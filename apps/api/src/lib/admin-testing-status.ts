import type { DispatchCreneau } from '../db/schema.js';

import { computeReversement, type ReversementPcts, tndToMillimes } from './reversement/split.js';

// ADM-OBS1 slice B (operator program 2026-09-11; money-lost rule ruled 2026-09-12) — the two pure
// derivations the admin « Tests » page adds on top of slice A:
//  1. the status of every open hour (free / campaigns but N seconds free / full / the host declared
//     the day unavailable / an event holds the hour — never collapsed into « free »);
//  2. the per-campaign view on this venue: ran fully / disrupted / received a redispatch, and the
//     value of the slots it did not play (missed facturable × CPM / 1000), redirected to the hosts
//     that received the redispatch — plus the host's own share of that value.
// Pure: the route loads the rows, this file only counts. Elapsed = the E6 detector's notion
// (a Tunis (date, hour) strictly before « now »).
//
// ADM-OBS2 (Mejri 17/09, rulings D and C of 2026-09-18):
//  - D — the status now reads the screen the way DISPATCH does. An EN_ATTENTE share is still held
//    by the engine (an undecided allocation may yet air — dispatch/pool.ts), so it is ENGAGED here
//    too, and shown apart as `pending_seconds`. An hour held in `hour_reservations` (an event's
//    blocs) leaves classic capacity entirely (pool.ts drops it from Hi), so it is a FIFTH state,
//    « reservee_evenement », with no free seconds. Before this, the page counted ACCEPTE shares
//    only and could call « libre » an hour the engine would never sell.
//  - C — `missed_value_tnd` is the whole value of the missed slots (the 12/09 formula);
//    `host_share_lost_tnd` is what THIS host would have received of it: the SH line of the same
//    `computeReversement` split the settlement pays with.

export type HourState = 'libre' | 'partiel' | 'plein' | 'indisponible' | 'reservee_evenement';

export interface HourStatus {
  date: string;
  hour: number;
  state: HourState;
  /** Σ (reps × spot seconds) of the ACCEPTE and EN_ATTENTE shares in that hour. */
  engaged_seconds: number;
  /** The EN_ATTENTE part of `engaged_seconds`. */
  pending_seconds: number;
  /** F − engaged; null when the host declared the day unavailable or an event holds the hour. */
  seconds_free: number | null;
  /** Σ repetitions planned in that hour (ACCEPTE and EN_ATTENTE shares). */
  reps: number;
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

/** Does this share hold screen time? ACCEPTE airs; EN_ATTENTE may yet air (the engine's rule). */
const holdsScreenTime = (a: AllocationForStatus): boolean =>
  (a.statutAcceptation === 'ACCEPTE' || a.statutAcceptation === 'EN_ATTENTE') &&
  a.campaignStatus !== 'rejected';

/** A Tunis (date, hour) strictly before « now » (today + the current Tunis hour). */
export const isElapsed = (
  date: string,
  hour: number,
  todayIso: string,
  currentHour: number,
): boolean => date < todayIso || (date === todayIso && hour < currentHour);

/** The status of every open hour of `days` (hours in clock order, wrap-aware). */
export const hourStatuses = (
  days: readonly string[],
  hours: readonly number[],
  unavailableDays: ReadonlySet<string>,
  reservedHours: ReadonlySet<string>, // 'date:hour' held in hour_reservations
  allocations: readonly AllocationForStatus[],
  fMaxSeconds: number,
): HourStatus[] => {
  const engaged = new Map<
    string,
    { seconds: number; pending: number; reps: number; campaigns: Set<string> }
  >();
  for (const a of allocations) {
    if (!holdsScreenTime(a)) continue;
    const pending = a.statutAcceptation === 'EN_ATTENTE';
    for (const c of a.creneaux) {
      const key = `${c.date}:${c.hour}`;
      const e = engaged.get(key) ?? { seconds: 0, pending: 0, reps: 0, campaigns: new Set() };
      const seconds = c.reps * a.sSpotSeconds;
      e.seconds += seconds;
      if (pending) e.pending += seconds;
      e.reps += c.reps;
      e.campaigns.add(a.campaignId);
      engaged.set(key, e);
    }
  }
  const out: HourStatus[] = [];
  for (const date of days) {
    for (const hour of hours) {
      const e = engaged.get(`${date}:${hour}`);
      const base = {
        date,
        hour,
        engaged_seconds: e?.seconds ?? 0,
        pending_seconds: e?.pending ?? 0,
        reps: e?.reps ?? 0,
        campaigns: e?.campaigns.size ?? 0,
      };
      if (unavailableDays.has(date)) {
        out.push({ ...base, state: 'indisponible', seconds_free: null });
        continue;
      }
      if (reservedHours.has(`${date}:${hour}`)) {
        out.push({ ...base, state: 'reservee_evenement', seconds_free: null });
        continue;
      }
      const free = Math.max(0, fMaxSeconds - base.engaged_seconds);
      out.push({
        ...base,
        state: base.engaged_seconds === 0 ? 'libre' : free <= 0 ? 'plein' : 'partiel',
        seconds_free: free,
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
  /** The whole value of the slots this host did not play: missed facturable × CPM / 1000. */
  missed_value_tnd: number;
  /** This host's share of that value (the SH line of the split); null if the split is invalid. */
  host_share_lost_tnd: number | null;
  redirected_to: { screenhost_id: string; added_fact: number }[];
}

export interface RoundForStatus {
  campaignId: string;
  missedFrom: readonly { screenhost_id: string }[];
  placedTo: readonly { screenhost_id: string; added_fact: number }[];
}

/** The SH line of the settlement split on `valueTnd`, or null when the configured split is invalid. */
const hostShareTnd = (valueTnd: number, pcts: ReversementPcts): number | null => {
  try {
    return computeReversement(tndToMillimes(valueTnd), pcts).shMillimes / 1000;
  } catch {
    return null; // a Σ ≠ 100 config — the money rail refuses it too; this page must not 500
  }
};

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
  pcts: ReversementPcts,
): CampaignOnVenue[] =>
  allocations
    .map((a) => {
      const inPeriod = a.creneaux.filter((c) => c.date >= from && c.date <= to);
      const delivered = deliveredKeys.get(a.campaignId) ?? new Set<string>();
      const elapsed = inPeriod.filter((c) => isElapsed(c.date, c.hour, todayIso, currentHour));
      const missed = elapsed.filter((c) => !delivered.has(`${c.date}:${c.hour}`));
      const missedPhysical = missed.reduce((s, c) => s + c.impressions, 0);
      const missedFact = Math.floor(missedPhysical * a.t);
      const missedValue = Math.round(((missedFact * a.cpm) / 1000) * 1000) / 1000;
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
        missed_value_tnd: missedValue,
        host_share_lost_tnd: hostShareTnd(missedValue, pcts),
        redirected_to: redirected,
      };
    })
    .filter((row) => row.slots_in_period > 0);
