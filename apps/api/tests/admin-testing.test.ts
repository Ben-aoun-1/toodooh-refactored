import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import {
  type NewUser,
  campaignDispatchAllocation,
  campaignDispatchPlan,
  campaigns,
  creatives,
  events,
  hourReservations,
  screenhostAffluenceHourly,
  screenhostUnavailability,
  screenhosts,
  users,
} from '../src/db/schema.js';
import { tunisDateOf } from '../src/lib/campaign-dates.js';
import { SPS_NEUTRAL } from '../src/lib/sps-score.js';
import { adminTestingRoutes } from '../src/routes/admin-testing.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;

const buildApp = () => Fastify({ logger: false });
const mockSession = (userId: string, role = 'admin'): void => {
  vi.spyOn(auth.api, 'getSession').mockResolvedValue({
    session: {},
    user: { id: userId, role, status: 'approved' },
  } as unknown as GetSessionResult);
};

let seq = 0;
const seedUser = async (values: Partial<NewUser> = {}): Promise<string> => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `testing${seq}@example.com`,
      contactName: `User ${seq}`,
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

const shiftDays = (iso: string, days: number): string => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** The current Tunis hour — the boundary between « Historique » and « À venir ». */
const tunisHourNow = (): number =>
  Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Africa/Tunis',
      hour: '2-digit',
      hour12: false,
    }).format(new Date()),
  );

interface HourRow {
  date: string;
  hour: number;
  state: string;
  engaged_seconds: number;
  pending_seconds: number;
  seconds_free: number | null;
  reps: number;
  campaigns: number;
}

interface Report {
  screenhost: {
    id: string;
    name: string;
    opening_hour: number | null;
    sps_stored: number;
    broadcastable_hours: number[];
  };
  periode: {
    from: string;
    to: string;
    today: string;
    created_date: string;
    first_reading: string | null;
    estimation_floor: string | null;
    unavailable_days: string[];
  };
  audience: {
    total: number;
    a_max: number;
    days: { n: number; min: number | null; max: number | null; median: number | null };
    hours: { n: number; min: number | null; max: number | null; median: number | null };
    measured_hours: { n: number };
    estimated_hours: { n: number };
    day_rows: {
      date: string;
      audience: number;
      source: string;
      measured_cells: number;
      backup_cells: number;
    }[];
    cell_rows: { date: string; slot: number; value: number; source: string }[];
    week: unknown[][];
    mean_per_hour: number | null;
  };
  sps: {
    live: number;
    stored: number;
    computable: boolean;
    neutral: number;
    weights: Record<string, number>;
  };
  config: Record<string, unknown>;
  status_hours: { past: HourRow[]; future: HourRow[] };
  campaigns: unknown[];
}

describe('ADM-OBS1 — GET /api/admin/testing/screenhosts[/:id] (real Postgres)', () => {
  let app: ReturnType<typeof buildApp>;
  let adminId: string;
  let venueId: string;
  const today = tunisDateOf(new Date());
  const d1 = shiftDays(today, -2);
  const d2 = shiftDays(today, -1);
  const created = shiftDays(today, -10);

  beforeEach(async () => {
    await resetAuthTables();
    await db.delete(screenhostAffluenceHourly);
    await db.delete(screenhostUnavailability);
    await db.delete(screenhosts);
    adminId = await seedUser({ role: 'admin' });
    const ownerId = await seedUser({ role: 'individual_owner' });
    const [s] = await db
      .insert(screenhosts)
      .values({
        name: 'Café Tests',
        ownerId,
        openingHour: 8,
        closingHour: 20,
        // Created before the first reading, so the estimation floor (max(created_at, first
        // observed day)) is the first observed day — the MEJ-7b rule, visible on the page.
        createdAt: new Date(`${created}T10:00:00Z`),
      })
      .returning();
    venueId = s?.id ?? '';
    // Three measured half-hours over two days: 10, 20 on d1 and 30 on d2 → cells median 20.
    await db.insert(screenhostAffluenceHourly).values([
      { screenhostId: venueId, date: d1, hour: 10, slot: 20, value: 10 },
      { screenhostId: venueId, date: d1, hour: 10, slot: 21, value: 20 },
      { screenhostId: venueId, date: d2, hour: 11, slot: 22, value: 30 },
    ]);
    await db.insert(screenhostUnavailability).values({ screenhostId: venueId, day: d2 });
    app = buildApp();
    await app.register(adminTestingRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await sql.end();
  });

  it('lists every screenhost for the picker, admin only', async () => {
    mockSession(adminId);
    const res = await app.inject({ method: 'GET', url: '/api/admin/testing/screenhosts' });
    expect(res.statusCode).toBe(200);
    const body = res.json<{
      screenhosts: { id: string; name: string; opening_hour: number; created_date: string }[];
    }>();
    expect(body.screenhosts.map((s) => s.name)).toContain('Café Tests');
    expect(body.screenhosts.find((s) => s.id === venueId)?.opening_hour).toBe(8);
    // ADM-OBS2 — the Tunis creation day, where « Tout l'historique » starts.
    expect(body.screenhosts.find((s) => s.id === venueId)?.created_date).toBe(created);
  });

  it('non-admin → 403', async () => {
    const advertiserId = await seedUser({ role: 'advertiser' });
    mockSession(advertiserId, 'advertiser');
    const res = await app.inject({
      method: 'GET',
      url: `/api/admin/testing/screenhosts/${venueId}?from=${d1}&to=${d2}`,
    });
    expect(res.statusCode).toBe(403);
  });

  it('exposes the engine outputs for the période: audience (min/median/max over days AND hours), SPS evidence, status', async () => {
    mockSession(adminId);
    const res = await app.inject({
      method: 'GET',
      url: `/api/admin/testing/screenhosts/${venueId}?from=${d1}&to=${d2}`,
    });
    expect(res.statusCode).toBe(200);
    const r = res.json<Report>();
    expect(r.screenhost.name).toBe('Café Tests');
    // ADM-OBS2 ruling B — the creation day and the first sensor reading, side by side; the floor
    // (the later of the two) stays in the JSON only.
    expect(r.periode).toMatchObject({
      from: d1,
      to: d2,
      today,
      created_date: created,
      first_reading: d1,
      estimation_floor: d1,
      unavailable_days: [d2],
    });

    // FLOW-4: a day is the SUM of its HOUR values → d1's 10h is the mean of 10 and 20 (15), d2's
    // 11h is a lone 30 (30), so the total is 45 where FLOW-1 read 60. A day is legitimately
    // fractional under this rule; here it happens not to be, and the median of 15 and 30 is.
    expect(r.audience.total).toBe(45);
    expect(r.audience.day_rows.map((d) => [d.date, d.audience])).toEqual([
      [d1, 15],
      [d2, 30],
    ]);
    expect(r.audience.days).toMatchObject({ n: 2, min: 15, max: 30, median: 22.5 });
    // ADM-OBS2 item 4 — the statistics are over HOURS (the mean of the halves each hour has), the
    // same values the day sums: d1 10h = 15, d2 11h = a lone 30. Not over the three half-hours.
    expect(r.audience.hours).toMatchObject({ n: 2, min: 15, max: 30, median: 22.5 });
    expect(r.audience.measured_hours.n).toBe(2);
    expect(r.audience.estimated_hours.n).toBe(0);
    // Item 5 — every day row says how many of its half-hours were measured vs from the grid.
    expect(
      r.audience.day_rows.map((d) => [d.date, d.source, d.measured_cells, d.backup_cells]),
    ).toEqual([
      [d1, 'measured', 2, 0],
      [d2, 'measured', 1, 0],
    ]);
    // The raw cells stay raw half-hours.
    expect(r.audience.cell_rows).toEqual([
      { date: d1, slot: 20, value: 10, source: 'measured' },
      { date: d1, slot: 21, value: 20, source: 'measured' },
      { date: d2, slot: 22, value: 30, source: 'measured' },
    ]);
    // 2 open days × 12 opening hours → 45 / 24 h = 1.875 → 1.88 per opening hour. FLOW-4 divides
    // by the HOURS: the day already folded its readings into them.
    expect(r.audience.mean_per_hour).toBe(1.88);
    expect(r.audience.week).toHaveLength(7);
    expect(r.audience.week[0]).toHaveLength(48);

    // SPS: no decisions, attestations, créneaux or engagement → not computable; the evidence is
    // shown next to the weights and the stored snapshot.
    expect(r.sps.computable).toBe(false);
    expect(r.sps.neutral).toBe(SPS_NEUTRAL);
    expect(r.sps.stored).toBe(50);
    expect(Object.keys(r.sps.weights).sort()).toEqual([
      'acceptation',
      'activite',
      'remplissage',
      'respect_evenements',
    ]);

    // Items 7 and 8 — A_max sits with the audience; the dispatch inputs (CPM, T, lead) left the
    // page's blocks. The resolved config stays in the raw JSON.
    expect(typeof r.audience.a_max).toBe('number');
    expect(r).not.toHaveProperty('pricing');
    expect(r.screenhost.broadcastable_hours).toEqual([
      8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
    ]);
    expect(r.config).toHaveProperty('spsWeightAcceptation');

    // « Historique »: one row per (elapsed day, open hour) of the période; the unavailable day is
    // « indisponible », a day without any share is « libre » with the whole SCREEN hour free (CAP-F1:
    // 3600 s — F caps each campaign, not the hour).
    expect(r.status_hours.past).toHaveLength(2 * 12);
    expect(
      r.status_hours.past.filter((h) => h.date === d2).every((h) => h.state === 'indisponible'),
    ).toBe(true);
    expect(r.status_hours.past.find((h) => h.date === d1 && h.hour === 8)).toMatchObject({
      state: 'libre',
      seconds_free: 3600,
      reps: 0,
    });
    // « À venir » with nothing planned: only today's hours that have not started yet.
    const hourNow = tunisHourNow();
    expect(r.status_hours.future.every((h) => h.date === today && h.hour >= hourNow)).toBe(true);
    expect(r.campaigns).toEqual([]);
  });

  it('« À venir » runs past « Au » to the last planned day; a pending share engages; an event-held hour is réservée', async () => {
    const advertiserId = await seedUser({ role: 'advertiser' });
    const [creative] = await db
      .insert(creatives)
      .values({
        advertiserId,
        creativeType: 'video',
        storageKey: `creatives/${advertiserId}/c`,
        durationSeconds: 10,
        validationStatus: 'approved',
      })
      .returning();
    const inThree = shiftDays(today, 3);
    const inFive = shiftDays(today, 5);
    const [campaign] = await db
      .insert(campaigns)
      .values({
        advertiserId,
        name: 'À venir',
        campaignType: 'standard',
        status: 'upcoming',
        startDate: inThree,
        endDate: inThree,
        creativeId: creative?.id,
      })
      .returning();
    const [plan] = await db
      .insert(campaignDispatchPlan)
      .values({
        campaignId: campaign?.id ?? '',
        iCible: 600,
        cpm: '10',
        sSpotSeconds: 10,
        tTierCoef: '0.6',
        seuilDiffusable: 1000,
        sMin: '10',
        gJour: '3.33',
        fMaxSeconds: 300,
        rMinEfficace: 2,
        couvert: 600,
        nMin: 1,
        nMax: 20,
        nRetenus: 1,
      })
      .returning();
    await db.insert(campaignDispatchAllocation).values({
      planId: plan?.id ?? '',
      screenhostId: venueId,
      iiPotentiel: 600,
      rI: 6,
      revenuPrevisionnel: '6',
      statutAcceptation: 'EN_ATTENTE',
      creneaux: [{ date: inThree, hour: 9, reps: 6, impressions: 600 }],
    });
    const [event] = await db
      .insert(events)
      .values({
        name: 'Match à venir',
        type: 'sport',
        kickoffAt: new Date(`${inFive}T10:00:00Z`),
        endsAt: new Date(`${inFive}T12:00:00Z`),
        source: 'official',
      })
      .returning();
    await db
      .insert(hourReservations)
      .values({ screenhostId: venueId, day: inFive, hour: 10, eventId: event?.id ?? '' });

    mockSession(adminId);
    const res = await app.inject({
      method: 'GET',
      url: `/api/admin/testing/screenhosts/${venueId}?from=${d1}&to=${d2}`,
    });
    expect(res.statusCode).toBe(200);
    const r = res.json<Report>();
    const future = r.status_hours.future;
    // Ruling E — the table ignores « Au » (d2) and runs to the last planned day (the reservation).
    expect(future.at(-1)?.date).toBe(inFive);
    expect(future.some((h) => h.date <= d2)).toBe(false);
    // Ruling D — the EN_ATTENTE share holds 6 × 10 s, shown as pending; the event holds 10h.
    expect(future.find((h) => h.date === inThree && h.hour === 9)).toMatchObject({
      state: 'partiel',
      engaged_seconds: 60,
      pending_seconds: 60,
      seconds_free: 3600 - 60, // CAP-F1: the screen hour (3600 s), not F, minus the 60 s engaged
      reps: 6,
      campaigns: 1,
    });
    expect(future.find((h) => h.date === inFive && h.hour === 10)).toMatchObject({
      state: 'reservee_evenement',
      seconds_free: null,
    });
    // The past table and the campaign list stay on the période: nothing planned there.
    expect(r.status_hours.past.every((h) => h.date >= d1 && h.date <= d2)).toBe(true);
    expect(r.campaigns).toEqual([]);
  });

  it('rejects a malformed or inverted période', async () => {
    mockSession(adminId);
    const bad = await app.inject({
      method: 'GET',
      url: `/api/admin/testing/screenhosts/${venueId}?from=2026-13-01&to=${d2}`,
    });
    expect(bad.statusCode).toBe(400);
    const inverted = await app.inject({
      method: 'GET',
      url: `/api/admin/testing/screenhosts/${venueId}?from=${d2}&to=${d1}`,
    });
    expect(inverted.statusCode).toBe(400);
  });
});
