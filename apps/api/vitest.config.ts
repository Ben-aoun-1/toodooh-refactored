import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Run test files sequentially: signup.test.ts and profile.test.ts both write the
    // shared `users` table (signup truncates in beforeEach), so parallel files would
    // race on the same Postgres. The api suite is small — serializing is cheap.
    fileParallelism: false,
    // The eager env singleton (src/env.ts) parses at import. Integration tests
    // (signup.test.ts) need a REAL DATABASE_URL, so read process.env first and
    // fall back to the fake for DB-free suites (CF-21 shim, env-aware).
    env: {
      DATABASE_URL: process.env['DATABASE_URL'] ?? 'postgresql://test:test@localhost:5432/test_db',
      AUTH_SECRET: process.env['AUTH_SECRET'] ?? 'test-auth-secret-at-least-32-characters-long',
      // Required SMTP vars (HOST/PORT/SECURE default in env.ts). nodemailer is
      // mocked in tests, so these are never used to connect.
      SMTP_USER: process.env['SMTP_USER'] ?? 'ci@too-dooh.com',
      SMTP_PASSWORD: process.env['SMTP_PASSWORD'] ?? 'ci-smtp-password',
      SMTP_FROM: process.env['SMTP_FROM'] ?? 'no-reply@too-dooh.com',
      // STORAGE_* required vars (BUCKET/REGION default in env.ts). The S3 client is
      // unit-mocked; only the integration suite connects to a real MinIO.
      STORAGE_ENDPOINT: process.env['STORAGE_ENDPOINT'] ?? 'http://localhost:9000',
      STORAGE_ACCESS_KEY: process.env['STORAGE_ACCESS_KEY'] ?? 'minioadmin',
      STORAGE_SECRET_KEY: process.env['STORAGE_SECRET_KEY'] ?? 'minioadmin',
    },
  },
});
