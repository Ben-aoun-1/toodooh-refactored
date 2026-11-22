import { eq, inArray } from 'drizzle-orm';

import { db } from '../../db/client.js';
import { campaigns, creatives, eventAllocations } from '../../db/schema.js';
import {
  EVENT_SEAT_MODEL,
  type PodSlot,
  eventPodTimeline,
  eventSlotSeconds,
} from '../event-pricing/minutes.js';
import { BLOC_MINUTES } from '../fenetre-diffusion.js';
import { airedCreativeTypeSql, airedStorageKeySql } from '../spot-cta.js';

// OPS-BROADCAST (operator 22/11) — ONE ad page sent to the TVs on the operator's order, outside
// every commercial gate: no owner acceptance, no campaign status, no match bloc. It replays spots
// the network already carries (their campaign ids, so a TV that cached them plays at once), laid
// out exactly like a match's ad page (eventPodTimeline, 2-minute seats, the order given).
//
// NOTHING here is money: the page is not a positioning, its proofs never reach proof_of_play
// (ingest refuses them like any non-airable play) and are only COUNTED here and logged, so no
// advertiser is billed and no venue is paid for it.
//
// The page and its counts live in MEMORY (one process, like the socket registry): a restart
// forgets them, and the next playlist push then clears the page from the TVs.

export interface BroadcastSpot {
  campaignId: string;
  campaignName: string;
  storageKey: string;
  durationSeconds: number | null;
  creativeType: string;
}

export interface ManualBroadcast {
  start: Date;
  end: Date;
  spots: BroadcastSpot[];
  slots: PodSlot[];
  /** The venues it airs on; null = every venue. */
  venueIds: ReadonlySet<string> | null;
}

let current: ManualBroadcast | null = null;

/** What each screen reported airing of the page: passes started and ended. */
const plays = new Map<string, { started: number; ended: number }>();

/** A late VIDEO_ENDED still belongs to the page. */
const TRACE_GRACE_MS = 2 * 60 * 1000;

/** The page's timeline: the spots in the given order, as a match's ad page opening at `start`. */
export const broadcastTimeline = (
  spots: readonly BroadcastSpot[],
  start: Date,
): { end: Date; slots: PodSlot[] } | null => {
  const pod = eventPodTimeline(
    'avant',
    start,
    new Date(start.getTime() + BLOC_MINUTES * 60_000),
    spots.map((s) => {
      const slotSeconds = eventSlotSeconds(s.creativeType, s.durationSeconds) ?? 30;
      return {
        campaignId: s.campaignId,
        slotSeconds,
        spotSeconds:
          s.creativeType === 'video' && s.durationSeconds !== null
            ? s.durationSeconds
            : slotSeconds,
      };
    }),
    EVENT_SEAT_MODEL,
  );
  return pod ? { end: pod.end, slots: pod.slots } : null;
};

/** The spots of the given campaigns, in the order given (unknown or spot-less ids are dropped). */
export const loadBroadcastSpots = async (
  campaignIds: readonly string[],
): Promise<BroadcastSpot[]> => {
  if (campaignIds.length === 0) return [];
  const rows = await db
    .select({
      campaignId: campaigns.id,
      campaignName: campaigns.name,
      storageKey: airedStorageKeySql(),
      durationSeconds: creatives.durationSeconds,
      creativeType: airedCreativeTypeSql(),
    })
    .from(campaigns)
    .innerJoin(creatives, eq(campaigns.creativeId, creatives.id))
    .where(inArray(campaigns.id, [...campaignIds]));
  return campaignIds.flatMap((id) => rows.filter((r) => r.campaignId === id));
};

/** The venues that held an allocation of any of the campaigns (a match positioning's venues). */
export const broadcastCampaignVenues = async (
  campaignIds: readonly string[],
): Promise<Set<string>> => {
  if (campaignIds.length === 0) return new Set();
  const rows = await db
    .selectDistinct({ screenhostId: eventAllocations.screenhostId })
    .from(eventAllocations)
    .where(inArray(eventAllocations.campaignId, [...campaignIds]));
  return new Set(rows.map((r) => r.screenhostId));
};

export const setManualBroadcast = (broadcast: ManualBroadcast): void => {
  current = broadcast;
  plays.clear();
};

/** Withdraw the page (its counts stay readable until the next one is announced). */
export const clearManualBroadcast = (): void => {
  current = null;
};

/** Count one reported play of the page. */
export const countManualBroadcastPlay = (
  screenId: string,
  eventType: 'VIDEO_STARTED' | 'VIDEO_ENDED',
): void => {
  const entry = plays.get(screenId) ?? { started: 0, ended: 0 };
  if (eventType === 'VIDEO_STARTED') entry.started += 1;
  else entry.ended += 1;
  plays.set(screenId, entry);
};

export const manualBroadcastPlays = (): { screenId: string; started: number; ended: number }[] =>
  [...plays.entries()].map(([screenId, n]) => ({ screenId, ...n }));

export const currentManualBroadcast = (): ManualBroadcast | null => current;

/** The page a venue's playlist carries at `now`: announced until it ends. */
export const manualBroadcastFor = (screenhostId: string, now: Date): ManualBroadcast | null => {
  if (!current || now.getTime() >= current.end.getTime()) return null;
  if (current.venueIds && !current.venueIds.has(screenhostId)) return null;
  return current;
};

/** A reported play belongs to the page: one of its spots, at this venue, inside its window. */
export const isManualBroadcastPlay = (
  screenhostId: string,
  videoId: string,
  playedAt: Date,
): boolean => {
  if (!current) return false;
  if (current.venueIds && !current.venueIds.has(screenhostId)) return false;
  const t = playedAt.getTime();
  return (
    current.spots.some((s) => s.campaignId === videoId) &&
    t >= current.start.getTime() - TRACE_GRACE_MS &&
    t < current.end.getTime() + TRACE_GRACE_MS
  );
};
