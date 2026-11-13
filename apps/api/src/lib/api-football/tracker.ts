import {
  and,
  asc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  notInArray,
  or,
  sql,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { FastifyBaseLogger } from 'fastify';

import { db } from '../../db/client.js';
import { eventMatches, events, teams } from '../../db/schema.js';
import { env } from '../../env.js';
import { extendEventEnd } from '../event-playout/extend.js';

import {
  type ApiFixture,
  apiFootballEnabled,
  fixtureById,
  fixturesOnDate,
  liveFixtures,
} from './client.js';
import { FINAL_STATUSES, jumpsFor } from './jumps.js';
import { eventTeams, matchFixture } from './match.js';

// EVT-ET1 (operator rulings 2026-10-27) — the extra-time tracker, one tick every
// API_FOOTBALL_POLL_SECONDS (default 2 min). Two steps, both sized for the FREE plan (100
// requests a day):
//
//   1. LINK — confirmed official football events kicking off from 30 min ago to TOMORROW (Tunis)
//      with no fixture yet: ONE request per Tunis day (every fixture of that day), at most once
//      per day every 6 h. The free plan only answers dates from yesterday to tomorrow (« Free plans
//      do not have access to this date », seen on staging 2026-10-27), so a later match waits
//      until the day before its kick-off. Each event is matched on its two teams + kick-off
//      (lib/api-football/match.ts). Unmatched events stay unlinked and are retried 6 h later.
//   2. FOLLOW — linked events from minute 85 after kick-off until a final status (or 4 h after
//      kick-off): ONE `live=all` request per tick covers every followed match (the free plan has
//      no multi-id lookup). A followed match missing from the live list is read by `id` once — it
//      has just ended, and its final status still applies a jump it went through between two
//      ticks; one that was never seen live (a late kick-off) is re-read by id at most every 15 min.
//      A status of extra time / penalties applies the fixed jumps (lib/api-football/jumps.ts)
//      through lib/event-playout/extend.ts.
//
// An evening of matches costs ~15 requests (minute 85 → final whistle every 2 min, shared by all
// its matches) plus one per match at its end — far under the 100 a day. Quota / network errors
// are logged and the next tick simply tries again.

const LINK_HORIZON_MS = 48 * 3600_000;
const LINK_RETRY_MS = 6 * 3600_000;
const FOLLOW_FROM_MS = 85 * 60_000;
const FOLLOW_UNTIL_MS = 4 * 3600_000;
/** A followed match not seen live yet is re-read by id at most this often. */
const NOT_LIVE_RECHECK_MS = 15 * 60_000;
/** Statuses that mean « on the pitch right now » (the match is in the live list). */
const LIVE_STATUSES = new Set(['1H', 'HT', '2H', 'ET', 'BT', 'P', 'SUSP', 'INT', 'LIVE']);

export interface TrackerDeps {
  fixturesOnDate: (day: string) => Promise<ApiFixture[]>;
  liveFixtures: () => Promise<ApiFixture[]>;
  fixtureById: (id: number) => Promise<ApiFixture | null>;
  extend: typeof extendEventEnd;
  pollSeconds: number;
  /** When each Tunis day was last fetched for linking (kept across ticks). */
  linkAttempts: Map<string, number>;
}

const tunisDay = (d: Date): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Tunis' }).format(d);

const footballSql = sql`lower(coalesce(${events.category}, '')) = 'football'`;

/** The single-match teams of each event (its catalogue matches with team names). */
const loadMatchTeams = async (
  eventIds: string[],
): Promise<Map<string, { home: string; away: string | null }[]>> => {
  const out = new Map<string, { home: string; away: string | null }[]>();
  if (eventIds.length === 0) return out;
  const home = alias(teams, 'home_team');
  const away = alias(teams, 'away_team');
  const rows = await db
    .select({ eventId: eventMatches.eventId, home: home.name, away: away.name })
    .from(eventMatches)
    .innerJoin(home, eq(home.id, eventMatches.homeTeamId))
    .leftJoin(away, eq(away.id, eventMatches.awayTeamId))
    .where(inArray(eventMatches.eventId, eventIds))
    .orderBy(asc(eventMatches.position));
  for (const r of rows) {
    const list = out.get(r.eventId) ?? [];
    list.push({ home: r.home, away: r.away });
    out.set(r.eventId, list);
  }
  return out;
};

export const linkFixtures = async (
  now: Date,
  deps: TrackerDeps,
  log: FastifyBaseLogger,
): Promise<number> => {
  const candidates = await db
    .select()
    .from(events)
    .where(
      and(
        eq(events.source, 'official'),
        eq(events.annule, false),
        eq(events.dateTbc, false),
        isNull(events.apiFootballFixtureId),
        footballSql,
        gte(events.kickoffAt, new Date(now.getTime() - 30 * 60_000)),
        lte(events.kickoffAt, new Date(now.getTime() + LINK_HORIZON_MS)),
      ),
    );
  if (candidates.length === 0) return 0;
  const matchTeams = await loadMatchTeams(candidates.map((e) => e.id));
  const byDay = new Map<string, typeof candidates>();
  for (const e of candidates) {
    const day = tunisDay(e.kickoffAt);
    byDay.set(day, [...(byDay.get(day) ?? []), e]);
  }
  // The free plan's window: yesterday … tomorrow (Tunis). Later days are not asked yet.
  const tomorrow = tunisDay(new Date(now.getTime() + 24 * 3600_000));
  let linked = 0;
  for (const [day, dayEvents] of byDay) {
    if (day > tomorrow) continue;
    const last = deps.linkAttempts.get(day);
    if (last !== undefined && now.getTime() - last < LINK_RETRY_MS) continue;
    deps.linkAttempts.set(day, now.getTime());
    let fixtures: ApiFixture[];
    try {
      fixtures = await deps.fixturesOnDate(day);
    } catch (err) {
      log.warn({ err, day }, 'api-football: fixtures of the day could not be read');
      continue;
    }
    for (const e of dayEvents) {
      const pair = eventTeams(e.name, matchTeams.get(e.id) ?? []);
      if (!pair) continue;
      const fixture = matchFixture(
        { teams: pair, kickoffAt: e.kickoffAt, timeTbc: e.timeTbc },
        fixtures,
      );
      if (!fixture) continue;
      await db
        .update(events)
        .set({ apiFootballFixtureId: fixture.id, apiFootballStatus: fixture.status })
        .where(and(eq(events.id, e.id), isNull(events.apiFootballFixtureId)));
      linked += 1;
      log.info({ eventId: e.id, fixtureId: fixture.id }, 'api-football: event linked');
    }
  }
  return linked;
};

export const followLiveMatches = async (
  now: Date,
  deps: TrackerDeps,
  log: FastifyBaseLogger,
): Promise<number> => {
  const due = await db
    .select()
    .from(events)
    .where(
      and(
        eq(events.annule, false),
        isNotNull(events.apiFootballFixtureId),
        or(
          isNull(events.apiFootballStatus),
          notInArray(events.apiFootballStatus, [...FINAL_STATUSES]),
        ),
        lte(events.kickoffAt, new Date(now.getTime() - FOLLOW_FROM_MS)),
        gte(events.kickoffAt, new Date(now.getTime() - FOLLOW_UNTIL_MS)),
        or(
          isNull(events.apiFootballCheckedAt),
          lte(
            events.apiFootballCheckedAt,
            new Date(now.getTime() - deps.pollSeconds * 1000 + 5_000),
          ),
        ),
      ),
    );
  if (due.length === 0) return 0;
  let live: Map<number, ApiFixture>;
  try {
    live = new Map((await deps.liveFixtures()).map((f) => [f.id, f]));
  } catch (err) {
    log.warn({ err }, 'api-football: live statuses could not be read');
    return 0;
  }
  let jumped = 0;
  for (const e of due) {
    const id = e.apiFootballFixtureId;
    if (id === null) continue;
    let fixture: ApiFixture | null | undefined = live.get(id);
    if (!fixture) {
      // Off the live list: it just ended (it was live) → read its final status now; never seen
      // live yet → at most every 15 min.
      const wasLive = e.apiFootballStatus !== null && LIVE_STATUSES.has(e.apiFootballStatus);
      const stale =
        e.apiFootballCheckedAt === null ||
        now.getTime() - e.apiFootballCheckedAt.getTime() >= NOT_LIVE_RECHECK_MS;
      if (!wasLive && !stale) continue;
      try {
        fixture = await deps.fixtureById(id);
      } catch (err) {
        log.warn({ err, eventId: e.id }, 'api-football: fixture could not be read');
        continue;
      }
    }
    if (!fixture) continue;
    await db
      .update(events)
      .set({ apiFootballStatus: fixture.status, apiFootballCheckedAt: now })
      .where(eq(events.id, e.id));
    for (const jump of jumpsFor(fixture.status, {
      extraTime: e.extraTimeAppliedAt !== null,
      penalties: e.penaltiesAppliedAt !== null,
    })) {
      await deps.extend(e.id, jump.minutes, jump.reason, log);
      jumped += 1;
    }
  }
  return jumped;
};

export const trackerTick = async (
  now: Date,
  deps: TrackerDeps,
  log: FastifyBaseLogger,
): Promise<{ linked: number; jumped: number }> => {
  const linked = await linkFixtures(now, deps, log);
  const jumped = await followLiveMatches(now, deps, log);
  return { linked, jumped };
};

/** Boot tick + an unref'd interval (the startXJob pattern). Off without API_FOOTBALL_KEY. */
export const startApiFootballJob = (log: FastifyBaseLogger): void => {
  if (!apiFootballEnabled()) {
    log.warn(
      'api-football disabled (API_FOOTBALL_KEY unset) — extra time is extended by hand only',
    );
    return;
  }
  const deps: TrackerDeps = {
    fixturesOnDate,
    liveFixtures,
    fixtureById,
    extend: extendEventEnd,
    pollSeconds: env.API_FOOTBALL_POLL_SECONDS,
    linkAttempts: new Map(),
  };
  const tick = (): void => {
    void trackerTick(new Date(), deps, log).catch((err: unknown) =>
      log.warn({ err }, 'api-football: tracker tick failed'),
    );
  };
  tick();
  setInterval(tick, deps.pollSeconds * 1000).unref();
};
