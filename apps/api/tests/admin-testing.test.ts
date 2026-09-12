import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import {
  type NewUser,
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

interface Report {
  screenhost: { id: string; name: string; opening_hour: number | null; sps_stored: number };
  periode: { from: string; to: string; today: string; estimation_floor: string | null };
  audience: {
    total: number;
    days: { n: number; min: number | null; max: number | null; median: number | null };
    cells: { n: number; min: number | null; max: number | null; median: number | null };
    measured_cells: { n: number };
    day_rows: { date: string; audience: number; source: string }[];
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
  pricing: {
    a_max: number;
    broadcastable_hours: number[];
    unavailable_days: string[];
    cpm_standard_tnd: number;
  };
  config: Record<string, unknown>;
}

describe('ADM-OBS1 — GET /api/admin/testing/screenhosts[/:id] (real Postgres)', () => {
  let app: ReturnType<typeof buildApp>;
  let adminId: string;
  let venueId: string;
  const today = tunisDateOf(new Date());
  const d1 = shiftDays(today, -2);
  const d2 = shiftDays(today, -1);

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
        createdAt: new Date(`${shiftDays(today, -10)}T10:00:00Z`),
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
    const body = res.json<{ screenhosts: { id: string; name: string; opening_hour: number }[] }>();
    expect(body.screenhosts.map((s) => s.name)).toContain('Café Tests');
    expect(body.screenhosts.find((s) => s.id === venueId)?.opening_hour).toBe(8);
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

  it('exposes the engine outputs for the période: audience (min/median/max over days AND cells), SPS evidence, pricing inputs', async () => {
    mockSession(adminId);
    const res = await app.inject({
      method: 'GET',
      url: `/api/admin/testing/screenhosts/${venueId}?from=${d1}&to=${d2}`,
    });
    expect(res.statusCode).toBe(200);
    const r = res.json<Report>();
    expect(r.screenhost.name).toBe('Café Tests');
    expect(r.periode).toMatchObject({ from: d1, to: d2, today, estimation_floor: d1 });

    // FLOW-1: a day is the SUM of its cells → d1 = 30, d2 = 30, total 60.
    expect(r.audience.total).toBe(60);
    expect(r.audience.day_rows.map((d) => [d.date, d.audience])).toEqual([
      [d1, 30],
      [d2, 30],
    ]);
    expect(r.audience.days).toMatchObject({ n: 2, min: 30, max: 30, median: 30 });
    // The raw cells, so a median over any window is answerable without sketches.
    expect(r.audience.cells).toMatchObject({ n: 3, min: 10, max: 30, median: 20 });
    expect(r.audience.measured_cells.n).toBe(3);
    expect(r.audience.cell_rows).toEqual([
      { date: d1, slot: 20, value: 10, source: 'measured' },
      { date: d1, slot: 21, value: 20, source: 'measured' },
      { date: d2, slot: 22, value: 30, source: 'measured' },
    ]);
    // 2 open days × 12 opening hours → 60 / 24 = 2.5 per opening hour.
    expect(r.audience.mean_per_hour).toBe(2.5);
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

    // Pricing inputs: A_max is a number, the broadcastable hours follow opening/closing, the
    // owner's unavailable day in the période is listed, the CPM in force is the config's.
    expect(typeof r.pricing.a_max).toBe('number');
    expect(r.pricing.broadcastable_hours).toEqual([8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
    expect(r.pricing.unavailable_days).toEqual([d2]);
    expect(r.pricing.cpm_standard_tnd).toBeGreaterThan(0);
    expect(r.config).toHaveProperty('spsWeightAcceptation');
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
