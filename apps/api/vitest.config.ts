import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // The eager env singleton (src/env.ts) parses at import. Integration tests
    // (signup.test.ts) need a REAL DATABASE_URL, so read process.env first and
    // fall back to the fake for DB-free suites (CF-21 shim, env-aware).
    env: {
      DATABASE_URL: process.env['DATABASE_URL'] ?? 'postgresql://test:test@localhost:5432/test_db',
      AUTH_SECRET: process.env['AUTH_SECRET'] ?? 'test-auth-secret-at-least-32-characters-long',
    },
  },
});
