// Per-socket inbound rate limiter for the screen WebSocket (a public, billing-adjacent surface).
// Fixed-window counter: within each `windowMs`, the first `maxPerWindow` messages pass ('ok'); past
// that they are 'drop'ped; a sustained flood beyond `closeAt` returns 'close' (the caller closes the
// socket). The clock is injectable for deterministic tests.
export interface RateLimiter {
  hit(): 'ok' | 'drop' | 'close';
}

export interface RateLimiterOptions {
  maxPerWindow: number;
  closeAt: number;
  windowMs?: number;
  now?: () => number;
}

export const createRateLimiter = (opts: RateLimiterOptions): RateLimiter => {
  const windowMs = opts.windowMs ?? 1000;
  const now = opts.now ?? ((): number => Date.now());
  let windowStart = now();
  let count = 0;
  return {
    hit(): 'ok' | 'drop' | 'close' {
      const t = now();
      if (t - windowStart >= windowMs) {
        windowStart = t;
        count = 0;
      }
      count += 1;
      if (count > opts.closeAt) return 'close';
      if (count > opts.maxPerWindow) return 'drop';
      return 'ok';
    },
  };
};
