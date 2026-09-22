import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import postgres from 'postgres';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import {
  type NewUser,
  businessSectors,
  campaignDispatchPlan,
  campaignTargeting,
  campaigns,
  creatives,
  eventAllocations,
  events,
  hourReservations,
  recharges,
  screenhostAffluence,
  screenhosts,
  users,
} from '../src/db/schema.js';
import { env } from '../src/env.js';
import { prepareActivation } from '../src/lib/activation-service.js';
import { plusCalendarDays, premiereDateDisponible } from '../src/lib/campaign-dates.js';
import { getDispatchConfig } from '../src/lib/dispatch/config.js';
import { OCCUPANCY_LOCK_NAMESPACE } from '../src/lib/dispatch/pool.js';
import { updateScreencasterCpm } from '../src/lib/screencaster-cpm.js';
import { campaignDispatchRoutes } from '../src/routes/campaign-dispatch.js';
import { cartRoutes } from '../src/routes/cart.js';

import { bothHalves, resetAuthTables } from './helpers/db-test-setup.js';
import { seedInstalledScreen } from './helpers/installed-screen.js';

// CPM-3 final review (ruled 2026-09-19) — a freeze racing an admin CPM change, on real Postgres
// with a SECOND connection (`side`) that holds locks. The freeze (runDispatch / runEventDispatch,
// opted in by prepareActivation) locks the advertiser row FOR KEY SHARE and re-reads the campaign
// CPM as its first statements: (a) a change that committed first → CPM_CHANGED, nothing frozen;
// (b) a freeze holding its lock → the change waits, then leaves the frozen draft alone (ruling A),
// so the campaign row and the frozen price agree; (c) the admin dispatch keeps its explicit CPM.

type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;
const buildApp = () => Fastify({ logger: false });
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
      email: `race${seq}@example.com`,
      contactName: `Race ${seq}`,
      status: 'approved',
      ...values,
    })
    .returning({ id: users.id });
  return u?.id ?? '';
};

/** One approved venue (affluence 100 every day) + a funded advertiser at 12 / 12 TND. */
const fixture = async (closingHour: number) => {
  const admin = await seedUser({ role: 'admin' });
  const advertiser = await seedUser({
    role: 'advertiser',
    cpmStandardTnd: '12.000',
    cpmEventTnd: '12.000',
  });
  const owner = await seedUser({ role: 'individual_owner' });
  const [sector] = await db
    .select({ id: businessSectors.id })
    .from(businessSectors)
    .where(eq(businessSectors.audience, 'owner'))
    .limit(1);
  const [sh] = await db
    .insert(screenhosts)
    .values({
      name: `Race Venue ${seq}`,
      ownerId: owner,
      businessSectorId: sector?.id ?? '',
      class: 'premium',
      openingHour: 8,
      closingHour,
      broadcastCapacity: 4,
    })
    .returning({ id: screenhosts.id });
  const venue = sh?.id ?? '';
  const cells = [];
  for (let dow = 1; dow <= 7; dow += 1)
    for (let h = 8; h < closingHour; h += 1)
      cells.push({ screenhostId: venue, dayOfWeek: dow, hour: h, estimatedImpressions: 100 });
  await db.insert(screenhostAffluence).values(bothHalves(cells));
  await seedInstalledScreen(venue);
  await db.insert(recharges).values({
    advertiserId: advertiser,
    amountTnd: '5000.00',
    status: 'confirmed',
    reference: `RACE-${seq}-${Math.random().toString(16).slice(2, 8)}`,
  });
  const [creative] = await db
    .insert(creatives)
    .values({
      advertiserId: advertiser,
      creativeType: 'video',
      storageKey: `creatives/race/${seq}-${Math.random().toString(16).slice(2)}`,
      durationSeconds: 10,
      validationStatus: 'approved',
      fileHash: `race-${seq}-${Math.random().toString(16).slice(2)}`,
    })
    .returning({ id: creatives.id });
  return { admin, advertiser, venue, sector: sector?.id ?? '', creative: creative?.id ?? '' };
};
type Fixture = Awaited<ReturnType<typeof fixture>>;

/** A complete classic draft (floor-valid 2-day window) — it captures the advertiser's 12.000. */
const seedDraft = async (f: Fixture): Promise<string> => {
  const start = premiereDateDisponible(
    new Date(),
    (await getDispatchConfig()).campaignLeadWorkingDays,
  );
  const [c] = await db
    .insert(campaigns)
    .values({
      advertiserId: f.advertiser,
      name: `Race campagne ${seq}`,
      campaignType: 'standard',
      status: 'draft',
      startDate: start,
      endDate: plusCalendarDays(start, 1),
      requestedBudget: '200.00',
      creativeId: f.creative,
    })
    .returning({ id: campaigns.id });
  const id = c?.id ?? '';
  await db.insert(campaignTargeting).values({ campaignId: id, categoryId: f.sector, class: null });
  return id;
};

/** A draft positioning on a Tunis-evening match (window 19:00–23:00, venue open until 23). */
const seedPositioning = async (f: Fixture): Promise<{ id: string; eventId: string }> => {
  const [ev] = await db
    .insert(events)
    .values({
      name: `Race Match ${seq}`,
      type: 'sport',
      kickoffAt: new Date('2027-06-10T20:00:00+01:00'),
      endsAt: new Date('2027-06-10T22:00:00+01:00'),
      source: 'official',
    })
    .returning({ id: events.id });
  const [c] = await db
    .insert(campaigns)
    .values({
      advertiserId: f.advertiser,
      name: `Race positionnement ${seq}`,
      campaignType: 'event',
      status: 'draft',
      startDate: '2027-06-10',
      endDate: '2027-06-10',
      requestedBudget: '200.00',
      eventId: ev?.id ?? null,
      creativeId: f.creative,
    })
    .returning({ id: campaigns.id });
  return { id: c?.id ?? '', eventId: ev?.id ?? '' };
};

const readCampaign = async (id: string) => {
  const [row] = await db.select().from(campaigns).where(eq(campaigns.id, id)).limit(1);
  if (!row) throw new Error(`campaign ${id} not found`);
  return row;
};
const prepare = async (id: string, campaign?: Awaited<ReturnType<typeof readCampaign>>) =>
  prepareActivation({
    campaign: campaign ?? (await readCampaign(id)),
    contentValidationStatus: 'approved',
    creativeDurationSeconds: 10,
    fromStatus: 'draft',
  });
const planOf = async (id: string) =>
  (await db.select().from(campaignDispatchPlan).where(eq(campaignDispatchPlan.campaignId, id)))[0];
const allocationsOf = (id: string) =>
  db.select().from(eventAllocations).where(eq(eventAllocations.campaignId, id));

/** Backends of THIS database blocked on a lock (row, tuple, transaction id or advisory). */
const waitForLockWaiters = async (n: number): Promise<boolean> => {
  const until = Date.now() + 5_000;
  while (Date.now() < until) {
    const [row] = await sql<{ n: number }[]>`
      select count(*)::int as n from pg_stat_activity
      where datname = current_database() and wait_event_type = 'Lock'`;
    if ((row?.n ?? 0) >= n) return true;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return false;
};

/** Holds `statements` open on the side connection until release() (afterEach releases it too). */
let openHold: (() => Promise<void>) | null = null;
const hold = async (
  side: postgres.Sql,
  statements: (tx: postgres.TransactionSql) => Promise<void>,
) => {
  let ready!: () => void;
  const readyP = new Promise<void>((resolve) => (ready = resolve));
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  const done = side.begin(async (tx) => {
    await statements(tx);
    ready();
    await released;
  });
  await readyP;
  const releaseOnce = async (): Promise<void> => {
    release();
    await done;
  };
  openHold = releaseOnce;
  return releaseOnce;
};

describe('CPM-3 — a freeze racing a CPM change (real Postgres, two connections)', () => {
  const side = postgres(env.DATABASE_URL, { max: 1, onnotice: () => undefined });
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    await resetAuthTables();
    app = buildApp();
    await app.register(cartRoutes);
    await app.register(campaignDispatchRoutes);
    await app.ready();
  });
  afterEach(async () => {
    await openHold?.();
    openHold = null;
    await app.close();
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    await side.end();
    await sql.end();
  });

  it('(a) the change committed first → the freeze refuses CPM_CHANGED and freezes nothing; a fresh read freezes at the new CPM', async () => {
    const f = await fixture(18);
    const id = await seedDraft(f);
    const stale = await readCampaign(id); // read at 12.000, as the cart does, unlocked
    await updateScreencasterCpm({ userIds: [f.advertiser], standardCpmTnd: 8, changedBy: f.admin });

    expect(await prepare(id, stale)).toEqual({ status: 'CPM_CHANGED' });
    expect(await planOf(id)).toBeUndefined();

    expect((await prepare(id)).status).toBe('READY');
    expect(Number((await planOf(id))?.cpm)).toBe(8);
    expect((await readCampaign(id)).standardCpmTnd).toBe('8.000');
  }, 30_000);

  it('(a) event: a stale positioning refuses CPM_CHANGED — no allocation, no hour reserved', async () => {
    const f = await fixture(23);
    const { id, eventId } = await seedPositioning(f);
    const stale = await readCampaign(id);
    await updateScreencasterCpm({ userIds: [f.advertiser], eventCpmTnd: 8, changedBy: f.admin });

    expect(await prepare(id, stale)).toEqual({ status: 'CPM_CHANGED' });
    expect(await allocationsOf(id)).toEqual([]);
    const held = await db
      .select()
      .from(hourReservations)
      .where(eq(hourReservations.eventId, eventId));
    expect(held).toEqual([]);
  }, 30_000);

  it('(a) the cart confirm waits out a change in flight, then refuses the item with CPM_CHANGED (cart intact); the re-confirm launches at the new CPM', async () => {
    const f = await fixture(18);
    const id = await seedDraft(f);
    mockSession(f.advertiser, 'advertiser');
    const add = await app.inject({
      method: 'POST',
      url: '/api/cart/items',
      payload: { campaign_id: id },
    });
    expect(add.statusCode).toBe(200);

    // The side connection runs the PATCH's statements and keeps its transaction open.
    const commit = await hold(side, async (tx) => {
      await tx`select id from users where id = ${f.advertiser} for update`;
      await tx`update users set cpm_standard_tnd = '8.000' where id = ${f.advertiser}`;
      await tx`update campaigns set standard_cpm_tnd = '8.000' where id = ${id}`;
    });
    const confirmP = app.inject({ method: 'POST', url: '/api/cart/confirm' });
    expect(await waitForLockWaiters(1)).toBe(true); // the freeze waits on the advertiser row
    await commit();

    const res = await confirmP;
    expect(res.statusCode).toBe(400);
    expect(res.json<{ items: unknown[] }>().items).toEqual([
      { campaign_id: id, reason: 'CPM_CHANGED' },
    ]);
    expect(await planOf(id)).toBeUndefined();
    expect((await readCampaign(id)).status).toBe('draft');

    const again = await app.inject({ method: 'POST', url: '/api/cart/confirm' });
    expect(again.statusCode).toBe(200);
    expect(Number((await planOf(id))?.cpm)).toBe(8);
    expect((await readCampaign(id)).standardCpmTnd).toBe('8.000');
  }, 30_000);

  it('(b) a freeze holding its lock makes the change WAIT; the change then leaves that draft alone — row CPM = plan CPM', async () => {
    const f = await fixture(18);
    const id = await seedDraft(f);
    // Park the freeze AFTER its CPM check: the side connection holds the venue's occupancy lock.
    const releaseVenue = await hold(side, async (tx) => {
      await tx`select pg_advisory_xact_lock(${OCCUPANCY_LOCK_NAMESPACE}, hashtext(${f.venue}))`;
    });
    const freezeP = prepare(id);
    expect(await waitForLockWaiters(1)).toBe(true);

    let changeSettled = false;
    const changeP = updateScreencasterCpm({
      userIds: [f.advertiser],
      standardCpmTnd: 8,
      changedBy: f.admin,
    }).finally(() => (changeSettled = true));
    expect(await waitForLockWaiters(2)).toBe(true); // the change waits on the freeze's KEY SHARE
    expect(changeSettled).toBe(false);

    await releaseVenue();
    expect((await freezeP).status).toBe('READY');
    expect(await changeP).toEqual({ ok: true, updated: 1, draftsRepriced: 0 });
    expect((await readCampaign(id)).standardCpmTnd).toBe('12.000');
    expect(Number((await planOf(id))?.cpm)).toBe(12);
    const [account] = await db
      .select({ s: users.cpmStandardTnd })
      .from(users)
      .where(eq(users.id, f.advertiser));
    expect(account?.s).toBe('8.000'); // the change itself landed: new campaigns capture 8
  }, 30_000);

  it('(b) event: the change waits for the allocations freeze, then leaves the positioning at the CPM its allocations were priced at', async () => {
    const f = await fixture(23);
    const { id, eventId } = await seedPositioning(f);
    // Park the freeze in its write transaction, AFTER its CPM check: the side holds uncommitted
    // reservations on the match's Tunis hours (19–22) that the freeze's own insert waits on. (A
    // venue-row lock would park it too early: the A_max ratchet writes before the transaction.)
    const releaseVenue = await hold(side, async (tx) => {
      for (const hour of [19, 20, 21, 22]) {
        await tx`insert into hour_reservations (screenhost_id, day, hour, event_id)
          values (${f.venue}, '2027-06-10', ${hour}, ${eventId})`;
      }
    });
    const freezeP = prepare(id);
    expect(await waitForLockWaiters(1)).toBe(true);

    let changeSettled = false;
    const changeP = updateScreencasterCpm({
      userIds: [f.advertiser],
      eventCpmTnd: 8,
      changedBy: f.admin,
    }).finally(() => (changeSettled = true));
    expect(await waitForLockWaiters(2)).toBe(true);
    expect(changeSettled).toBe(false);

    await releaseVenue();
    expect((await freezeP).status).toBe('READY');
    expect(await changeP).toEqual({ ok: true, updated: 1, draftsRepriced: 0 });
    expect((await readCampaign(id)).eventCpmTnd).toBe('12.000');
    const allocations = await allocationsOf(id);
    expect(allocations.length).toBeGreaterThan(0);
    const iCible = Math.floor((200 * 1000) / 12);
    for (const a of allocations) {
      // One venue: every placed impression up to I_cible is charged at the frozen 12 TND / 1000.
      expect(Number(a.montantTnd)).toBe(
        Math.round(Math.min(a.impressionsTotal, iCible) * 12) / 1000,
      );
    }
  }, 30_000);

  it('(c) the admin POST /api/campaigns/:id/dispatch still freezes at its EXPLICIT CPM (no freeze check)', async () => {
    const f = await fixture(18);
    const id = await seedDraft(f); // the row carries 12.000
    mockSession(f.admin, 'admin');
    const res = await app.inject({
      method: 'POST',
      url: `/api/campaigns/${id}/dispatch`,
      payload: { i_cible: 10000, cpm: 20, s: 10 },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json<{ plan: { cpm: number } }>().plan.cpm).toBe(20);
    expect(Number((await planOf(id))?.cpm)).toBe(20);
  }, 30_000);
});
