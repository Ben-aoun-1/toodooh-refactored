/**
 * Bounded availability probes (prod-blocker lane). The email/tax conflict probes fail OPEN on
 * 429/network (`null` verdict — the signup submit stays the server-side authority), but a probe
 * that HANGS (mobile radio black-hole, proxy stall) would hold the Suivant click forever with no
 * verdict at all. Every probe race-bounds here: past the deadline the verdict is `null` — the
 * same fail-open path as a network error. Rate-limit courtesy (per-value caching) is untouched:
 * a timeout is never cached, so the next click re-asks.
 */

export const PROBE_TIMEOUT_MS = 8000;

export function probeWithTimeout<T>(
  probe: Promise<T | null>,
  timeoutMs: number = PROBE_TIMEOUT_MS,
): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  return Promise.race([probe.catch(() => null), deadline]).finally(() =>
    clearTimeout(timer),
  ) as Promise<T | null>;
}
