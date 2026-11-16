// Mariem 13/11 + operator 2026-11-14 — « the campaign start depends on the opening hours of the
// screenhosts: each screenhost has its own start hour ». ONE home for that instant and the two
// pre-launch deadlines derived from it (lib/campaign-prelaunch.ts, ./placer.ts).

export const PRELAUNCH_LOCK_LEAD_MS = 6 * 60 * 60 * 1000;
export const PRELAUNCH_FREEZE_LEAD_MS = 5 * 60 * 1000;

/** The campaign's start at one venue: its start date at the venue's opening hour, in Tunis
 * (UTC+1, no DST). A venue without hours starts at 00:00. */
export const hostStartInstant = (startDate: string, openingHour: number | null): Date =>
  new Date(`${startDate}T${String(openingHour ?? 0).padStart(2, '0')}:00:00+01:00`);

export const hostLockInstant = (startDate: string, openingHour: number | null): Date =>
  new Date(hostStartInstant(startDate, openingHour).getTime() - PRELAUNCH_LOCK_LEAD_MS);

export const hostFreezeInstant = (startDate: string, openingHour: number | null): Date =>
  new Date(hostStartInstant(startDate, openingHour).getTime() - PRELAUNCH_FREEZE_LEAD_MS);
