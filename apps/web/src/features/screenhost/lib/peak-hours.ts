import { type ProvenanceKind, affluenceEmpty } from './affluence-provenance';
import { formatDecimalFr } from './performance-derive';

/**
 * PERF-QA1 R7 — the peak-hours section's HONEST semantics, in one pure home (apps/web has no
 * render harness — a rule that lives in a component is unpinnable).
 */

/**
 * BYTE-IDENTICAL twin of the api's PEAK_HOURS_LEAD (apps/api/src/lib/report/template.ts). Each
 * side pins the exact literal in its own test, so neither the page nor the PDF can be reworded
 * without the other — the two surfaces must never disagree on what this grid means. Do not
 * reword one without the other.
 *
 * PEAK-MAX1 (Mejri, confirmed by the operator 2026-09-04) — the grid is no longer a « semaine
 * type ». Each cell is the HIGHEST audience recorded on that créneau over the période: « peak means
 * the highest value ever recorded at a specific thirty-minute slot ». A quieter later week never
 * lowers a cell; only a higher reading raises it. The lead had to say so — « semaine type » reads
 * as a typical week, which is exactly the average this rule replaced.
 *
 * The période scoping STAYS (PERF-R2, operator 2026-08-30, superseding AFF1's « never the
 * période »): « Depuis le début » is what gives the all-time persistence she describes. Provenance
 * is unchanged in meaning (solid = measured by the sensor, dotted = estimation, hachure = closed,
 * out of the période, or no data at all) — it now names the cell that HOLDS the peak.
 */
export const PEAK_HOURS_LEAD =
  "Vos pics d'audience sur la période analysée : pour chaque créneau, la valeur la plus haute enregistrée, croisant les jours de la semaine et les heures d'ouverture — mesure de votre capteur en priorité, estimation en secours. Plus la couleur est vive, plus l'audience est élevée. Les cases pleines sont mesurées par votre capteur, les cases en pointillé sont des estimations. Les zones rayées correspondent à vos heures de fermeture, aux jours hors période ou aux créneaux sans aucune donnée.";

/** The S02 empty-state title — pinned here because the component itself is unpinnable. */
export const PEAK_HOURS_EMPTY_TITLE = "Pas encore de mesure d'audience";

/** The mockups' fallback window (8h–21h, 14 columns) — used ONLY when the hours are unknown. */
export const FALLBACK_HEATMAP_HOURS: readonly number[] = Array.from(
  { length: 14 },
  (_, i) => i + 8,
);

/**
 * R7 — the heatmap's hour columns come from the venue's REAL hours (`[opening, closing)`); the
 * 8h–21h mockup window is only the null / zero-width fallback. HOURS-X1: an inverted pair is an
 * overnight window — the columns run in clock order past midnight (21 → 8 = 21h … 23h, 0h … 7h).
 */
export function heatmapHours(openingHour: number | null, closingHour: number | null): number[] {
  if (openingHour === null || closingHour === null) return [...FALLBACK_HEATMAP_HOURS];
  const from = Math.max(0, Math.min(23, openingHour));
  const to = Math.max(0, Math.min(24, closingHour));
  if (to === from) return [...FALLBACK_HEATMAP_HOURS];
  if (to > from) return Array.from({ length: to - from }, (_, i) => from + i);
  return [
    ...Array.from({ length: 24 - from }, (_, i) => from + i),
    ...Array.from({ length: to }, (_, i) => i),
  ];
}

/** The grid's own observed min/max over cells that CARRY data (measured or estimated; null =
 * no data) — the colour scale's bounds. */
export function heatmapScale(cells: (number | null)[]): { min: number; max: number } | null {
  let min = Infinity;
  let max = -Infinity;
  for (const value of cells) {
    if (value === null) continue;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return min === Infinity ? null : { min, max };
}

/**
 * Level 0 = NO DATA → hachure. 1–5 = a linear ramp over the grid's own min/max, so the colour is
 * relative to what this venue's week holds and never to an absolute audience. A grid whose
 * values are all equal reads at the neutral middle instead of pretending to a peak.
 */
export function heatmapLevel(
  value: number | null,
  scale: { min: number; max: number } | null,
): 0 | 1 | 2 | 3 | 4 | 5 {
  if (value === null || scale === null) return 0;
  if (scale.max <= scale.min) return 3;
  const level = Math.ceil(((value - scale.min) / (scale.max - scale.min)) * 5);
  return (level < 1 ? 1 : level > 5 ? 5 : level) as 1 | 2 | 3 | 4 | 5;
}

/**
 * AFF1 — the explanatory empty state ONLY when no measured, no backup AND no data (a
 * NULL-source-only venue has data: it renders as estimation). Web-only: the PDF renders its
 * hachured grid under the same lead, a document has no interactive state to fall back to.
 */
export function peakHoursEmpty(input: {
  has_data: boolean;
  counts: { measured: number; backup: number };
}): boolean {
  return affluenceEmpty(input);
}

/**
 * MEJ-3 (Mejri 31/08 pt 3) — THE S02 cell description: the value that cell RENDERS and where it
 * comes from. It lived inline in the component as a native `title`, which made it (a) unpinnable
 * — apps/web has no render harness, so nothing could assert what a cell claims — and (b)
 * unreliable in practice: a native tooltip is anchored per element and lags behind the cursor
 * when it slides across 26px cells, so the panel a tester reads can belong to the PREVIOUS cell.
 * The string now lives here, and the component renders it into a live caption driven by the
 * hovered cell's own (value, kind), so the number on screen is always that cell's.
 *
 * `closed` wins over everything: outside the venue's hours there is no audience to describe.
 */
export interface HeatmapCell {
  /** « Lun », « Mar », … */
  dayLabel: string;
  /** 0–47 — the half-hour slot on the venue's own clock (slice C). */
  slot: number;
  closed: boolean;
  kind: ProvenanceKind;
  /** The cell's rendered value (the number the colour encodes). */
  value: number;
}

export function heatmapCellTitle(cell: HeatmapCell): string {
  const at = `${cell.dayLabel} ${slotLabel(cell.slot)}`;
  if (cell.closed) return `${at} — fermé`;
  if (cell.kind === 'none') return `${at} — aucune donnée`;
  const source = cell.kind === 'measured' ? 'mesuré' : 'estimation';
  return `${at} — ${formatDecimalFr(cell.value)} pers. (${source})`;
}

/** The caption's resting state, before the reader has pointed at anything. */
export const HEATMAP_HINT = 'Survolez une case pour en lire la valeur et sa source.';

// ── Slice C — the half-hour heatmap ───────────────────────────────────────────────────────────
//
// S02 renders TWO sub-columns per hour on desktop. At ≤375 px that is 28 columns on a phone, which
// AFF1 already fought a width battle over, so the narrow layout collapses back to one column per
// hour. These rules live here rather than in the component because apps/web has no render harness
// (WEB-GATE1): a rule left in a .tsx is a rule nobody can pin.

/** The viewport at or below which S02 collapses its halves back into hours. */
export const HEATMAP_COLLAPSE_MAX_PX = 375;

/** Slots per hour, mirrored from the api's half-hour vocabulary. */
const HALVES_PER_HOUR = 2;

/** « 13h » / « 13h30 » — a slot on the venue's own clock. */
export function slotLabel(slot: number): string {
  const hour = Math.floor(slot / HALVES_PER_HOUR);
  return slot % HALVES_PER_HOUR === 0 ? `${hour}h` : `${hour}h30`;
}

/** The heatmap's SLOT columns: each open hour contributes its two halves, in order. */
export function heatmapSlots(openingHour: number | null, closingHour: number | null): number[] {
  return heatmapHours(openingHour, closingHour).flatMap((hour) => [
    hour * HALVES_PER_HOUR,
    hour * HALVES_PER_HOUR + 1,
  ]);
}

/** One rendered half-hour: the value the colour encodes, and where it came from. */
export interface HalfCell {
  value: number | null;
  kind: ProvenanceKind;
}

/**
 * The narrow layout's collapse: what ONE hour column shows for its two halves.
 *
 * PEAK-MAX1 (2026-09-04) — the value is the HIGHER of the two half-hour peaks, not their mean.
 * S02 now shows, per slot, the highest audience recorded on it over the période; an hour's peak is
 * therefore the peak of its better half. The mean stated a number no slot ever reached and, worse,
 * it was LOWER than the true peak in the one section named for peaks — halves peaking 100 and 200
 * would have rendered 150 on a phone and 200 on a desktop, for the same venue and période.
 *
 * The phone and the desktop agree because both show a slot's PEAK. (The api's
 * `collapseHalvesToHour` / `collapseHalvesSql` remain MEANS and are untouched: those collapse RAW
 * readings upstream of the merge — a different quantity, not this display.)
 *
 * The kind is the kind of the half that HOLDS the max, measured winning a tie — the same rule the
 * api applies to the grid, and for the same reason: the number shown IS one half's, so its
 * provenance is that half's. A half carrying nothing is ignored rather than counted against the
 * other: an hour measured for 30 minutes shows what it measured.
 */
export function collapseHourCell(halves: readonly HalfCell[]): HalfCell {
  const carrying = halves.filter((half) => half.value !== null && half.kind !== 'none');
  if (carrying.length === 0) {
    return { value: null, kind: 'none' };
  }
  let best: HalfCell = carrying[0] as HalfCell;
  for (const half of carrying.slice(1)) {
    const higher = (half.value ?? 0) > (best.value ?? 0);
    const tieToMeasured = half.value === best.value && half.kind === 'measured';
    if (higher || tieToMeasured) best = half;
  }
  return { value: best.value, kind: best.kind };
}
