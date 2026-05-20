import { describe, expect, it } from 'vitest';

import { parseEnv } from '../src/env.js';

describe('parseEnv', () => {
  it('applies defaults when env is empty', () => {
    const env = parseEnv({});
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(4000);
    expect(env.HOST).toBe('0.0.0.0');
    expect(env.LOG_LEVEL).toBe('debug');
  });

  it('uses info LOG_LEVEL when NODE_ENV=production', () => {
    const env = parseEnv({ NODE_ENV: 'production' });
    expect(env.LOG_LEVEL).toBe('info');
  });

  it('rejects malformed PORT', () => {
    expect(() => parseEnv({ PORT: 'abc' })).toThrowError(/Invalid environment configuration/);
  });
});
