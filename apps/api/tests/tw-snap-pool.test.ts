import { and, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { db, sql } from '../src/db/client.js';
import { screenhostAffluence } from '../src/db/schema.js';
import { campaignEligibleHosts } from '../src/lib/campaign-eligible-hosts.js';
import { assemblePool } from '../src/lib/dispatch/pool.js';
import {
  dropTypicalWeekFreeze,
  freezeTypicalWeek,
  hasTypicalWeekFreeze,
} from '../src/lib/typical-week-freeze.js';

import { seedApprovedOwner } from './helpers/approved-owner.js';
import { resetAuthTables } from './helpers/db-test-setup.js';
import {
  eventSector,
  seedCampaign,
  seedMatrix,
  seedVenue,
} from './helpers/installed-screen-matrix.js';
import { seedInstalledScreen } from './helpers/installed-screen.js';

// TW-SNAP (operator ruling Z-A, 2026-09-25) — a campaign added to the cart prices and places on
// the typical week AS IT STOOD at that add, whatever the hub pushes afterwards. Fixture = MAP-TV1's
// matrix: three placeable venues (c)(d)(e), every cell of their week at 100.

const INPUTS = { s: 10, t: 0.7, fMaxSeconds: 300 };

const poolOf = async (campaign: { id: string; startDate: string; endDate: string }) =>
  assemblePool(db, campaign, INPUTS);

/** The hub rewrites a venue's whole live week. */
const hubPushes = (screenhostId: string, value: number) =>
  db
    .update(screenhostAffluence)
    .set({ estimatedImpressions: value })
    .where(eq(screenhostAffluence.screenhostId, screenhostId));

describe('TW-SNAP — the typical week frozen at cart add', () => {
  beforeEach(async () => {
    await resetAuthTables();
  });
  afterAll(async () => {
    await sql.end();
  });

  it('a hub push after the freeze moves a live campaign, never a frozen one', async () => {
    const v = await seedMatrix(await eventSector());
    const advertiser = await seedApprovedOwner({ role: 'advertiser' });
    const frozen = await seedCampaign(advertiser);
    const live = await seedCampaign(advertiser);
    await freezeTypicalWeek(db, frozen.id);

    const venue = v.in[0] ?? '';
    await hubPushes(venue, 500);

    const frozenEntry = (await poolOf(frozen)).pool.find((p) => p.id === venue);
    const liveEntry = (await poolOf(live)).pool.find((p) => p.id === venue);
    expect(frozenEntry?.avgAffluence).toBe(100);
    expect(liveEntry?.avgAffluence).toBe(500);
  });

  it('a cell suspended by the hub after the freeze still counts for the frozen campaign', async () => {
    const v = await seedMatrix(await eventSector());
    const advertiser = await seedApprovedOwner({ role: 'advertiser' });
    const frozen = await seedCampaign(advertiser);
    await freezeTypicalWeek(db, frozen.id);
    const venue = v.in[0] ?? '';
    const before = (await poolOf(frozen)).pool.find((p) => p.id === venue);

    // OFF-1 — the hub suspends every cell of the venue (in_effect = false): absent for live readers.
    await db
      .update(screenhostAffluence)
      .set({ inEffect: false })
      .where(and(eq(screenhostAffluence.screenhostId, venue)));

    const after = (await poolOf(frozen)).pool.find((p) => p.id === venue);
    expect(after?.avgAffluence).toBe(before?.avgAffluence);
    expect(after?.capaciteUtile).toBe(before?.capaciteUtile);
  });

  it('Q2 B — a venue that joins the network after the freeze is excluded, and says why', async () => {
    const sector = await eventSector();
    const v = await seedMatrix(sector);
    const advertiser = await seedApprovedOwner({ role: 'advertiser' });
    const frozen = await seedCampaign(advertiser);
    const live = await seedCampaign(advertiser);
    await freezeTypicalWeek(db, frozen.id);

    const newcomer = await seedVenue('(f) arrivé après le gel', sector);
    await seedInstalledScreen(newcomer, { name: 'TV neuve' });

    const frozenIds = (await poolOf(frozen)).pool.map((p) => p.id).sort();
    const liveIds = (await poolOf(live)).pool.map((p) => p.id).sort();
    expect(frozenIds).toEqual(v.in);
    expect(liveIds).toEqual([...v.in, newcomer].sort());

    const hosts = await campaignEligibleHosts(frozen.id);
    if (hosts.status !== 'OK') throw new Error(`eligible hosts: ${hosts.status}`);
    expect(hosts.report.excluded.find((e) => e.id === newcomer)?.reason).toBe('not_in_frozen_week');
  });

  it('Q1 B — dropping the freeze returns to the live week; a new freeze takes the week of NOW', async () => {
    const v = await seedMatrix(await eventSector());
    const advertiser = await seedApprovedOwner({ role: 'advertiser' });
    const campaign = await seedCampaign(advertiser);
    const venue = v.in[0] ?? '';

    await freezeTypicalWeek(db, campaign.id);
    await hubPushes(venue, 300);
    expect((await poolOf(campaign)).pool.find((p) => p.id === venue)?.avgAffluence).toBe(100);

    await dropTypicalWeekFreeze(db, campaign.id);
    expect(await hasTypicalWeekFreeze(db, campaign.id)).toBe(false);
    expect((await poolOf(campaign)).pool.find((p) => p.id === venue)?.avgAffluence).toBe(300);

    await freezeTypicalWeek(db, campaign.id);
    await hubPushes(venue, 700);
    expect((await poolOf(campaign)).pool.find((p) => p.id === venue)?.avgAffluence).toBe(300);
  });
});
