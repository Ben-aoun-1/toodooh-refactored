import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { db, sql } from '../src/db/client.js';
import {
  type NewUser,
  campaignDispatchPlan,
  campaigns,
  cartItems,
  screencasterCpmChanges,
  users,
} from '../src/db/schema.js';
import {
  listScreencasterCpm,
  screencasterCpmRates,
  updateScreencasterCpm,
} from '../src/lib/screencaster-cpm.js';

import { type CpmConfigSnapshot, pinCpmConfig, restoreCpmConfig } from './helpers/cpm-config.js';
import { resetAuthTables } from './helpers/db-test-setup.js';

// CPM-3 — the rule of spec §2 on real Postgres: an admin change re-prices the screencaster's
// DRAFTS only; every other status keeps its CPM; the trail records it; a new campaign captures it.

let seq = 0;
const seedUser = async (values: Partial<NewUser> = {}): Promise<string> => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `cpm3-${seq}@example.com`,
      contactName: `CPM3 ${seq}`,
      status: 'approved',
      ...values,
    })
    .returning({ id: users.id });
  return u?.id ?? '';
};
const seedCampaign = async (
  advertiserId: string,
  status: 'draft' | 'pending' | 'upcoming' | 'active' | 'rejected' | 'completed',
  name: string,
): Promise<string> => {
  const [c] = await db
    .insert(campaigns)
    .values({ advertiserId, name, campaignType: 'standard', status })
    .returning({ id: campaigns.id });
  return c?.id ?? '';
};
const ratesOf = async (id: string) => {
  const [row] = await db
    .select({ s: campaigns.standardCpmTnd, e: campaigns.eventCpmTnd })
    .from(campaigns)
    .where(eq(campaigns.id, id));
  return { standard: Number(row?.s), event: Number(row?.e) };
};

describe('CPM-3 — the CPM per screencaster (real Postgres)', () => {
  let pinned: CpmConfigSnapshot;

  beforeEach(async () => {
    await resetAuthTables();
    pinned = await pinCpmConfig('15.000', '15.000');
  });
  afterEach(async () => {
    await restoreCpmConfig(pinned);
  });
  afterAll(async () => {
    await sql.end();
  });

  it('re-prices the screencaster’s drafts only — every other status keeps its CPM', async () => {
    const admin = await seedUser({ role: 'admin' });
    const adv = await seedUser();
    const byStatus = {
      draft: await seedCampaign(adv, 'draft', 'Brouillon'),
      carted: await seedCampaign(adv, 'draft', 'Au panier'),
      pending: await seedCampaign(adv, 'pending', 'En attente'),
      rejected: await seedCampaign(adv, 'rejected', 'Refusée'),
      upcoming: await seedCampaign(adv, 'upcoming', 'Programmée'),
      active: await seedCampaign(adv, 'active', 'Active'),
      completed: await seedCampaign(adv, 'completed', 'Terminée'),
    };
    await db.insert(cartItems).values({ userId: adv, campaignId: byStatus.carted });

    const result = await updateScreencasterCpm({
      userIds: [adv],
      standardCpmTnd: 12,
      eventCpmTnd: 25,
      changedBy: admin,
    });

    expect(result).toEqual({ ok: true, updated: 1, draftsRepriced: 2 });
    expect(await ratesOf(byStatus.draft)).toEqual({ standard: 12, event: 25 });
    expect(await ratesOf(byStatus.carted)).toEqual({ standard: 12, event: 25 });
    for (const kept of ['pending', 'rejected', 'upcoming', 'active', 'completed'] as const) {
      expect(await ratesOf(byStatus[kept])).toEqual({ standard: 15, event: 15 });
    }
  });

  it('changing only one rate keeps the other; the trail records old → new and the drafts count', async () => {
    const admin = await seedUser({ role: 'admin' });
    const adv = await seedUser();
    await seedCampaign(adv, 'draft', 'Brouillon');

    await updateScreencasterCpm({ userIds: [adv], eventCpmTnd: 30, changedBy: admin });

    expect(await screencasterCpmRates(adv)).toEqual({ standardCpmTnd: 15, eventCpmTnd: 30 });
    const trail = await db
      .select()
      .from(screencasterCpmChanges)
      .where(eq(screencasterCpmChanges.userId, adv));
    expect(trail).toHaveLength(1);
    expect(trail[0]).toMatchObject({
      changedBy: admin,
      oldStandardCpmTnd: '15.000',
      newStandardCpmTnd: '15.000',
      oldEventCpmTnd: '15.000',
      newEventCpmTnd: '30.000',
      draftsRepriced: 1,
    });
  });

  it('a campaign created after the change — a replay included — captures the new CPM', async () => {
    const admin = await seedUser({ role: 'admin' });
    const adv = await seedUser();
    const before = await seedCampaign(adv, 'completed', 'Avant');
    await updateScreencasterCpm({ userIds: [adv], standardCpmTnd: 9.5, changedBy: admin });
    const replay = await seedCampaign(adv, 'draft', 'Rejouée');
    expect(await ratesOf(replay)).toEqual({ standard: 9.5, event: 15 });
    expect(await ratesOf(before)).toEqual({ standard: 15, event: 15 });
  });

  it('an activated campaign keeps its frozen plan CPM (what a boost and the settlement price at)', async () => {
    const admin = await seedUser({ role: 'admin' });
    const adv = await seedUser();
    const active = await seedCampaign(adv, 'active', 'Active');
    await db.insert(campaignDispatchPlan).values({
      campaignId: active,
      iCible: 1000,
      cpm: '15',
      sSpotSeconds: 10,
      tTierCoef: '0.6',
      seuilDiffusable: 1334,
      sMin: '20',
      gJour: '3.33',
      fMaxSeconds: 300,
      rMinEfficace: 2,
      couvert: 1000,
      nMin: 1,
      nMax: 20,
      nRetenus: 1,
    });
    await updateScreencasterCpm({ userIds: [adv], standardCpmTnd: 8, changedBy: admin });
    const [plan] = await db
      .select({ cpm: campaignDispatchPlan.cpm })
      .from(campaignDispatchPlan)
      .where(eq(campaignDispatchPlan.campaignId, active));
    expect(plan?.cpm).toBe('15.000');
    expect(await ratesOf(active)).toEqual({ standard: 15, event: 15 });
  });

  it('several screencasters at once, each with its own trail row', async () => {
    const admin = await seedUser({ role: 'admin' });
    const a = await seedUser();
    const b = await seedUser();
    await seedCampaign(a, 'draft', 'A1');
    await seedCampaign(b, 'draft', 'B1');
    await seedCampaign(b, 'draft', 'B2');
    const result = await updateScreencasterCpm({
      userIds: [a, b, a],
      standardCpmTnd: 11,
      changedBy: admin,
    });
    expect(result).toEqual({ ok: true, updated: 2, draftsRepriced: 3 });
    const trail = await db.select().from(screencasterCpmChanges);
    expect(trail.map((t) => [t.userId, t.draftsRepriced]).sort()).toEqual(
      [
        [a, 1],
        [b, 2],
      ].sort(),
    );
  });

  it('refuses a non-advertiser id and writes nothing', async () => {
    const admin = await seedUser({ role: 'admin' });
    const adv = await seedUser();
    const owner = await seedUser({ role: 'individual_owner' });
    const result = await updateScreencasterCpm({
      userIds: [adv, owner],
      standardCpmTnd: 11,
      changedBy: admin,
    });
    expect(result).toEqual({ ok: false, error: 'NOT_ADVERTISER', ids: [owner] });
    expect(await screencasterCpmRates(adv)).toEqual({ standardCpmTnd: 15, eventCpmTnd: 15 });
    expect(await db.select().from(screencasterCpmChanges)).toEqual([]);
  });

  it('lists advertisers only, with their CPMs, drafts and last change', async () => {
    const admin = await seedUser({ role: 'admin', contactName: 'Admin Tarifs' });
    const adv = await seedUser({ businessName: 'Agence Zeta', businessType: 'agency' });
    await seedUser({ role: 'individual_owner' });
    await seedCampaign(adv, 'draft', 'D');
    await updateScreencasterCpm({ userIds: [adv], standardCpmTnd: 13, changedBy: admin });

    const rows = await listScreencasterCpm();
    expect(rows.map((r) => r.id)).toEqual([adv]);
    expect(rows[0]).toMatchObject({
      company_name: 'Agence Zeta',
      business_type: 'agency',
      cpm_standard_tnd: 13,
      cpm_event_tnd: 15,
      draft_count: 1,
      last_change: { changed_by_name: 'Admin Tarifs' },
    });
  });

  it('screencasterCpmRates is null for a non-advertiser', async () => {
    expect(await screencasterCpmRates(await seedUser({ role: 'admin' }))).toBeNull();
  });
});
