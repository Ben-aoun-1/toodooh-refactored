import { defineConfig } from 'vitest/config';

import { baseDatabaseUrl, workerCount } from './tests/helpers/parallel-db.js';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Files run IN PARALLEL, one Postgres database per worker (tests/helpers/parallel-db.ts).
    // The suite used to be serial because signup/profile/admin… all TRUNCATE the same tables;
    // each worker now owns a private clone of the migrated template, so that reason is gone.
    // Measured 2026-09-11: 1740 tests took 579 s serial in CI. TEST_WORKERS=1 restores the
    // old behaviour for bisecting an order-dependent failure.
    maxWorkers: workerCount(),
    globalSetup: ['./tests/helpers/global-setup.ts'],
    setupFiles: ['./tests/helpers/setup-worker-db.ts'],
    // The eager env singleton (src/env.ts) parses at import. Integration tests
    // (signup.test.ts) need a REAL DATABASE_URL, so read process.env first and
    // fall back to the fake for DB-free suites (CF-21 shim, env-aware). This is the
    // TEMPLATE url; setup-worker-db.ts rewrites it per worker before src/env.ts loads.
    env: {
      DATABASE_URL: baseDatabaseUrl(),
      AUTH_SECRET: process.env['AUTH_SECRET'] ?? 'test-auth-secret-at-least-32-characters-long',
      // WIFI_ENC_KEY = base64 of 32 zero bytes (a 32-byte key); a fixed test key,
      // never a real secret. wifi-crypto round-trips against this in unit tests.
      WIFI_ENC_KEY: process.env['WIFI_ENC_KEY'] ?? 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
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
      // R1 report renderer — pass through so the real-chromium smoke runs when the machine has
      // one (unset → the guarded suite skips; CI stays chromium-free).
      ...(process.env['CHROMIUM_PATH'] ? { CHROMIUM_PATH: process.env['CHROMIUM_PATH'] } : {}),
      // CF-SH1 media probe — same posture: the ffprobe-dependent upload tests run only where an
      // explicit FFPROBE_PATH exists (the docker image); dev/CI without ffmpeg skips them.
      ...(process.env['FFPROBE_PATH'] ? { FFPROBE_PATH: process.env['FFPROBE_PATH'] } : {}),
    },
  },
});
