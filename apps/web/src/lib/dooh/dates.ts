/**
 * Pure calendar/date helpers for the DOOH engine. No imports, no side effects.
 *
 * `location_affluence_schedule.day_of_week` is 1 = Monday … 7 = Sunday. JS `Date.getDay()`
 * is 0 = Sunday … 6 = Saturday. `jsGetDayToDbDayOfWeek` bridges the two. Campaign bounds are
 * interpreted as **local civil days** (not UTC midnight) so `getDay()`/`getDate()` don't shift
 * by timezone.
 */

export const MS_PER_DAY = 86_400_000;

/** `Date.getDay()` (0=dimanche) → `day_of_week` BD (1=lundi … 7=dimanche). */
export function jsGetDayToDbDayOfWeek(jsDay: number): number {
  return jsDay === 0 ? 7 : jsDay;
}

/** Jour semaine 1 = lundi … 7 = dimanche (aligné `location_affluence_schedule`). */
export function dateToDayOfWeek(d: Date): number {
  return jsGetDayToDbDayOfWeek(d.getDay());
}

/**
 * Interprète une borne de campagne comme **jour civil local** (évite `new Date('YYYY-MM-DD')` = minuit UTC
 * qui décale `getDay()` / `getDate()` selon le fuseau).
 */
export function parseLocalCampaignCalendarDay(d: Date | string): Date {
  if (typeof d === 'string') {
    const part = d.trim().split('T')[0];
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(part);
    if (m) {
      const y = Number(m[1]);
      const mo = Number(m[2]) - 1;
      const day = Number(m[3]);
      return new Date(y, mo, day, 0, 0, 0, 0);
    }
    // Compat legacy: accepte aussi "DD/MM/YYYY" ou "DD-MM-YYYY"
    const dmy = /^(\d{2})[/-](\d{2})[/-](\d{4})$/.exec(part);
    if (dmy) {
      const day = Number(dmy[1]);
      const mo = Number(dmy[2]) - 1;
      const y = Number(dmy[3]);
      return new Date(y, mo, day, 0, 0, 0, 0);
    }
  }
  const x = d instanceof Date ? new Date(d.getTime()) : new Date(d);
  return new Date(x.getFullYear(), x.getMonth(), x.getDate(), 0, 0, 0, 0);
}

/** Nombre de jours calendaires à parcourir (bornes inclusives), minimum 1. */
export function computeCampaignDayCount(start: Date | string, end: Date | string): number {
  const startDay = parseLocalCampaignCalendarDay(start);
  const endDay = parseLocalCampaignCalendarDay(end);
  const diffDays = Math.floor((endDay.getTime() - startDay.getTime()) / MS_PER_DAY);
  return Math.max(1, diffDays + 1);
}

/** Date calendaire locale `YYYY-MM-DD` (alignée sur la boucle du moteur). */
export function formatLocalCalendarDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Début de la tranche locale [date à hour:00, date à hour+1:00). */
export function localSlotRange(dateCalendar: Date, hour: number): { start: Date; end: Date } {
  const start = new Date(dateCalendar);
  start.setHours(hour, 0, 0, 0);
  const end = new Date(start);
  end.setHours(hour + 1, 0, 0, 0);
  return { start, end };
}
