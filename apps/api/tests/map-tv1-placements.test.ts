import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { db, sql } from '../src/db/client.js';
import {
  campaignDispatchAllocation,
  campaignDispatchPlan,
  eventAllocations,
} from '../src/db/schema.js';
import { runBoost } from '../src/lib/boost.js';
import { computeCampaignCmax } from '../src/lib/campaign-cmax.js';
import { runRefusalCascade } from '../src/lib/dispatch/cascade.js';
import { campaignTTiers } from '../src/lib/dispatch/config.js';
import { runDispatch } from '../src/lib/dispatch/dispatch-service.js';
import { runEventDispatch, runEventRefusalCascade } from '../src/lib/event-dispatch/dispatch.js';

import { seedApprovedOwner } from './helpers/approved-owner.js';
import { resetAuthTables } from './helpers/db-test-setup.js';
import {
  TUESDAY,
  WEDNESDAY,
  eventSector,
  seedCampaign,
  seedMatrix,
  seedPositioning,
} from './helpers/installed-screen-matrix.js';

// MAP-TV1 (operator ruling 2026-09-21, M1 A · M2 A) — the NEW placements land only on a venue
// with an installed screen: dispatch, the refusal cascade, the booster, event dispatch and the
// event refusal cascade, on the five-venue matrix (tests/helpers/installed-screen-matrix.ts).
// Each case asks for MORE than the three installed venues (c)(d)(e) can carry, so an engine
// without the gate would have to open (a) or (b) — the assertion is that it never does.
//
// Redispatch reads the same pool and adds its own, stricter liveness rule (a screen seen within
// REDISPATCH_HEARTBEAT_TOLERANCE_MS — e6-redispatch.test.ts), so it is gated twice. The event
// booster reads computeEventCmax + assembleEventPool, pinned in map-tv1-installed-screen.test.ts.

const EVENT_CPM = 15;
/** The day before the standard window: the booster places forward from here. */
const BOOST_NOW = new Date('2023-12-31T09:00:00+01:00');

const standardAllocations = async (campaignId: string) =>
  db
    .select({
      id: campaignDispatchAllocation.id,
      screenhostId: campaignDispatchAllocation.screenhostId,
      iiPotentiel: campaignDispatchAllocation.iiPotentiel,
    })
    .from(campaignDispatchAllocation)
    .innerJoin(campaignDispatchPlan, eq(campaignDispatchPlan.id, campaignDispatchAllocation.planId))
    .where(eq(campaignDispatchPlan.campaignId, campaignId));

const venuesOf = (rows: readonly { screenhostId: string }[]): string[] =>
  [...new Set(rows.map((r) => r.screenhostId))].sort();

describe('MAP-TV1 — new placements land only on installed venues (real Postgres)', () => {
  beforeEach(async () => {
    await resetAuthTables();
  });
  afterAll(async () => {
    await sql.end();
  });

  /** A standard campaign dispatched at 80 % of the three installed venues' capacity. */
  const dispatchedOverInstalled = async () => {
    const v = await seedMatrix(await eventSector());
    const campaign = await seedCampaign(await seedApprovedOwner({ role: 'advertiser' }));
    const cmax = await computeCampaignCmax(campaign, 10);
    const result = await runDispatch(campaign, {
      iCible: Math.floor(cmax.iMaxFacturable * 0.8),
      cpm: cmax.cpmTnd,
      s: 10,
      tiers: campaignTTiers(campaign),
    });
    expect(result.status).toBe('OK');
    return { v, campaign };
  };

  it('dispatch places only on (c)(d)(e), even when it needs every venue it can get', async () => {
    const { v, campaign } = await dispatchedOverInstalled();
    // 80 % of three venues' capacity: two venues cannot carry it, so all three are used.
    expect(venuesOf(await standardAllocations(campaign.id))).toEqual(v.in);
  });

  it('the refusal cascade re-places a refused share onto installed venues only', async () => {
    const { v, campaign } = await dispatchedOverInstalled();
    const [plan] = await db
      .select()
      .from(campaignDispatchPlan)
      .where(eq(campaignDispatchPlan.campaignId, campaign.id));
    const [refused] = await standardAllocations(campaign.id);
    if (!plan || !refused) throw new Error('the dispatch left no plan or allocation');

    const outcome = await db.transaction(async (tx) => {
      await tx
        .update(campaignDispatchAllocation)
        .set({ statutAcceptation: 'REFUSE' })
        .where(eq(campaignDispatchAllocation.id, refused.id));
      return runRefusalCascade(tx, { plan, campaign, refused });
    });

    // The two other installed venues hold 80 % of the network already: they cannot absorb the
    // whole share, and (a)(b) — with all their capacity free — are never opened for the rest.
    expect(outcome.absorbed).toBeLessThan(outcome.v);
    expect(outcome.createdAllocations).toBe(0);
    const after = venuesOf(await standardAllocations(campaign.id));
    expect(after).toEqual(v.in);
  });

  it('the booster prices and would place only on (c)(d)(e)', async () => {
    const v = await seedMatrix(await eventSector());
    const advertiserId = await seedApprovedOwner({ role: 'advertiser' });
    const campaign = await seedCampaign(advertiserId, { endDate: TUESDAY, status: 'upcoming' });
    await db.insert(campaignDispatchPlan).values({
      campaignId: campaign.id,
      iCible: 10_000,
      cpm: '15',
      sSpotSeconds: 10,
      tTierCoef: '0.6',
      seuilDiffusable: 1334,
      sMin: '20',
      gJour: '3.3333',
      fMaxSeconds: 300,
      rMinEfficace: 2,
      couvert: 10_000,
      nMin: 1,
      nMax: 10,
      nRetenus: 0,
    });

    const preview = await runBoost(
      campaign.id,
      advertiserId,
      { newEndDate: WEDNESDAY },
      { previewOnly: true, now: BOOST_NOW },
    );
    expect(preview.status).toBe('PREVIEW');
    if (preview.status !== 'PREVIEW') return;
    expect(preview.eligibleCount).toBe(v.in.length);
    expect(preview.cMaxBoostTnd).toBeGreaterThan(0);
  });

  it('event dispatch and the event refusal cascade place only on (c)(d)(e)', async () => {
    const v = await seedMatrix(await eventSector());
    const advertiserId = await seedApprovedOwner({ role: 'advertiser' });
    const { positioningId, event } = await seedPositioning(advertiserId);

    // Each installed venue is worth 6 blocs × 100 pers/h × 20 at CPM 15 = 180 TND: 700 TND needs
    // a fourth venue. The gated pool has none → a PARTIAL fill over the three installed ones.
    const dispatched = await runEventDispatch(
      { id: positioningId, name: 'MAP-TV1', advertiserId, requestedBudget: 700 },
      event,
      EVENT_CPM,
    );
    expect(dispatched).toMatchObject({ status: 'OK', partial: true });
    const placed = await db
      .select()
      .from(eventAllocations)
      .where(eq(eventAllocations.campaignId, positioningId));
    expect(venuesOf(placed)).toEqual(v.in);

    // An owner refuses: every installed venue already holds a share, so there is nowhere left.
    const [refused] = placed;
    if (!refused) throw new Error('event dispatch placed nothing');
    await db
      .update(eventAllocations)
      .set({ statut: 'REFUSE' })
      .where(eq(eventAllocations.id, refused.id));
    const cascade = await runEventRefusalCascade(
      db,
      { id: positioningId, name: 'MAP-TV1' },
      event,
      { screenhostId: refused.screenhostId, impressionsTotal: refused.impressionsTotal },
      EVENT_CPM,
    );
    expect(cascade).toEqual({ status: 'NO_POOL', allocationIds: [] });
    const after = await db
      .select({ screenhostId: eventAllocations.screenhostId })
      .from(eventAllocations)
      .where(eq(eventAllocations.campaignId, positioningId));
    expect(venuesOf(after)).toEqual(v.in);
  });
});
