/**
 * UI-side date helpers: calendar grid generation, date comparison for picker UIs.
 * For pricing-engine date helpers (campaign calendar day math), see lib/dooh/dates.ts.
 */

export interface CalendarDay {
  day: number;
  currentMonth: boolean;
  date: Date;
}

/**
 * Generate a 42-cell month grid (6 rows × 7 days) with Monday as the first column.
 * Cells outside the target month are marked `currentMonth: false`.
 */
export function getCalendarDays(year: number, month: number): CalendarDay[] {
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const startDay = first.getDay() === 0 ? 6 : first.getDay() - 1;
  const daysInMonth = last.getDate();
  const prevMonth = month === 0 ? 11 : month - 1;
  const prevYear = month === 0 ? year - 1 : year;
  const prevLast = new Date(prevYear, prevMonth + 1, 0).getDate();

  const rows: CalendarDay[] = [];
  for (let i = 0; i < startDay; i++) {
    const d = prevLast - startDay + 1 + i;
    rows.push({ day: d, currentMonth: false, date: new Date(prevYear, prevMonth, d) });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    rows.push({ day: d, currentMonth: true, date: new Date(year, month, d) });
  }
  const remaining = 42 - rows.length;
  for (let i = 0; i < remaining; i++) {
    rows.push({ day: i + 1, currentMonth: false, date: new Date(year, month + 1, i + 1) });
  }
  return rows;
}

export function isDatePast(date: Date): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d < today;
}
