import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PROBE_TIMEOUT_MS, probeWithTimeout } from './probe-timeout';

// Bounded probes (prod-blocker lane): a hung availability check must NEVER hold the Suivant
// click — past the deadline the verdict is null, the same fail-open path as a network error.
describe('probeWithTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('a fast verdict passes through untouched', async () => {
    await expect(probeWithTimeout(Promise.resolve(true))).resolves.toBe(true);
    await expect(probeWithTimeout(Promise.resolve(false))).resolves.toBe(false);
  });

  it('a null (fail-open) verdict passes through', async () => {
    await expect(probeWithTimeout(Promise.resolve(null))).resolves.toBeNull();
  });

  it('a rejecting probe fails OPEN (null), never throws into the click handler', async () => {
    await expect(probeWithTimeout(Promise.reject(new Error('network')))).resolves.toBeNull();
  });

  it('a probe that HANGS resolves null at the deadline (the stuck-gate repro)', async () => {
    const hung = new Promise<boolean>(() => undefined); // never settles
    const verdict = probeWithTimeout(hung);
    await vi.advanceTimersByTimeAsync(PROBE_TIMEOUT_MS);
    await expect(verdict).resolves.toBeNull();
  });

  it('a verdict landing just before the deadline wins the race', async () => {
    let resolve!: (v: boolean) => void;
    const slow = new Promise<boolean>((r) => {
      resolve = r;
    });
    const verdict = probeWithTimeout(slow);
    await vi.advanceTimersByTimeAsync(PROBE_TIMEOUT_MS - 1);
    resolve(false);
    await expect(verdict).resolves.toBe(false);
  });
});
