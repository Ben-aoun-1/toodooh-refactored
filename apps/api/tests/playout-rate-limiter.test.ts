import { describe, expect, it } from 'vitest';

import { createRateLimiter } from '../src/lib/playout/rate-limiter.js';

describe('createRateLimiter — fixed-window per-socket cap', () => {
  it('passes up to maxPerWindow, then drops, then closes past closeAt (same window)', () => {
    const t = 1000;
    const rl = createRateLimiter({ maxPerWindow: 3, closeAt: 5, windowMs: 1000, now: () => t });
    expect([rl.hit(), rl.hit(), rl.hit()]).toEqual(['ok', 'ok', 'ok']); // 1..3
    expect([rl.hit(), rl.hit()]).toEqual(['drop', 'drop']); // 4..5 (> max, ≤ closeAt)
    expect(rl.hit()).toBe('close'); // 6 (> closeAt)
  });

  it('resets the count when the window rolls over', () => {
    let t = 0;
    const rl = createRateLimiter({ maxPerWindow: 2, closeAt: 10, windowMs: 1000, now: () => t });
    expect([rl.hit(), rl.hit(), rl.hit()]).toEqual(['ok', 'ok', 'drop']);
    t = 1000; // new window
    expect(rl.hit()).toBe('ok');
  });
});
