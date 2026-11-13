import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm';

import {
  campaignTargeting,
  campaignTypicalWeek,
  campaignZones,
  hourReservations,
  screenhostAffluence,
  screenhosts,
} from '../../../db/schema.js';
import { ownerApprovedSql } from '../../approved-owner.js';
import { demoVenueIds, isDemoCampaign } from '../../demo.js';
import { NOOP_TRACE, type EngineTrace } from '../../engine-journal/trace.js';
import { blackoutMinutesInHour, eventBlackouts, windowsForVenue } from '../../event-blackout.js';
import { collapseHalvesSql, inEffectSql } from '../../half-hour-slots.js';
import { venueHasInstalledScreenSql } from '../../installed-screen.js';
import { addIsoDays, openingHours, shiftDayOfWeek } from '../../opening-hours.js';
import { spsObservationsFor } from '../../sps-observations.js';
import { SPS_NEUTRAL, spsComputable } from '../../sps-score.js';
import { frozenVenueIds, hasTypicalWeekFreeze } from '../../typical-week-freeze.js';
import { loadUnavailableCells } from '../../unavailable-hours.js';
import { poolExclusionReason } from '../exclusion-reason.js';
import { type WindowDay } from '../plan.js';
import { type DbExecutor, OCCUPANCY_LOCK_NAMESPACE } from '../pool.js';
import { buildWindowDays } from '../window.js';

import { type VenueHourInput, type VenueInput } from './heures-types.js';

// DISP-TOURS — the pool and its usable hours, from the DB (Mariem's spec R1–R3). The tours engine
// (./calculer.ts) is pure; this is its one DB input, shared by the cart's calculation, the launch,
// the redispatching and the admin fiche, so they can never disagree about what a venue can air.
//
//   R1 — eligibility is UNCHANGED (./exclusion-reason.ts, the same hard filters as the old pool:
//        targeting, zones, approved owner, installed screen, opening hours, demo bounding), plus a
//        typical week: a venue nobody was ever measured in has no hour worth airing.
//   R2 — the typical week is read as it stands: the LIVE grid while the campaign is priced (the
//        cart), the campaign's own copy once it was launched (frozen at launch, typical-week-
//        freeze.ts) — the redispatching and the cascade price on the week the advertiser bought.
//   R3 — a date of an hour is usable when it is in the period, it is not an hour of today already
//        started (Mariem 05/11: launched at 13:10, a same-day campaign starts at 14 h), the venue
//        did not declare it unavailable (whole day or hour, HOUR-UNAV1), it is open then, the hour
//        is not full
//        (fewer than CAP_heure = ⌊3600 ÷ F⌋ launched campaigns hold it, counted from their
//        « Lancer » — a campaign in a cart holds nothing) and the event engine does not hold it
//        (an hour_reservations cell, or any minute of a confirmed match's window: ruled out for
//        that date).

export interface AssembleToursOpts {
  /** 'live' (pricing before launch) or 'frozen' (the launch-time copy, when it exists). */
  typicalWeek: 'live' | 'frozen';
  excludeScreenhostIds?: readonly string[];
  /** Redispatching — only créneaux strictly after this Tunis (date, hour) are usable. */
  afterSlot?: { date: string; hour: number };
  /** The instant of the calculation (default: now) — today's hours already started are not usable. */
  now?: Date;
  /** Cells this campaign already uses, per venue ('date:hour') — not free for it again. */
  ownCells?: ReadonlyMap<string, ReadonlySet<string>>;
  /** US-4.4 — the same sorted per-venue advisory locks as the old allocating paths. */
  lockOccupancy?: boolean;
  trace?: EngineTrace;
}

export type ToursExclusionReason =
  | ReturnType<typeof poolExclusionReason>
  | 'no_typical_week'
  | 'no_usable_hour';

export interface ToursPool {
  windowDays: WindowDay[];
  venues: VenueInput[];
  /** Every active venue left out, with its first reason (the admin's « établissements exclus »). */
  excluded: { venueId: string; reason: NonNullable<ToursExclusionReason> }[];
  /** Venues matching the targeting before any availability (0 = the targeting matches nothing). */
  candidateCount: number;
  /** ⌊3600 ÷ F⌋ — campaigns one hour can hold. */
  capHeure: number;
  /** Each pool venue's opening (weekday, hour) cells in the period with their A — the admin grid
   *  greys the ones with no usable date (unavailable, closed that day, full, held by an event). */
  week: Map<string, { dayOfWeek: number; hour: number; affluence: number }[]>;
}

const cellKey = (date: string, hour: number): string => `${date}:${hour}`;

/** CAP_heure = ⌊3600 ÷ F⌋. */
export const capHeure = (fMaxSeconds: number): number =>
  fMaxSeconds > 0 ? Math.floor(3600 / fMaxSeconds) : 0;

export const assembleToursPool = async (
  executor: DbExecutor,
  campaign: { id: string; startDate: string; endDate: string },
  fMaxSeconds: number,
  opts: AssembleToursOpts,
): Promise<ToursPool> => {
  const trace = opts.trace ?? NOOP_TRACE;
  const windowDays = buildWindowDays(campaign.startDate, campaign.endDate);
  const cap = capHeure(fMaxSeconds);
  const windowStart = windowDays[0]?.date ?? campaign.startDate;
  const windowEnd = windowDays.at(-1)?.date ?? campaign.endDate;
  // An overnight window's post-midnight hours sit on the day AFTER the last opening day.
  const cellsEnd = addIsoDays(windowEnd, 1);
  // Mariem 05/11 — today's hours already started (the one under way included) are gone. Only
  // TODAY's: the cart never starts a campaign in the past, and an older window (an admin
  // activating a late campaign, the simulator's worlds) keeps the engine's dates as they were.
  const now = opts.now ?? new Date();
  const today = formatInTimeZone(now, 'Africa/Tunis', 'yyyy-MM-dd');
  const hourUnderWay = Number(formatInTimeZone(now, 'Africa/Tunis', 'H'));

  const lines = await executor
    .select({ categoryId: campaignTargeting.categoryId, class: campaignTargeting.class })
    .from(campaignTargeting)
    .where(eq(campaignTargeting.campaignId, campaign.id));
  const zoneIds = (
    await executor
      .select({ zoneId: campaignZones.zoneId })
      .from(campaignZones)
      .where(eq(campaignZones.campaignId, campaign.id))
  ).map((z) => z.zoneId);

  const activeRows = await executor
    .select({
      id: screenhosts.id,
      ownerApproved: ownerApprovedSql(),
      installedScreen: venueHasInstalledScreenSql(),
      demoOnly: screenhosts.demoOnly,
      sps: screenhosts.sps,
      businessSectorId: screenhosts.businessSectorId,
      class: screenhosts.class,
      zoneId: screenhosts.zoneId,
      openingHour: screenhosts.openingHour,
      closingHour: screenhosts.closingHour,
    })
    .from(screenhosts)
    .where(eq(screenhosts.isActive, true));

  const frozen =
    opts.typicalWeek === 'frozen' && (await hasTypicalWeekFreeze(executor, campaign.id));
  const frozenVenues = frozen ? await frozenVenueIds(executor, campaign.id) : null;
  const demoVenues = (await isDemoCampaign(executor, campaign.id))
    ? await demoVenueIds(executor)
    : null;
  const ctx = {
    lines,
    zoneIds,
    excluded: new Set(opts.excludeScreenhostIds ?? []),
    frozenVenues,
    demoVenues,
  };
  const excluded: ToursPool['excluded'] = [];
  const candidates = activeRows.filter((sh) => {
    const reason = poolExclusionReason(sh, ctx);
    if (reason !== null) {
      excluded.push({ venueId: sh.id, reason });
      trace.event('venue_excluded', { reason }, sh.id);
    }
    return reason === null;
  });
  const ids = candidates.map((c) => c.id);

  if (opts.lockOccupancy === true) {
    for (const id of [...ids].sort()) {
      await executor.execute(
        sql`select pg_advisory_xact_lock(${OCCUPANCY_LOCK_NAMESPACE}, hashtext(${id}))`,
      );
    }
  }

  // R2 — A per (venue, weekday, hour): the half-hour cells collapse to their hour (pool.ts).
  const affluenceRows = ids.length
    ? frozen
      ? await executor
          .select({
            screenhostId: campaignTypicalWeek.screenhostId,
            dayOfWeek: campaignTypicalWeek.dayOfWeek,
            hour: campaignTypicalWeek.hour,
            affluence: collapseHalvesSql(campaignTypicalWeek.estimatedImpressions),
          })
          .from(campaignTypicalWeek)
          .where(
            and(
              eq(campaignTypicalWeek.campaignId, campaign.id),
              inArray(campaignTypicalWeek.screenhostId, ids),
              inEffectSql(campaignTypicalWeek.inEffect),
            ),
          )
          .groupBy(
            campaignTypicalWeek.screenhostId,
            campaignTypicalWeek.dayOfWeek,
            campaignTypicalWeek.hour,
          )
      : await executor
          .select({
            screenhostId: screenhostAffluence.screenhostId,
            dayOfWeek: screenhostAffluence.dayOfWeek,
            hour: screenhostAffluence.hour,
            affluence: collapseHalvesSql(screenhostAffluence.estimatedImpressions),
          })
          .from(screenhostAffluence)
          .where(
            and(
              inArray(screenhostAffluence.screenhostId, ids),
              inEffectSql(screenhostAffluence.inEffect),
            ),
          )
          .groupBy(
            screenhostAffluence.screenhostId,
            screenhostAffluence.dayOfWeek,
            screenhostAffluence.hour,
          )
    : [];
  const affByKey = new Map<string, number>();
  for (const a of affluenceRows) {
    affByKey.set(`${a.screenhostId}:${a.dayOfWeek}:${a.hour}`, Number(a.affluence));
  }

  // R3 — the cells no date of which is usable, per venue.
  const unavailable = await loadUnavailableCells(executor, candidates, windowStart, cellsEnd);
  const reservations = ids.length
    ? await executor
        .select({
          screenhostId: hourReservations.screenhostId,
          day: hourReservations.day,
          hour: hourReservations.hour,
        })
        .from(hourReservations)
        .where(
          and(
            inArray(hourReservations.screenhostId, ids),
            gte(hourReservations.day, windowStart),
            lte(hourReservations.day, cellsEnd),
          ),
        )
    : [];
  const reservedBySh = new Map<string, Set<string>>();
  for (const r of reservations) {
    const set = reservedBySh.get(r.screenhostId) ?? new Set<string>();
    set.add(cellKey(r.day, r.hour));
    reservedBySh.set(r.screenhostId, set);
  }
  const blackouts = await eventBlackouts(
    fromZonedTime(`${addIsoDays(windowStart, -1)}T00:00:00`, 'Africa/Tunis'),
    fromZonedTime(`${addIsoDays(cellsEnd, 1)}T00:00:00`, 'Africa/Tunis'),
    executor,
  );
  // CAP_heure — the LAUNCHED campaigns (a plan, not ended, the allocation not refused) holding
  // each (venue, date, hour): one place each, whatever their passages. This campaign never
  // competes with itself (its own cells are `ownCells`, the redispatching's concern). A plan
  // counts from the « Lancer » that froze it: the cart freezes all its campaigns BEFORE flipping
  // them out of draft, so a draft with a plan holds its places too (Mariem 05/11: seven campaigns
  // launched together had all taken the same hours, over the cap of 6).
  const occupancyRows = ids.length
    ? [
        ...(await executor.execute<{ screenhostId: string; date: string; hour: number; n: number }>(
          sql`
          select a.screenhost_id as "screenhostId", c->>'date' as "date", (c->>'hour')::int as "hour",
                 count(distinct p.campaign_id)::int as "n"
          from campaign_dispatch_allocation a
          join campaign_dispatch_plan p on p.id = a.plan_id
          join campaigns cp on cp.id = p.campaign_id
          cross join lateral jsonb_array_elements(a.creneaux) c
          where a.screenhost_id in (${sql.join(
            ids.map((id) => sql`${id}::uuid`),
            sql`, `,
          )})
            and a.statut_acceptation <> 'REFUSE'
            and cp.status not in ('completed', 'rejected')
            and p.campaign_id <> ${campaign.id}::uuid
            and c->>'date' between ${windowStart} and ${cellsEnd}
            and coalesce((c->>'reps')::int, 0) > 0
          group by 1, 2, 3`,
        )),
      ]
    : [];
  const occupied = new Map<string, number>();
  for (const o of occupancyRows) occupied.set(`${o.screenhostId}:${o.date}:${o.hour}`, o.n);

  const observations = await spsObservationsFor(ids);
  const venues: VenueInput[] = [];
  const week: ToursPool['week'] = new Map();
  for (const sh of candidates) {
    const oHours = openingHours(sh.openingHour, sh.closingHour);
    const off = unavailable.get(sh.id);
    const reserved = reservedBySh.get(sh.id);
    const own = opts.ownCells?.get(sh.id);
    const venueBlackouts = windowsForVenue(blackouts, sh.id);
    const byHour = new Map<string, VenueHourInput & { dates: string[] }>();
    const cells = new Map<string, { dayOfWeek: number; hour: number; affluence: number }>();
    let measured = false;
    for (const day of windowDays) {
      for (const { hour, dayOffset } of oHours) {
        const date = dayOffset ? addIsoDays(day.date, dayOffset) : day.date;
        const dayOfWeek = shiftDayOfWeek(day.dayOfWeek, dayOffset);
        const affluence = affByKey.get(`${sh.id}:${dayOfWeek}:${hour}`) ?? 0;
        if (affluence > 0) measured = true;
        cells.set(`${dayOfWeek}:${hour}`, { dayOfWeek, hour, affluence });
        const key = cellKey(date, hour);
        if (off?.has(key) || reserved?.has(key) || own?.has(key)) continue;
        if (date === today && hour <= hourUnderWay) continue;
        if (opts.afterSlot && !isAfter({ date, hour }, opts.afterSlot)) continue;
        if ((occupied.get(`${sh.id}:${key}`) ?? 0) >= cap) continue;
        if (blackoutMinutesInHour(venueBlackouts, date, hour) > 0) continue;
        const hk = `${dayOfWeek}:${hour}`;
        const entry = byHour.get(hk) ?? { dayOfWeek, hour, affluence, dates: [] };
        entry.dates.push(date);
        byHour.set(hk, entry);
      }
    }
    const hours = [...byHour.values()].filter((h) => h.affluence > 0);
    if (!measured) {
      excluded.push({ venueId: sh.id, reason: 'no_typical_week' });
      trace.event('venue_excluded', { reason: 'no_typical_week' }, sh.id);
      continue;
    }
    if (hours.length === 0) {
      excluded.push({ venueId: sh.id, reason: 'no_usable_hour' });
      trace.event('venue_excluded', { reason: 'no_usable_hour' }, sh.id);
      continue;
    }
    // SPS-DISPATCH1 — an unscored venue ranks at the neutral midpoint, never on its defaults.
    const obs = observations.get(sh.id);
    const scored = obs !== undefined && spsComputable(obs);
    venues.push({ id: sh.id, sps: scored ? Number(sh.sps) : SPS_NEUTRAL, hours });
    week.set(
      sh.id,
      [...cells.values()].sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.hour - b.hour),
    );
  }

  trace.event('pool_assembled', {
    poolSize: venues.length,
    windowDays: windowDays.length,
    windowStart,
    windowEnd,
  });
  return { windowDays, venues, excluded, candidateCount: candidates.length, capHeure: cap, week };
};

/** A créneau strictly after the given Tunis (date, hour). */
const isAfter = (
  c: { date: string; hour: number },
  slot: { date: string; hour: number },
): boolean => c.date > slot.date || (c.date === slot.date && c.hour > slot.hour);
