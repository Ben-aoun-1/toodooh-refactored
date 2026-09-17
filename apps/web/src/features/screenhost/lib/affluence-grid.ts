/**
 * Affluence grid — pure logic (L-aff-view).
 *
 * The API returns a weekday grid of the venue's estimated audience (grid[0]=Monday …
 * grid[6]=Sunday): 7×48 half-hour SLOTS since slice C, 7×24 hours on the legacy wire. A cell with
 * no reading is null (HOUR-AVG2); a measured 0 is 0. This module derives the dashboard summary
 * (weekly total, daily average, busiest day, peak hour, and the 7 per-day totals) shown as plain
 * numbers. Framed as AUDIENCE / affluence (the venue's foot traffic), never "impressions" (that's
 * the ad side).
 */

export const DAY_LABELS = [
  'Lundi',
  'Mardi',
  'Mercredi',
  'Jeudi',
  'Vendredi',
  'Samedi',
  'Dimanche',
] as const;

export const DAY_LABELS_SHORT = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'] as const;

export const HOURS: readonly number[] = Array.from({ length: 24 }, (_, h) => h);

export interface AffluenceSummary {
  weeklyTotal: number;
  dailyAverage: number;
  peakDayIndex: number | null; // 0..6 (Monday-first); null when there is no data
  peakDayTotal: number;
  peakHourIndex: number | null; // 0..23; null when there is no data
  peakHourTotal: number; // Σ over the 7 days of the hour's value (the exact mean of the halves it has)
  dayTotals: number[]; // the 7 per-day totals (Monday-first) — the per-day readout
  maxCell: number; // the single busiest slot (peak audience in one hour)
}

const argmax = (values: readonly number[]): { index: number; value: number } =>
  values.reduce((best, value, index) => (value > best.value ? { index, value } : best), {
    index: -1,
    value: -1,
  });

/**
 * HOUR-AVG2 (operator 17/09, the hub's #97 rule) — an hour's value is the EXACT mean of the
 * half-hour cells it HAS: a lone half is the hour (12 → 12, never 6), a measured 0 is a value
 * (0 and 10 → 5), and an hour with no cell is no data (null). Never rounded here. On the legacy
 * 7×24 wire (`perHour` = 1) the cell is the hour.
 */
export const hourValue = (
  row: readonly (number | null)[],
  hour: number,
  perHour: number,
): number | null => {
  let sum = 0;
  let present = 0;
  for (let k = 0; k < perHour; k += 1) {
    const v = row[hour * perHour + k];
    if (v === null || v === undefined) continue;
    sum += v;
    present += 1;
  }
  return present === 0 ? null : sum / present;
};

export const summarize = (grid: readonly (readonly (number | null)[])[]): AffluenceSummary => {
  let maxCell = 0;
  const dayTotals = grid.map((row) => {
    let sum = 0;
    for (const v of row) {
      if (v === null) continue;
      sum += v;
      if (v > maxCell) maxCell = v;
    }
    return sum;
  });
  // DATA1 — « Audience hebdomadaire » IS Σ of the 7 day tiles, by construction: one pass over the
  // same rows feeds both, so the week can never disagree with the tiles it stands beside.
  const weeklyTotal = dayTotals.reduce((a, b) => a + b, 0);
  // Slice C — the api serves SLOT columns (7×48, two per hour) since the half-hour grid; the hub's
  // legacy wire was 7×24. « Heure de pointe » is an HOUR either way: on a slot grid the two halves
  // fold into their hour before the argmax, otherwise slot 9 (04h30) printed as « 09h » and no
  // afternoon peak could ever be seen (the scan stopped at column 23 = 11h30).
  // HOUR-AVG1 (Mejri 15/09) — an hour's value is the AVERAGE of its half-hours, never their sum:
  // each half-hour cell is a reading of who is present, and the hour is their mean. HOUR-AVG2 —
  // the mean of the halves it HAS (hourValue); a day with no cell in that hour adds nothing.
  const columns = grid[0]?.length ?? 0;
  const perHour = columns > HOURS.length ? Math.ceil(columns / HOURS.length) : 1;
  const hourTotals = HOURS.map((h) =>
    grid.reduce((acc, row) => acc + (hourValue(row, h, perHour) ?? 0), 0),
  );

  const hasData = weeklyTotal > 0;
  const peakDay = argmax(dayTotals);
  const peakHour = argmax(hourTotals);

  return {
    weeklyTotal,
    dailyAverage: Math.round(weeklyTotal / 7),
    peakDayIndex: hasData ? peakDay.index : null,
    peakDayTotal: hasData ? peakDay.value : 0,
    peakHourIndex: hasData ? peakHour.index : null,
    peakHourTotal: hasData ? peakHour.value : 0,
    dayTotals,
    maxCell,
  };
};

export const formatHour = (hour: number): string => `${String(hour).padStart(2, '0')}h`;
