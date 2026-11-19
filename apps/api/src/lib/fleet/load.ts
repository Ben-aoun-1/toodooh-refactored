import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { and, eq, gte, inArray, sql } from 'drizzle-orm';

import { db } from '../../db/client.js';
import {
  campaignDispatchAllocation,
  campaignDispatchPlan,
  campaigns,
  creatives,
  proofOfPlay,
  screenWsEvents,
  screenhosts,
  screens,
  zones,
} from '../../db/schema.js';
import {
  blackoutMinutesInHour,
  eventBlackouts,
  isInBlackout,
  windowsForVenue,
} from '../event-blackout.js';
import { airableAllocationConditions } from '../playout/active-allocations.js';
import { isWindowActive } from '../playout/playlist.js';
import { screenRegistry } from '../playout/registry.js';

import {
  type DeviceReport,
  type HealthIssue,
  type StatusReport,
  healthIssues,
  readDeviceReport,
  readStatusReport,
} from './health.js';
import { type HourPlan, type PlanRow, dayPlan, plannedRunStart } from './plan.js';
import { type FleetStatus, fleetStatus, isOpenAt } from './status.js';

// FLEET-1 — the « Parc d'écrans » reads: every screen with its state NOW and its day so far, and
// one screen in detail (hour by hour, campaign by campaign). Reads only; the plan comes through the
// SAME airability rule as the playlist (airableAllocationConditions), the match windows through
// event-blackout, the proofs from proof_of_play (VIDEO_STARTED = one pass).

const TUNIS = 'Africa/Tunis';

export interface FleetScreen {
  id: string;
  name: string;
  venue: { id: string; name: string; zone: string | null };
  status: FleetStatus;
  connected: boolean;
  lastSeenAt: Date | null;
  pairedAt: Date | null;
  openNow: boolean;
  /** A confirmed match holds the venue now (classic does not air). */
  matchNow: boolean;
  now: { plannedReps: number; campaigns: HourPlan['campaigns'] };
  lastProof: { at: Date; campaignName: string | null } | null;
  today: { plannedTotal: number; plannedSoFar: number; aired: number };
  /** FLEET-2 — what the TV app reports about itself (null = an app older than 1.5.6). */
  device: DeviceReport | null;
  deviceReportAt: Date | null;
  issues: HealthIssue[];
}

export interface FleetScreenDetail extends FleetScreen {
  /** The player state the TV sent when last asked (« Demander un état »). */
  player: StatusReport | null;
  playerReportAt: Date | null;
  /** The last 24 h of connections, disconnections, errors and remote actions, newest first. */
  events: { kind: string; detail: string | null; at: Date }[];
  hours: {
    hour: number;
    planned: number;
    aired: number;
    blackoutMinutes: number;
    campaigns: HourPlan['campaigns'];
  }[];
  campaigns: {
    id: string;
    name: string;
    startDate: string | null;
    endDate: string | null;
    plannedToday: number;
    airedToday: number;
    airedTotal: number;
    lastProofAt: Date | null;
  }[];
}

interface DayContext {
  now: Date;
  date: string;
  hour: number;
  minute: number;
  dayStart: Date;
}

const dayContext = (now: Date): DayContext => {
  const date = formatInTimeZone(now, TUNIS, 'yyyy-MM-dd');
  return {
    now,
    date,
    hour: Number(formatInTimeZone(now, TUNIS, 'H')),
    minute: Number(formatInTimeZone(now, TUNIS, 'm')),
    dayStart: fromZonedTime(`${date}T00:00:00`, TUNIS),
  };
};

const hourStart = (date: string, hour: number): Date =>
  fromZonedTime(`${date}T${String(hour).padStart(2, '0')}:00:00`, TUNIS);

/** The airable allocations of the given venues, grouped as day-plan rows. */
const loadPlanRows = async (
  venueIds: readonly string[],
  now: Date,
): Promise<Map<string, PlanRow[]>> => {
  const byVenue = new Map<string, PlanRow[]>();
  if (venueIds.length === 0) return byVenue;
  const rows = await db
    .select({
      screenhostId: campaignDispatchAllocation.screenhostId,
      campaignId: campaigns.id,
      campaignName: campaigns.name,
      startDate: campaigns.startDate,
      endDate: campaigns.endDate,
      engine: campaignDispatchPlan.engine,
      rI: campaignDispatchAllocation.rI,
      creneaux: campaignDispatchAllocation.creneaux,
    })
    .from(campaignDispatchAllocation)
    .innerJoin(campaignDispatchPlan, eq(campaignDispatchAllocation.planId, campaignDispatchPlan.id))
    .innerJoin(campaigns, eq(campaignDispatchPlan.campaignId, campaigns.id))
    .innerJoin(creatives, eq(campaigns.creativeId, creatives.id))
    .innerJoin(screenhosts, eq(screenhosts.id, campaignDispatchAllocation.screenhostId))
    .where(
      and(
        inArray(campaignDispatchAllocation.screenhostId, [...venueIds]),
        ...airableAllocationConditions(now),
      ),
    );
  for (const r of rows) {
    if (!isWindowActive(r.startDate, r.endDate, now)) continue;
    const list = byVenue.get(r.screenhostId) ?? [];
    list.push(r);
    byVenue.set(r.screenhostId, list);
  }
  return byVenue;
};

const loadScreens = async (screenId?: string) =>
  db
    .select({
      id: screens.id,
      name: screens.name,
      pairedAt: screens.pairedAt,
      lastSeenAt: screens.lastSeenAt,
      venueId: screenhosts.id,
      venueName: screenhosts.name,
      zone: zones.name,
      openingHour: screenhosts.openingHour,
      closingHour: screenhosts.closingHour,
      deviceReport: screens.deviceReport,
      deviceReportAt: screens.deviceReportAt,
      statusReport: screens.statusReport,
      statusReportAt: screens.statusReportAt,
    })
    .from(screens)
    .innerJoin(screenhosts, eq(screenhosts.id, screens.screenhostId))
    .leftJoin(zones, eq(zones.id, screenhosts.zoneId))
    .where(screenId === undefined ? eq(screens.isActive, true) : eq(screens.id, screenId));

type ScreenRow = Awaited<ReturnType<typeof loadScreens>>[number];

/** Today's VIDEO_STARTED by screen, Tunis hour and campaign. */
const loadTodayProofs = async (screenIds: readonly string[], dayStart: Date) => {
  if (screenIds.length === 0) return [];
  const hourSql = sql<number>`extract(hour from ${proofOfPlay.receivedAt} at time zone 'Africa/Tunis')::int`;
  return db
    .select({
      screenId: proofOfPlay.screenId,
      campaignId: proofOfPlay.campaignId,
      hour: hourSql,
      n: sql<number>`count(*)::int`,
      last: sql<Date>`max(${proofOfPlay.receivedAt})`,
    })
    .from(proofOfPlay)
    .where(
      and(
        inArray(proofOfPlay.screenId, [...screenIds]),
        eq(proofOfPlay.eventType, 'VIDEO_STARTED'),
        gte(proofOfPlay.receivedAt, dayStart),
      ),
    )
    .groupBy(proofOfPlay.screenId, proofOfPlay.campaignId, hourSql);
};

/** The latest pass of each screen, even before today (« dernier passage il y a 2 jours »). */
const loadLastProofs = async (screenIds: readonly string[]) => {
  const out = new Map<string, { at: Date; campaignName: string | null }>();
  if (screenIds.length === 0) return out;
  const rows = await db
    .selectDistinctOn([proofOfPlay.screenId], {
      screenId: proofOfPlay.screenId,
      at: proofOfPlay.receivedAt,
      campaignName: campaigns.name,
    })
    .from(proofOfPlay)
    .leftJoin(campaigns, eq(campaigns.id, proofOfPlay.campaignId))
    .where(
      and(
        inArray(proofOfPlay.screenId, [...screenIds]),
        eq(proofOfPlay.eventType, 'VIDEO_STARTED'),
      ),
    )
    .orderBy(proofOfPlay.screenId, sql`${proofOfPlay.receivedAt} desc`);
  for (const r of rows) out.set(r.screenId, { at: new Date(r.at), campaignName: r.campaignName });
  return out;
};

interface Assembled {
  screen: FleetScreen;
  plan: HourPlan[];
  blackoutByHour: number[];
  proofs: Awaited<ReturnType<typeof loadTodayProofs>>;
}

const assemble = async (screenRows: readonly ScreenRow[], now: Date): Promise<Assembled[]> => {
  const ctx = dayContext(now);
  const venueIds = [...new Set(screenRows.map((s) => s.venueId))];
  const screenIds = screenRows.map((s) => s.id);
  const [byVenue, proofs, lastProofs, blackouts] = await Promise.all([
    loadPlanRows(venueIds, now),
    loadTodayProofs(screenIds, ctx.dayStart),
    loadLastProofs(screenIds),
    eventBlackouts(ctx.dayStart, new Date(ctx.dayStart.getTime() + 24 * 3_600_000)),
  ]);
  const connected = new Set(screenRegistry.connectedScreenIds());

  return screenRows.map((s) => {
    const windows = windowsForVenue(blackouts, s.venueId);
    const blackoutByHour = Array.from({ length: 24 }, (_, h) =>
      blackoutMinutesInHour(windows, ctx.date, h),
    );
    const matchNow = isInBlackout(windows, now);
    const plan = dayPlan(byVenue.get(s.venueId) ?? [], ctx.date, s.openingHour, s.closingHour);
    const current = plan[ctx.hour];
    const plannedRepsNow = matchNow ? 0 : (current?.reps ?? 0);
    const runStart = plannedRepsNow > 0 ? plannedRunStart(plan, ctx.hour) : null;
    const mine = proofs.filter((p) => p.screenId === s.id);
    const aired = mine.reduce((sum, p) => sum + p.n, 0);
    const plannedTotal = plan.reduce((sum, h) => sum + h.reps, 0);
    const plannedSoFar =
      plan.slice(0, ctx.hour).reduce((sum, h) => sum + h.reps, 0) +
      Math.floor(((current?.reps ?? 0) * ctx.minute) / 60);
    const lastProof = lastProofs.get(s.id) ?? null;
    const openNow = isOpenAt(ctx.hour, s.openingHour, s.closingHour);
    const isConnected = connected.has(s.id);
    const status = fleetStatus({
      now,
      connected: isConnected,
      lastSeenAt: s.lastSeenAt,
      pairedAt: s.pairedAt,
      plannedRepsNow,
      plannedSince: runStart === null ? null : hourStart(ctx.date, runStart),
      lastProofAt: lastProof?.at ?? null,
      openNow,
    });
    return {
      screen: {
        id: s.id,
        name: s.name,
        venue: { id: s.venueId, name: s.venueName, zone: s.zone },
        status,
        connected: isConnected,
        lastSeenAt: s.lastSeenAt,
        pairedAt: s.pairedAt,
        openNow,
        matchNow,
        now: { plannedReps: plannedRepsNow, campaigns: matchNow ? [] : (current?.campaigns ?? []) },
        lastProof,
        today: { plannedTotal, plannedSoFar, aired },
        device: readDeviceReport(s.deviceReport),
        deviceReportAt: s.deviceReportAt,
        issues: healthIssues(readDeviceReport(s.deviceReport)),
      },
      plan,
      blackoutByHour,
      proofs: mine,
    };
  });
};

export const loadFleet = async (now: Date = new Date()): Promise<FleetScreen[]> =>
  (await assemble(await loadScreens(), now)).map((a) => a.screen);

export const loadFleetScreen = async (
  screenId: string,
  now: Date = new Date(),
): Promise<FleetScreenDetail | null> => {
  const rows = await loadScreens(screenId);
  if (rows.length === 0) return null;
  const [a] = await assemble(rows, now);
  if (!a) return null;
  const airedByHour = new Map<number, number>();
  const airedTodayByCampaign = new Map<string, number>();
  const lastByCampaign = new Map<string, Date>();
  for (const p of a.proofs) {
    airedByHour.set(p.hour, (airedByHour.get(p.hour) ?? 0) + p.n);
    if (p.campaignId) {
      airedTodayByCampaign.set(p.campaignId, (airedTodayByCampaign.get(p.campaignId) ?? 0) + p.n);
      const last = new Date(p.last);
      const prev = lastByCampaign.get(p.campaignId);
      if (!prev || last > prev) lastByCampaign.set(p.campaignId, last);
    }
  }
  // The campaigns of today's plan + any that aired today (an ended or withdrawn one shows too).
  const plannedByCampaign = new Map<string, { name: string; planned: number }>();
  for (const h of a.plan) {
    for (const c of h.campaigns) {
      const e = plannedByCampaign.get(c.id) ?? { name: c.name, planned: 0 };
      e.planned += c.reps;
      plannedByCampaign.set(c.id, e);
    }
  }
  const campaignIds = [...new Set([...plannedByCampaign.keys(), ...airedTodayByCampaign.keys()])];
  const meta =
    campaignIds.length === 0
      ? []
      : await db
          .select({
            id: campaigns.id,
            name: campaigns.name,
            startDate: campaigns.startDate,
            endDate: campaigns.endDate,
          })
          .from(campaigns)
          .where(inArray(campaigns.id, campaignIds));
  const totals =
    campaignIds.length === 0
      ? []
      : await db
          .select({ campaignId: proofOfPlay.campaignId, n: sql<number>`count(*)::int` })
          .from(proofOfPlay)
          .where(
            and(
              eq(proofOfPlay.screenId, screenId),
              eq(proofOfPlay.eventType, 'VIDEO_STARTED'),
              inArray(proofOfPlay.campaignId, campaignIds),
            ),
          )
          .groupBy(proofOfPlay.campaignId);
  const totalByCampaign = new Map(totals.map((t) => [t.campaignId, t.n]));
  const events = await db
    .select({ kind: screenWsEvents.kind, detail: screenWsEvents.detail, at: screenWsEvents.at })
    .from(screenWsEvents)
    .where(
      and(
        eq(screenWsEvents.screenId, screenId),
        gte(screenWsEvents.at, new Date(now.getTime() - 24 * 3_600_000)),
      ),
    )
    .orderBy(sql`${screenWsEvents.at} desc`)
    .limit(60);
  const row = rows[0];
  return {
    ...a.screen,
    player: readStatusReport(row?.statusReport ?? null),
    playerReportAt: row?.statusReportAt ?? null,
    events,
    hours: a.plan.map((h) => ({
      hour: h.hour,
      planned: h.reps,
      aired: airedByHour.get(h.hour) ?? 0,
      blackoutMinutes: a.blackoutByHour[h.hour] ?? 0,
      campaigns: h.campaigns,
    })),
    campaigns: meta
      .map((m) => ({
        id: m.id,
        name: m.name,
        startDate: m.startDate,
        endDate: m.endDate,
        plannedToday: plannedByCampaign.get(m.id)?.planned ?? 0,
        airedToday: airedTodayByCampaign.get(m.id) ?? 0,
        airedTotal: totalByCampaign.get(m.id) ?? 0,
        lastProofAt: lastByCampaign.get(m.id) ?? null,
      }))
      .sort((x, y) => y.plannedToday - x.plannedToday || x.name.localeCompare(y.name)),
  };
};
