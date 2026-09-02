/** 0–47 — the half-hour grid width (slice C). Local so the two twins stay import-free. */
const SLOTS_PER_DAY = 48;

/**
 * AFF1 — affluence provenance, the ONE display home (operator ruling 2026-08-26).
 *
 * The hub's affluence grid is ONE merged weekday×hour truth: PAX readings first (`measured`),
 * the admin's manual grid as backup where the measure is 0 during opening hours (`backup`). The
 * api stores that provenance per slot and serves it beside the values (`sources`, `counts`);
 * the three owner surfaces — « Votre audience », Mes performances S02 and (through the api twin)
 * the PDF S02 — show the MERGED values WITH provenance. This module is the only place that says
 * what a cell's (value, source) pair MEANS; components label, they never re-derive.
 *
 * Provenance is display-only: dispatch, C_max, event pricing and settlement never read it.
 */

/** A slot's provenance as the hub reports it — `null` = unknown (pre-AFF1 row or hub). */
export type AffluenceSource = 'measured' | 'backup';

/**
 * What a surface renders for a cell: solid / estimation / hachure — plus, since slice C, `mixte`.
 *
 * `mixte` is a COLLAPSED-HOUR kind and nothing else. It exists only where a half-hour grid is
 * squeezed back into one column for width (S02 at ≤375 px), because there the mixing is FORCED by
 * the viewport rather than chosen. It must never widen into « anything not clearly measured »:
 * `cellProvenance`'s conservative rule stands untouched — a cell with an unknown source and a
 * value is still `backup`, an estimation, exactly as AFF1 ruled.
 */
export type ProvenanceKind = 'measured' | 'backup' | 'none' | 'mixte';

export const PROVENANCE_LABELS = {
  measured: 'Mesuré (capteur)',
  backup: 'Estimation',
  mixte: 'Mixte (mesure + estimation)',
} as const;

/** « Votre audience » — the one line under the summaries when not ONE slot is measured. */
export const ESTIMATED_ONLY_NOTE =
  'Valeurs estimées (aucune mesure capteur sur les 4 dernières semaines)';

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

export function provenanceLabel(kind: ProvenanceKind): string {
  return kind === 'none' ? 'Aucune donnée' : PROVENANCE_LABELS[kind];
}

/**
 * The 7×48 kinds grid (Monday-first) from the api's `grid` + `sources`. Tolerates a missing or
 * short `sources` (pre-AFF1 payload → unknown provenance everywhere) and an empty `grid` (idle
 * query → all none), so a surface never has to guard the shape itself.
 */
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

/**
 * A day tile aggregates its slots: it is « mesuré » only when EVERY data-carrying slot is; one
 * estimated slot makes the whole day's total an estimation; no data at all → none.
 */
export function dayProvenance(kinds: readonly ProvenanceKind[]): ProvenanceKind {
  let sawMeasured = false;
  for (const kind of kinds) {
    if (kind === 'backup') return 'backup';
    if (kind === 'measured') sawMeasured = true;
  }
  return sawMeasured ? 'measured' : 'none';
}

/** Data exists but not one measured slot (counts are PURE tallies — a NULL-source-only venue
 * has data too) → the summaries are estimates and say so. */
export function affluenceAllEstimated(
  counts: { measured: number; backup: number },
  hasData: boolean,
): boolean {
  return hasData && counts.measured === 0;
}

/**
 * The explanatory empty state — ONLY with no measured, no backup AND no data (ruling): a
 * NULL-source-only venue has data and renders as estimation, never as empty.
 */
export function affluenceEmpty(input: {
  has_data: boolean;
  counts: { measured: number; backup: number };
}): boolean {
  return !input.has_data && input.counts.measured === 0 && input.counts.backup === 0;
}

/**
 * Slice C — the kind of ONE HOUR whose two half-hour cells are collapsed for width.
 *
 * Halves that carry no data are ignored rather than counted as disagreement: an hour with one
 * measured half and one empty half is measured, not mixed — nothing contradicts the measure. Only
 * a genuine measured-beside-estimated pair is `mixte`, which is the disagreement a reader at
 * 375 px cannot otherwise see.
 */
export function collapsedHourKind(halves: readonly ProvenanceKind[]): ProvenanceKind {
  const carrying = halves.filter((kind) => kind !== 'none');
  if (carrying.length === 0) return 'none';
  const first = carrying[0] as ProvenanceKind;
  return carrying.every((kind) => kind === first) ? first : 'mixte';
}
