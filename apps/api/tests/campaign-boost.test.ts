import { and, eq, inArray } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import {
  type NewUser,
  businessSectors,
  campaignBoosts,
  campaignDispatchAllocation,
  campaignDispatchPlan,
  campaignTargeting,
  campaignZones,
  campaigns,
  creatives,
  notifications,
  recharges,
  screenhostAffluence,
  screenhosts,
  users,
  zones,
} from '../src/db/schema.js';
import { activateCampaign } from '../src/lib/activation-service.js';
import { plusCalendarDays, premiereDateDisponible } from '../src/lib/campaign-dates.js';
import { getDispatchConfig } from '../src/lib/dispatch/config.js';
import { campaignBoostRoutes } from '../src/routes/campaign-boost.js';

import { resetAuthTables, bothHalves } from './helpers/db-test-setup.js';
import { seedInstalledScreen } from './helpers/installed-screen.js';

// CF-B1 (spec §3.3) — « Booster »: strictly additive on Active/À venir; the complementary budget
// dispatches over the MERGED perimeter under the same rules. Real Postgres; session mocked. The
// one test zone is swept in afterEach (FK detach first — the exact-seed-count footgun); NO
// business_sectors rows are added (the canonical owner sectors are the fixture).

type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;

const buildApp = () => Fastify({ logger: false });

const mockSession = (userId: string, role = 'advertiser'): void => {
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
      email: `boost${seq}@example.com`,
      contactName: `User ${seq}`,
      role: 'advertiser',
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

const ownerSectorIds = async (): Promise<[string, string]> => {
  const rows = await db
    .select({ id: businessSectors.id })
    .from(businessSectors)
    .where(eq(businessSectors.audience, 'owner'))
    .orderBy(businessSectors.name)
    .limit(2);
  return [rows[0]?.id ?? '', rows[1]?.id ?? ''];
};

const seedVenue = async (
  ownerId: string,
  categoryId: string,
  opts: { zoneId?: string | null; affluence?: number } = {},
): Promise<string> => {
  seq += 1;
  const [sh] = await db
    .insert(screenhosts)
    .values({
      name: `Boost Venue ${seq}`,
      ownerId,
      businessSectorId: categoryId,
      class: 'premium',
      openingHour: 8,
      closingHour: 18,
      broadcastCapacity: 4,
      zoneId: opts.zoneId ?? null,
    })
    .returning();
  const id = sh?.id ?? '';
  const rows = [];
  for (const dow of [1, 2, 3, 4, 5, 6, 7])
    for (let h = 8; h < 18; h += 1)
      rows.push({
        screenhostId: id,
        dayOfWeek: dow,
        hour: h,
        estimatedImpressions: opts.affluence ?? 100,
      });
  await db.insert(screenhostAffluence).values(bothHalves(rows));
  await seedInstalledScreen(id);
  return id;
};

const fund = (advertiserId: string, amountTnd: string) =>
  db.insert(recharges).values({
    advertiserId,
    amountTnd,
    status: 'confirmed',
    reference: `BOOST-${seq}-${Math.random().toString(16).slice(2, 8)}`,
  });

/** An ACTIVATED (upcoming) campaign: draft seeded → the activation core runs it for real. */
const seedActivated = async (
  advertiserId: string,
  categoryId: string,
  opts: { budget?: string; zoneId?: string } = {},
): Promise<string> => {
  seq += 1;
  const lead = (await getDispatchConfig()).campaignLeadWorkingDays;
  const start = premiereDateDisponible(new Date(), lead);
  const [creative] = await db
    .insert(creatives)
    .values({
      advertiserId,
      creativeType: 'video',
      storageKey: `creatives/boost/${seq}-${Math.random().toString(16).slice(2)}`,
      durationSeconds: 10,
      validationStatus: 'approved',
    })
    .returning();
  const [c] = await db
    .insert(campaigns)
    .values({
      advertiserId,
      name: `Boost campagne ${seq}`,
      campaignType: 'standard',
      status: 'draft',
      startDate: start,
      endDate: plusCalendarDays(start, 1),
      requestedBudget: opts.budget ?? '150.00',
      creativeId: creative?.id ?? null,
    })
    .returning();
  const id = c?.id ?? '';
  await db.insert(campaignTargeting).values({ campaignId: id, categoryId, class: null });
  if (opts.zoneId) await db.insert(campaignZones).values({ campaignId: id, zoneId: opts.zoneId });
  const [full] = await db.select().from(campaigns).where(eq(campaigns.id, id)).limit(1);
  const outcome = await activateCampaign({
    campaign: full!,
    contentValidationStatus: 'approved',
    creativeDurationSeconds: 10,
    activatedBy: null,
    fromStatus: 'draft',
  });
  if (outcome.status !== 'OK') throw new Error(`fixture activation failed: ${outcome.status}`);
  return id;
};

describe('CF-B1 — Booster (real Postgres)', () => {
  let app: ReturnType<typeof buildApp>;
  const createdZoneIds: string[] = [];

  beforeEach(async () => {
    await resetAuthTables();
    app = buildApp();
    await app.register(campaignBoostRoutes);
    await app.ready();
  });

  afterEach(async () => {
    if (createdZoneIds.length > 0) {
      await db
        .update(screenhosts)
        .set({ zoneId: null })
        .where(inArray(screenhosts.zoneId, createdZoneIds));
      await db.delete(campaignZones).where(inArray(campaignZones.zoneId, createdZoneIds));
      await db.delete(zones).where(inArray(zones.id, createdZoneIds));
      createdZoneIds.length = 0;
    }
    await app.close();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await sql.end();
  });

  const preview = (id: string, body: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: `/api/campaigns/${id}/boost/preview`, payload: body });
  const apply = (id: string, body: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: `/api/campaigns/${id}/boost`, payload: body });

  const campaignRow = async (id: string) => {
    const [row] = await db.select().from(campaigns).where(eq(campaigns.id, id)).limit(1);
    return row;
  };
  const targetingOf = (id: string) =>
    db
      .select({ categoryId: campaignTargeting.categoryId })
      .from(campaignTargeting)
      .where(eq(campaignTargeting.campaignId, id));
  const allocationsOf = async (id: string) => {
    const [plan] = await db
      .select({ id: campaignDispatchPlan.id })
      .from(campaignDispatchPlan)
      .where(eq(campaignDispatchPlan.campaignId, id));
    return db
      .select()
      .from(campaignDispatchAllocation)
      .where(eq(campaignDispatchAllocation.planId, plan?.id ?? ''));
  };

  // The base fixture: sector A venue engaged by the campaign; sector B venue = boost headroom.
  const fixture = async () => {
    const advertiser = await seedUser();
    const owner = await seedUser({ role: 'individual_owner' });
    const [sectorA, sectorB] = await ownerSectorIds();
    const venueA = await seedVenue(owner, sectorA);
    const venueB = await seedVenue(owner, sectorB);
    await fund(advertiser, '10000.00');
    const campaignId = await seedActivated(advertiser, sectorA);
    return { advertiser, owner, sectorA, sectorB, venueA, venueB, campaignId };
  };

  describe('preview', () => {
    it('a CATEGORY addition alone prices the added perimeter (own allocations engaged)', async () => {
      const f = await fixture();
      mockSession(f.advertiser);
      const res = await preview(f.campaignId, { added_category_ids: [f.sectorB] });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ c_max_boost_tnd: number; eligible_count: number }>();
      // Venue B is virgin (36 000 fact → 540); venue A carries the campaign's OWN allocation as
      // ENGAGEMENT (ruling 4) — the boost ceiling is 540 + venue A's residual, both venues in.
      expect(body.eligible_count).toBe(2);
      expect(body.c_max_boost_tnd).toBeGreaterThanOrEqual(540);
      expect(body.c_max_boost_tnd).toBeLessThan(1080); // venue A is NOT priced as virgin
      // NOTHING persisted by a preview:
      expect(await targetingOf(f.campaignId)).toHaveLength(1);
    });

    it('an END-EXTENSION alone prices the widened window; a ZONE alone prices the added zone', async () => {
      const f = await fixture();
      mockSession(f.advertiser);
      const row = await campaignRow(f.campaignId);
      const resEnd = await preview(f.campaignId, {
        new_end_date: plusCalendarDays(row?.endDate ?? '', 2),
      });
      expect(resEnd.statusCode).toBe(200);
      expect(resEnd.json<{ c_max_boost_tnd: number }>().c_max_boost_tnd).toBeGreaterThan(0);

      // Zones: the campaign must already narrow the zone axis for an addition to broaden it.
      const [z1] = await db
        .insert(zones)
        .values({ name: `boost-z1-${seq}` })
        .returning();
      const [z2] = await db
        .insert(zones)
        .values({ name: `boost-z2-${seq}` })
        .returning();
      createdZoneIds.push(z1?.id ?? '', z2?.id ?? '');
      await db.update(screenhosts).set({ zoneId: z1?.id }).where(eq(screenhosts.id, f.venueA));
      await db.update(screenhosts).set({ zoneId: z2?.id }).where(eq(screenhosts.id, f.venueB));
      await db.insert(campaignZones).values({ campaignId: f.campaignId, zoneId: z1?.id ?? '' });
      const resZone = await preview(f.campaignId, { added_zone_ids: [z2?.id] });
      expect(resZone.statusCode).toBe(200);
      expect(resZone.json<{ c_max_boost_tnd: number }>().c_max_boost_tnd).toBeGreaterThan(0);
    });

    it('COMBINED additions price together; refusal matrix: no-addition, foreign, wrong status, non-additive', async () => {
      const f = await fixture();
      mockSession(f.advertiser);
      const row = await campaignRow(f.campaignId);
      const combined = await preview(f.campaignId, {
        added_category_ids: [f.sectorB],
        new_end_date: plusCalendarDays(row?.endDate ?? '', 3),
      });
      expect(combined.statusCode).toBe(200);

      // NO addition (same end date = not an addition).
      expect((await preview(f.campaignId, {})).json<{ error: string }>().error).toBe('NO_ADDITION');
      expect(
        (await preview(f.campaignId, { new_end_date: row?.endDate })).json<{ error: string }>()
          .error,
      ).toBe('NO_ADDITION');
      // End before the original: never below the origin.
      expect(
        (await preview(f.campaignId, { new_end_date: row?.startDate })).json<{ error: string }>()
          .error,
      ).toBe('INVALID_END_DATE');
      // Already-targeted category; whole-network axes refuse additions (E5.1 — adding NARROWS).
      expect(
        (await preview(f.campaignId, { added_category_ids: [f.sectorA] })).json<{ error: string }>()
          .error,
      ).toBe('CATEGORY_ALREADY_TARGETED');
      expect(
        (
          await preview(f.campaignId, { added_zone_ids: ['00000000-0000-4000-8000-000000000000'] })
        ).json<{ error: string }>().error,
      ).toBe('ZONES_WHOLE_NETWORK');

      // Foreign campaign ≡ missing.
      const stranger = await seedUser();
      mockSession(stranger);
      expect((await preview(f.campaignId, { added_category_ids: [f.sectorB] })).statusCode).toBe(
        404,
      );

      // Wrong status: a draft can't boost.
      mockSession(f.advertiser);
      const [draft] = await db
        .insert(campaigns)
        .values({
          advertiserId: f.advertiser,
          name: 'Boost draft',
          campaignType: 'standard',
          status: 'draft',
        })
        .returning();
      const wrong = await preview(draft?.id ?? '', { added_category_ids: [f.sectorB] });
      expect(wrong.statusCode).toBe(409);
      expect(wrong.json<{ error: string }>().error).toBe('NOT_BOOSTABLE');
    });
  });

  describe('apply', () => {
    it('HAPPY PATH (upcoming): category addition places EN_ATTENTE on the NEW venue, budget grows, the boost row records', async () => {
      const f = await fixture();
      mockSession(f.advertiser);
      const before = await campaignRow(f.campaignId);
      // 500 TND → V = 33 333 > venue A's residual (26 000): selection CONCENTRATES first (pas un
      // de plus), so the spill is what forces the NEW venue open — the engine's real semantics.
      const res = await apply(f.campaignId, { added_category_ids: [f.sectorB], amount_tnd: 500 });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ boost_id: string; placed_fact: number; v_fact: number }>();
      expect(body.v_fact).toBe(Math.floor((500 * 1000) / 15));
      expect(body.placed_fact).toBeGreaterThan(0);

      // The NEW venue's allocation is EN_ATTENTE (consent never bypassed) with future créneaux.
      const allocs = await allocationsOf(f.campaignId);
      const added = allocs.find((a) => a.screenhostId === f.venueB);
      expect(added?.statutAcceptation).toBe('EN_ATTENTE');
      expect(added?.creneaux.length).toBeGreaterThan(0);

      // Strictly additive state: targeting appended (class null), budget grew by the amount.
      expect(await targetingOf(f.campaignId)).toHaveLength(2);
      const after = await campaignRow(f.campaignId);
      expect(Number(after?.requestedBudget)).toBe(Number(before?.requestedBudget) + 500);
      expect(after?.status).toBe('upcoming'); // status untouched
      expect(after?.startDate).toBe(before?.startDate); // start frozen

      // The audit row.
      const [boost] = await db
        .select()
        .from(campaignBoosts)
        .where(eq(campaignBoosts.campaignId, f.campaignId));
      expect(boost?.addedCategoryIds).toEqual([f.sectorB]);
      expect(Number(boost?.amountTnd)).toBe(500);
      expect(boost?.placedFact).toBe(body.placed_fact);
      expect(boost?.appliedBy).toBe(f.advertiser);

      // The owner was notified (the dispatch producer pattern).
      const notifs = await db
        .select()
        .from(notifications)
        .where(and(eq(notifications.userId, f.owner), eq(notifications.campaignId, f.campaignId)));
      expect(notifs.length).toBeGreaterThan(0);
    });

    it('ACTIVE campaign: placements are FUTURE-ONLY créneaux (the E6 rule, pinned)', async () => {
      const f = await fixture();
      // Force the campaign ACTIVE with a window that started YESTERDAY.
      const today = new Date().toISOString().slice(0, 10);
      const yesterday = plusCalendarDays(today, -1);
      await db
        .update(campaigns)
        .set({ status: 'active', startDate: yesterday, endDate: plusCalendarDays(today, 3) })
        .where(eq(campaigns.id, f.campaignId));
      mockSession(f.advertiser);

      const res = await apply(f.campaignId, { added_category_ids: [f.sectorB], amount_tnd: 150 });
      expect(res.statusCode).toBe(200);
      // The E6 pin: NOTHING lands on the elapsed part of the window — every créneau of every
      // allocation (the original ones were placed on the still-future premiere window; the boost
      // delta is future-filtered) is ≥ today, and today's are strictly later than the current hour.
      const allocs = await allocationsOf(f.campaignId);
      const touched = allocs.filter((a) => a.statutAcceptation === 'EN_ATTENTE');
      expect(touched.length).toBeGreaterThan(0);
      const nowHour = new Date().getHours();
      for (const a of allocs) {
        for (const c of a.creneaux) {
          expect(c.date >= yesterday).toBe(true);
          expect(c.date === yesterday).toBe(false); // the elapsed day received NOTHING
          if (c.date === today) expect(c.hour).toBeGreaterThan(nowHour);
        }
      }
      expect((await campaignRow(f.campaignId))?.status).toBe('active');
    });

    it('MERGE = RE-CONSENT (E3): an ACCEPTE absorber flips EN_ATTENTE and is re-notified', async () => {
      const f = await fixture();
      // The owner accepted the original allocation on venue A.
      const allocsBefore = await allocationsOf(f.campaignId);
      const original = allocsBefore.find((a) => a.screenhostId === f.venueA);
      await db
        .update(campaignDispatchAllocation)
        .set({ statutAcceptation: 'ACCEPTE' })
        .where(eq(campaignDispatchAllocation.id, original?.id ?? ''));
      const notifsBefore = (
        await db.select().from(notifications).where(eq(notifications.userId, f.owner))
      ).length;

      // Extend the end — venue A (already allocated) absorbs boost volume → MERGE.
      const row = await campaignRow(f.campaignId);
      mockSession(f.advertiser);
      const res = await apply(f.campaignId, {
        new_end_date: plusCalendarDays(row?.endDate ?? '', 3),
        amount_tnd: 150,
      });
      expect(res.statusCode).toBe(200);

      const allocsAfter = await allocationsOf(f.campaignId);
      const merged = allocsAfter.find((a) => a.screenhostId === f.venueA);
      expect(merged?.statutAcceptation).toBe('EN_ATTENTE'); // the deal changed — re-consent
      expect(merged?.iiPotentiel).toBeGreaterThan(original?.iiPotentiel ?? 0);
      expect(merged?.creneaux.length).toBeGreaterThan(original?.creneaux.length ?? 0);
      const notifsAfter = (
        await db.select().from(notifications).where(eq(notifications.userId, f.owner))
      ).length;
      expect(notifsAfter).toBeGreaterThan(notifsBefore); // re-notified
      expect((await campaignRow(f.campaignId))?.endDate).toBe(
        plusCalendarDays(row?.endDate ?? '', 3),
      );
    });

    it('ATOMICITY: a TOO_THIN boost persists NOTHING (end/zones/targeting/budget unchanged)', async () => {
      const f = await fixture();
      // Saturate venue B entirely with a second campaign so the added-category pool has zero
      // residual → the boost's own dispatch refuses.
      const other = await seedUser();
      await fund(other, '10000.00');
      const eater = await seedActivated(other, f.sectorB, { budget: '540.00' });
      expect(eater).toBeTruthy();
      // …and venue A's residual (26 000 fact = 390 TND) goes to a second eater, so the boost's
      // merged pool prices to ZERO — the refusal fires with the additions already written in-tx,
      // which is exactly what the rollback must undo.
      const other2 = await seedUser();
      await fund(other2, '10000.00');
      const eater2 = await seedActivated(other2, f.sectorA, { budget: '390.00' });
      expect(eater2).toBeTruthy();

      mockSession(f.advertiser);
      const before = await campaignRow(f.campaignId);
      const targetingBefore = await targetingOf(f.campaignId);
      const allocsBefore = await allocationsOf(f.campaignId);

      const res = await apply(f.campaignId, { added_category_ids: [f.sectorB], amount_tnd: 200 });
      expect(res.statusCode).toBe(400);
      expect(['TOO_THIN', 'NO_ELIGIBLE', 'BUDGET_EXCEEDS_CMAX']).toContain(
        res.json<{ error: string }>().error,
      );

      // NOTHING moved.
      const after = await campaignRow(f.campaignId);
      expect(after?.endDate).toBe(before?.endDate);
      expect(Number(after?.requestedBudget)).toBe(Number(before?.requestedBudget));
      expect(await targetingOf(f.campaignId)).toHaveLength(targetingBefore.length);
      expect((await allocationsOf(f.campaignId)).length).toBe(allocsBefore.length);
      expect(
        await db.select().from(campaignBoosts).where(eq(campaignBoosts.campaignId, f.campaignId)),
      ).toEqual([]);
    });

    it('the money gates: floor 100, the live boost ceiling, the solde HT', async () => {
      const f = await fixture();
      mockSession(f.advertiser);
      expect(
        (await apply(f.campaignId, { added_category_ids: [f.sectorB], amount_tnd: 99 })).json<{
          error: string;
        }>().error,
      ).toBe('BUDGET_BELOW_MINIMUM');
      expect(
        (await apply(f.campaignId, { added_category_ids: [f.sectorB], amount_tnd: 99999 })).json<{
          error: string;
        }>().error,
      ).toBe('BUDGET_EXCEEDS_CMAX');

      // A barely-funded advertiser: ceiling admits the ask, the solde does not. FIX2 — available
      // is now SPENDABLE: the 150 funded is entirely engaged by the active (unsettled) campaign
      // being boosted, so disponible reads 0 — the boost is NEW money on top of the engagement.
      const poor = await seedUser();
      await fund(poor, '150.00');
      const poorCampaign = await seedActivated(poor, f.sectorA, { budget: '150.00' });
      mockSession(poor);
      const res = await apply(poorCampaign, { added_category_ids: [f.sectorB], amount_tnd: 200 });
      expect(res.json<{ error: string }>().error).toBe('INSUFFICIENT_BALANCE');
      expect(res.json<{ available_tnd: number }>().available_tnd).toBe(0);
    });

    it('SETTLEMENT COMPATIBILITY: a boosted plan reads like any other (added allocation carries revenu/creneaux for reconcile)', async () => {
      const f = await fixture();
      mockSession(f.advertiser);
      await apply(f.campaignId, { added_category_ids: [f.sectorB], amount_tnd: 200 });
      const allocs = await allocationsOf(f.campaignId);
      // The reconcile engine reads (iiPotentiel, rI, revenuPrevisionnel, creneaux,
      // statutAcceptation) uniformly — the boost-added row carries the SAME shape and its
      // revenue matches its facturable volume at the plan's CPM (the conservation identity's
      // per-row input).
      for (const a of allocs) {
        expect(a.iiPotentiel).toBeGreaterThan(0);
        expect(a.rI).toBeGreaterThan(0);
        expect(Number(a.revenuPrevisionnel)).toBeCloseTo((a.iiPotentiel * 15) / 1000, 2);
        expect(Array.isArray(a.creneaux)).toBe(true);
        expect(['EN_ATTENTE', 'ACCEPTE', 'REFUSE']).toContain(a.statutAcceptation);
      }
    });
  });
});
