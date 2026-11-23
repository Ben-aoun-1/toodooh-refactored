import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { db, sql } from '../src/db/client.js';
import { campaigns, casterVenueExclusions, screenhosts } from '../src/db/schema.js';
import { campaignEligibleHosts } from '../src/lib/campaign-eligible-hosts.js';
import {
  casterExcludedVenues,
  casterExcludedVenuesNow,
  excludeVenues,
  reintegrateVenues,
} from '../src/lib/caster-exclusions.js';
import { assemblePool } from '../src/lib/dispatch/pool.js';
import { assembleToursPool } from '../src/lib/dispatch/tours/assemble.js';
import { eventCoverageVenues } from '../src/lib/event-pricing/coverage.js';
import { computeEventCmax } from '../src/lib/event-pricing/pricing.js';
import {
  dominantAge,
  networkAgeBands,
  networkCategory,
  mostCommon,
  networkFor,
  networkVenueIds,
  parksFor,
} from '../src/lib/network.js';

import { seedApprovedOwner } from './helpers/approved-owner.js';
import { resetAuthTables } from './helpers/db-test-setup.js';
import {
  eventSector,
  seedCampaign,
  seedMatrix,
  seedPositioning,
} from './helpers/installed-screen-matrix.js';

// The v1 pool is read directly below; the tours pool has its own test. Pinned so the admin
// « Hosts éligibles » view reads the same engine as the pool assertion next to it.
vi.mock('../src/lib/dispatch/engine-switch.js', () => ({
  toursEngineOn: () => false,
  usesToursEngine: async () => false,
}));

// Mariem 17/11/2026 — « Réseau Screenhosts » : a Screencaster removes venues from his network.
// The list applies to him alone; a campaign already validated keeps the list in force at its
// validation; a draft follows the current list. Fixture = MAP-TV1's matrix (three placeable
// venues, v.in).

const INPUTS = { s: 10, t: 0.7, fMaxSeconds: 300 };
const poolIds = async (campaign: { id: string; startDate: string; endDate: string }) =>
  (await assemblePool(db, campaign, INPUTS)).pool.map((p) => p.id).sort();

const submitAt = (campaignId: string, at: Date) =>
  db
    .update(campaigns)
    .set({ status: 'pending', submittedAt: at })
    .where(eq(campaigns.id, campaignId));

/** Moves the open exclusion of a venue back in time (the fixtures run in one instant). */
const backdateExclusion = (advertiserId: string, at: Date) =>
  db
    .update(casterVenueExclusions)
    .set({ excludedAt: at })
    .where(eq(casterVenueExclusions.advertiserId, advertiserId));

describe('« Réseau Screenhosts » — a Screencaster’s excluded venues', () => {
  beforeEach(async () => {
    await resetAuthTables();
  });
  afterAll(async () => {
    await sql.end();
  });

  it('an excluded venue leaves a draft’s pool, says why, and comes back when reintegrated', async () => {
    const v = await seedMatrix(await eventSector());
    const advertiser = await seedApprovedOwner({ role: 'advertiser' });
    const draft = await seedCampaign(advertiser);
    const venue = v.in[0] ?? '';
    expect(await poolIds(draft)).toEqual(v.in);

    await excludeVenues(advertiser, [venue]);
    expect(await poolIds(draft)).toEqual(v.in.filter((id) => id !== venue));
    const hosts = await campaignEligibleHosts(draft.id);
    if (hosts.status !== 'OK') throw new Error(`eligible hosts: ${hosts.status}`);
    expect(hosts.report.excluded.find((e) => e.id === venue)?.reason).toBe('caster_excluded');

    expect(await reintegrateVenues(advertiser, [venue])).toBe(1);
    expect(await poolIds(draft)).toEqual(v.in);
  });

  it('the list is his alone: another Screencaster’s draft keeps the venue', async () => {
    const v = await seedMatrix(await eventSector());
    const mine = await seedApprovedOwner({ role: 'advertiser' });
    const other = await seedApprovedOwner({ role: 'advertiser' });
    const otherDraft = await seedCampaign(other);
    await excludeVenues(mine, [v.in[0] ?? '']);
    expect(await poolIds(otherDraft)).toEqual(v.in);
  });

  it('a campaign validated BEFORE the exclusion keeps the venue; one validated after loses it', async () => {
    const v = await seedMatrix(await eventSector());
    const advertiser = await seedApprovedOwner({ role: 'advertiser' });
    const venue = v.in[0] ?? '';
    const before = await seedCampaign(advertiser);
    const after = await seedCampaign(advertiser);

    await submitAt(before.id, new Date('2026-11-01T10:00:00Z'));
    await excludeVenues(advertiser, [venue]);
    await backdateExclusion(advertiser, new Date('2026-11-02T10:00:00Z'));
    await submitAt(after.id, new Date('2026-11-03T10:00:00Z'));

    expect(await poolIds(before)).toEqual(v.in);
    expect(await poolIds(after)).toEqual(v.in.filter((id) => id !== venue));

    // Reintegrating later changes neither: each keeps the list of its own validation.
    await reintegrateVenues(advertiser, [venue]);
    expect(await poolIds(before)).toEqual(v.in);
    expect(await poolIds(after)).toEqual(v.in.filter((id) => id !== venue));
    // A new draft follows the current list: the venue is back.
    expect(await poolIds(await seedCampaign(advertiser))).toEqual(v.in);
  });

  it('excluding twice keeps one open period; reintegrating a venue never excluded changes nothing', async () => {
    const v = await seedMatrix(await eventSector());
    const advertiser = await seedApprovedOwner({ role: 'advertiser' });
    const venue = v.in[0] ?? '';
    await excludeVenues(advertiser, [venue, venue]);
    await excludeVenues(advertiser, [venue]);
    const rows = await db
      .select()
      .from(casterVenueExclusions)
      .where(eq(casterVenueExclusions.advertiserId, advertiser));
    expect(rows).toHaveLength(1);
    expect(await reintegrateVenues(advertiser, [v.in[1] ?? ''])).toBe(0);
    expect([...(await casterExcludedVenuesNow(db, advertiser))]).toEqual([venue]);
  });

  it('the tours pool drops the venue too, under the same reason', async () => {
    const v = await seedMatrix(await eventSector());
    const advertiser = await seedApprovedOwner({ role: 'advertiser' });
    const draft = await seedCampaign(advertiser);
    const venue = v.in[0] ?? '';
    await excludeVenues(advertiser, [venue]);
    const pool = await assembleToursPool(db, draft, INPUTS.fMaxSeconds, { typicalWeek: 'live' });
    expect(pool.venues.map((x) => x.id)).not.toContain(venue);
    expect(pool.excluded.find((e) => e.venueId === venue)?.reason).toBe('caster_excluded');
  });

  it('a match positioning: the venue leaves the ceiling and the coverage map', async () => {
    const v = await seedMatrix(await eventSector());
    const advertiser = await seedApprovedOwner({ role: 'advertiser' });
    const { positioningId, event } = await seedPositioning(advertiser);
    const venue = v.in[0] ?? '';
    const full = await computeEventCmax(event, 15, new Set(), 3);
    expect(full.eligibleCount).toBe(v.in.length);

    await excludeVenues(advertiser, [venue]);
    const mine = await casterExcludedVenues(db, positioningId);
    expect([...mine]).toEqual([venue]);
    const less = await computeEventCmax(event, 15, mine, 3);
    expect(less.eligibleCount).toBe(v.in.length - 1);
    expect(less.cMaxEvtTnd).toBeLessThan(full.cMaxEvtTnd);
    const map = await eventCoverageVenues(event.id, null, mine);
    expect(map.map((m) => m.id)).not.toContain(venue);
  });

  it('his network lists the placeable venues, flags the excluded ones, and only they can be excluded', async () => {
    const v = await seedMatrix(await eventSector());
    const advertiser = await seedApprovedOwner({ role: 'advertiser' });
    const venue = v.in[0] ?? '';
    const before = await networkFor(advertiser);
    expect(before.venues.map((x) => x.id).sort()).toEqual(v.in);
    expect(before.venues.every((x) => !x.excluded)).toBe(true);

    // A venue outside his network (not placeable) is ignored by the selection.
    expect((await networkVenueIds(advertiser, [venue, v.out[0] ?? ''])).sort()).toEqual([venue]);
    await excludeVenues(advertiser, [venue]);
    const after = await networkFor(advertiser);
    expect(after.venues.filter((x) => x.excluded).map((x) => x.id)).toEqual([venue]);
    expect(after.venues).toHaveLength(v.in.length);
  });

  it('« Parcs TV » — every Screenhost is a park; an owner with two venues is one park with two locations', async () => {
    const v = await seedMatrix(await eventSector());
    const advertiser = await seedApprovedOwner({ role: 'advertiser' });
    // Each venue of the fixture has its own owner: one park each.
    expect(await parksFor(advertiser)).toHaveLength(v.in.length);

    const brand = await seedApprovedOwner({ role: 'fleet_owner', businessName: 'Enseigne Test' });
    const two = v.in.slice(0, 2);
    await db.update(screenhosts).set({ ownerId: brand }).where(inArray(screenhosts.id, two));

    const parks = await parksFor(advertiser);
    expect(parks).toHaveLength(v.in.length - 1);
    const brandPark = parks.find((p) => p.id === brand);
    expect(brandPark?.name).toBe('Enseigne Test');
    expect(brandPark?.locations.map((l) => l.screenhost_id).sort()).toEqual([...two].sort());
    expect(brandPark?.locations.every((l) => !l.excluded)).toBe(true);

    await excludeVenues(advertiser, two);
    const after = await parksFor(advertiser);
    expect(after.find((p) => p.id === brand)?.locations.every((l) => l.excluded)).toBe(true);
    // The other Screenhost's park is untouched.
    expect(after.filter((p) => p.id !== brand).every((p) => !p.locations[0]?.excluded)).toBe(true);
  });
});

describe('« Réseau Screenhosts » — what a venue card prints', () => {
  it('the value most venues share; null when none has one', () => {
    expect(mostCommon(['moyen', 'premium', 'moyen', null])).toBe('moyen');
    expect(mostCommon([null, null])).toBeNull();
  });

  it('the three families come from the sector name', () => {
    expect(networkCategory('Café')).toBe('cafe');
    expect(networkCategory('Salon de thé')).toBe('cafe');
    expect(networkCategory('Resto')).toBe('resto');
    expect(networkCategory('Salle de sport')).toBe('sport');
    expect(networkCategory('Pharmacie')).toBe('autre');
    expect(networkCategory(null)).toBe('autre');
  });

  it('age bands: the two upper bands when the hub sent them, else « 46 ans et plus »', () => {
    const none = {
      age17To30Pct: null,
      age31To45Pct: null,
      age46PlusPct: null,
      age46To60Pct: null,
      age60PlusPct: null,
    };
    expect(networkAgeBands(none)).toBeNull();
    expect(dominantAge(null)).toBeNull();
    const legacy = networkAgeBands({
      ...none,
      age17To30Pct: '20',
      age31To45Pct: '30',
      age46PlusPct: '50',
    });
    expect(legacy?.map((b) => b.label)).toEqual(['17 à 30 ans', '31 à 45 ans', '46 ans et plus']);
    expect(dominantAge(legacy)).toBe('46 ans et plus');
    const split = networkAgeBands({
      age17To30Pct: '22.4',
      age31To45Pct: '41',
      age46PlusPct: '37',
      age46To60Pct: '29',
      age60PlusPct: '8',
    });
    expect(split).toEqual([
      { label: '17 à 30 ans', pct: 22 },
      { label: '31 à 45 ans', pct: 41 },
      { label: '46 à 60 ans', pct: 29 },
      { label: '60 ans et plus', pct: 8 },
    ]);
    expect(dominantAge(split)).toBe('31 à 45 ans');
  });
});
