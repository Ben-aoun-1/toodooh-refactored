import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).optional(),
  DATABASE_URL: z.string().min(1),
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
