import { eq, inArray } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import {
  type NewUser,
  businessSectors,
  campaignDispatchPlan,
  campaignTargeting,
  campaigns,
  cartItems,
  creatives,
  notifications,
  recharges,
  screenhostAffluence,
  screenhosts,
  users,
} from '../src/db/schema.js';
import { activateCampaign } from '../src/lib/activation-service.js';
import { computeCampaignCmax } from '../src/lib/campaign-cmax.js';
import { plusCalendarDays, premiereDateDisponible } from '../src/lib/campaign-dates.js';
import { getDispatchConfig } from '../src/lib/dispatch/config.js';
import { adminCampaignsRoutes } from '../src/routes/admin-campaigns.js';
import { cartRoutes } from '../src/routes/cart.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// CF-SK1 (spec §2.1, ruling #9) — the approved-spot SKIP: « la campagne saute En attente et passe
// à À venir (ou Active) dès la confirmation du panier ». Real Postgres; session mocked. One venue
// (all-dow affluence 100, 8–18h) → C_max 540 for a 2-day window at S=10.

type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;

const buildApp = () => Fastify({ logger: false });

const mockSession = (userId: string, role = 'advertiser', status = 'approved'): void => {
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
      email: `skip${seq}@example.com`,
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

const seedVenue = async (ownerId: string, categoryId: string): Promise<string> => {
  const [sh] = await db
    .insert(screenhosts)
    .values({
      name: `Skip Venue ${seq}`,
      ownerId,
      businessSectorId: categoryId,
      class: 'premium',
      openingHour: 8,
      closingHour: 18,
      broadcastCapacity: 4,
    })
    .returning();
  const id = sh?.id ?? '';
  const rows = [];
  for (const dow of [1, 2, 3, 4, 5, 6, 7])
    for (let h = 8; h < 18; h += 1)
      rows.push({ screenhostId: id, dayOfWeek: dow, hour: h, estimatedImpressions: 100 });
  await db.insert(screenhostAffluence).values(rows);
  return id;
};

const seedCreative = async (
  advertiserId: string,
  validationStatus: 'pending' | 'approved' | 'rejected',
): Promise<string> => {
  seq += 1;
  const [c] = await db
    .insert(creatives)
    .values({
      advertiserId,
      creativeType: 'video',
      storageKey: `creatives/skip/${seq}-${Math.random().toString(16).slice(2)}`,
      durationSeconds: 10,
      validationStatus,
      fileHash: `hash-${seq}-${Math.random().toString(16).slice(2)}`,
    })
    .returning();
  return c?.id ?? '';
};

const fund = (advertiserId: string, amountTnd: string) =>
  db.insert(recharges).values({
    advertiserId,
    amountTnd,
    status: 'confirmed',
    reference: `SKIP-${seq}-${Math.random().toString(16).slice(2, 8)}`,
  });

interface DraftOpts {
  creativeStatus: 'pending' | 'approved' | 'rejected';
  /** Default: a FUTURE floor-valid window (→ 'upcoming'). */
  startedWindow?: boolean;
  budget?: string;
}

const seedDraft = async (
  advertiserId: string,
  sector: string,
  opts: DraftOpts,
): Promise<string> => {
  const lead = (await getDispatchConfig()).campaignLeadWorkingDays;
  const start = premiereDateDisponible(new Date(), lead);
  const creativeId = await seedCreative(advertiserId, opts.creativeStatus);
  const [c] = await db
    .insert(campaigns)
    .values({
      advertiserId,
      name: `Skip campagne ${seq}`,
      campaignType: 'standard',
      status: 'draft',
      startDate: start,
      endDate: plusCalendarDays(start, 1),
      requestedBudget: opts.budget ?? '200.00',
      creativeId,
    })
    .returning();
  const id = c?.id ?? '';
  await db.insert(campaignTargeting).values({ campaignId: id, categoryId: sector, class: null });
  return id;
};

describe('CF-SK1 — the approved-spot skip at cart confirm (real Postgres)', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    await resetAuthTables();
    app = buildApp();
    await app.register(cartRoutes);
    await app.register(adminCampaignsRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await sql.end();
  });

  const add = (campaignId: string) =>
    app.inject({ method: 'POST', url: '/api/cart/items', payload: { campaign_id: campaignId } });
  const confirm = () => app.inject({ method: 'POST', url: '/api/cart/confirm' });
  const statusOf = async (id: string) => {
    const [row] = await db
      .select({ status: campaigns.status, activatedBy: campaigns.activatedBy })
      .from(campaigns)
      .where(eq(campaigns.id, id));
    return row;
  };
  const hasPlan = async (id: string) =>
    (
      await db
        .select({ id: campaignDispatchPlan.id })
        .from(campaignDispatchPlan)
        .where(eq(campaignDispatchPlan.campaignId, id))
    ).length > 0;

  const fixture = async () => {
    const advertiser = await seedUser();
    const owner = await seedUser({ role: 'individual_owner' });
    const sector = await ownerSectorId();
    await seedVenue(owner, sector);
    await fund(advertiser, '5000.00');
    return { advertiser, sector };
  };

  it('HAPPY PATH: an approved spot SKIPS pending — confirm yields upcoming + a frozen plan', async () => {
    const f = await fixture();
    const id = await seedDraft(f.advertiser, f.sector, { creativeStatus: 'approved' });
    mockSession(f.advertiser);
    await add(id);
    const res = await confirm();
    expect(res.statusCode).toBe(200);

    const row = await statusOf(id);
    expect(row?.status).toBe('upcoming'); // future window → À venir, NEVER pending
    expect(row?.activatedBy).toBeNull(); // system activation, no admin
    expect(await hasPlan(id)).toBe(true); // dispatch ran at confirm
    const body = res.json<{ launched: { id: string }[]; pending_review: { id: string }[] }>();
    expect(body.launched.map((c) => c.id)).toEqual([id]);
    expect(body.pending_review).toEqual([]);
    expect(await db.select().from(cartItems).where(eq(cartItems.userId, f.advertiser))).toEqual([]);
  });

  it("a STARTED window goes straight to active — via the core (the cart's floor gate makes a today-start unreachable through the cart itself)", async () => {
    const f = await fixture();
    const id = await seedDraft(f.advertiser, f.sector, { creativeStatus: 'approved' });
    // The cart's revalidation refuses a today-start (INVALID_START_DATE, the J+lead floor), so
    // this state can only arise at the CORE — which is exactly what the date routing lives in.
    const today = new Date().toISOString().slice(0, 10);
    await db
      .update(campaigns)
      .set({ startDate: today, endDate: plusCalendarDays(today, 2) })
      .where(eq(campaigns.id, id));
    const [full] = await db.select().from(campaigns).where(eq(campaigns.id, id)).limit(1);

    const outcome = await activateCampaign({
      campaign: full!,
      contentValidationStatus: 'approved',
      creativeDurationSeconds: 10,
      activatedBy: null,
      fromStatus: 'draft',
    });
    expect(outcome.status).toBe('OK');
    expect((await statusOf(id))?.status).toBe('active');
    expect((await statusOf(id))?.activatedBy).toBeNull();
  });

  it.each([
    ['pending', 'pending'],
    ['rejected', 'pending'],
  ] as const)(
    'a %s spot takes the NORMAL review path (draft → pending, no plan)',
    async (creativeStatus, expected) => {
      const f = await fixture();
      const id = await seedDraft(f.advertiser, f.sector, { creativeStatus });
      mockSession(f.advertiser);
      await add(id);
      const res = await confirm();
      expect(res.statusCode).toBe(200);
      expect((await statusOf(id))?.status).toBe(expected);
      expect(await hasPlan(id)).toBe(false); // the admin dispatches at activation
      expect(res.json<{ launched: unknown[] }>().launched).toEqual([]);
    },
  );

  it('MIXED cart: ONE confirm yields upcoming for the approved spot AND pending for the new one', async () => {
    const f = await fixture();
    const approved = await seedDraft(f.advertiser, f.sector, { creativeStatus: 'approved' });
    const fresh = await seedDraft(f.advertiser, f.sector, { creativeStatus: 'pending' });
    mockSession(f.advertiser);
    await add(approved);
    await add(fresh);

    const res = await confirm();
    expect(res.statusCode).toBe(200);
    expect((await statusOf(approved))?.status).toBe('upcoming');
    expect((await statusOf(fresh))?.status).toBe('pending');
    const body = res.json<{
      launched: { id: string }[];
      pending_review: { id: string }[];
      confirmed: { id: string }[];
    }>();
    expect(body.launched.map((c) => c.id)).toEqual([approved]);
    expect(body.pending_review.map((c) => c.id)).toEqual([fresh]);
    expect(body.confirmed).toHaveLength(2);
    expect(await db.select().from(cartItems).where(eq(cartItems.userId, f.advertiser))).toEqual([]);
  });

  it('the ADMIN QUEUE never sees a skipped campaign (only the new-spot one is pending)', async () => {
    const f = await fixture();
    const approved = await seedDraft(f.advertiser, f.sector, { creativeStatus: 'approved' });
    const fresh = await seedDraft(f.advertiser, f.sector, { creativeStatus: 'pending' });
    mockSession(f.advertiser);
    await add(approved);
    await add(fresh);
    await confirm();

    const admin = await seedUser({ role: 'admin' });
    mockSession(admin, 'admin');
    const queue = await app.inject({ method: 'GET', url: '/api/admin/campaigns?status=pending' });
    const ids = queue.json<{ id: string }[]>().map((c) => c.id);
    expect(ids).toContain(fresh);
    expect(ids).not.toContain(approved);
  });

  it('AMENDMENT — partial skip failure leaves draft-with-frozen-plan; the retry RESUMES it (idempotent, owners notified ONCE)', async () => {
    // One venue = 36 000 facturable for the 2-day window (the E5 hand-computation), C_max 540.
    // Item 1 takes the WHOLE ceiling (540 TND → 36 000 impressions); item 2 (500) passes the
    // PRE-confirm gate (virgin pool) but finds an EMPTY pool at dispatch — item 1's freeze
    // saturated the venue → TOO_THIN (nMin > nMax over the zero-residual pool). A PARTIAL
    // shortfall would be absorbed as a partial allocation (the gate and dispatch share
    // assemblePool's semantics) — only full saturation fails a mid-basket dispatch.
    const advertiser = await seedUser();
    const owner = await seedUser({ role: 'individual_owner' });
    const sector = await ownerSectorId();
    await seedVenue(owner, sector);
    await fund(advertiser, '5000.00');
    const first = await seedDraft(advertiser, sector, {
      creativeStatus: 'approved',
      budget: '540.00',
    });
    const second = await seedDraft(advertiser, sector, {
      creativeStatus: 'approved',
      budget: '500.00',
    });
    mockSession(advertiser);
    expect((await add(first)).statusCode).toBe(200);
    expect((await add(second)).statusCode).toBe(200);

    const ownerNotifs = async () =>
      (
        await db
          .select({ id: notifications.id })
          .from(notifications)
          .where(eq(notifications.userId, owner))
      ).length;

    // Confirm #1 — item 2 fails at dispatch → the WHOLE confirm fails, NOTHING flips.
    const res1 = await confirm();
    expect(res1.statusCode).toBe(400);
    const body1 = res1.json<{ items: { campaign_id: string; reason: string }[] }>();
    expect(body1.items).toEqual([{ campaign_id: second, reason: 'TOO_THIN' }]);
    expect((await statusOf(first))?.status).toBe('draft'); // NOT flipped — the amendment's state
    expect(await hasPlan(first)).toBe(true); // …but its plan froze (irrevocable, invisible)
    expect((await statusOf(second))?.status).toBe('draft');
    expect(await hasPlan(second)).toBe(false);
    expect(
      await db
        .select()
        .from(cartItems)
        .where(inArray(cartItems.campaignId, [first, second])),
    ).toHaveLength(2); // cart intact
    const notifsAfterFirst = await ownerNotifs();
    expect(notifsAfterFirst).toBeGreaterThan(0); // the freeze notified the owner…

    // The gate re-prices item 1 FAIRLY on retry: its own frozen allocations are excluded from
    // the engagement netting, so the ceiling is still the full 540 (not collapsed to 0 — the
    // venue is saturated ENTIRELY by item 1's own plan).
    const [firstRow] = await db.select().from(campaigns).where(eq(campaigns.id, first));
    const cmaxRetry = await computeCampaignCmax(
      {
        id: first,
        startDate: firstRow?.startDate ?? '',
        endDate: firstRow?.endDate ?? '',
        campaignType: 'standard',
      },
      10,
    );
    expect(cmaxRetry.cMaxTnd).toBe(540);

    // Resolve item 2 (remove it), RETRY — item 1 RESUMES via its existing plan and lands upcoming.
    await app.inject({ method: 'DELETE', url: `/api/cart/items/${second}` });
    const res2 = await confirm();
    expect(res2.statusCode).toBe(200);
    expect((await statusOf(first))?.status).toBe('upcoming');
    expect((await statusOf(first))?.activatedBy).toBeNull();
    expect(res2.json<{ launched: { id: string }[] }>().launched.map((c) => c.id)).toEqual([first]);
    expect(await ownerNotifs()).toBe(notifsAfterFirst); // …and NEVER again on the resume
  });

  it('a skip item whose dispatch FAILS blocks the WHOLE confirm — cart intact, nothing pending', async () => {
    // No venue at all → the pool is empty → NO_ELIGIBLE at dispatch time. The C_max gate is
    // bypassed by seeding the cart row directly (the add gate would refuse a 0-ceiling campaign).
    const advertiser = await seedUser();
    const sector = await ownerSectorId();
    await fund(advertiser, '5000.00');
    const approved = await seedDraft(advertiser, sector, { creativeStatus: 'approved' });
    const fresh = await seedDraft(advertiser, sector, { creativeStatus: 'pending' });
    await db.insert(cartItems).values([
      { userId: advertiser, campaignId: approved },
      { userId: advertiser, campaignId: fresh },
    ]);
    mockSession(advertiser);

    const res = await confirm();
    expect(res.statusCode).toBe(400);
    const body = res.json<{ error: string; items: { campaign_id: string; reason: string }[] }>();
    expect(body.error).toBe('CART_CONFIRM_FAILED');
    // The cart's own revalidation catches the zero ceiling first — either way the WHOLE confirm
    // fails on this item and nothing else moves.
    expect(body.items.some((i) => i.campaign_id === approved)).toBe(true);
    expect((await statusOf(approved))?.status).toBe('draft');
    expect((await statusOf(fresh))?.status).toBe('draft'); // the review item never flipped
    expect(
      await db
        .select()
        .from(cartItems)
        .where(inArray(cartItems.campaignId, [approved, fresh])),
    ).toHaveLength(2); // cart intact
  });
});
