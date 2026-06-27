/**
 * Affluence grid — pure logic (L-aff-view).
 *
 * The API returns a 7×24 weekday×hour grid of the venue's estimated audience (grid[0]=Monday …
 * grid[6]=Sunday, hour 0–23). This module derives the dashboard summary (weekly total, daily
 * average, busiest day, peak hour, and the 7 per-day totals) shown as plain numbers. Framed as
 * AUDIENCE / affluence (the venue's foot traffic), never "impressions" (that's the ad side).
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
  peakHourTotal: number;
  dayTotals: number[]; // the 7 per-day totals (Monday-first) — the per-day readout
  maxCell: number; // the single busiest slot (peak audience in one hour)
}

const argmax = (values: readonly number[]): { index: number; value: number } =>
  values.reduce((best, value, index) => (value > best.value ? { index, value } : best), {
    index: -1,
    value: -1,
  });

export const summarize = (grid: readonly number[][]): AffluenceSummary => {
  let maxCell = 0;
  const dayTotals = grid.map((row) => {
    let sum = 0;
    for (const v of row) {
      sum += v;
      if (v > maxCell) maxCell = v;
    }
    return sum;
  });
  const weeklyTotal = dayTotals.reduce((a, b) => a + b, 0);
  const hourTotals = HOURS.map((h) => grid.reduce((acc, row) => acc + (row[h] ?? 0), 0));

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
