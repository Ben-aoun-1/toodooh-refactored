import { eq, sql as dsql } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import {
  type NewUser,
  accountDeletions,
  agentAffiliations,
  agents,
  businessSectors,
  campaignDispatchAllocation,
  campaignDispatchPlan,
  campaignTargeting,
  campaigns,
  creatives,
  demoScreenhosts,
  dispatchConfig,
  notifications,
  proofOfPlay,
  screenhostAffluence,
  screenhosts,
  screens,
  users,
  walletAdjustments,
} from '../src/db/schema.js';
import { STORAGE_COLUMNS } from '../src/lib/account-deletion/execute.js';
import { deletionOrder, edgePolicy } from '../src/lib/account-deletion/graph.js';
import { runHubDeletionSweep } from '../src/lib/account-deletion/hub.js';
import { plusCalendarDays, tunisDateOf } from '../src/lib/campaign-dates.js';
import { adminAccountDeletionRoutes } from '../src/routes/admin-account-deletion.js';
import { cartRoutes } from '../src/routes/cart.js';
import { storage } from '../src/storage/s3-storage.js';

import { bothHalves, resetAuthTables } from './helpers/db-test-setup.js';
import { seedInstalledScreen } from './helpers/installed-screen.js';

// DEL-1 (operator 2026-10-19, rulings A A B A) — complete account deletion on a real Postgres:
// a screencaster with a campaign ON AIR on someone else's venue (plan, allocation, proof, cart,
// notices, balance) disappears completely — the other owner keeps their venue; a screenhost takes
// their venues, screens and the other screencasters' proofs on them with them; an agent their
// affiliations. Financial records are archived first; the hub is told, and retried.

type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;
const mockSession = (userId: string, role: string): void => {
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
      email: `del${seq}@example.com`,
      contactName: `User ${seq}`,
      role: 'advertiser',
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

const ownerSectorId = async (): Promise<string> => {
  const [s] = await db
    .select({ id: businessSectors.id })
    .from(businessSectors)
    .where(eq(businessSectors.audience, 'owner'))
    .limit(1);
  return s?.id ?? '';
};

const seedVenue = async (ownerId: string, sector: string) => {
  seq += 1;
  const [sh] = await db
    .insert(screenhosts)
    .values({
      name: `Venue ${seq}`,
      ownerId,
      businessSectorId: sector,
      openingHour: 0,
      closingHour: 23,
    })
    .returning();
  const id = sh?.id ?? '';
  const rows = [];
  for (const dow of [1, 2, 3, 4, 5, 6, 7])
    for (let h = 0; h < 23; h += 1)
      rows.push({ screenhostId: id, dayOfWeek: dow, hour: h, estimatedImpressions: 100 });
  await db.insert(screenhostAffluence).values(bothHalves(rows));
  const screenId = await seedInstalledScreen(id);
  return { id, screenId };
};

/** A demo screencaster's campaign launched on `venue`, with one proof of play. */
const launchedCampaign = async (
  app: App,
  advertiserId: string,
  sector: string,
  venue: { id: string; screenId: string },
) => {
  seq += 1;
  const [creative] = await db
    .insert(creatives)
    .values({
      advertiserId,
      storageKey: `creatives/${advertiserId}/spot-${seq}`,
      durationSeconds: 10,
      validationStatus: 'approved',
      fileHash: `h-${seq}-${Math.random()}`,
    })
    .returning();
  const today = tunisDateOf(new Date());
  const [c] = await db
    .insert(campaigns)
    .values({
      advertiserId,
      name: `Campagne ${seq}`,
      campaignType: 'standard',
      status: 'draft',
      startDate: today,
      endDate: plusCalendarDays(today, 3),
      requestedBudget: '100.00',
      creativeId: creative?.id ?? null,
    })
    .returning();
  const id = c?.id ?? '';
  await db.insert(campaignTargeting).values({ campaignId: id, categoryId: sector, class: null });
  mockSession(advertiserId, 'advertiser');
  expect(
    (await app.inject({ method: 'POST', url: '/api/cart/items', payload: { campaign_id: id } }))
      .statusCode,
  ).toBe(200);
  expect((await app.inject({ method: 'POST', url: '/api/cart/confirm' })).statusCode).toBe(200);
  vi.restoreAllMocks();
  stubStorage();
  await db.insert(proofOfPlay).values({
    screenId: venue.screenId,
    screenhostId: venue.id,
    campaignId: id,
    creativeId: creative?.id ?? '',
    videoIdAsSent: id,
    eventType: 'VIDEO_STARTED',
  });
  return { campaignId: id, creativeKey: creative?.storageKey ?? '' };
};

const buildApp = () => Fastify({ logger: false });
type App = ReturnType<typeof buildApp>;

const uploads: string[] = [];
const deletes: string[] = [];
const stubStorage = () => {
  vi.spyOn(storage, 'download').mockResolvedValue({
    body: Buffer.from('pdf'),
    contentType: 'application/pdf',
  });
  vi.spyOn(storage, 'upload').mockImplementation(async ({ key, body }) => {
    uploads.push(key);
    if (key.endsWith('records.json')) lastArchive = JSON.parse(body.toString()) as Archive;
    return { key };
  });
  vi.spyOn(storage, 'delete').mockImplementation(async ({ key }) => {
    deletes.push(key);
    return { deleted: true };
  });
};
type Archive = { records: Record<string, unknown[]> };
let lastArchive: Archive | null = null;

describe('DEL-1 — complete account deletion (real Postgres)', () => {
  let app: App;

  beforeEach(async () => {
    await resetAuthTables();
    await db.delete(demoScreenhosts);
    await db.update(dispatchConfig).set({ demoDelayMinutes: 0 });
    uploads.length = 0;
    deletes.length = 0;
    lastArchive = null;
    stubStorage();
    app = buildApp();
    await app.register(cartRoutes);
    await app.register(adminAccountDeletionRoutes);
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    await sql.end();
  });

  const world = async () => {
    const superadmin = await seedUser({ role: 'superadmin' });
    const owner = await seedUser({ role: 'individual_owner', email: `owner${seq}@example.com` });
    const sector = await ownerSectorId();
    const venue = await seedVenue(owner, sector);
    await db.insert(demoScreenhosts).values({ screenhostId: venue.id });
    const caster = await seedUser({ isDemo: true, email: `caster${seq}@example.com` });
    await db.insert(walletAdjustments).values({
      advertiserId: caster,
      adminId: superadmin,
      amountTnd: '2000.00',
      reason: 'Crédit démo',
    });
    return { superadmin, owner, sector, venue, caster };
  };

  const remove = (id: string, email: string, actor: string, role = 'superadmin') => {
    vi.spyOn(auth.api, 'getSession').mockResolvedValue({
      session: {},
      user: { id: actor, role, status: 'approved' },
    } as unknown as GetSessionResult);
    return app.inject({
      method: 'POST',
      url: `/api/admin/users/${id}/delete`,
      payload: { reason: 'Demande du client', confirm_email: email },
    });
  };

  it('the graph rules: ownership override, cascade, nullable cleared, NOT NULL deleted; children first', () => {
    expect(
      edgePolicy({
        child: 'screenhosts',
        column: 'owner_id',
        parent: 'users',
        onDelete: 'a',
        nullable: true,
      }),
    ).toBe('delete');
    expect(
      edgePolicy({
        child: 'x',
        column: 'validated_by',
        parent: 'users',
        onDelete: 'a',
        nullable: true,
      }),
    ).toBe('nullify');
    expect(
      edgePolicy({ child: 'x', column: 'y', parent: 'users', onDelete: 'c', nullable: true }),
    ).toBe('delete');
    expect(
      edgePolicy({ child: 'x', column: 'y', parent: 'users', onDelete: 'r', nullable: false }),
    ).toBe('delete');
    const edges = [
      {
        child: 'campaigns',
        column: 'advertiser_id',
        parent: 'users',
        onDelete: 'a',
        nullable: false,
      },
      {
        child: 'proof_of_play',
        column: 'campaign_id',
        parent: 'campaigns',
        onDelete: 'r',
        nullable: false,
      },
    ];
    expect(deletionOrder(['users', 'campaigns', 'proof_of_play'], edges)).toEqual([
      'proof_of_play',
      'campaigns',
      'users',
    ]);
    expect(() =>
      deletionOrder(
        ['a', 'b'],
        [
          { child: 'a', column: 'b_id', parent: 'b', onDelete: 'a', nullable: false },
          { child: 'b', column: 'a_id', parent: 'a', onDelete: 'a', nullable: false },
        ],
      ),
    ).toThrow('deletion cycle');
  });

  it('every file column of a deletable table is known (no file left behind)', async () => {
    const rows =
      (await db.execute(dsql`SELECT table_name AS t, column_name AS c FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name ~ '(^|_)key$' AND data_type = 'text'`)) as unknown as {
        t: string;
        c: string;
      }[];
    // Keys that are not files of a user: catalogue imagery and the playlist's own ids.
    const notUserFiles = new Set([
      'events.image_key',
      'teams.logo_key',
      'agent_cge_versions.storage_key',
    ]);
    const unknown = rows
      .map((r) => `${r.t}.${r.c}`)
      .filter((k) => !notUserFiles.has(k))
      .filter((k) => {
        const [t, c] = k.split('.');
        return !(STORAGE_COLUMNS[t ?? ''] ?? []).includes(c ?? '');
      });
    expect(unknown).toEqual([]);
  });

  it('deletes the screencaster: campaign, plan, allocation, proof, notices and balance go; archive first', async () => {
    const w = await world();
    const [caster] = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, w.caster));
    const { campaignId, creativeKey } = await launchedCampaign(app, w.caster, w.sector, w.venue);
    await db
      .insert(notifications)
      .values({ userId: w.owner, title: 'Nouvelle campagne', body: 'x', type: 'info', campaignId });
    const res = await remove(w.caster, caster?.email ?? '', w.superadmin);
    expect(res.statusCode).toBe(200);
    const body = res.json<{ counts: Record<string, number> }>();
    expect(body.counts).toMatchObject({ users: 1, campaigns: 1, creatives: 1, proof_of_play: 1 });

    expect(await db.select().from(users).where(eq(users.id, w.caster))).toEqual([]);
    expect(await db.select().from(campaigns).where(eq(campaigns.id, campaignId))).toEqual([]);
    expect(
      await db
        .select()
        .from(campaignDispatchPlan)
        .where(eq(campaignDispatchPlan.campaignId, campaignId)),
    ).toEqual([]);
    expect(
      await db.select().from(proofOfPlay).where(eq(proofOfPlay.campaignId, campaignId)),
    ).toEqual([]);
    expect(
      await db.select().from(walletAdjustments).where(eq(walletAdjustments.advertiserId, w.caster)),
    ).toEqual([]);
    // The owner's notice about that campaign stays, unlinked (a reference, not ownership).
    const [notice] = await db.select().from(notifications).where(eq(notifications.userId, w.owner));
    expect(notice?.campaignId).toBeNull();
    // The other owner keeps their venue and screen.
    expect(await db.select().from(screenhosts).where(eq(screenhosts.id, w.venue.id))).toHaveLength(
      1,
    );
    // D2 A — the financial records were archived before anything was deleted.
    expect(lastArchive?.records['wallet_adjustments']).toHaveLength(1);
    expect(lastArchive?.records['campaigns']).toHaveLength(1);
    expect(uploads.every((k) => k.startsWith(`archives/deleted-accounts/${w.caster}/`))).toBe(true);
    // Every file of the account is deleted.
    expect(deletes).toContain(creativeKey);
    const [log] = await db
      .select()
      .from(accountDeletions)
      .where(eq(accountDeletions.deletedUserId, w.caster));
    expect(log).toMatchObject({ role: 'advertiser', deletedBy: w.superadmin, hubStatus: 'none' });
  });

  it('deletes a screenhost with their venues and the proofs on them; the hub is told and retried', async () => {
    const w = await world();
    const { campaignId } = await launchedCampaign(app, w.caster, w.sector, w.venue);
    const [owner] = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, w.owner));
    const res = await remove(w.owner, owner?.email ?? '', w.superadmin);
    expect(res.statusCode).toBe(200);
    expect(await db.select().from(screenhosts).where(eq(screenhosts.id, w.venue.id))).toEqual([]);
    expect(await db.select().from(screens).where(eq(screens.id, w.venue.screenId))).toEqual([]);
    expect(
      await db.select().from(proofOfPlay).where(eq(proofOfPlay.screenhostId, w.venue.id)),
    ).toEqual([]);
    expect(
      await db
        .select()
        .from(campaignDispatchAllocation)
        .where(eq(campaignDispatchAllocation.screenhostId, w.venue.id)),
    ).toEqual([]);
    // The screencaster and their campaign stay.
    expect(await db.select().from(campaigns).where(eq(campaigns.id, campaignId))).toHaveLength(1);

    const [log] = await db
      .select()
      .from(accountDeletions)
      .where(eq(accountDeletions.deletedUserId, w.owner));
    expect(log).toMatchObject({
      hubStatus: 'pending',
      hubLocationIds: [w.venue.id],
      hubAgent: false,
    });
    const cfg = { ingestUrl: 'http://hub.test', syncKey: 'k'.repeat(32) };
    const down = vi.fn(async () => new Response('', { status: 503 }));
    expect(await runHubDeletionSweep(undefined, cfg, down as unknown as typeof fetch)).toBe(0);
    const [afterFail] = await db
      .select()
      .from(accountDeletions)
      .where(eq(accountDeletions.id, log?.id ?? ''));
    expect(afterFail).toMatchObject({ hubStatus: 'pending', hubAttempts: 1, hubError: 'HTTP 503' });
    const up = vi.fn<typeof fetch>(async () => new Response('{}', { status: 200 }));
    expect(await runHubDeletionSweep(undefined, cfg, up)).toBe(1);
    expect(up.mock.calls[0]?.[0]).toBe('http://hub.test/api/sync/delete');
    expect(JSON.parse(String(up.mock.calls[0]?.[1]?.body))).toEqual({
      location_ids: [w.venue.id],
      toodooh_user_id: null,
    });
    const [afterOk] = await db
      .select()
      .from(accountDeletions)
      .where(eq(accountDeletions.id, log?.id ?? ''));
    expect(afterOk?.hubStatus).toBe('done');
  });

  it('deletes an agent with their affiliations; the hub deletes the agent user', async () => {
    const w = await world();
    const agent = await seedUser({ role: 'screenhost_agent', email: `agent${seq}@example.com` });
    await db.insert(agents).values({ userId: agent, code: `SH9${seq}`, accountStatus: 'actif' });
    await db.insert(agentAffiliations).values({
      agentUserId: agent,
      agentRole: 'screenhost_agent',
      referredUserId: w.owner,
      screenhostId: w.venue.id,
      status: 'en_attente_activation',
    });
    const [agentRow] = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, agent));
    const res = await remove(agent, agentRow?.email ?? '', w.superadmin);
    expect(res.statusCode).toBe(200);
    expect(
      await db.select().from(agentAffiliations).where(eq(agentAffiliations.agentUserId, agent)),
    ).toEqual([]);
    expect(await db.select().from(users).where(eq(users.id, w.owner))).toHaveLength(1);
    const [log] = await db
      .select()
      .from(accountDeletions)
      .where(eq(accountDeletions.deletedUserId, agent));
    expect(log).toMatchObject({ hubAgent: true, hubStatus: 'pending' });
  });

  it('only a superadmin; the email must match; staff and self are refused', async () => {
    const w = await world();
    const admin = await seedUser({ role: 'admin' });
    const [caster] = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, w.caster));
    expect((await remove(w.caster, caster?.email ?? '', admin, 'admin')).statusCode).toBe(403);
    vi.restoreAllMocks();
    stubStorage();
    expect((await remove(w.caster, 'someone@else.tn', w.superadmin)).json()).toMatchObject({
      error: 'CONFIRM_EMAIL_MISMATCH',
    });
    vi.restoreAllMocks();
    stubStorage();
    const [adminRow] = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, admin));
    expect((await remove(admin, adminRow?.email ?? '', w.superadmin)).json()).toMatchObject({
      error: 'NOT_DELETABLE',
    });
    expect(await db.select().from(users).where(eq(users.id, w.caster))).toHaveLength(1);
  });
});
