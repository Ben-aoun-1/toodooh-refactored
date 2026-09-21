import { fromZonedTime } from 'date-fns-tz';
import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm';

import { db } from '../db/client.js';
import { screenhostAffluenceHourly, screenhosts } from '../db/schema.js';

import { isOpenSlot } from './opening-hours.js';

// CAL-2 (Figma « Mon calendrier et mes dispositifs de diffusion », card « ÉTAT DE MON
// DISPOSITIF ») — the affluence sensor's state as the platform can honestly know it. The hub
// knows each sensor individually, but it only ever sends the platform the venue's MEASURED
// half-hour cells (AUD-HOURLY1), so the state here is per venue and read from those cells:
//   - never   : no measured cell has ever arrived;
//   - active  : the latest measured half-hour ended recently AND the hub flagged the device
//               online for it;
//   - offline : otherwise.
// « Recently » is the hub's own offline rule (3 missed 30-minute reports = 1 h 30) plus one push
// cycle (the hub pushes every 30 min). The cell's received_at is NOT used: every re-push
// refreshes it, so a silent sensor whose old cells keep being re-sent would look alive.
// LEARN-1 — « Recently » counts the venue's OPENING time only: under the hub's flag closed
// half-hours are never sent, so counting wall-clock minutes would read every sensor as offline
// every night. NULL hours (either bound) = open all day = exactly the wall-clock rule.

export type SensorStatus = 'active' | 'offline' | 'never';

const TZ = 'Africa/Tunis';
export const SENSOR_OFFLINE_AFTER_MINUTES = 90 + 30;

export interface LatestMeasuredCell {
  date: string;
  slot: number;
  deviceOnline: boolean | null;
}

/** The instant a half-hour slot of a Tunis calendar day ENDS. */
export const slotEndInstant = (date: string, slot: number): Date => {
  const endMinutes = (slot + 1) * 30;
  // slot 47 ends at 24:00 = the next day's 00:00 — built from minutes past midnight.
  const base = fromZonedTime(`${date}T00:00:00`, TZ);
  return new Date(base.getTime() + endMinutes * 60 * 1000);
};

/** LEARN-1 — a venue's opening window, straight from `screenhosts.opening_hour/closing_hour`. */
export interface VenueHours {
  openingHour: number | null;
  closingHour: number | null;
}

/**
 * LEARN-1 — minutes of `[from, to)` whose Tunis half-hour is open (per `isOpenSlot`). Walks in
 * steps that end on the next half-hour boundary (the first step may be partial when `from` is not
 * on a boundary; the last step is cut at `to`), and returns as soon as the running total exceeds
 * `cap` — so a venue open all day over a long `[from, to)` stops early instead of walking it all.
 */
export const openMinutesBetween = (
  from: Date,
  to: Date,
  hours: VenueHours,
  cap: number,
): number => {
  let total = 0;
  let stepStart = from;
  while (stepStart.getTime() < to.getTime()) {
    const key = tunisSlotKey(stepStart);
    const boundary = slotEndInstant(key.date, key.slot);
    const stepEnd = boundary.getTime() < to.getTime() ? boundary : to;
    if (isOpenSlot(key.slot, hours.openingHour, hours.closingHour)) {
      total += (stepEnd.getTime() - stepStart.getTime()) / 60_000;
      if (total > cap) return total;
    }
    stepStart = stepEnd;
  }
  return total;
};

export const sensorStatusOf = (
  latest: LatestMeasuredCell | null,
  now: Date,
  hours?: VenueHours,
): { status: SensorStatus; lastMeasuredAt: string | null } => {
  if (!latest) return { status: 'never', lastMeasuredAt: null };
  const end = slotEndInstant(latest.date, latest.slot);
  const recent =
    hours &&
    hours.openingHour !== null &&
    hours.closingHour !== null &&
    hours.openingHour !== hours.closingHour
      ? openMinutesBetween(end, now, hours, SENSOR_OFFLINE_AFTER_MINUTES) <=
        SENSOR_OFFLINE_AFTER_MINUTES
      : now.getTime() - end.getTime() <= SENSOR_OFFLINE_AFTER_MINUTES * 60 * 1000;
  return {
    status: recent && latest.deviceOnline !== false ? 'active' : 'offline',
    lastMeasuredAt: end.toISOString(),
  };
};

export interface OwnerSensorRow {
  venue_id: string;
  venue_name: string;
  status: SensorStatus;
  /** When the latest measured half-hour ended (ISO), or null when nothing was ever measured. */
  last_measured_at: string | null;
}

export const ownerSensorStatuses = async (
  ownerId: string,
  now: Date,
): Promise<OwnerSensorRow[]> => {
  const venues = await db
    .select({
      id: screenhosts.id,
      name: screenhosts.name,
      openingHour: screenhosts.openingHour,
      closingHour: screenhosts.closingHour,
    })
    .from(screenhosts)
    .where(eq(screenhosts.ownerId, ownerId))
    .orderBy(screenhosts.name);
  if (venues.length === 0) return [];

  const latest = await db
    .selectDistinctOn([screenhostAffluenceHourly.screenhostId], {
      screenhostId: screenhostAffluenceHourly.screenhostId,
      date: screenhostAffluenceHourly.date,
      slot: screenhostAffluenceHourly.slot,
      deviceOnline: screenhostAffluenceHourly.deviceOnline,
    })
    .from(screenhostAffluenceHourly)
    .where(
      and(
        inArray(
          screenhostAffluenceHourly.screenhostId,
          venues.map((v) => v.id),
        ),
        isNotNull(screenhostAffluenceHourly.value),
      ),
    )
    .orderBy(
      screenhostAffluenceHourly.screenhostId,
      desc(screenhostAffluenceHourly.date),
      desc(screenhostAffluenceHourly.slot),
    );
  const latestOf = new Map(latest.map((l) => [l.screenhostId, l]));

  return venues.map((v) => {
    const cell = latestOf.get(v.id);
    const { status, lastMeasuredAt } = sensorStatusOf(
      cell ? { date: cell.date, slot: cell.slot, deviceOnline: cell.deviceOnline } : null,
      now,
      { openingHour: v.openingHour, closingHour: v.closingHour },
    );
    return { venue_id: v.id, venue_name: v.name, status, last_measured_at: lastMeasuredAt };
  });
};

/** For tests and callers that need a Tunis slot key: « YYYY-MM-DD » + slot of an instant. */
export const tunisSlotKey = (instant: Date): { date: string; slot: number } => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(instant);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '00';
  const hour = Number(get('hour')) % 24;
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    slot: hour * 2 + (Number(get('minute')) >= 30 ? 1 : 0),
  };
};
