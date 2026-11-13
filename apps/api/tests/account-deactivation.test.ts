import { and, eq, isNull } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import {
  type DispatchCreneau,
  type NewUser,
  campaignDispatchAllocation,
  campaignDispatchPlan,
  campaigns,
  creatives,
  deviceSessions,
  screenhosts,
  screens,
  sessions,
  users,
} from '../src/db/schema.js';
import { plusCalendarDays, tunisDateOf } from '../src/lib/campaign-dates.js';
import { hashDeviceToken } from '../src/lib/device-tokens.js';
import { activeAllocationsForScreenhost } from '../src/lib/playout/active-allocations.js';
import { requireAuth } from '../src/middleware/require-auth.js';
import { adminAccountDeactivationRoutes } from '../src/routes/admin-account-deactivation.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// DEACT-1 (Mariem's sheet row 11, operator rulings 2026-10-28) — the reversible deactivation of a
// Host or a Cast by an admin, real Postgres: the account is signed out and refused, a Host's
// FUTURE hours leave its venues (aired ones stay) and its TVs stop airing, a Cast's pending
// campaigns are rejected and its standard campaigns stop with refund or finish, as the admin
// chooses; reactivation brings the account back.

type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;
const mockSession = (userId: string, role: string, status = 'approved'): void => {
  vi.spyOn(auth.api, 'getSession').mockResolvedValue({
    session: {},
    user: { id: userId, role, status },
  } as unknown as GetSessionResult);
};

let seq = 0;
const seedUser = async (values: Partial<NewUser> = {}): Promise<string> => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `deact-${seq}@example.com`,
      contactName: `Deact User ${seq}`,
      role: 'advertiser',
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

const today = tunisDateOf(new Date());
const YESTERDAY = plusCalendarDays(today, -1);
const TOMORROW = plusCalendarDays(today, 1);

/** A campaign with a plan and ONE allocation on `venueId` (past hour + future hour). */
const seedCampaign = async (opts: {
  advertiserId: string;
  venueId: string;
  status?: 'active' | 'upcoming' | 'pending';
  creneaux?: DispatchCreneau[];
}): Promise<string> => {
  const [creative] = await db
    .insert(creatives)
    .values({
      advertiserId: opts.advertiserId,
      creativeType: 'video',
      storageKey: `creatives/deact/${seq}-${Math.random()}`,
      durationSeconds: 20,
      validationStatus: 'approved',
    })
    .returning();
  const creneaux = opts.creneaux ?? [
    { date: YESTERDAY, hour: 10, reps: 100, impressions: 3000 },
    { date: TOMORROW, hour: 10, reps: 100, impressions: 3000 },
  ];
  const ii = creneaux.reduce((s, c) => s + c.impressions, 0);
  const [campaign] = await db
    .insert(campaigns)
    .values({
      advertiserId: opts.advertiserId,
      name: `Campagne ${seq}`,
      campaignType: 'standard',
      status: opts.status ?? 'active',
      startDate: YESTERDAY,
      endDate: plusCalendarDays(today, 5),
      creativeId: creative?.id,
      requestedBudget: '400.00',
    })
    .returning();
  const [plan] = await db
    .insert(campaignDispatchPlan)
    .values({
      campaignId: campaign?.id ?? '',
      iCible: ii,
      cpm: '10',
      sSpotSeconds: 10,
      tTierCoef: '1.0',
      seuilDiffusable: 1000,
      sMin: '10',
      gJour: '3.33',
      fMaxSeconds: 300,
      rMinEfficace: 2,
      couvert: ii,
      nMin: 1,
      nMax: 20,
      nRetenus: 1,
    })
    .returning();
  await db.insert(campaignDispatchAllocation).values({
    planId: plan?.id ?? '',
    screenhostId: opts.venueId,
    iiPotentiel: ii,
    rI: 100,
    revenuPrevisionnel: String((ii * 10) / 1000),
    creneaux,
    statutAcceptation: 'ACCEPTE',
  });
  return campaign?.id ?? '';
};

const world = async () => {
  const admin = await seedUser({ role: 'admin' });
  const owner = await seedUser({ role: 'individual_owner' });
  const [venue] = await db
    .insert(screenhosts)
    .values({ name: `Deact Venue ${seq}`, ownerId: owner, openingHour: 0, closingHour: 23 })
    .returning();
  await db.insert(screens).values({ screenhostId: venue?.id ?? '', name: 'Deact TV' });
  const caster = await seedUser();
  return { admin, owner, venueId: venue?.id ?? '', caster };
};

const statusOf = async (id: string) =>
  (await db.select({ s: users.status }).from(users).where(eq(users.id, id)))[0]?.s;

describe('DEACT-1 — account deactivation (admin, real Postgres)', () => {
  const app = Fastify({ logger: false });

  beforeEach(async () => {
    await resetAuthTables();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    await app.close();
    await sql.end();
  });

  const call = async (method: 'GET' | 'POST', url: string, payload?: object) => {
    if (!app.hasRoute({ method: 'POST', url: '/api/admin/users/:id/deactivate' })) {
      await app.register(adminAccountDeactivationRoutes);
      app.get('/probe', { preHandler: requireAuth }, async () => ({ ok: true }));
      await app.ready();
    }
    return app.inject({ method, url, ...(payload ? { payload } : {}) });
  };

  it('a Host: future hours leave its venue, its TV stops airing, it is signed out; reactivation', async () => {
    const w = await world();
    const campaignId = await seedCampaign({ advertiserId: w.caster, venueId: w.venueId });
    await db.insert(sessions).values({
      id: crypto.randomUUID(),
      token: `tok-${seq}`,
      userId: w.owner,
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    await db.insert(deviceSessions).values({
      userId: w.owner,
      accessTokenHash: hashDeviceToken(`acc-${seq}`),
      refreshTokenHash: hashDeviceToken(`ref-${seq}`),
      accessExpiresAt: new Date(Date.now() + 3_600_000),
      refreshExpiresAt: new Date(Date.now() + 86_400_000),
    });
    expect(await activeAllocationsForScreenhost(w.venueId, new Date())).toHaveLength(1);

    mockSession(w.admin, 'admin');
    const preview = await call('GET', `/api/admin/users/${w.owner}/deactivation`);
    expect(preview.json()).toMatchObject({ kind: 'host', venues: 1, shared_campaigns: 1 });
    const res = await call('POST', `/api/admin/users/${w.owner}/deactivate`, {
      reason: 'Quitte Toodooh',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'deactivated', kind: 'host', moved_campaigns: 1 });

    expect(await statusOf(w.owner)).toBe('deactivated');
    expect(await db.select().from(sessions).where(eq(sessions.userId, w.owner))).toHaveLength(0);
    expect(
      await db
        .select()
        .from(deviceSessions)
        .where(and(eq(deviceSessions.userId, w.owner), isNull(deviceSessions.revokedAt))),
    ).toHaveLength(0);
    // The aired hour stays (paid normally); the future hour left (the reliquat E6 re-places).
    const [alloc] = await db
      .select({ creneaux: campaignDispatchAllocation.creneaux })
      .from(campaignDispatchAllocation)
      .where(eq(campaignDispatchAllocation.screenhostId, w.venueId));
    expect(alloc?.creneaux.map((c) => c.date)).toEqual([YESTERDAY]);
    const [plan] = await db
      .select({ reliquat: campaignDispatchPlan.reliquatStocke })
      .from(campaignDispatchPlan)
      .where(eq(campaignDispatchPlan.campaignId, campaignId));
    expect(plan?.reliquat).toBe(3000);
    // The TV airs nothing any more.
    expect(await activeAllocationsForScreenhost(w.venueId, new Date())).toEqual([]);

    // A surviving cookie of the account is refused.
    mockSession(w.owner, 'individual_owner', 'deactivated');
    expect((await call('GET', '/probe')).json()).toMatchObject({ error: 'ACCOUNT_DEACTIVATED' });

    mockSession(w.admin, 'admin');
    expect((await call('POST', `/api/admin/users/${w.owner}/reactivate`)).statusCode).toBe(200);
    expect(await statusOf(w.owner)).toBe('approved');
    expect(await activeAllocationsForScreenhost(w.venueId, new Date())).toHaveLength(1);
  });

  it('a Cast, « arrêter »: pending campaigns rejected, standard campaigns stopped with refund', async () => {
    const w = await world();
    const pending = await seedCampaign({
      advertiserId: w.caster,
      venueId: w.venueId,
      status: 'pending',
    });
    const active = await seedCampaign({ advertiserId: w.caster, venueId: w.venueId });
    mockSession(w.admin, 'admin');
    const preview = await call('GET', `/api/admin/users/${w.caster}/deactivation`);
    expect(preview.json()).toMatchObject({ kind: 'cast' });
    expect((preview.json() as { campaigns: unknown[] }).campaigns).toHaveLength(2);

    const res = await call('POST', `/api/admin/users/${w.caster}/deactivate`, {
      reason: 'Fin de contrat',
      campaigns: 'stop',
    });
    expect(res.json()).toMatchObject({
      kind: 'cast',
      rejected_campaigns: 1,
      stopped_campaigns: [{ campaign_id: active }],
      finishing_campaigns: 0,
    });
    const rows = await db
      .select({ id: campaigns.id, status: campaigns.status, reason: campaigns.rejectReason })
      .from(campaigns)
      .where(eq(campaigns.advertiserId, w.caster));
    expect(rows).toContainEqual({ id: pending, status: 'rejected', reason: 'Compte désactivé' });
    expect(rows.find((r) => r.id === active)?.status).toBe('completed');
  });

  it('a Cast, « laisser finir »: its running campaign stays active', async () => {
    const w = await world();
    const active = await seedCampaign({ advertiserId: w.caster, venueId: w.venueId });
    mockSession(w.admin, 'admin');
    const res = await call('POST', `/api/admin/users/${w.caster}/deactivate`, {
      reason: 'Fin de contrat',
      campaigns: 'finish',
    });
    expect(res.json()).toMatchObject({ stopped_campaigns: [], finishing_campaigns: 1 });
    const [c] = await db
      .select({ status: campaigns.status })
      .from(campaigns)
      .where(eq(campaigns.id, active));
    expect(c?.status).toBe('active');
  });

  it('refusals: not an admin, self, staff or agent, not validated, no reason', async () => {
    const w = await world();
    mockSession(w.caster, 'advertiser');
    expect(
      (await call('POST', `/api/admin/users/${w.owner}/deactivate`, { reason: 'x x x' }))
        .statusCode,
    ).toBe(403);
    mockSession(w.admin, 'admin');
    expect(
      (await call('POST', `/api/admin/users/${w.admin}/deactivate`, { reason: 'Moi-même' })).json(),
    ).toMatchObject({ error: 'SELF' });
    const otherAdmin = await seedUser({ role: 'admin' });
    expect(
      (await call('POST', `/api/admin/users/${otherAdmin}/deactivate`, { reason: 'Staff' })).json(),
    ).toMatchObject({ error: 'NOT_DEACTIVATABLE' });
    const agent = await seedUser({ role: 'screenhost_agent' });
    expect(
      (await call('POST', `/api/admin/users/${agent}/deactivate`, { reason: 'Agent' })).json(),
    ).toMatchObject({ error: 'NOT_DEACTIVATABLE' });
    const pendingOwner = await seedUser({ role: 'individual_owner', status: 'pending' });
    expect(
      (await call('POST', `/api/admin/users/${pendingOwner}/deactivate`, { reason: 'Test' })).json(),
    ).toMatchObject({ error: 'NOT_ACTIVE' });
    expect(
      (await call('POST', `/api/admin/users/${w.owner}/deactivate`, { reason: '' })).statusCode,
    ).toBe(400);
    expect(
      (await call('POST', `/api/admin/users/${w.owner}/reactivate`)).json(),
    ).toMatchObject({ error: 'NOT_DEACTIVATED' });
  });
});
