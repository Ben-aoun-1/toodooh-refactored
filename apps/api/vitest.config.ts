import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // The eager env singleton (src/env.ts) parses at import; tests that
    // import it need DATABASE_URL present. Real DB tests mock the client.
    env: {
      DATABASE_URL: 'postgresql://test:test@localhost:5432/test_db',
    },
  },
});
