import { addDays, format, parseISO, startOfISOWeek } from 'date-fns';
import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '../db/client.js';
import {
  agentAffiliations,
  businessSectors,
  screenhostAffluence,
  screenhostAffluenceHourly,
  screenhosts,
} from '../db/schema.js';
import { env } from '../env.js';

import { tunisDateOf } from './campaign-dates.js';

// Mariem 12/11/2026 (Agent Screenhost spec VF §12 « Suivi des capteurs », §14 « Assigner un
// capteur »; operator 2026-11-14: bring the sensor screens INTO Toodooh, no second sign-in).
// The hub stays the owner of the sensors: the platform asks it, server to server with the sync
// key, for the agent's sensors and their places, and asks it to assign a sensor. Which venues an
// agent may see or assign to is decided HERE, from his affiliations. The heat-maps come from the
// platform's own affluence tables (the hub's pushes).

const deviceSchema = z.object({
  id: z.string(),
  label: z.string(),
  status: z.enum(['online', 'offline', 'never']),
  people: z.number().nullable(),
  battery_pct: z.number().nullable(),
  last_seen_at: z.string().nullable(),
  location_id: z.string().nullable(),
  place_name: z.string().nullable(),
});
const placeSchema = z.object({
  location_id: z.string(),
  name: z.string(),
  device_count: z.number(),
  people_now: z.number(),
  last24h: z.array(z.object({ at: z.string(), people: z.number().nullable() })),
});
const hubSensorsSchema = z.object({
  agent_found: z.boolean(),
  devices: z.array(deviceSchema),
  places: z.array(placeSchema),
});

export type HubDevice = z.infer<typeof deviceSchema>;
export type HubPlace = z.infer<typeof placeSchema>;
export type HubSensors = z.infer<typeof hubSensorsSchema>;

export interface HubConfig {
  ingestUrl: string;
  syncKey: string;
}

const hubConfig = (): HubConfig | null =>
  env.WEDOOH_INGEST_URL && env.TOODOOH_SYNC_KEY
    ? { ingestUrl: env.WEDOOH_INGEST_URL, syncKey: env.TOODOOH_SYNC_KEY }
    : null;

/** The agent's sensors and their places as the hub knows them; null when the hub is unreachable. */
export const fetchHubSensors = async (
  agentUserId: string,
  cfg: HubConfig | null = hubConfig(),
): Promise<HubSensors | null> => {
  if (!cfg) return null;
  try {
    const res = await fetch(
      `${cfg.ingestUrl}/api/sync/agent-sensors?toodooh_user_id=${encodeURIComponent(agentUserId)}`,
      { headers: { 'x-api-key': cfg.syncKey }, signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) return null;
    const parsed = hubSensorsSchema.safeParse(await res.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

export type AssignError =
  | 'HUB_UNAVAILABLE'
  | 'AGENT_NOT_FOUND'
  | 'DEVICE_NOT_FOUND'
  | 'PLACE_NOT_FOUND'
  | 'NOT_YOUR_DEVICE';

/** Ask the hub to assign one of the agent's sensors to a venue. */
export const assignHubSensor = async (
  agentUserId: string,
  deviceId: string,
  screenhostId: string,
  cfg: HubConfig | null = hubConfig(),
): Promise<{ ok: true; device: HubDevice } | { ok: false; error: AssignError }> => {
  if (!cfg) return { ok: false, error: 'HUB_UNAVAILABLE' };
  try {
    const res = await fetch(`${cfg.ingestUrl}/api/sync/agent-sensors/assign`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': cfg.syncKey },
      body: JSON.stringify({
        toodooh_user_id: agentUserId,
        device_id: deviceId,
        location_id: screenhostId,
      }),
      signal: AbortSignal.timeout(8000),
    });
    const body: unknown = await res.json().catch(() => null);
    if (res.ok) {
      const parsed = z.object({ device: deviceSchema }).safeParse(body);
      return parsed.success
        ? { ok: true, device: parsed.data.device }
        : { ok: false, error: 'HUB_UNAVAILABLE' };
    }
    const code = z.object({ error: z.string() }).safeParse(body);
    const known: AssignError[] = [
      'AGENT_NOT_FOUND',
      'DEVICE_NOT_FOUND',
      'PLACE_NOT_FOUND',
      'NOT_YOUR_DEVICE',
    ];
    const error = known.find((k) => code.success && code.data.error === k);
    return { ok: false, error: error ?? 'HUB_UNAVAILABLE' };
  } catch {
    return { ok: false, error: 'HUB_UNAVAILABLE' };
  }
};

export interface AgentVenue {
  screenhost_id: string;
  name: string;
  category: string | null;
  status: 'en_attente_activation' | 'en_cours';
}

/** The venues of the agent's live affiliations (pending activation or running). */
export const agentVenues = async (agentUserId: string): Promise<AgentVenue[]> => {
  const rows = await db
    .select({
      id: screenhosts.id,
      name: screenhosts.name,
      category: businessSectors.name,
      status: agentAffiliations.status,
    })
    .from(agentAffiliations)
    .innerJoin(screenhosts, eq(screenhosts.id, agentAffiliations.screenhostId))
    .leftJoin(businessSectors, eq(businessSectors.id, screenhosts.businessSectorId))
    .where(
      and(
        eq(agentAffiliations.agentUserId, agentUserId),
        inArray(agentAffiliations.status, ['en_attente_activation', 'en_cours']),
      ),
    );
  return rows.map((r) => ({
    screenhost_id: r.id,
    name: r.name,
    category: r.category,
    status: r.status === 'en_cours' ? 'en_cours' : 'en_attente_activation',
  }));
};

// ── pure views ─────────────────────────────────────────────────────────────────────────────

export interface SensorVenueCard {
  screenhost_id: string;
  name: string;
  category: string | null;
  status: AgentVenue['status'];
  people_now: number;
  online: number;
  offline: number;
}

/** A sensor that never connected counts as offline on this page (it sends nothing). */
const isOnline = (d: HubDevice) => d.status === 'online';

/**
 * « Suivi des capteurs » — only the agent's venues equipped with at least one of the sensors the
 * hub reports for him; « personnes présentes maintenant » is the sum over the online sensors.
 */
export const sensorCards = (venues: readonly AgentVenue[], hub: HubSensors): SensorVenueCard[] =>
  venues.flatMap((v) => {
    const devices = hub.devices.filter((d) => d.location_id === v.screenhost_id);
    if (devices.length === 0) return [];
    const online = devices.filter(isOnline);
    return [
      {
        screenhost_id: v.screenhost_id,
        name: v.name,
        category: v.category,
        status: v.status,
        people_now: online.reduce((s, d) => s + (d.people ?? 0), 0),
        online: online.length,
        offline: devices.length - online.length,
      },
    ];
  });

export const sensorTotals = (cards: readonly SensorVenueCard[]) => {
  const online = cards.reduce((s, c) => s + c.online, 0);
  const offline = cards.reduce((s, c) => s + c.offline, 0);
  return { sensors: online + offline, online, offline };
};

/** The hours a heat-map shows: the venue's opening hours, else 08:00 to 23:00 (the prototype's). */
export const heatHours = (opening: number | null, closing: number | null): number[] => {
  if (opening === null || closing === null || opening === closing) {
    return Array.from({ length: 16 }, (_, i) => i + 8);
  }
  const out: number[] = [];
  for (let h = opening; h !== (closing + 1) % 24; h = (h + 1) % 24) {
    out.push(h);
    if (out.length === 24) break;
  }
  return out;
};

export type HeatGrid = { hour: number; days: (number | null)[] }[];

/** Rows of hours × 7 days (Mon…Sun) from cells; a cell is the rounded mean of its half-hours. */
export const heatGrid = (
  hours: readonly number[],
  cells: readonly { day: number; hour: number; value: number | null }[],
): HeatGrid =>
  hours.map((hour) => ({
    hour,
    days: Array.from({ length: 7 }, (_, i) => {
      const values = cells
        .filter((c) => c.day === i + 1 && c.hour === hour && c.value !== null)
        .map((c) => c.value ?? 0);
      return values.length ? Math.round(values.reduce((s, v) => s + v, 0) / values.length) : null;
    }),
  }));

export interface SensorVenueDetail {
  card: SensorVenueCard;
  wifi_ssid: string | null;
  wifi_password_set: boolean;
  average_per_sensor: number;
  last24h: { at: string; people: number | null }[];
  heat_typical: HeatGrid;
  heat_week: HeatGrid;
  sensors: {
    id: string;
    label: string;
    online: boolean;
    people: number | null;
    battery_pct: number | null;
    last_seen_at: string | null;
  }[];
}

/** The window of one venue: tiles, Wi-Fi name, 24 h curve, the two heat-maps, the sensors. */
export const sensorVenueDetail = async (
  card: SensorVenueCard,
  hub: HubSensors,
  now: Date = new Date(),
): Promise<SensorVenueDetail> => {
  const [venue] = await db
    .select({
      ssid: screenhosts.wifiSsid,
      pwd: screenhosts.wifiPasswordEncrypted,
      opening: screenhosts.openingHour,
      closing: screenhosts.closingHour,
    })
    .from(screenhosts)
    .where(eq(screenhosts.id, card.screenhost_id))
    .limit(1);
  const hours = heatHours(venue?.opening ?? null, venue?.closing ?? null);
  const typical = await db
    .select({
      day: screenhostAffluence.dayOfWeek,
      hour: screenhostAffluence.hour,
      value: screenhostAffluence.estimatedImpressions,
    })
    .from(screenhostAffluence)
    .where(eq(screenhostAffluence.screenhostId, card.screenhost_id));
  // « Cette semaine »: Monday to Sunday of the current Tunis week; the days ahead have no row.
  const today = tunisDateOf(now);
  const monday = format(startOfISOWeek(parseISO(today)), 'yyyy-MM-dd');
  const nextMonday = format(addDays(parseISO(monday), 7), 'yyyy-MM-dd');
  const week = await db
    .select({
      day: sql<number>`extract(isodow from ${screenhostAffluenceHourly.date})::int`,
      hour: screenhostAffluenceHourly.hour,
      value: screenhostAffluenceHourly.value,
    })
    .from(screenhostAffluenceHourly)
    .where(
      and(
        eq(screenhostAffluenceHourly.screenhostId, card.screenhost_id),
        gte(screenhostAffluenceHourly.date, monday),
        lt(screenhostAffluenceHourly.date, nextMonday),
      ),
    );
  const place = hub.places.find((p) => p.location_id === card.screenhost_id);
  const devices = hub.devices.filter((d) => d.location_id === card.screenhost_id);
  return {
    card,
    wifi_ssid: venue?.ssid ?? null,
    wifi_password_set: Boolean(venue?.pwd),
    average_per_sensor: card.online ? Math.round(card.people_now / card.online) : 0,
    last24h: place?.last24h ?? [],
    heat_typical: heatGrid(hours, typical),
    heat_week: heatGrid(hours, week),
    sensors: devices.map((d) => ({
      id: d.id,
      label: d.label,
      online: isOnline(d),
      people: isOnline(d) ? d.people : null,
      battery_pct: d.battery_pct,
      last_seen_at: d.last_seen_at,
    })),
  };
};

export interface AssignableSensor {
  id: string;
  label: string;
  status: HubDevice['status'];
  battery_pct: number | null;
  screenhost_id: string | null;
  screenhost_name: string | null;
}

/**
 * « Assigner mes capteurs » — the sensors the agent prepared, each with the venue it is assigned
 * to (the hub's own name when that place is not one of his venues), and his venues with their
 * status and how many of his sensors each holds.
 */
export const assignmentView = (venues: readonly AgentVenue[], hub: HubSensors) => {
  const nameOf = new Map(venues.map((v) => [v.screenhost_id, v.name]));
  const sensors: AssignableSensor[] = hub.devices.map((d) => ({
    id: d.id,
    label: d.label,
    status: d.status,
    battery_pct: d.status === 'never' ? null : d.battery_pct,
    screenhost_id: d.location_id,
    screenhost_name: d.location_id
      ? (nameOf.get(d.location_id) ?? d.place_name)
      : (d.place_name ?? null),
  }));
  return {
    sensors,
    venues: venues.map((v) => ({
      screenhost_id: v.screenhost_id,
      name: v.name,
      status: v.status,
      sensor_count: hub.devices.filter((d) => d.location_id === v.screenhost_id).length,
    })),
  };
};
