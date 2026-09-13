// SIM-1 — the one random source of the world generator. Deterministic by construction: the same
// seed string yields the same stream, so a world is reproducible from its seed alone (the seed is
// stored on the simulation row and shown on the page). `Math.random` is never called anywhere in
// the generator — a single `Math.random` would make a world unreproducible and the determinism
// test would catch it.

/** cyrb128 — a string → 4×32-bit hash, the seeding front-end for mulberry32. */
const hashSeed = (seed: string): number => {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i += 1) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
};

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform integer in [min, max] (inclusive both ends). */
  int(min: number, max: number): number;
  /** Uniform float in [min, max). */
  float(min: number, max: number): number;
  /** Uniform element. Throws on an empty list (a generator bug, never user input). */
  pick<T>(values: readonly T[]): T;
  /** Weighted element; weights need not sum to 1. */
  weighted<T>(entries: readonly { value: T; weight: number }[]): T;
  /** True with probability p. */
  bool(p: number): boolean;
  /** A v4-SHAPED uuid drawn from this stream (not crypto-random — reproducibility is the point). */
  uuid(): string;
}

export const createRng = (seed: string): Rng => {
  let state = hashSeed(seed);
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number): number => min + Math.floor(next() * (max - min + 1));
  const hex = (n: number): string => {
    let out = '';
    for (let i = 0; i < n; i += 1) out += '0123456789abcdef'[int(0, 15)];
    return out;
  };
  return {
    next,
    int,
    float: (min, max) => min + next() * (max - min),
    pick: <T>(values: readonly T[]): T => {
      if (values.length === 0) throw new Error('rng.pick on an empty list');
      return values[int(0, values.length - 1)]!;
    },
    weighted: <T>(entries: readonly { value: T; weight: number }[]): T => {
      const total = entries.reduce((sum, e) => sum + e.weight, 0);
      if (total <= 0) throw new Error('rng.weighted needs a positive total weight');
      let roll = next() * total;
      for (const entry of entries) {
        roll -= entry.weight;
        if (roll < 0) return entry.value;
      }
      return entries[entries.length - 1]!.value;
    },
    bool: (p) => next() < p,
    // Version 4 / variant 8-b nibbles so Postgres' uuid type and zod's z.uuid() both accept it.
    uuid: () => `${hex(8)}-${hex(4)}-4${hex(3)}-${'89ab'[int(0, 3)]!}${hex(3)}-${hex(12)}`,
  };
};
