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
  // SUP-1 — where a copy of each support message goes once ops create the mailbox; unset = no copy.
  SUPPORT_MAILBOX: z.email().optional(),
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
  // toodooh ↔ wedooh sync (S-T1). ALL THREE ARE OPTIONAL by design — env.ts parses eagerly at
  // import (line below), so a REQUIRED var here would fail-fast every entrypoint (server, migrate
  // script, every vitest file) and re-run the 2026-06-10 CI-red incident unless ci.yml/deploy.yml/
  // vitest.config all carry a dummy. Unset = the sync degrades: inbound /api/internal/* returns 503
  // SYNC_DISABLED, the outbound B2 push no-ops with a boot warning. Provisioned at S-INT switch-on.
  //   WEDOOH_SYNC_KEY  — inbound guard: wedooh presents it (Bearer) on /api/internal/*; we validate.
  //   TOODOOH_SYNC_KEY — outbound auth: we present it (x-api-key) on the B2 push to wedooh.
  //   WEDOOH_INGEST_URL — wedooh's base URL for the B2 location push (e.g. https://hub.too-dooh.com).
  WEDOOH_SYNC_KEY: z.string().min(16).optional(),
  TOODOOH_SYNC_KEY: z.string().min(16).optional(),
  WEDOOH_INGEST_URL: z.url().optional(),
  // (The FACTURE_BANK_* block was removed at GREEN1. The facture's bank coordinates now come
  // from dispatch_config.bank_* alone — the ONE home FCT1's « Pour info » block already read.
  // Prod never carried these vars, so the env fallback could only ever yield the '—' placeholder
  // that config already returns; it was ceremony, not a fallback. See lib/facture.ts.)
  // Chromium executable for the report renderer (R1). OPTIONAL for the same eager-parse reason as
  // the WEDOOH_* block: unset, the renderer falls back to PUPPETEER_EXECUTABLE_PATH (the docker
  // image sets it) then common system paths; when none resolves, report rendering fails with a
  // clear error while every other route keeps serving.
  CHROMIUM_PATH: z.string().min(1).optional(),
  // ffprobe executable for authoritative creative validation (CF-SH1). OPTIONAL, the CHROMIUM_PATH
  // posture: the docker image installs ffmpeg and sets it; unset (dev without ffmpeg), byte-sniffing
  // still applies but codec/ratio/duration checks SKIP with ONE boot warning — never block dev,
  // never silently skip in the real image.
  FFPROBE_PATH: z.string().min(1).optional(),
  // ffmpeg executable for the WebP-photo → PNG conversion on upload (UPL-4). OPTIONAL, the same
  // posture: the docker image sets it; unset, a WebP photo is REFUSED as before (UPL-2) with ONE
  // boot warning — only PNG/JPEG is ever stored either way.
  FFMPEG_PATH: z.string().min(1).optional(),
  // Claude API key for the report's AI recommendations (R2). OPTIONAL by design, mirroring the
  // WEDOOH_* pattern: unset, the feature is OFF — every report keeps the generic pistes and boot
  // logs ONE warning. The operator provisions the real key in /srv/toodooh/.env at switch-on.
  ANTHROPIC_API_KEY: z.string().min(16).optional(),
  // SIM-0 — the admin « Simulateur ». OPTIONAL by design (the WEDOOH_* posture: eager parse must
  // never fail-fast an entrypoint). Off → every /api/admin/simulations/* answers 503
  // SIMULATOR_DISABLED and the boot orphan sweep does not run. MAX bounds the number of sandbox
  // DATABASES on the server (each holds a small pool; see simulator/pools.ts).
  SIMULATOR_ENABLED: z.stringbool().default(false),
  SIMULATOR_MAX_SANDBOXES: z.coerce.number().int().min(1).max(20).default(5),
  // LEARN-1 (spec 2026-09-21, hub + toodooh) — the learned half-hour average. OFF by default, and
  // off is today's behaviour byte for byte. ON ('true'): periodAudience takes the hub's per-date
  // cells as they are (T3 — measured, else the hub's estimate, nothing outside the venue's hours)
  // and computeAmax prices events on the highest hour ever MEASURED (F1). THE one switch: every
  // reader resolves it from here (each accepts a per-call override for tests). Flip it only after
  // the hub's own flag is on AND its full-history push has landed (spec §6, steps 5 → 6).
  LEARNED_AFFLUENCE_ENABLED: z.stringbool().default(false),
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
