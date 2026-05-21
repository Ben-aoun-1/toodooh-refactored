import { describe, expect, it } from 'vitest';

import { parseEnv } from '../src/env.js';

const DB = 'postgresql://test:test@localhost:5432/test_db';
const SECRET = 'test-auth-secret-at-least-32-characters-long';

describe('parseEnv', () => {
  it('applies defaults when only DATABASE_URL + AUTH_SECRET are set', () => {
    const env = parseEnv({ DATABASE_URL: DB, AUTH_SECRET: SECRET });
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(4000);
    expect(env.HOST).toBe('0.0.0.0');
    expect(env.LOG_LEVEL).toBe('debug');
    expect(env.DATABASE_URL).toBe(DB);
  });

  it('uses info LOG_LEVEL when NODE_ENV=production', () => {
    const env = parseEnv({ NODE_ENV: 'production', DATABASE_URL: DB, AUTH_SECRET: SECRET });
    expect(env.LOG_LEVEL).toBe('info');
  });

  it('rejects malformed PORT', () => {
    expect(() => parseEnv({ PORT: 'abc', DATABASE_URL: DB })).toThrowError(
      /Invalid environment configuration/,
    );
  });

  it('rejects missing DATABASE_URL', () => {
    expect(() => parseEnv({})).toThrowError(/DATABASE_URL/);
  });

  it('rejects AUTH_SECRET shorter than 32 characters', () => {
    expect(() => parseEnv({ DATABASE_URL: DB, AUTH_SECRET: 'too-short' })).toThrowError(
      /AUTH_SECRET must be at least 32 characters/,
    );
  });
});
