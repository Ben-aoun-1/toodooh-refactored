import { describe, expect, it } from 'vitest';

import { parseEnv } from '../src/env.js';

const DB = 'postgresql://test:test@localhost:5432/test_db';
const SECRET = 'test-auth-secret-at-least-32-characters-long';
// base64 of 32 zero bytes — a valid 32-byte key shape, never a real secret.
const WIFI_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
const SMTP = { SMTP_USER: 'a@b.com', SMTP_PASSWORD: 'pw-min-8ch', SMTP_FROM: 'no-reply@b.com' };
const STORAGE = {
  STORAGE_ENDPOINT: 'http://localhost:9000',
  STORAGE_ACCESS_KEY: 'minioadmin',
  STORAGE_SECRET_KEY: 'minioadmin',
};

describe('parseEnv', () => {
  it('applies defaults when only the required vars are set', () => {
    const env = parseEnv({
      DATABASE_URL: DB,
      AUTH_SECRET: SECRET,
      WIFI_ENC_KEY: WIFI_KEY,
      ...SMTP,
      ...STORAGE,
    });
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(4000);
    expect(env.HOST).toBe('0.0.0.0');
    expect(env.LOG_LEVEL).toBe('debug');
    expect(env.DATABASE_URL).toBe(DB);
    // SMTP defaults (z.stringbool / z.coerce.number)
    expect(env.SMTP_HOST).toBe('smtp.mail.ovh.net');
    expect(env.SMTP_PORT).toBe(465);
    expect(env.SMTP_SECURE).toBe(true);
    // STORAGE defaults (BUCKET/REGION)
    expect(env.STORAGE_BUCKET).toBe('toodooh-documents');
    expect(env.STORAGE_REGION).toBe('us-east-1');
    // WEB_ORIGIN default (CORS origin + better-auth trustedOrigins)
    expect(env.WEB_ORIGIN).toBe('http://localhost:5173');
  });

  it('uses info LOG_LEVEL when NODE_ENV=production', () => {
    const env = parseEnv({
      NODE_ENV: 'production',
      DATABASE_URL: DB,
      AUTH_SECRET: SECRET,
      WIFI_ENC_KEY: WIFI_KEY,
      ...SMTP,
      ...STORAGE,
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
        WIFI_ENC_KEY: WIFI_KEY,
        ...STORAGE,
        SMTP_PASSWORD: 'pw-min-8ch',
        SMTP_FROM: 'no-reply@b.com',
      }),
    ).toThrowError(/SMTP_USER/);
  });

  it('rejects missing STORAGE_ENDPOINT', () => {
    expect(() =>
      parseEnv({
        DATABASE_URL: DB,
        AUTH_SECRET: SECRET,
        WIFI_ENC_KEY: WIFI_KEY,
        ...SMTP,
        STORAGE_ACCESS_KEY: 'minioadmin',
        STORAGE_SECRET_KEY: 'minioadmin',
      }),
    ).toThrowError(/STORAGE_ENDPOINT/);
  });

  it('accepts a WIFI_ENC_KEY that is base64 of exactly 32 bytes', () => {
    const env = parseEnv({
      DATABASE_URL: DB,
      AUTH_SECRET: SECRET,
      WIFI_ENC_KEY: WIFI_KEY,
      ...SMTP,
      ...STORAGE,
    });
    expect(env.WIFI_ENC_KEY).toBe(WIFI_KEY);
  });

  it('rejects missing WIFI_ENC_KEY', () => {
    expect(() =>
      parseEnv({ DATABASE_URL: DB, AUTH_SECRET: SECRET, ...SMTP, ...STORAGE }),
    ).toThrowError(/WIFI_ENC_KEY/);
  });

  it('rejects a WIFI_ENC_KEY that does not decode to 32 bytes', () => {
    // base64 of 16 bytes — a 128-bit key, too short for AES-256.
    expect(() =>
      parseEnv({
        DATABASE_URL: DB,
        AUTH_SECRET: SECRET,
        WIFI_ENC_KEY: 'AAAAAAAAAAAAAAAAAAAAAA==',
        ...SMTP,
        ...STORAGE,
      }),
    ).toThrowError(/WIFI_ENC_KEY must be a base64 string decoding to exactly 32 bytes/);
  });

  it('LEARN-1: LEARNED_AFFLUENCE_ENABLED is OFF by default and ON only when set', () => {
    const base = {
      DATABASE_URL: DB,
      AUTH_SECRET: SECRET,
      WIFI_ENC_KEY: WIFI_KEY,
      ...SMTP,
      ...STORAGE,
    };
    expect(parseEnv(base).LEARNED_AFFLUENCE_ENABLED).toBe(false);
    expect(parseEnv({ ...base, LEARNED_AFFLUENCE_ENABLED: 'true' }).LEARNED_AFFLUENCE_ENABLED).toBe(
      true,
    );
    expect(
      parseEnv({ ...base, LEARNED_AFFLUENCE_ENABLED: 'false' }).LEARNED_AFFLUENCE_ENABLED,
    ).toBe(false);
  });

  it('LEARN-1: a malformed LEARNED_AFFLUENCE_ENABLED fails the boot — never silently on or off', () => {
    expect(() =>
      parseEnv({
        DATABASE_URL: DB,
        AUTH_SECRET: SECRET,
        WIFI_ENC_KEY: WIFI_KEY,
        ...SMTP,
        ...STORAGE,
        LEARNED_AFFLUENCE_ENABLED: 'maybe',
      }),
    ).toThrowError(/LEARNED_AFFLUENCE_ENABLED/);
  });
});
