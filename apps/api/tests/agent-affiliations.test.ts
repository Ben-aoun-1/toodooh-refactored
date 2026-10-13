import { and, eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import {
  agentAffiliations,
  agentReferrals,
  agents,
  campaignDispatchAllocation,
  campaignDispatchPlan,
  campaigns,
  creatives,
  notifications,
  proofOfPlay,
  screenhosts,
  users,
} from '../src/db/schema.js';
import {
  affiliationEnd,
  applyAffiliationAction,
  createAffiliationsOnApproval,
  runAgentAffiliationTick,
} from '../src/lib/agent-affiliations.js';
import { tunisDateOf } from '../src/lib/campaign-dates.js';
import { adminRoutes } from '../src/routes/admin.js';

import { resetAuthTables } from './helpers/db-test-setup.js';
import { seedInstalledScreen } from './helpers/installed-screen.js';

// AGT-2 — agent affiliations (agent specs v1.0 §6, rulings 2026-10-13) on a real Postgres.

vi.mock('../src/lib/wedooh-sync.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/wedooh-sync.js')>();
  return { ...actual, pushApprovedOwnerLocations: vi.fn(() => Promise.resolve()) };
});

type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;

let seq = 0;
const seedUser = async (values: Partial<typeof users.$inferInsert> = {}) => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({ email: `aff${seq}@example.com`, contactName: `User ${seq}`, ...values })
    .returning();
  return u?.id ?? '';
};

const seedAgent = async (role: 'screenhost_agent' | 'screencast_agent') => {
  const id = await seedUser({ role, status: 'approved' });
  seq += 1;
  await db.insert(agents).values({
    userId: id,
    code: `${role === 'screenhost_agent' ? 'SH' : 'SC'}${100000 + seq}`,
    accountStatus: 'actif',
  });
  return id;
};

const refer = (agentUserId: string, referredUserId: string) =>
  db.insert(agentReferrals).values({ agentUserId, referredUserId, agentCodeUsed: 'X' });

const seedVenue = async (ownerId: string, name: string) => {
  const [v] = await db.insert(screenhosts).values({ name, ownerId }).returning();
  return v?.id ?? '';
};

describe('AGT-2 — agent affiliations (real Postgres)', () => {
  beforeEach(async () => {
    await resetAuthTables();
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await sql.end();
  });

  it('the admin approval of a referred screencaster starts a 24-month affiliation and notifies the agent', async () => {
    const agent = await seedAgent('screencast_agent');
    const admin = await seedUser({ role: 'admin', status: 'approved' });
    const sc = await seedUser({
      role: 'advertiser',
      status: 'pending',
      businessName: 'Café Plus SARL',
    });
    await refer(agent, sc);
    const app = Fastify({ logger: false });
    await app.register(adminRoutes);
    vi.spyOn(auth.api, 'getSession').mockResolvedValue({
      session: {},
      user: { id: admin, role: 'admin', status: 'approved' },
    } as unknown as GetSessionResult);
    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/users/${sc}/approve`,
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    await app.close();

    const [a] = await db
      .select()
      .from(agentAffiliations)
      .where(eq(agentAffiliations.referredUserId, sc));
    const today = tunisDateOf(new Date());
    expect(a).toMatchObject({
      agentUserId: agent,
      status: 'en_cours',
      startDate: today,
      endDate: affiliationEnd(today),
      screenhostId: null,
    });
    const notes = await db.select().from(notifications).where(eq(notifications.userId, agent));
    expect(notes.map((n) => n.title)).toEqual(['Nouveau Screencaster affilié : Café Plus SARL']);
    // idempotent
    await createAffiliationsOnApproval(db, sc);
    expect(await db.select().from(agentAffiliations)).toHaveLength(1);
  });

  it('a Screenhost agent gets one pending affiliation per venue, including venues added later', async () => {
    const agent = await seedAgent('screenhost_agent');
    const owner = await seedUser({ role: 'individual_owner', status: 'approved' });
    await refer(agent, owner);
    await seedVenue(owner, 'Café Nord');
    await createAffiliationsOnApproval(db, owner);
    await seedVenue(owner, 'Café Sud');
    const tick = await runAgentAffiliationTick();
    expect(tick.attached).toBe(1);
    const rows = await db.select().from(agentAffiliations);
    expect(rows.map((r) => r.status)).toEqual(['en_attente_activation', 'en_attente_activation']);
    expect(rows.every((r) => r.startDate === null)).toBe(true);
  });

  it('the first completed campaign activates the venue from its first day of diffusion', async () => {
    const agent = await seedAgent('screenhost_agent');
    const owner = await seedUser({ role: 'individual_owner', status: 'approved' });
    await refer(agent, owner);
    const venue = await seedVenue(owner, 'Café Nord');
    const screen = await seedInstalledScreen(venue);
    await createAffiliationsOnApproval(db, owner);

    const advertiser = await seedUser({ role: 'advertiser', status: 'approved' });
    const [cr] = await db
      .insert(creatives)
      .values({
        advertiserId: advertiser,
        storageKey: `k${seq}`,
        durationSeconds: 10,
        validationStatus: 'approved',
      })
      .returning();
    const [c] = await db
      .insert(campaigns)
      .values({
        advertiserId: advertiser,
        name: 'Campagne terminée',
        campaignType: 'standard',
        status: 'completed',
        startDate: '2026-09-01',
        endDate: '2026-09-10',
        creativeId: cr?.id ?? null,
      })
      .returning();
    const [plan] = await db
      .insert(campaignDispatchPlan)
      .values({
        campaignId: c?.id ?? '',
        iCible: 100,
        cpm: '15',
        sSpotSeconds: 10,
        tTierCoef: '0.6',
        seuilDiffusable: 10,
        sMin: '1',
        gJour: '1',
        fMaxSeconds: 300,
        rMinEfficace: 2,
        couvert: 100,
        nMin: 1,
        nMax: 1,
        nRetenus: 1,
        isPartial: false,
        isTooThin: false,
        reliquatStocke: 0,
      })
      .returning();
    await db.insert(campaignDispatchAllocation).values({
      planId: plan?.id ?? '',
      screenhostId: venue,
      iiPotentiel: 100,
      rI: 2,
      revenuPrevisionnel: '1.5',
      statutAcceptation: 'ACCEPTE',
      creneaux: [],
    });
    await db.insert(proofOfPlay).values({
      screenId: screen,
      screenhostId: venue,
      campaignId: c?.id ?? '',
      creativeId: cr?.id ?? '',
      videoIdAsSent: cr?.id ?? '',
      eventType: 'VIDEO_ENDED',
      receivedAt: new Date('2026-09-03T10:00:00Z'),
    });

    const tick = await runAgentAffiliationTick(undefined, new Date('2026-10-13T10:00:00Z'));
    expect(tick.activated).toBe(1);
    const [a] = await db.select().from(agentAffiliations);
    expect(a).toMatchObject({
      status: 'en_cours',
      startDate: '2026-09-03',
      endDate: '2028-09-03',
      activationCampaignId: c?.id,
    });
    const titles = (
      await db.select().from(notifications).where(eq(notifications.userId, agent))
    ).map((n) => n.title);
    expect(titles).toContain('Screenhost activé : Café Nord');
  });

  it('30-day reminder (preference on), then « terminée » at the end date', async () => {
    const agent = await seedAgent('screencast_agent');
    const sc = await seedUser({ role: 'advertiser', status: 'approved', businessName: 'Pub SARL' });
    await db.insert(agentAffiliations).values({
      agentUserId: agent,
      agentRole: 'screencast_agent',
      referredUserId: sc,
      startDate: '2024-11-01',
      endDate: '2026-11-01',
      status: 'en_cours',
    });
    const remind = await runAgentAffiliationTick(undefined, new Date('2026-10-13T10:00:00Z'));
    expect(remind.reminded).toBe(1);
    expect(
      (await runAgentAffiliationTick(undefined, new Date('2026-10-14T10:00:00Z'))).reminded,
    ).toBe(0);
    const notes = await db.select().from(notifications).where(eq(notifications.userId, agent));
    expect(notes[0]?.title).toBe('L’affiliation de Pub SARL se termine le 01/11/2026');
    const end = await runAgentAffiliationTick(undefined, new Date('2026-11-01T10:00:00Z'));
    expect(end.ended).toBe(1);
    expect((await db.select().from(agentAffiliations))[0]?.status).toBe('terminee');
  });

  it('hub actions: avenant, exploited (SH only), reassign (old row excluded), exclude', async () => {
    const agent = await seedAgent('screenhost_agent');
    const other = await seedAgent('screenhost_agent');
    const scAgent = await seedAgent('screencast_agent');
    const owner = await seedUser({ role: 'individual_owner', status: 'approved' });
    await refer(agent, owner);
    await seedVenue(owner, 'Café Nord');
    await createAffiliationsOnApproval(db, owner);
    const [a] = await db.select().from(agentAffiliations);
    const id = a?.id ?? '';

    expect(
      await applyAffiliationAction(id, {
        kind: 'exploited',
        exploited: true,
        conventionRef: 'CONV-1',
      }),
    ).toEqual({ ok: true });
    expect(await applyAffiliationAction(id, { kind: 'reassign', agentUserId: scAgent })).toEqual({
      ok: false,
      error: 'BAD_AGENT',
    });
    expect(await applyAffiliationAction(id, { kind: 'reassign', agentUserId: other })).toEqual({
      ok: true,
    });
    const rows = await db.select().from(agentAffiliations);
    expect(rows.find((r) => r.id === id)).toMatchObject({
      status: 'exclue',
      exclusionReason: 'reaffecte',
    });
    const moved = rows.find((r) => r.id !== id);
    expect(moved).toMatchObject({
      agentUserId: other,
      status: 'en_attente_activation',
      exploitedByAgent: false,
    });
    expect(await applyAffiliationAction(id, { kind: 'exclude', reason: 'exclu' })).toEqual({
      ok: false,
      error: 'NOT_LIVE',
    });
    expect(
      await applyAffiliationAction(moved?.id ?? '', { kind: 'exclude', reason: 'exclu' }),
    ).toEqual({ ok: true });
    const [live] = await db
      .select()
      .from(agentAffiliations)
      .where(and(eq(agentAffiliations.agentUserId, other)));
    expect(live?.status).toBe('exclue');
  });
});
