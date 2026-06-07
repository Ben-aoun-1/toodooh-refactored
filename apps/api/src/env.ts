import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).optional(),
  DATABASE_URL: z.string().min(1),
  AUTH_SECRET: z
    .string()
    .min(32, 'AUTH_SECRET must be at least 32 characters for cryptographic security'),
  // App-layer AES-256-GCM key for screenhost WiFi passwords (recoverable at-rest
  // encryption). A base64 string decoding to EXACTLY 32 bytes; fails fast at boot,
  // mirroring AUTH_SECRET. Generate with: openssl rand -base64 32. The real key is
  // provisioned on the VPS as a deploy-time operator task.
  WIFI_ENC_KEY: z
    .string()
    .refine(
      (value) => Buffer.from(value, 'base64').length === 32,
      'WIFI_ENC_KEY must be a base64 string decoding to exactly 32 bytes',
    ),
  // Base URL for better-auth verification links. Dev default avoids a test-env
  // shim; production overrides to https://api.too-dooh.com (Phase 1g).
  BETTER_AUTH_URL: z.url().default('http://localhost:4000'),
  // Browser origin allowed to reach the API: @fastify/cors `origin` + better-auth
  // `trustedOrigins`. Dev = Vite's origin (a same-origin proxy fronts :4000); prod
  // overrides to the web origin (joins BETTER_AUTH_URL/SMTP/STORAGE at deploy).
  WEB_ORIGIN: z.url().default('http://localhost:5173'),
  // SMTP (OVH) — verification email send (Commit 4). HOST/PORT/SECURE default;
  // USER/PASSWORD/FROM required (fast-fail at boot).
  SMTP_HOST: z.string().default('smtp.mail.ovh.net'),
  SMTP_PORT: z.coerce.number().int().positive().default(465),
  SMTP_SECURE: z.stringbool().default(true),
  SMTP_USER: z.email(),
  SMTP_PASSWORD: z.string().min(8),
  SMTP_FROM: z.email(),
  // MinIO / S3-compatible object storage (Commit 2). ENDPOINT/ACCESS_KEY/SECRET_KEY
  // required (fast-fail at boot); BUCKET/REGION default. forcePathStyle is set in code.
  // STORAGE_ENDPOINT is the INTERNAL endpoint for ALL server-side SDK calls (upload,
  // ensure-bucket, delete) — on the VPS this is http://minio:9000 (the api container
  // can't reach the public host: it 301-redirects via the legacy origin until 1h-flip).
  STORAGE_ENDPOINT: z.url(),
  // Browser-facing endpoint used ONLY to sign presigned GET URLs (slice-1 hotfix C1).
  // Falls back to STORAGE_ENDPOINT when unset, preserving dev's single-host setup. On the
  // VPS this is http://too-dooh.com; presigned downloads stay broken until the production
  // A-record is flipped to the VPS (1h-flip) — expected, gated, not a regression.
  STORAGE_PUBLIC_ENDPOINT: z.url().optional(),
  STORAGE_ACCESS_KEY: z.string().min(1),
  STORAGE_SECRET_KEY: z.string().min(1),
  STORAGE_BUCKET: z.string().min(1).default('toodooh-documents'),
  STORAGE_REGION: z.string().min(1).default('us-east-1'),
});

export type Env = z.infer<typeof EnvSchema> & {
  LOG_LEVEL: NonNullable<z.infer<typeof EnvSchema>['LOG_LEVEL']>;
};

export const parseEnv = (raw: NodeJS.ProcessEnv): Env => {
  const result = EnvSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const parsed = result.data;
  const logLevel: Env['LOG_LEVEL'] =
    parsed.LOG_LEVEL ?? (parsed.NODE_ENV === 'production' ? 'info' : 'debug');
  return { ...parsed, LOG_LEVEL: logLevel };
};

export const env: Env = parseEnv(process.env);
