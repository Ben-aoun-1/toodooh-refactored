import { formatInTimeZone } from 'date-fns-tz';

import { type VenuePod } from '../event-playout/spots.js';

import { type HourPlan } from './plan.js';
import { SILENT_FLOOR_MS } from './status.js';

// FLEET-3 (operator 21/11) — the match side of the « Parc d'écrans », PURE. During a confirmed
// match's window the classic campaigns pause and the venue airs ad pages (pods): a few minutes of
// spots at exact instants, then nothing until the next page. The fleet reads those pages here:
// which one is on (or just ended), which one comes next, and how many passes each hour holds.

const TUNIS = 'Africa/Tunis';

export interface PodNow {
  /** The page on air, or the one that ended less than {@link SILENT_FLOOR_MS} ago. */
  pod: VenuePod | null;
  /** `pod` is on air right now. */
  live: boolean;
  /** The next page to open. */
  next: VenuePod | null;
}

/** Where `now` falls among a venue's pages (sorted or not). */
export const podAt = (pods: readonly VenuePod[], now: Date): PodNow => {
  const t = now.getTime();
  const sorted = [...pods].sort((a, b) => a.start.getTime() - b.start.getTime());
  const started = sorted.filter((p) => p.start.getTime() <= t);
  const last = started[started.length - 1] ?? null;
  const pod = last && t < last.end.getTime() + SILENT_FLOOR_MS ? last : null;
  return {
    pod,
    live: pod !== null && t < pod.end.getTime(),
    next: sorted.find((p) => p.start.getTime() > t) ?? null,
  };
};

/** The campaigns of one page, with their passes. */
export const podCampaigns = (pod: VenuePod): HourPlan['campaigns'] => {
  const out: HourPlan['campaigns'] = [];
  for (const slot of pod.slots) {
    const existing = out.find((c) => c.id === slot.campaignId);
    if (existing) existing.reps += 1;
    else out.push({ id: slot.campaignId, name: slot.campaignName, reps: 1 });
  }
  return out;
};

/** The event passes of ONE Tunis day, hour by hour (a pass counts in the hour it starts). */
export const eventDayPlan = (pods: readonly VenuePod[], date: string): HourPlan[] => {
  const hours: HourPlan[] = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    reps: 0,
    campaigns: [],
  }));
  for (const pod of pods) {
    for (const slot of pod.slots) {
      if (formatInTimeZone(slot.at, TUNIS, 'yyyy-MM-dd') !== date) continue;
      const h = hours[Number(formatInTimeZone(slot.at, TUNIS, 'H'))];
      if (!h) continue;
      h.reps += 1;
      const existing = h.campaigns.find((c) => c.id === slot.campaignId);
      if (existing) existing.reps += 1;
      else h.campaigns.push({ id: slot.campaignId, name: slot.campaignName, reps: 1 });
    }
  }
  return hours;
};

/**
 * What the day really expects: the event passes, plus the classic ones — except in an hour a
 * match holds entirely, where classic does not air.
 */
export const expectedDayPlan = (
  classic: readonly HourPlan[],
  event: readonly HourPlan[],
  blackoutByHour: readonly number[],
): HourPlan[] =>
  classic.map((c, hour) => {
    const e = event[hour];
    const keepClassic = (blackoutByHour[hour] ?? 0) < 60;
    const campaigns = [...(keepClassic ? c.campaigns : []), ...(e?.campaigns ?? [])];
    return { hour, reps: (keepClassic ? c.reps : 0) + (e?.reps ?? 0), campaigns };
  });
