import type { DispatchCreneau } from '../db/schema.js';

// ADM-OBS1 slice B (operator program 2026-09-11; money-lost rule ruled 2026-09-12) — the two pure
// derivations the admin « Tests » page adds on top of slice A:
//  1. the FOUR-STATE status of every open hour of the période (free / campaigns but N minutes free
//     / full / the host declared the day unavailable — never collapsed into « free »);
//  2. the per-campaign view on this venue: ran fully / disrupted / received a redispatch, and the
//     money lost on the slots it did not play = what would have been paid to this host for them
//     (missed facturable × CPM / 1000), redirected to the hosts that received the redispatch.
// Pure: the route loads the rows, this file only counts. Elapsed = the E6 detector's notion
// (a Tunis (date, hour) strictly before « now »).

export type HourState = 'libre' | 'partiel' | 'plein' | 'indisponible';

export interface HourStatus {
  date: string;
  hour: number;
  state: HourState;
  engaged_seconds: number;
  minutes_free: number | null; // null when the day is unavailable
  campaigns: number;
}

export interface AllocationForStatus {
  campaignId: string;
  campaignName: string;
  campaignStatus: string;
  statutAcceptation: string;
  rI: number;
  sSpotSeconds: number;
  fMaxSeconds: number;
  cpm: number;
  t: number;
  creneaux: readonly DispatchCreneau[];
}

/** The four-state status per open hour of the période (hours in clock order, wrap-aware). */
export const hourStatuses = (
  days: readonly string[],
  hours: readonly number[],
  unavailableDays: ReadonlySet<string>,
  allocations: readonly AllocationForStatus[],
): HourStatus[] => {
  const engaged = new Map<string, { seconds: number; campaigns: Set<string> }>();
  for (const a of allocations) {
    if (a.statutAcceptation !== 'ACCEPTE') continue; // only accepted shares occupy the screen
    for (const c of a.creneaux) {
      const key = `${c.date}:${c.hour}`;
      const e = engaged.get(key) ?? { seconds: 0, campaigns: new Set<string>() };
      e.seconds += c.reps * a.sSpotSeconds;
      e.campaigns.add(a.campaignId);
      engaged.set(key, e);
    }
  }
  const fMax = allocations[0]?.fMaxSeconds ?? 300;
  const out: HourStatus[] = [];
  for (const date of days) {
    for (const hour of hours) {
      if (unavailableDays.has(date)) {
        out.push({
          date,
          hour,
          state: 'indisponible',
          engaged_seconds: 0,
          minutes_free: null,
          campaigns: 0,
        });
        continue;
      }
      const e = engaged.get(`${date}:${hour}`);
      const seconds = e?.seconds ?? 0;
      const free = Math.max(0, fMax - seconds);
      out.push({
        date,
        hour,
        state: seconds === 0 ? 'libre' : free <= 0 ? 'plein' : 'partiel',
        engaged_seconds: seconds,
        minutes_free: Math.round((free / 60) * 10) / 10,
        campaigns: e?.campaigns.size ?? 0,
      });
    }
  }
  return out;
};

export interface CampaignOnVenue {
  campaign_id: string;
  campaign_name: string;
  campaign_status: string;
  statut_acceptation: string;
  slots_in_period: number;
  slots_elapsed: number;
  slots_delivered: number;
  slots_missed: number;
  impressions_planned_physical: number;
  impressions_missed_physical: number;
  impressions_missed_fact: number;
  ran_fully: boolean; // every elapsed slot delivered
  disrupted: boolean; // ≥ 1 elapsed slot not delivered
  received_redispatch: boolean; // a round placed a share onto this host
  money_lost_tnd: number; // what this host would have been paid for the slots it did not play
  redirected_to: { screenhost_id: string; added_fact: number }[];
}

export interface RoundForStatus {
  campaignId: string;
  missedFrom: readonly { screenhost_id: string }[];
  placedTo: readonly { screenhost_id: string; added_fact: number }[];
}

const isElapsed = (date: string, hour: number, todayIso: string, currentHour: number): boolean =>
  date < todayIso || (date === todayIso && hour < currentHour);

/** The per-campaign rows for ONE venue over the période. */
export const campaignsOnVenue = (
  screenhostId: string,
  allocations: readonly AllocationForStatus[],
  from: string,
  to: string,
  todayIso: string,
  currentHour: number,
  deliveredKeys: ReadonlyMap<string, ReadonlySet<string>>, // campaignId → Set('date:hour')
  rounds: readonly RoundForStatus[],
): CampaignOnVenue[] =>
  allocations
    .map((a) => {
      const inPeriod = a.creneaux.filter((c) => c.date >= from && c.date <= to);
      const delivered = deliveredKeys.get(a.campaignId) ?? new Set<string>();
      const elapsed = inPeriod.filter((c) => isElapsed(c.date, c.hour, todayIso, currentHour));
      const missed = elapsed.filter((c) => !delivered.has(`${c.date}:${c.hour}`));
      const missedPhysical = missed.reduce((s, c) => s + c.impressions, 0);
      const missedFact = Math.floor(missedPhysical * a.t);
      const myRounds = rounds.filter(
        (r) =>
          r.campaignId === a.campaignId &&
          r.missedFrom.some((m) => m.screenhost_id === screenhostId),
      );
      const redirected = myRounds.flatMap((r) =>
        r.placedTo.filter((p) => p.screenhost_id !== screenhostId).map((p) => ({ ...p })),
      );
      const receivedRedispatch = rounds.some(
        (r) =>
          r.campaignId === a.campaignId && r.placedTo.some((p) => p.screenhost_id === screenhostId),
      );
      return {
        campaign_id: a.campaignId,
        campaign_name: a.campaignName,
        campaign_status: a.campaignStatus,
        statut_acceptation: a.statutAcceptation,
        slots_in_period: inPeriod.length,
        slots_elapsed: elapsed.length,
        slots_delivered: elapsed.length - missed.length,
        slots_missed: missed.length,
        impressions_planned_physical: inPeriod.reduce((s, c) => s + c.impressions, 0),
        impressions_missed_physical: missedPhysical,
        impressions_missed_fact: missedFact,
        ran_fully: elapsed.length > 0 && missed.length === 0,
        disrupted: missed.length > 0,
        received_redispatch: receivedRedispatch,
        money_lost_tnd: Math.round(((missedFact * a.cpm) / 1000) * 1000) / 1000,
        redirected_to: redirected,
      };
    })
    .filter((row) => row.slots_in_period > 0);
