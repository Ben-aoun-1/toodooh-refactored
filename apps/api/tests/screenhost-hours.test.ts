import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import {
  campaignDispatchAllocation,
  campaignDispatchPlan,
  campaigns,
  type DispatchCreneau,
  type NewUser,
  screenhosts,
  users,
} from '../src/db/schema.js';
import { screenhostsRoutes } from '../src/routes/screenhosts.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// H2 — the owner opening-hours PATCH (real Postgres). The wedooh re-push is mocked (the
// screenhostsRoutes plugin imports it) — same isolation the WiFi/allocations suites use.
// No business_sectors/zones fixtures anywhere (the exact-seed-count footgun).
const pushSpy = vi.hoisted(() =>
  vi.fn<(ownerId: string, logger: unknown) => Promise<void>>(() => Promise.resolve()),
);
vi.mock('../src/lib/wedooh-sync.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/wedooh-sync.js')>();
  return { ...actual, pushApprovedOwnerLocations: pushSpy };
});

type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;

const buildApp = () => Fastify({ logger: false });

const mockSession = (userId: string, role = 'individual_owner', status = 'approved'): void => {
  vi.spyOn(auth.api, 'getSession').mockResolvedValue({
    session: {},
    user: { id: userId, role, status },
  } as unknown as GetSessionResult);
};

const mockNoSession = (): void => {
  vi.spyOn(auth.api, 'getSession').mockResolvedValue(null as unknown as GetSessionResult);
};

let seq = 0;
const seedUser = async (values: Partial<NewUser> = {}): Promise<string> => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `hours${seq}@example.com`,
      contactName: `User ${seq}`,
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

const seedVenue = async (
  ownerId: string,
  hours: { open?: number | null; close?: number | null } = {},
): Promise<string> => {
  const [sh] = await db
    .insert(screenhosts)
    .values({
      name: 'Café Horaires',
      ownerId,
      openingHour: hours.open ?? null,
      closingHour: hours.close ?? null,
    })
    .returning();
  return sh?.id ?? '';
};

const hoursOf = async (id: string) => {
  const [row] = await db
    .select({ open: screenhosts.openingHour, close: screenhosts.closingHour })
    .from(screenhosts)
    .where(eq(screenhosts.id, id));
  return row;
};

const patchHours = (
  app: ReturnType<typeof buildApp>,
  id: string,
  payload: unknown,
): ReturnType<ReturnType<typeof buildApp>['inject']> =>
  app.inject({ method: 'PATCH', url: `/api/screenhosts/${id}/hours`, payload: payload as never });

describe('owner opening-hours PATCH (H2, real Postgres)', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    await resetAuthTables();
    app = buildApp();
    await app.register(screenhostsRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await sql.end();
  });

  // ── validation matrix ────────────────────────────────────────────────────────
  it('sets a valid pair (200) — the same columns every other writer uses', async () => {
    const owner = await seedUser();
    const id = await seedVenue(owner);
    mockSession(owner);
    const res = await patchHours(app, id, { opening_hour: 8, closing_hour: 22 });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id, opening_hour: 8, closing_hour: 22 });
    expect(await hoursOf(id)).toEqual({ open: 8, close: 22 });
  });

  it('clears with BOTH null (200) — back to the no-hours state', async () => {
    const owner = await seedUser();
    const id = await seedVenue(owner, { open: 8, close: 22 });
    mockSession(owner);
    const res = await patchHours(app, id, { opening_hour: null, closing_hour: null });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ opening_hour: null, closing_hour: null });
    expect(await hoursOf(id)).toEqual({ open: null, close: null });
  });

  it.each([
    [{ opening_hour: 8 }, 'one-sided (missing closing)'],
    [{ closing_hour: 22 }, 'one-sided (missing opening)'],
    [{ opening_hour: 8, closing_hour: null }, 'int + null'],
    [{ opening_hour: null, closing_hour: 22 }, 'null + int'],
    [{ opening_hour: 22, closing_hour: 8 }, 'unordered'],
    [{ opening_hour: 8, closing_hour: 8 }, 'equal (open < close is strict)'],
    [{ opening_hour: -1, closing_hour: 22 }, 'below range'],
    [{ opening_hour: 8, closing_hour: 24 }, 'above range'],
    [{ opening_hour: 8.5, closing_hour: 22 }, 'non-integer'],
  ] as const)('rejects %j — %s (400, row untouched)', async (payload) => {
    const owner = await seedUser();
    const id = await seedVenue(owner, { open: 9, close: 18 });
    mockSession(owner);
    const res = await patchHours(app, id, payload);
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe('INVALID_INPUT');
    expect(await hoursOf(id)).toEqual({ open: 9, close: 18 }); // unchanged
  });

  // ── owner scoping ────────────────────────────────────────────────────────────
  it('a FOREIGN venue is indistinguishable from a missing one (404, no write)', async () => {
    const me = await seedUser();
    const other = await seedUser();
    const foreignId = await seedVenue(other, { open: 9, close: 18 });
    mockSession(me);

    const foreign = await patchHours(app, foreignId, { opening_hour: 8, closing_hour: 22 });
    const missing = await patchHours(app, '99999999-9999-4999-8999-999999999999', {
      opening_hour: 8,
      closing_hour: 22,
    });
    expect(foreign.statusCode).toBe(404);
    expect(missing.statusCode).toBe(404);
    expect(foreign.json()).toEqual(missing.json());
    expect(await hoursOf(foreignId)).toEqual({ open: 9, close: 18 }); // untouched
  });

  it('rejects a non-uuid id (400) and requires authentication (401)', async () => {
    const owner = await seedUser();
    mockSession(owner);
    const bad = await patchHours(app, 'not-a-uuid', { opening_hour: 8, closing_hour: 22 });
    expect(bad.statusCode).toBe(400);

    mockNoSession();
    const anon = await patchHours(app, '99999999-9999-4999-8999-999999999999', {
      opening_hour: 8,
      closing_hour: 22,
    });
    expect(anon.statusCode).toBe(401);
  });

  // ── /mine carries the hours for the editor ───────────────────────────────────
  it('GET /mine exposes opening_hour/closing_hour per venue (set and null)', async () => {
    const owner = await seedUser();
    await seedVenue(owner, { open: 8, close: 22 });
    await seedVenue(owner);
    mockSession(owner);
    const res = await app.inject({ method: 'GET', url: '/api/screenhosts/mine' });
    expect(res.statusCode).toBe(200);
    const rows = res.json() as { opening_hour: number | null; closing_hour: number | null }[];
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => [r.opening_hour, r.closing_hour])).toEqual(
      expect.arrayContaining([
        [8, 22],
        [null, null],
      ]),
    );
  });

  // ── admin path regression: the eligibility PATCH keeps its PARTIAL semantics ─
  it('admin eligibility PATCH still writes a one-sided hour (H2 tightened only the owner route)', async () => {
    const owner = await seedUser();
    const admin = await seedUser({ role: 'admin' });
    const id = await seedVenue(owner, { open: 9, close: 18 });
    mockSession(admin, 'admin');
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/screenhosts/${id}/eligibility`,
      payload: { opening_hour: 7 },
    });
    expect(res.statusCode).toBe(200);
    expect(await hoursOf(id)).toEqual({ open: 7, close: 18 });
  });

  // ── frozen-plan untouchability ────────────────────────────────────────────────
  it('an hours change NEVER rewrites already-frozen plans/créneaux', async () => {
    const owner = await seedUser();
    const id = await seedVenue(owner, { open: 8, close: 22 });
    // A frozen dispatch plan + allocation on this venue (créneaux frozen at approval time).
    const advertiser = await seedUser({ role: 'advertiser' });
    const [campaign] = await db
      .insert(campaigns)
      .values({
        advertiserId: advertiser,
        name: 'Campagne gelée',
        campaignType: 'standard',
        status: 'active',
        startDate: '2026-07-10',
        endDate: '2026-07-31',
      })
      .returning();
    const [plan] = await db
      .insert(campaignDispatchPlan)
      .values({
        campaignId: campaign?.id ?? '',
        iCible: 1000,
        cpm: '15',
        sSpotSeconds: 10,
        tTierCoef: '1.0',
        seuilDiffusable: 1000,
        sMin: '10',
        gJour: '3.33',
        fMaxSeconds: 300,
        rMinEfficace: 2,
        couvert: 1000,
        nMin: 1,
        nMax: 20,
        nRetenus: 1,
      })
      .returning();
    const creneaux: DispatchCreneau[] = [
      { date: '2026-07-16', hour: 9, reps: 100, impressions: 500 },
      { date: '2026-07-16', hour: 21, reps: 80, impressions: 400 },
    ];
    const [alloc] = await db
      .insert(campaignDispatchAllocation)
      .values({
        planId: plan?.id ?? '',
        screenhostId: id,
        iiPotentiel: 900,
        rI: 90,
        revenuPrevisionnel: '12.5',
        creneaux,
        statutAcceptation: 'ACCEPTE',
      })
      .returning();
    mockSession(owner);

    // The owner shrinks the window past the 21h créneau — and even clears the hours entirely.
    await patchHours(app, id, { opening_hour: 10, closing_hour: 14 });
    await patchHours(app, id, { opening_hour: null, closing_hour: null });

    const [allocAfter] = await db
      .select()
      .from(campaignDispatchAllocation)
      .where(eq(campaignDispatchAllocation.id, alloc?.id ?? ''));
    expect(allocAfter?.creneaux).toEqual(creneaux); // frozen — byte-identical
    expect(allocAfter?.statutAcceptation).toBe('ACCEPTE');
    expect(allocAfter?.revenuPrevisionnel).toBe('12.5000'); // numeric(14,4) round-trip, unchanged
    const [planAfter] = await db
      .select()
      .from(campaignDispatchPlan)
      .where(eq(campaignDispatchPlan.id, plan?.id ?? ''));
    expect(planAfter?.couvert).toBe(1000);
  });
});
