import { and, eq, sql } from 'drizzle-orm';

import { db } from '../db/client.js';
import {
  campaignScreenhostPayout,
  proofOfPlay,
  screenhostAffluenceHourly,
  screenhosts,
} from '../db/schema.js';

import { ownerApprovedSql } from './approved-owner.js';
import { venueHasInstalledScreenSql } from './installed-screen.js';

// NEWLANDING-1 (operator ruling 1A, 2026-10-02) — the public landing's « Smart Sensor » live block
// (GET /api/public/network-stats). NETWORK-WIDE AGGREGATES ONLY: nothing here may be traced back
// to one venue, one owner or one advertiser — no ids, no names, no per-row figures.
//
// The wire is the landing script's contract (data-k keys + the three charts):
//   venues       venues on the network: an APPROVED owner and at least one INSTALLED screen
//   diffusions   every completed play (proof_of_play VIDEO_ENDED)
//   hours        Σ played time of those plays, in hours
//   impressions  Σ delivered impressions of settled campaigns (the figure the closing reports show)
//   audience     Σ MEASURED audience: per (venue, day, hour) the hour value = round(avg of its two
//                half-hour cells), summed (FLOW-4: a day is the Σ of its hours). Estimates never count.
//   hourly       16 bars, 8h → 23h: the average measured hour value across venues and days over the
//                last 30 days
//   gender/ages  the plain mean of the network venues' hub class ratios (percentages), null-skipped
//
// Cached in memory for 60 s: the landing polls every minute per visitor, and these are full-table
// aggregates. Charts are omitted (null) when there is no data, and the landing then keeps them hidden.

export interface PublicNetworkStats {
  venues: number;
  diffusions: number;
  hours: number;
  impressions: number;
  audience: number;
  hourly: number[] | null;
  gender: { f: number; m: number } | null;
  ages: Record<string, number> | null;
}

export const HOURLY_FIRST_HOUR = 8;
export const HOURLY_LAST_HOUR = 23;
const HOURLY_WINDOW_DAYS = 30;
const CACHE_MS = 60_000;

const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const pct = (v: unknown): number => Math.round(num(v));

export async function computePublicNetworkStats(): Promise<PublicNetworkStats> {
  const networkVenue = and(ownerApprovedSql(), venueHasInstalledScreenSql());

  const [venueRow] = await db
    .select({
      venues: sql<string>`count(*)`,
      female: sql<string | null>`avg(${screenhosts.genderFemalePct})`,
      male: sql<string | null>`avg(${screenhosts.genderMalePct})`,
      a1: sql<string | null>`avg(${screenhosts.age17To30Pct})`,
      a2: sql<string | null>`avg(${screenhosts.age31To45Pct})`,
      a3: sql<string | null>`avg(${screenhosts.age46PlusPct})`,
    })
    .from(screenhosts)
    .where(networkVenue);

  const [playRow] = await db
    .select({
      diffusions: sql<string>`count(*)`,
      ms: sql<string>`coalesce(sum(${proofOfPlay.playedDurationMs}), 0)`,
    })
    .from(proofOfPlay)
    .where(eq(proofOfPlay.eventType, 'VIDEO_ENDED'));

  const [impRow] = await db
    .select({
      impressions: sql<string>`coalesce(sum(${campaignScreenhostPayout.deliveredImp}), 0)`,
    })
    .from(campaignScreenhostPayout);

  // One row per measured (venue, day, hour): the hour value is the rounded mean of its halves.
  const hourCells = db
    .select({
      date: screenhostAffluenceHourly.date,
      hour: screenhostAffluenceHourly.hour,
      value: sql<number>`round(avg(${screenhostAffluenceHourly.value}))`.as('value'),
    })
    .from(screenhostAffluenceHourly)
    .where(sql`${screenhostAffluenceHourly.value} is not null`)
    .groupBy(
      screenhostAffluenceHourly.screenhostId,
      screenhostAffluenceHourly.date,
      screenhostAffluenceHourly.hour,
    )
    .as('hour_cells');

  const [audienceRow] = await db
    .select({ audience: sql<string>`coalesce(sum(${hourCells.value}), 0)` })
    .from(hourCells);

  const hourlyRows = await db
    .select({ hour: hourCells.hour, avg: sql<string>`avg(${hourCells.value})` })
    .from(hourCells)
    .where(
      sql`${hourCells.date} >= (now() at time zone 'Africa/Tunis')::date - ${HOURLY_WINDOW_DAYS}::int
        and ${hourCells.hour} between ${HOURLY_FIRST_HOUR} and ${HOURLY_LAST_HOUR}`,
    )
    .groupBy(hourCells.hour);

  const byHour = new Map(hourlyRows.map((r) => [Number(r.hour), num(r.avg)]));
  const hourly = Array.from({ length: HOURLY_LAST_HOUR - HOURLY_FIRST_HOUR + 1 }, (_, i) =>
    Math.round(byHour.get(HOURLY_FIRST_HOUR + i) ?? 0),
  );

  const hasGender = venueRow?.female != null && venueRow?.male != null;
  const hasAges = venueRow?.a1 != null && venueRow?.a2 != null && venueRow?.a3 != null;

  return {
    venues: num(venueRow?.venues),
    diffusions: num(playRow?.diffusions),
    hours: Math.round(num(playRow?.ms) / 3_600_000),
    impressions: num(impRow?.impressions),
    audience: num(audienceRow?.audience),
    hourly: hourly.some((v) => v > 0) ? hourly : null,
    gender: hasGender ? { f: pct(venueRow?.female), m: pct(venueRow?.male) } : null,
    ages: hasAges
      ? {
          '17–30 ans': pct(venueRow?.a1),
          '31–45 ans': pct(venueRow?.a2),
          '46 ans et +': pct(venueRow?.a3),
        }
      : null,
  };
}

let cache: { at: number; value: PublicNetworkStats } | null = null;

/** The served figure: computed at most once per 60 s across all visitors. */
export async function publicNetworkStats(now: number = Date.now()): Promise<PublicNetworkStats> {
  if (cache && now - cache.at < CACHE_MS) return cache.value;
  const value = await computePublicNetworkStats();
  cache = { at: now, value };
  return value;
}

/** Tests only — drop the 60 s cache. */
export const resetPublicNetworkStatsCache = (): void => {
  cache = null;
};
