import { plusCalendarDays, tunisDateOf } from './campaign-dates.js';

// DISP-TOURS §3.1/3.2 (Mariem, 03/11/2026) — when a classic campaign that was never launched is
// deleted, and the two notices before it. ONE home: the lifecycle tick runs it, the tests pin
// Mariem's two examples (a cart campaign starting 15/11: notices 13/11 and 14/11, deleted
// 15/11; an undated draft saved 3/11 at 10 h: notices 8/11 and 9/11 at 10 h, deleted 10/11 at
// 10 h).
//   • In the cart or not, a campaign with a start date goes AT that date (Tunis midnight).
//   • An undated draft goes 7 days after its LAST save (Q8, proposed: every save restarts it).
//   • Never before the end of the day it was last saved: a campaign made to start today (LEAD-0,
//     a demo account) keeps the day it was made for.
//   • 48 h and 24 h before, one notice each — unless the advertiser saved the campaign since that
//     window opened (they are on it). A later deadline (a new start date) re-arms both.
// Days are Tunis calendar days (Africa/Tunis, UTC+1, no DST since 2008).

export const UNDATED_DRAFT_LIFETIME_DAYS = 7;
export const EXPIRY_NOTICE_HOURS = [48, 24] as const;
export type ExpiryNoticeHours = (typeof EXPIRY_NOTICE_HOURS)[number];

const HOUR_MS = 3_600_000;

export interface ExpiryClock {
  startDate: string | null;
  lastSavedAt: Date;
  /** The last expiry notice sent, if any. */
  noticeSentAt: Date | null;
}

/** The instant a Tunis calendar day begins. */
const tunisMidnight = (isoDate: string): Date => new Date(`${isoDate}T00:00:00+01:00`);

/** When the campaign is deleted if it is still not launched. */
export const expiryDeadline = ({
  startDate,
  lastSavedAt,
}: Pick<ExpiryClock, 'startDate' | 'lastSavedAt'>): Date => {
  if (startDate === null) {
    return new Date(lastSavedAt.getTime() + UNDATED_DRAFT_LIFETIME_DAYS * 24 * HOUR_MS);
  }
  const start = tunisMidnight(startDate);
  const saveDayEnd = tunisMidnight(plusCalendarDays(tunisDateOf(lastSavedAt), 1));
  return start > saveDayEnd ? start : saveDayEnd;
};

export type ExpiryStep =
  | { kind: 'delete' }
  | { kind: 'notice'; hours: ExpiryNoticeHours }
  | { kind: 'none' };

/** What the hourly tick does with the campaign now. A missed tick sends the closer notice only. */
export const expiryStep = (clock: ExpiryClock, now: Date): ExpiryStep => {
  const deadline = expiryDeadline(clock).getTime();
  const t = now.getTime();
  if (t >= deadline) return { kind: 'delete' };
  const touched = Math.max(
    clock.lastSavedAt.getTime(),
    clock.noticeSentAt?.getTime() ?? Number.NEGATIVE_INFINITY,
  );
  for (const hours of [...EXPIRY_NOTICE_HOURS].reverse()) {
    const opens = deadline - hours * HOUR_MS;
    if (t >= opens) return touched < opens ? { kind: 'notice', hours } : { kind: 'none' };
  }
  return { kind: 'none' };
};

export interface ExpiryNotice {
  type: 'campaign_cart_expiry' | 'campaign_draft_expiry';
  text: string;
}

/** Mariem's §3.2 wording, verbatim. */
export const expiryNotice = (
  name: string,
  inCart: boolean,
  hours: ExpiryNoticeHours,
): ExpiryNotice =>
  inCart
    ? {
        type: 'campaign_cart_expiry',
        text: `Votre campagne « ${name} » sera retirée de votre panier dans ${hours} h. Lancez-la avant cette échéance pour la conserver.`,
      }
    : {
        type: 'campaign_draft_expiry',
        text: `Votre brouillon « ${name} » sera supprimé dans ${hours} h. Reprenez sa saisie pour le conserver.`,
      };
