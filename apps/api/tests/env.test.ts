import { describe, expect, it } from 'vitest';

import { parseEnv } from '../src/env.js';

const DB = 'postgresql://test:test@localhost:5432/test_db';
const SECRET = 'test-auth-secret-at-least-32-characters-long';
const SMTP = { SMTP_USER: 'a@b.com', SMTP_PASSWORD: 'pw-min-8ch', SMTP_FROM: 'no-reply@b.com' };

describe('parseEnv', () => {
  it('applies defaults when only the required vars are set', () => {
    const env = parseEnv({ DATABASE_URL: DB, AUTH_SECRET: SECRET, ...SMTP });
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(4000);
    expect(env.HOST).toBe('0.0.0.0');
    expect(env.LOG_LEVEL).toBe('debug');
    expect(env.DATABASE_URL).toBe(DB);
    // SMTP defaults (z.stringbool / z.coerce.number)
    expect(env.SMTP_HOST).toBe('smtp.mail.ovh.net');
    expect(env.SMTP_PORT).toBe(465);
    expect(env.SMTP_SECURE).toBe(true);
  });

  it('uses info LOG_LEVEL when NODE_ENV=production', () => {
    const env = parseEnv({
      NODE_ENV: 'production',
      DATABASE_URL: DB,
      AUTH_SECRET: SECRET,
      ...SMTP,
    });
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

  it('rejects missing SMTP_USER', () => {
    expect(() =>
      parseEnv({
        DATABASE_URL: DB,
        AUTH_SECRET: SECRET,
        SMTP_PASSWORD: 'pw-min-8ch',
        SMTP_FROM: 'no-reply@b.com',
      }),
    ).toThrowError(/SMTP_USER/);
  });
});
