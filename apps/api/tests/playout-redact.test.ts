import { describe, expect, it } from 'vitest';

import { redactTokenInUrl } from '../src/lib/playout/redact.js';

describe('redactTokenInUrl — keep the device token out of logs', () => {
  it('redacts the token value, keeps the key + other params', () => {
    expect(redactTokenInUrl('/ws/screen?screen_id=abc&token=secret123')).toBe(
      '/ws/screen?screen_id=abc&token=REDACTED',
    );
    expect(redactTokenInUrl('/ws/screen?token=secret&screen_id=abc')).toBe(
      '/ws/screen?token=REDACTED&screen_id=abc',
    );
  });
  it('leaves a token-less url untouched', () => {
    expect(redactTokenInUrl('/api/screens/mine')).toBe('/api/screens/mine');
  });
});
