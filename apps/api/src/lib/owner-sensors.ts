import { fromZonedTime } from 'date-fns-tz';
import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm';

import { db } from '../db/client.js';
import { screenhostAffluenceHourly, screenhosts } from '../db/schema.js';

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

export const sensorStatusOf = (
  latest: LatestMeasuredCell | null,
  now: Date,
): { status: SensorStatus; lastMeasuredAt: string | null } => {
  if (!latest) return { status: 'never', lastMeasuredAt: null };
  const end = slotEndInstant(latest.date, latest.slot);
  const recent = now.getTime() - end.getTime() <= SENSOR_OFFLINE_AFTER_MINUTES * 60 * 1000;
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
    .select({ id: screenhosts.id, name: screenhosts.name })
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
