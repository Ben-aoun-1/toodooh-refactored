/** 0–47 — the half-hour grid width (slice C). Local so the two twins stay import-free. */
const SLOTS_PER_DAY = 48;

/**
 * AFF1 — affluence provenance, the api TWIN of the web's ONE display home
 * (apps/web/src/features/screenhost/lib/affluence-provenance.ts). The PDF's S02 applies the SAME
 * (value, source) → kind rule and the SAME French labels as the page; each package pins both in
 * its own test so neither side can drift silently. Keep the two files rule-identical.
 *
 * Provenance is display-only: dispatch, C_max, event pricing and settlement never read it.
 */

/** A slot's provenance as the hub reports it — `null` = unknown (pre-AFF1 row or hub). */
export type AffluenceSource = 'measured' | 'backup';

/**
 * What a surface renders for a cell: solid / estimation / hachure.
 *
 * PEAK-MAX1 (2026-09-04) RETIRED the `mixte` kind. It was slice C's collapsed-hour kind and
 * nothing else — « the number you see blends a measure and an estimation » — and under the peak
 * rule no number is a blend any more: a cell, collapsed or not, shows ONE reading and therefore
 * carries that reading's provenance. The state was not merely unreachable, it had become false by
 * construction, and a legend row no cell can ever wear is a lie of its own.
 *
 * `cellProvenance`'s conservative rule stands untouched — a cell with an unknown source and a
 * value is still `backup`, an estimation, exactly as AFF1 ruled.
 */
export type ProvenanceKind = 'measured' | 'backup' | 'none';

export const PROVENANCE_LABELS = {
  measured: 'Mesuré (capteur)',
  backup: 'Estimation',
} as const;

/**
 * THE rule. A known provenance wins whatever the value (a measured 0 IS a measurement, a backup
 * 0 IS an estimate). Unknown provenance with a value is labelled the CONSERVATIVE way — an
 * estimation, never a measure; unknown provenance without a value is no data at all.
 */
export function cellProvenance(value: number, source: AffluenceSource | null): ProvenanceKind {
  if (source === 'measured') return 'measured';
  if (source === 'backup') return 'backup';
  return value > 0 ? 'backup' : 'none';
}

/** The 7×48 kinds grid (Monday-first) from `grid` + `sources`; a missing/short `sources` reads
 * as unknown provenance everywhere, an empty `grid` as all none. */
export function provenanceGrid(
  grid: readonly (readonly number[])[],
  sources: readonly (readonly (AffluenceSource | null)[])[],
): ProvenanceKind[][] {
  return Array.from({ length: 7 }, (_, day) =>
    Array.from({ length: SLOTS_PER_DAY }, (__, slot) =>
      cellProvenance(grid[day]?.[slot] ?? 0, sources[day]?.[slot] ?? null),
    ),
  );
}

/** The explanatory empty state — ONLY with no measured, no backup AND no data (a NULL-source-only
 * venue has data and renders as estimation, never as empty). */
export function affluenceEmpty(input: {
  has_data: boolean;
  counts: { measured: number; backup: number };
}): boolean {
  return !input.has_data && input.counts.measured === 0 && input.counts.backup === 0;
}
