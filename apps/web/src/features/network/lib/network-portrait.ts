import type { NetworkCsp } from '@/features/network/services/network.api';

import {
  CSP_LABELS,
  CSP_ORDER,
  allSpots,
  type NetworkCategory,
  type NetworkEntry,
} from './network-entries';

// RESEAU-1 — « Le portrait du réseau ». The prototype's CSP, gender and age tiles carried
// « Valeurs illustratives »; here every tile is computed from the real entries, a null value is
// left out of its tally, and a tile with nothing to show returns null (the page prints « – »).

/** The prototype's `tally`: counts by key in first-seen order, biggest first (stable). */
export function tally<T>(
  items: readonly T[],
  keyOf: (item: T) => string | null,
): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = keyOf(item);
    if (key === null) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

export interface CategoryRow {
  category: NetworkCategory;
  count: number;
  /** Bar width, the category's share of all entries (0–100). */
  widthPct: number;
}

export function categoryRows(entries: readonly NetworkEntry[]): CategoryRow[] {
  const byId = new Map(entries.map((e) => [e.category.id, e.category]));
  return tally(entries, (e) => e.category.id).flatMap(([id, count]) => {
    const category = byId.get(id);
    return category ? [{ category, count, widthPct: (count / entries.length) * 100 }] : [];
  });
}

export interface RegionRow {
  region: string;
  count: number;
}

/** Venues per region; for parks, LOCATIONS per region (« Emplacements par région »). */
export function regionRows(entries: readonly NetworkEntry[]): RegionRow[] {
  return tally(allSpots(entries), (s) => s.region).map(([region, count]) => ({ region, count }));
}

export interface CspRow {
  csp: NetworkCsp;
  label: string;
  count: number;
  /** Bar height relative to the biggest CSP (0–100). */
  heightPct: number;
}

export function cspRows(entries: readonly NetworkEntry[]): CspRow[] | null {
  const counts = new Map(tally(entries, (e) => e.csp));
  const max = Math.max(0, ...counts.values());
  if (max === 0) return null;
  return CSP_ORDER.flatMap((csp) => {
    const count = counts.get(csp);
    return count ? [{ csp, label: CSP_LABELS[csp], count, heightPct: (count / max) * 100 }] : [];
  });
}

export interface GenderSplit {
  male: number;
  female: number;
}

/** The average split of the entries that have BOTH values; the two figures always sum to 100. */
export function genderSplit(entries: readonly NetworkEntry[]): GenderSplit | null {
  let sum = 0;
  let n = 0;
  for (const e of entries) {
    if (e.malePct === null || e.femalePct === null) continue;
    const total = e.malePct + e.femalePct;
    if (total <= 0) continue;
    sum += (e.malePct / total) * 100;
    n += 1;
  }
  if (n === 0) return null;
  const male = Math.round(sum / n);
  return { male, female: 100 - male };
}

export interface AgeRow {
  label: string;
  /** Rounded share, as printed. */
  pct: number;
  /** Bar height relative to the biggest band (0–100). */
  heightPct: number;
  isMax: boolean;
}

/**
 * The average age split of the entries that carry one, band by band in first-seen order (a band an
 * entry does not list counts as 0 for it). Null when no entry has bands.
 */
export function ageRows(entries: readonly NetworkEntry[]): AgeRow[] | null {
  const withBands = entries.filter((e) => e.ageBands !== null && e.ageBands.length > 0);
  if (withBands.length === 0) return null;
  const sums = new Map<string, number>();
  for (const e of withBands) {
    for (const band of e.ageBands ?? []) {
      sums.set(band.label, (sums.get(band.label) ?? 0) + band.pct);
    }
  }
  const means = [...sums.entries()].map(([label, sum]) => ({
    label,
    mean: sum / withBands.length,
  }));
  const max = Math.max(...means.map((m) => m.mean));
  if (!(max > 0)) return null;
  const top = means.findIndex((m) => m.mean === max);
  return means.map((m, i) => ({
    label: m.label,
    pct: Math.round(m.mean),
    heightPct: (m.mean / max) * 100,
    isMax: i === top,
  }));
}
