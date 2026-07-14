// CF-Q2 (spec §1.4) — the campaign start-date rule, centralized so jours fériés can land HERE
// later without touching any caller (the spec's clarify box on holidays is still open). RULED:
// the spec's EXAMPLE is authoritative over its prose — the floor is TWO WORKING DAYS (Mon–Fri)
// of lead (ven→mar, jeu→lun, sam/dim→mar, lun→mer).
// CF-W1 ruling #10 (2026-07-14): campaigns may START on ANY day, week-ends included — the
// working-day lead is the ONLY constraint. isJourOuvre + JOURS_FERIES stay: they drive the LEAD
// COUNTING (and the admin-holiday seam), no longer start-day eligibility.
//
// Timezone: the rule counts from the CALENDAR DATE in Africa/Tunis (UTC+1, no DST since 2008) —
// a campaign day is a Tunisian day regardless of the server's TZ. Intl extracts the Tunis date;
// all day-of-week math then runs on UTC-noon anchors (immune to date-line/rollover edges).
// Plain Date + Intl only (ruled: no date libs here).

const TUNIS_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Tunis' }); // → YYYY-MM-DD

/** The calendar date (YYYY-MM-DD) of `instant` as seen in Africa/Tunis. */
export function tunisDateOf(instant: Date): string {
  return TUNIS_DATE.format(instant);
}

/** Jours fériés tunisiens — EMPTY until the spec's open clarify box is ruled; the seam exists. */
const JOURS_FERIES: ReadonlySet<string> = new Set();

/** Working day = Mon–Fri and not a jour férié. Takes an ISO calendar date (YYYY-MM-DD). */
export function isJourOuvre(isoDate: string): boolean {
  const day = new Date(`${isoDate}T12:00:00Z`).getUTCDay();
  return day >= 1 && day <= 5 && !JOURS_FERIES.has(isoDate);
}

/** isoDate + n calendar days (UTC-noon anchored). */
const plusDays = (isoDate: string, n: number): string => {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * The first selectable campaign start: `today` advanced by TWO working days. Lands on a working
 * day by construction (the last day counted is itself ouvré).
 */
export function premiereDateDisponible(today: Date = new Date()): string {
  let d = tunisDateOf(today);
  let ouvres = 0;
  while (ouvres < 2) {
    d = plusDays(d, 1);
    if (isJourOuvre(d)) ouvres += 1;
  }
  return d;
}

export type StartDateViolation = 'TOO_SOON';

/**
 * Why `startIso` is not an acceptable campaign start today — or null when it is. Ruling #10:
 * the working-day LEAD is the only constraint; a week-end start past the floor is legal.
 */
export function startDateViolation(
  startIso: string,
  today: Date = new Date(),
): StartDateViolation | null {
  if (startIso < premiereDateDisponible(today)) return 'TOO_SOON';
  return null;
}
