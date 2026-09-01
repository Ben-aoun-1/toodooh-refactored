// ── shared block — BYTE-IDENTICAL in apps/api and apps/web (pinned by test). Edit BOTH. ────────
/**
 * RPT-COV1 (Mejri, ruled through the operator 2026-09-01) — how much of the analysed period the
 * report actually rests on.
 *
 * Her report: « le rapport mensuel d'août est disponible alors que nous avons uniquement les
 * données du 31/08 ». The ruling is deliberately NOT a minimum-data threshold — a month with real
 * data legitimately gets a report, and inventing a floor would silently withhold reports nobody
 * asked us to withhold. What was missing is that the document never said how thin it was.
 *
 * The numerator is DAYS THAT CARRY DATA, which is exactly what the période merge already means by
 * a day: a date with no cell is not a data point and never becomes one. Whether those days are
 * measured or estimated is a DIFFERENT question, already answered next to it by « dont N %
 * estimés » — saying it twice here would double-count the same caveat.
 */
export interface PeriodCoverage {
  /** Days in the analysed period that carry data (the merge's own days). */
  daysWithData: number;
  /** Days in the analysed period, inclusive of both bounds. */
  daysInPeriod: number;
}

/**
 * « 1 jour de données sur 31 ». Always rendered, never only when thin: a line that appeared only
 * for sparse reports would read as a warning badge, and its absence would be ambiguous rather than
 * reassuring. A full month simply states its own completeness.
 *
 * Returns null when the period itself is empty (a malformed range), so the caller renders nothing
 * rather than « 0 jour de données sur 0 ».
 */
export function coverageLabel(coverage: PeriodCoverage): string | null {
  const { daysWithData, daysInPeriod } = coverage;
  if (!Number.isFinite(daysInPeriod) || daysInPeriod <= 0) return null;
  const days = Math.max(0, Math.min(daysWithData, daysInPeriod));
  return `${days} jour${days > 1 ? 's' : ''} de données sur ${daysInPeriod}`;
}

/**
 * Inclusive day count of an ISO range — the coverage denominator. Both bounds count, so a single
 * day is 1 and August is 31. Returns 0 on a malformed or reversed range.
 */
export function daysInRange(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return 0;
  return Math.round((end - start) / 86_400_000) + 1;
}
// ── end shared block ──────────────────────────────────────────────────────────────────────────
