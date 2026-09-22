import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import {
  type NewUser,
  businessSectors,
  campaignDispatchAllocation,
  campaignDispatchPlan,
  campaignTargeting,
  campaigns,
  creatives,
  eventAllocations,
  events,
  screenhostAffluence,
  screenhosts,
  users,
} from '../src/db/schema.js';
import { deriveICible } from '../src/lib/activation-service.js';
import { runDispatch } from '../src/lib/dispatch/dispatch-service.js';
import { runEventDispatch } from '../src/lib/event-dispatch/dispatch.js';
import { campaignImpressionsEstimateRoutes } from '../src/routes/campaign-impressions-estimate.js';
import { campaignsRoutes } from '../src/routes/campaigns.js';

import { campaignTiersOf } from './helpers/cpm-config.js';
import { bothHalves, resetAuthTables } from './helpers/db-test-setup.js';
import { seedInstalledScreen } from './helpers/installed-screen.js';

// IMP-UNIT1 (operator ruling B, 2026-09-22) — « we are talking about real audience not billable,
// because billable is real × T ». The advertiser-facing « Impressions prévues » is PHYSICAL (the
// real audience) on BOTH sides of dispatch:
//
//   • before — IMP-EST1's dry-run: Σ créneau.impressions of the simulated plan;
//   • after  — the SAME sum over the frozen plan's non-REFUSE allocations.
//
// It used to be Σ campaign_dispatch_allocation.ii_potentiel, which is FACTURABLE (physical × T,
// T = 0.60 / 0.70 / 0.80) and counted REFUSE allocations: the same label dropped by ~T the moment
// the campaign was dispatched (the reported fixture: 16 000 → ~10 000). THE point of this file is
// the CONTINUITY pin — one campaign, one fixture, the figure before and after dispatch.
//
// The fixture is IMP-EST1's own (defaults F = 300 s, R_min_efficace = 2; the campaign's CPM 15 and
// t_10s 0.60, S = 10 s → R = min(360, 30) = 30):
//   one venue open 8–18 (10 hours), the same value every hour of a weekday, a different value per
//   weekday — Mon 10 · Tue 20 · Wed 30 · Thu 40 (Fri/Sat/Sun never enter a Mon→Thu window).
//   budget 150 TND → I_cible = 10 000 FACTURABLE → 16 000 PHYSICAL créneaux.

type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;
const mockSession = (userId: string, role = 'advertiser'): void => {
  vi.spyOn(auth.api, 'getSession').mockResolvedValue({
    session: {},
    user: { id: userId, role, status: 'approved' },
  } as unknown as GetSessionResult);
};

const WEEKDAY_AFFLUENCE: Record<number, number> = {
  1: 10,
  2: 20,
  3: 30,
  4: 40,
  5: 500,
  6: 600,
  7: 700,
};
const OPEN = 8;
const CLOSE = 18; // 10 broadcastable hours

let seq = 0;
const seedUser = async (values: Partial<NewUser> = {}): Promise<string> => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `impunit1-${seq}@example.com`,
      contactName: `IMP-UNIT1 ${seq}`,
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

/** An approved owner's venue with an installed screen; `affluence(dow, hour)` fills the grid. */
const seedVenue = async (
  affluence: (dow: number, hour: number) => number,
  opts: { openingHour?: number; closingHour?: number } = {},
): Promise<string> => {
  const ownerId = await seedUser({ role: 'individual_owner' });
  const openingHour = opts.openingHour ?? OPEN;
  const closingHour = opts.closingHour ?? CLOSE;
  const [sh] = await db
    .insert(screenhosts)
    .values({
      name: `IMP-UNIT1 Venue ${seq}-${Math.random().toString(16).slice(2, 6)}`,
      ownerId,
      businessSectorId: await ownerSectorId(),
      class: 'premium',
      openingHour,
      closingHour,
      broadcastCapacity: 4,
    })
    .returning();
  const id = sh?.id ?? '';
  const rows = [];
  for (let dow = 1; dow <= 7; dow += 1)
    for (let h = openingHour; h < closingHour; h += 1)
      rows.push({
        screenhostId: id,
        dayOfWeek: dow,
        hour: h,
        estimatedImpressions: affluence(dow, h),
      });
  await db.insert(screenhostAffluence).values(bothHalves(rows));
  await seedInstalledScreen(id);
  return id;
};

const seedCreative = async (advertiserId: string, durationSeconds = 10): Promise<string> => {
  seq += 1;
  const [c] = await db
    .insert(creatives)
    .values({
      advertiserId,
      creativeType: 'video',
      storageKey: `creatives/impunit1/${seq}-${Math.random().toString(16).slice(2)}`,
      durationSeconds,
      validationStatus: 'approved',
    })
    .returning();
  return c?.id ?? '';
};

const seedCampaign = async (
  advertiserId: string,
  over: Partial<typeof campaigns.$inferInsert> = {},
): Promise<string> => {
  const [c] = await db
    .insert(campaigns)
    .values({
      advertiserId,
      name: 'Continuité',
      campaignType: 'standard',
      status: 'draft',
      startDate: '2027-05-03', // Monday
      endDate: '2027-05-06', // Thursday
      requestedBudget: '150.00',
      standardCpmTnd: '15',
      eventCpmTnd: '15',
      t10s: '0.60',
      t20s: '0.70',
      t30s: '0.80',
      creativeId: await seedCreative(advertiserId),
      ...over,
    })
    .returning();
  const id = c?.id ?? '';
  await db
    .insert(campaignTargeting)
    .values({ campaignId: id, categoryId: await ownerSectorId(), class: null });
  return id;
};

interface MineRow {
  id: string;
  name: string;
  planned_impressions: number | null;
}

interface PlacementBody {
  count: number;
  impressions_total: number;
  montant_total_tnd: number;
}

interface EstimateBody {
  status: string;
  source: string | null;
  impressions: number | null;
  venues_count: number | null;
}

describe('IMP-UNIT1 — « Impressions prévues » is the real audience on both sides of dispatch', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    await resetAuthTables();
    app = Fastify({ logger: false });
    await app.register(campaignsRoutes);
    await app.register(campaignImpressionsEstimateRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await sql.end();
  });

  const mine = async (): Promise<MineRow[]> => {
    const res = await app.inject({ method: 'GET', url: '/api/campaigns/mine' });
    expect(res.statusCode).toBe(200);
    return res.json() as MineRow[];
  };

  const prevuesOf = async (campaignId: string): Promise<number | null> =>
    (await mine()).find((r) => r.id === campaignId)?.planned_impressions ?? null;

  /** The drawer's OTHER « impressions prévues » — EV4's placement block for a positioning. */
  const placementOf = async (campaignId: string): Promise<PlacementBody> => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/campaigns/${campaignId}/event-allocations`,
    });
    expect(res.statusCode).toBe(200);
    return res.json() as PlacementBody;
  };

  const estimate = async (campaignId: string): Promise<EstimateBody> => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/campaigns/${campaignId}/impressions-estimate`,
    });
    expect(res.statusCode).toBe(200);
    return res.json() as EstimateBody;
  };

  /** The frozen plan's allocations (whatever their statut), newest plan of the campaign. */
  const allocationsOf = async (campaignId: string) => {
    const [plan] = await db
      .select({ id: campaignDispatchPlan.id })
      .from(campaignDispatchPlan)
      .where(eq(campaignDispatchPlan.campaignId, campaignId));
    return db
      .select({
        id: campaignDispatchAllocation.id,
        screenhostId: campaignDispatchAllocation.screenhostId,
        iiPotentiel: campaignDispatchAllocation.iiPotentiel,
        creneaux: campaignDispatchAllocation.creneaux,
      })
      .from(campaignDispatchAllocation)
      .where(eq(campaignDispatchAllocation.planId, plan?.id ?? ''));
  };

  const dispatchAt = async (campaignId: string, budgetTnd: number, window: [string, string]) => {
    const iCible = deriveICible(budgetTnd, 15);
    expect(iCible).not.toBeNull();
    const result = await runDispatch(
      { id: campaignId, name: 'Continuité', startDate: window[0], endDate: window[1] },
      { iCible: iCible ?? 0, cpm: 15, s: 10, tiers: await campaignTiersOf(campaignId) },
    );
    expect(result.status).toBe('OK');
  };

  it('does NOT drop by T at dispatch: the estimate and /mine carry the same physical figure', async () => {
    await seedVenue((dow) => WEEKDAY_AFFLUENCE[dow] ?? 0);
    const advertiserId = await seedUser();
    mockSession(advertiserId);
    const campaignId = await seedCampaign(advertiserId);

    // Before: IMP-EST1's dry-run — 16 physical reps × 10 hours × (10+20+30+40).
    const before = await estimate(campaignId);
    expect(before.impressions).toBe(16 * 10 * 100);
    // Point 4 of the ruling: a PRE-DISPATCH campaign carries no plan figure on the list wire.
    expect(await prevuesOf(campaignId)).toBeNull();

    await dispatchAt(campaignId, 150, ['2027-05-03', '2027-05-06']);

    const allocations = await allocationsOf(campaignId);
    const physical = allocations.reduce(
      (sum, a) => sum + a.creneaux.reduce((s, c) => s + c.impressions, 0),
      0,
    );
    const facturable = allocations.reduce((sum, a) => sum + a.iiPotentiel, 0);
    // The old wire figure WAS the facturable sum — strictly smaller (physical × T).
    expect(facturable).toBeLessThan(physical);
    expect(physical).toBe(before.impressions);

    // After: the same label, the same number.
    expect(await prevuesOf(campaignId)).toBe(before.impressions);
    expect(await prevuesOf(campaignId)).not.toBe(facturable);
    expect(await estimate(campaignId)).toMatchObject({ source: 'plan', impressions: physical });
  });

  it('a REFUSE allocation is excluded on both sides', async () => {
    await seedVenue((dow, h) => 40 + ((h * 7 + dow * 3) % 23));
    await seedVenue((dow, h) => 25 + ((h * 5 + dow) % 11));
    const advertiserId = await seedUser();
    mockSession(advertiserId);
    const campaignId = await seedCampaign(advertiserId, {
      startDate: '2027-05-03',
      endDate: '2027-05-04',
      requestedBudget: '500.00',
    });

    await dispatchAt(campaignId, 500, ['2027-05-03', '2027-05-04']);
    const allocations = await allocationsOf(campaignId);
    expect(allocations).toHaveLength(2);
    const physicalOf = (a: (typeof allocations)[number]) =>
      a.creneaux.reduce((s, c) => s + c.impressions, 0);
    const [kept, refused] = allocations;
    expect(await prevuesOf(campaignId)).toBe(physicalOf(kept!) + physicalOf(refused!));

    await db
      .update(campaignDispatchAllocation)
      .set({ statutAcceptation: 'REFUSE' })
      .where(eq(campaignDispatchAllocation.id, refused?.id ?? ''));

    expect(await prevuesOf(campaignId)).toBe(physicalOf(kept!));
    expect(await estimate(campaignId)).toMatchObject({
      source: 'plan',
      impressions: physicalOf(kept!),
      venues_count: 1,
    });
  });

  describe('an event positioning behaves the same', () => {
    const KICKOFF = new Date('2027-06-10T20:00:00+01:00');
    const ENDS = new Date('2027-06-10T22:00:00+01:00');

    it('/mine sums the non-REFUSE event allocations — already physical', async () => {
      await seedVenue(() => 100, { openingHour: 8, closingHour: 23 });
      await seedVenue(() => 60, { openingHour: 8, closingHour: 23 });
      const advertiserId = await seedUser();
      mockSession(advertiserId);
      seq += 1;
      const [ev] = await db
        .insert(events)
        .values({
          name: `IMP-UNIT1 Match ${seq}`,
          type: 'sport',
          kickoffAt: KICKOFF,
          endsAt: ENDS,
          source: 'official',
        })
        .returning();
      const campaignId = await seedCampaign(advertiserId, {
        name: 'Positionnement',
        campaignType: 'event',
        eventId: ev?.id ?? null,
        startDate: '2027-06-10',
        endDate: '2027-06-10',
        requestedBudget: '600.00',
      });

      const before = await estimate(campaignId);
      expect(before).toMatchObject({ status: 'ok', source: 'simulation' });
      expect(await prevuesOf(campaignId)).toBeNull();

      const outcome = await runEventDispatch(
        { id: campaignId, name: 'Positionnement', advertiserId, requestedBudget: 600 },
        { id: ev?.id ?? '', kickoffAt: KICKOFF, endsAt: ENDS },
        15,
      );
      expect(outcome.status).toBe('OK');
      const placed = await db
        .select({ id: eventAllocations.id, impressions: eventAllocations.impressionsTotal })
        .from(eventAllocations)
        .where(eq(eventAllocations.campaignId, campaignId));
      expect(placed.length).toBeGreaterThan(1);
      const total = placed.reduce((s, p) => s + p.impressions, 0);
      expect(await prevuesOf(campaignId)).toBe(total);
      expect(before.impressions).toBe(total);
      expect(await placementOf(campaignId)).toMatchObject({
        count: placed.length,
        impressions_total: total,
      });

      const dropped = placed[0];
      await db
        .update(eventAllocations)
        .set({ statut: 'REFUSE' })
        .where(eq(eventAllocations.id, dropped?.id ?? ''));
      expect(await prevuesOf(campaignId)).toBe(total - (dropped?.impressions ?? 0));
      // ONE drawer, ONE figure: MyCampaigns mounts /mine's « Impressions prévues » and this
      // placement header's « impressions prévues » side by side, so the refusal has to leave BOTH.
      // The venue LINES keep listing the refused établissement (with its badge), hence count.
      expect(await placementOf(campaignId)).toMatchObject({
        count: placed.length,
        impressions_total: total - (dropped?.impressions ?? 0),
      });
    });
  });
});
