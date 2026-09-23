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

// IMP-FACT1 (operator, 2026-09-23) — « estimé et prévu should be the same »: what the screencaster
// sees when paying is THE OBJECTIVE, I_cible = ⌊budget × 1000 ÷ CPM⌋ in BILLABLE impressions, at the
// campaign's own CPM. The typical week decides whether it is deliverable (the C_max gate at payment,
// the dry-run) and where — not the number. So the objective is identical before and after dispatch
// and never moves after payment (G1 A): a refusal re-places or refunds, it does not shrink the
// objective. The PHYSICAL fields IMP-UNIT1 pins stay on the wire, unchanged; this file pins the new
// `impressions_objectif` / `objectif` fields.
//
// Fixture = IMP-UNIT1's (CPM 15, t_10s 0.60, S = 10 s, one venue open 8–18, Mon 10 · Tue 20 · Wed 30
// · Thu 40): budget 150 TND → I_cible = 10 000.

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
      email: `impfact1-${seq}@example.com`,
      contactName: `IMP-FACT1 ${seq}`,
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
      name: `IMP-FACT1 Venue ${seq}-${Math.random().toString(16).slice(2, 6)}`,
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
      storageKey: `creatives/impfact1/${seq}-${Math.random().toString(16).slice(2)}`,
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
  planned_impressions: number | null;
  impressions_objectif: number | null;
}

interface EstimateBody {
  status: string;
  source: string | null;
  impressions: number | null;
  objectif: number | null;
}

interface PlacementBody {
  impressions_total: number;
  impressions_objectif: number | null;
  allocations: {
    montant_tnd: number;
    impressions_total: number;
    impressions_facturables: number;
  }[];
}

describe('IMP-FACT1 — « Impressions prévues » is the objective fixed at payment', () => {
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

  const objectifOf = async (campaignId: string): Promise<number | null> => {
    const res = await app.inject({ method: 'GET', url: '/api/campaigns/mine' });
    expect(res.statusCode).toBe(200);
    return (res.json() as MineRow[]).find((r) => r.id === campaignId)?.impressions_objectif ?? null;
  };

  const estimate = async (campaignId: string, budgetTnd?: number): Promise<EstimateBody> => {
    const query = budgetTnd === undefined ? '' : `?budget_tnd=${budgetTnd}`;
    const res = await app.inject({
      method: 'GET',
      url: `/api/campaigns/${campaignId}/impressions-estimate${query}`,
    });
    expect(res.statusCode).toBe(200);
    return res.json() as EstimateBody;
  };

  const placementOf = async (campaignId: string): Promise<PlacementBody> => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/campaigns/${campaignId}/event-allocations`,
    });
    expect(res.statusCode).toBe(200);
    return res.json() as PlacementBody;
  };

  const allocationsOf = async (campaignId: string) => {
    const [plan] = await db
      .select({ id: campaignDispatchPlan.id })
      .from(campaignDispatchPlan)
      .where(eq(campaignDispatchPlan.campaignId, campaignId));
    return db
      .select({
        id: campaignDispatchAllocation.id,
        iiPotentiel: campaignDispatchAllocation.iiPotentiel,
      })
      .from(campaignDispatchAllocation)
      .where(eq(campaignDispatchAllocation.planId, plan?.id ?? ''));
  };

  const dispatch = async (campaignId: string, budgetTnd: number, window: [string, string]) => {
    const result = await runDispatch(
      { id: campaignId, name: 'Continuité', startDate: window[0], endDate: window[1] },
      {
        iCible: deriveICible(budgetTnd, 15) ?? 0,
        cpm: 15,
        s: 10,
        tiers: await campaignTiersOf(campaignId),
      },
    );
    expect(result.status).toBe('OK');
  };

  it('estimée == prévue == ⌊budget × 1000 ÷ CPM⌋ on both sides of dispatch', async () => {
    await seedVenue((dow) => WEEKDAY_AFFLUENCE[dow] ?? 0);
    const advertiserId = await seedUser();
    mockSession(advertiserId);
    const campaignId = await seedCampaign(advertiserId);

    // Before dispatch: the dry-run is deliverable, and the figure is the objective, not the audience.
    const before = await estimate(campaignId);
    expect(before).toMatchObject({ status: 'ok', source: 'simulation', objectif: 10_000 });
    expect(before.impressions).not.toBe(10_000); // the physical audience rides beside it
    expect(await objectifOf(campaignId)).toBe(10_000);

    await dispatch(campaignId, 150, ['2027-05-03', '2027-05-06']);

    // After: the same number — and it IS the plan's billed Σ a_i (the selection caps at I_cible).
    const billed = (await allocationsOf(campaignId)).reduce((s, a) => s + a.iiPotentiel, 0);
    expect(billed).toBe(10_000);
    expect(await objectifOf(campaignId)).toBe(10_000);
    expect(await estimate(campaignId)).toMatchObject({ source: 'plan', objectif: 10_000 });
  });

  it("the wizard's cursor prices the objective at the cursor's budget", async () => {
    await seedVenue((dow) => WEEKDAY_AFFLUENCE[dow] ?? 0);
    const advertiserId = await seedUser();
    mockSession(advertiserId);
    const campaignId = await seedCampaign(advertiserId);
    expect(await estimate(campaignId, 120)).toMatchObject({ status: 'ok', objectif: 8_000 });
  });

  it('an undeliverable estimate carries no objective (« — » + its reason)', async () => {
    const advertiserId = await seedUser();
    mockSession(advertiserId);
    const campaignId = await seedCampaign(advertiserId, { startDate: null, endDate: null });
    expect(await estimate(campaignId)).toMatchObject({ status: 'no_dates', objectif: null });
  });

  it('G1 — a refusal never shrinks the objective', async () => {
    await seedVenue((dow, h) => 40 + ((h * 7 + dow * 3) % 23));
    await seedVenue((dow, h) => 25 + ((h * 5 + dow) % 11));
    const advertiserId = await seedUser();
    mockSession(advertiserId);
    const campaignId = await seedCampaign(advertiserId, {
      startDate: '2027-05-03',
      endDate: '2027-05-04',
      requestedBudget: '500.00',
    });
    await dispatch(campaignId, 500, ['2027-05-03', '2027-05-04']);
    const [, refused] = await allocationsOf(campaignId);
    expect(refused).toBeDefined();
    await db
      .update(campaignDispatchAllocation)
      .set({ statutAcceptation: 'REFUSE' })
      .where(eq(campaignDispatchAllocation.id, refused?.id ?? ''));

    const objective = deriveICible(500, 15);
    expect(await objectifOf(campaignId)).toBe(objective);
    expect(await estimate(campaignId)).toMatchObject({ source: 'plan', objectif: objective });
  });

  it('an event positioning: the objective at CPM_evt, and each venue line in billable impressions', async () => {
    const KICKOFF = new Date('2027-06-10T20:00:00+01:00');
    const ENDS = new Date('2027-06-10T22:00:00+01:00');
    await seedVenue(() => 100, { openingHour: 8, closingHour: 23 });
    await seedVenue(() => 60, { openingHour: 8, closingHour: 23 });
    const advertiserId = await seedUser();
    mockSession(advertiserId);
    seq += 1;
    const [ev] = await db
      .insert(events)
      .values({
        name: `IMP-FACT1 Match ${seq}`,
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

    expect(await estimate(campaignId)).toMatchObject({ status: 'ok', objectif: 40_000 });
    expect(await objectifOf(campaignId)).toBe(40_000);

    const outcome = await runEventDispatch(
      { id: campaignId, name: 'Positionnement', advertiserId, requestedBudget: 600 },
      { id: ev?.id ?? '', kickoffAt: KICKOFF, endsAt: ENDS },
      15,
    );
    expect(outcome.status).toBe('OK');

    const placement = await placementOf(campaignId);
    expect(placement.impressions_objectif).toBe(40_000);
    expect(await objectifOf(campaignId)).toBe(40_000);
    expect(await estimate(campaignId)).toMatchObject({ source: 'plan', objectif: 40_000 });
    // Each line: the CHARGEABLE share (the overshoot past I_cible is free delivery), never more than
    // the venue's physical placement, and Σ lines = what the montants bill.
    for (const line of placement.allocations) {
      expect(line.impressions_facturables).toBe(Math.round((line.montant_tnd * 1000) / 15));
      expect(line.impressions_facturables).toBeLessThanOrEqual(line.impressions_total);
    }
    const billed = placement.allocations.reduce((s, l) => s + l.impressions_facturables, 0);
    expect(billed).toBeLessThanOrEqual(40_000);
  });
});
