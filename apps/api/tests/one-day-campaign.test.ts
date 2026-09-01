import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { db, sql } from '../src/db/client.js';
import {
  type NewUser,
  businessSectors,
  campaignDispatchAllocation,
  campaignDispatchPlan,
  campaignTargeting,
  campaigns,
  creatives,
  screenhostAffluence,
  screenhosts,
  users,
} from '../src/db/schema.js';
import { runDispatch } from '../src/lib/dispatch/dispatch-service.js';

import { resetAuthTables, bothHalves } from './helpers/db-test-setup.js';

// EV1 rider (the CF-HF3 watch-item, ruled LEGAL): a ONE-DAY campaign (start = end). The web's
// Période step was the only blocker in the chain — the server never mirrored the strict < and the
// engine's fenêtre is inclusive. This pins the server half end-to-end: a start = end campaign
// dispatches over a 1-day window and every créneau lands on that single date.
// No business_sectors/zones rows added (the fixture footgun).

const DAY = '2027-05-03'; // a Monday (dow 1)

let seq = 0;
const seedUser = async (values: Partial<NewUser> = {}): Promise<string> => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `oneday-${seq}@example.com`,
      contactName: `OneDay ${seq}`,
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

describe('one-day campaign (start = end) — the server chain', () => {
  beforeEach(async () => {
    await resetAuthTables();
  });

  afterAll(async () => {
    await sql.end();
  });

  it('dispatches over a 1-day window: plan frozen, every créneau on the single date', async () => {
    const [sector] = await db
      .select({ id: businessSectors.id })
      .from(businessSectors)
      .where(eq(businessSectors.audience, 'owner'))
      .limit(1);
    const ownerId = await seedUser({ role: 'individual_owner' });
    const [venue] = await db
      .insert(screenhosts)
      .values({
        name: 'One-Day Venue',
        ownerId,
        businessSectorId: sector?.id ?? '',
        class: 'premium' as never,
        sps: '80',
        openingHour: 8,
        closingHour: 18,
        broadcastCapacity: 4,
      })
      .returning();
    await db.insert(screenhostAffluence).values(
      bothHalves(
        Array.from({ length: 10 }, (_, i) => ({
          screenhostId: venue?.id ?? '',
          dayOfWeek: 1,
          hour: 8 + i,
          estimatedImpressions: 100,
        })),
      ),
    );

    const advertiserId = await seedUser({ role: 'advertiser' });
    const [creative] = await db
      .insert(creatives)
      .values({
        advertiserId,
        creativeType: 'video',
        storageKey: `creatives/oneday/${seq}`,
        durationSeconds: 10,
        validationStatus: 'approved',
      })
      .returning();
    const [campaign] = await db
      .insert(campaigns)
      .values({
        advertiserId,
        name: 'Campagne un jour',
        campaignType: 'standard',
        status: 'pending',
        startDate: DAY,
        endDate: DAY, // start = end — the whole point
        requestedBudget: '150.00',
        creativeId: creative?.id ?? null,
      })
      .returning();
    await db
      .insert(campaignTargeting)
      .values({ campaignId: campaign?.id ?? '', categoryId: sector?.id ?? '', class: null });

    const result = await runDispatch(
      { id: campaign?.id ?? '', name: 'Campagne un jour', startDate: DAY, endDate: DAY },
      { iCible: 3000, cpm: 15, s: 10 },
    );
    expect(result.status).toBe('OK');

    const [plan] = await db
      .select({ id: campaignDispatchPlan.id })
      .from(campaignDispatchPlan)
      .where(eq(campaignDispatchPlan.campaignId, campaign?.id ?? ''));
    const allocs = await db
      .select()
      .from(campaignDispatchAllocation)
      .where(eq(campaignDispatchAllocation.planId, plan?.id ?? ''));
    expect(allocs.length).toBeGreaterThan(0);
    for (const a of allocs) {
      expect(a.creneaux.length).toBeGreaterThan(0);
      for (const c of a.creneaux) expect(c.date).toBe(DAY);
    }
  });
});
