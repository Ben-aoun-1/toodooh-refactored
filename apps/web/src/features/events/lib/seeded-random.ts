/**
 * mulberry32 — a tiny deterministic PRNG: the same seed always yields the same sequence, so a
 * drawn scene (crowd, stars, lit windows) is identical on every render. Shared by the poster's
 * stadium and the Événements home scenes (Youssef's design uses the same generator).
 */
export function seededRandom(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
