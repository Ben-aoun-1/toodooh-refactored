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

/** What a surface renders for a cell: solid / estimation / hachure. */
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

/** The 7×24 kinds grid (Monday-first) from `grid` + `sources`; a missing/short `sources` reads
 * as unknown provenance everywhere, an empty `grid` as all none. */
export function provenanceGrid(
  grid: readonly (readonly number[])[],
  sources: readonly (readonly (AffluenceSource | null)[])[],
): ProvenanceKind[][] {
  return Array.from({ length: 7 }, (_, day) =>
    Array.from({ length: 24 }, (__, hour) =>
      cellProvenance(grid[day]?.[hour] ?? 0, sources[day]?.[hour] ?? null),
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
