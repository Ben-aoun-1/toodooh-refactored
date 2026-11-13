import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '../src/db/client.js';
import {
  type NewUser,
  businessSectors,
  campaignDispatchAllocation,
  campaignDispatchPlan,
  campaignTypicalWeekFreezes,
  campaigns,
  creatives,
  dispatchConfig,
  notifications,
  recharges,
  screenhostAffluence,
  screenhosts,
  users,
} from '../src/db/schema.js';
import { activateCampaign, prepareActivation } from '../src/lib/activation-service.js';
import { computeCampaignCmax } from '../src/lib/campaign-cmax.js';
import { campaignEligibleHosts } from '../src/lib/campaign-eligible-hosts.js';
import { type ToursPool, assembleToursPool } from '../src/lib/dispatch/tours/assemble.js';
import { activeAllocationsForScreenhost } from '../src/lib/playout/active-allocations.js';

import { bothHalves, resetAuthTables } from './helpers/db-test-setup.js';
import { seedInstalledScreen } from './helpers/installed-screen.js';

// DISP-TOURS — the tours engine end to end on a real Postgres, on Mariem's example (§2.1):
// Café A (ahead in the pool) and Café B, open 16 h → 20 h every day with her typical weeks, Café
// C open on the weekend only; a 30 s spot, CPM 12, F = 600 s (R_plein 20, CAP_heure 6), 9 → 18
// November 2026. Unscored venues rank at the neutral SPS, so the pool order is the id order: the
// fixed ids put A before B before C. The clock is pinned to Friday 6 November 2026, before the
// window (an hour already started is never usable, so the suite must not depend on its own day).

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const C = '00000000-0000-4000-8000-00000000000c';

const WEEK_A = [
  [20, 30, 25, 10],
  [20, 25, 30, 15],
  [15, 20, 25, 30],
  [30, 25, 20, 10],
  [20, 30, 35, 25],
  [25, 35, 40, 30],
  [30, 25, 20, 15],
];
const WEEK_B = [
  [10, 15, 12, 8],
  [12, 10, 15, 8],
  [8, 12, 15, 10],
  [15, 12, 10, 8],
  [10, 15, 18, 12],
  [12, 18, 20, 15],
  [15, 12, 10, 8],
];

let seq = 0;
const seedUser = async (values: Partial<NewUser> = {}): Promise<string> => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `tours${seq}@example.com`,
      contactName: `Tours ${seq}`,
      role: 'advertiser',
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

const seedVenue = async (
  id: string,
  ownerId: string,
  sectorId: string,
  week: number[][],
  hours: [number, number] = [16, 20],
): Promise<void> => {
  await db.insert(screenhosts).values({
    id,
    name: `Café ${id.slice(-1).toUpperCase()}`,
    ownerId,
    businessSectorId: sectorId,
    class: 'moyen',
    openingHour: hours[0],
    closingHour: hours[1],
    broadcastCapacity: 4,
  });
  const cells = week.flatMap((row, d) =>
    row.map((estimatedImpressions, i) => ({
      screenhostId: id,
      dayOfWeek: d + 1,
      hour: hours[0] + i,
      estimatedImpressions,
    })),
  );
  if (cells.length > 0) await db.insert(screenhostAffluence).values(bothHalves(cells));
  await seedInstalledScreen(id);
};

const seedCampaign = async (advertiserId: string, budget: string): Promise<string> => {
  const [creative] = await db
    .insert(creatives)
    .values({
      advertiserId,
      creativeType: 'video',
      storageKey: `creatives/tours/${seq}`,
      durationSeconds: 30,
      validationStatus: 'approved',
    })
    .returning();
  const [c] = await db
    .insert(campaigns)
    .values({
      advertiserId,
      name: `Tours ${seq}`,
      campaignType: 'standard',
      status: 'pending',
      startDate: '2026-11-09',
      endDate: '2026-11-18',
      creativeId: creative?.id ?? null,
      requestedBudget: budget,
      standardCpmTnd: '12.000',
      t10s: '0.60',
      t20s: '0.70',
      t30s: '0.80',
    })
    .returning();
  return c?.id ?? '';
};

const loadCampaign = async (id: string) => {
  const [row] = await db.select().from(campaigns).where(eq(campaigns.id, id));
  if (!row) throw new Error('campaign missing');
  return row;
};

const activate = async (campaignId: string) =>
  activateCampaign({
    campaign: await loadCampaign(campaignId),
    contentValidationStatus: 'approved',
    creativeDurationSeconds: 30,
    activatedBy: null,
    fromStatus: 'pending',
  });

const cellsOf = (pool: ToursPool, venue: string): number =>
  pool.venues.find((v) => v.id === venue)?.hours.reduce((n, h) => n + h.dates.length, 0) ?? 0;

describe('DISP-TOURS — cart quote, launch, places, playout and admin fiche (real Postgres)', () => {
  let advertiser = '';
  let ownerA = '';

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-06T09:00:00Z'));
    await resetAuthTables();
    await db.update(dispatchConfig).set({ fMaxSeconds: 600 });
    const [sector] = await db
      .select({ id: businessSectors.id })
      .from(businessSectors)
      .where(eq(businessSectors.audience, 'owner'))
      .limit(1);
    ownerA = await seedUser({ role: 'individual_owner' });
    const ownerB = await seedUser({ role: 'individual_owner' });
    await seedVenue(A, ownerA, sector?.id ?? '', WEEK_A);
    await seedVenue(B, ownerB, sector?.id ?? '', WEEK_B);
    await seedVenue(C, ownerB, sector?.id ?? '', [[], [], [], [], [], [10, 5], [8, 4]], [18, 20]);
    advertiser = await seedUser();
    await db.insert(recharges).values({
      advertiserId: advertiser,
      amountTnd: '5000.00',
      status: 'confirmed',
      reference: `TOURS-${seq}`,
    });
  });

  afterEach(async () => {
    vi.useRealTimers();
    await db.update(dispatchConfig).set({ fMaxSeconds: 300 });
  });

  const cmaxOf = async (campaignId: string, budget?: number) => {
    const c = await loadCampaign(campaignId);
    return computeCampaignCmax(
      { ...c, startDate: c.startDate ?? '', endDate: c.endDate ?? '' },
      30,
      budget,
    );
  };

  it('quotes the cart: the maximum 273,60 DT and 149,90 DT for 150 DT, nothing reserved', async () => {
    const campaignId = await seedCampaign(advertiser, '150.00');
    const cmax = await cmaxOf(campaignId, 150);
    expect(cmax.cMaxTnd).toBe(273.6);
    expect(cmax.iMaxFacturable).toBeCloseTo(22800, 6);
    expect(cmax.quote?.prixTnd).toBe(149.904);
    expect(cmax.quote?.impressions).toBeCloseTo(12492, 6);
    expect(cmax.quote?.venuesCount).toBe(1);
    expect(await db.select().from(campaignDispatchPlan)).toHaveLength(0);
  });

  it('launches: frozen tours plan, A alone at 20 then 11 passages, price engaged, A told 74,95 DT', async () => {
    const campaignId = await seedCampaign(advertiser, '150.00');
    const outcome = await activate(campaignId);
    expect(outcome.status).toBe('OK');
    const [plan] = await db
      .select()
      .from(campaignDispatchPlan)
      .where(eq(campaignDispatchPlan.campaignId, campaignId));
    expect(plan?.engine).toBe('tours');
    expect(plan?.priceTnd).toBe('149.9040');
    expect(plan?.couvert).toBe(12492);
    const allocations = await db
      .select()
      .from(campaignDispatchAllocation)
      .where(eq(campaignDispatchAllocation.planId, plan?.id ?? ''));
    expect(allocations.map((a) => a.screenhostId)).toEqual([A]);
    const creneaux = allocations[0]?.creneaux ?? [];
    // 10 dates × 2 peak hours at 20 passages + the same × 2 next hours at 11 passages.
    expect(creneaux.filter((c) => c.reps === 20)).toHaveLength(20);
    expect(creneaux.filter((c) => c.reps === 11)).toHaveLength(20);
    const mon16 = creneaux.find((c) => c.date === '2026-11-09' && c.hour === 16);
    expect(mon16).toMatchObject({ reps: 11, impressions: 220, tour: 2 });
    expect(creneaux.reduce((sum, c) => sum + c.impressions, 0) * 0.8 * (12 / 1000)).toBeCloseTo(
      149.904,
      6,
    );
    const row = await loadCampaign(campaignId);
    expect(row.requestedBudget).toBe('149.90');
    expect(row.status).toBe('upcoming');
    const freeze = await db
      .select()
      .from(campaignTypicalWeekFreezes)
      .where(eq(campaignTypicalWeekFreezes.campaignId, campaignId));
    expect(freeze).toHaveLength(1);
    const [notice] = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, ownerA), eq(notifications.campaignId, campaignId)));
    expect(notice?.body).toContain('74,95 DT');
    expect(plan?.detail?.venues.find((v) => v.venueId === B)?.statut).toBe('retire_budget');
    expect(plan?.detail?.venues.find((v) => v.venueId === C)?.statut).toBe('exclu_plein');
  });

  it('a launched campaign takes a place in each of its hours (CAP_heure); a cart one takes none', async () => {
    await db.update(dispatchConfig).set({ fMaxSeconds: 3600 }); // CAP_heure = 1
    const first = await seedCampaign(advertiser, '150.00');
    const second = await seedCampaign(advertiser, '150.00');
    const window = { startDate: '2026-11-09', endDate: '2026-11-18' };
    const before = await assembleToursPool(db, { id: second, ...window }, 3600, {
      typicalWeek: 'live',
    });
    expect(cellsOf(before, A)).toBe(40); // 4 hours × 10 days, nothing held yet
    expect((await activate(first)).status).toBe('OK');
    const after = await assembleToursPool(db, { id: second, ...window }, 3600, {
      typicalWeek: 'live',
    });
    const [plan] = await db
      .select({ id: campaignDispatchPlan.id })
      .from(campaignDispatchPlan)
      .where(eq(campaignDispatchPlan.campaignId, first));
    const [own] = await db
      .select({ creneaux: campaignDispatchAllocation.creneaux })
      .from(campaignDispatchAllocation)
      .where(
        and(
          eq(campaignDispatchAllocation.planId, plan?.id ?? ''),
          eq(campaignDispatchAllocation.screenhostId, A),
        ),
      );
    expect(cellsOf(after, A)).toBe(40 - (own?.creneaux.length ?? 0));
  });

  // Mariem 05/11 point 6 — seven campaigns of one cart had all taken the same hours (cap 6): the
  // cart freezes every plan BEFORE flipping any campaign out of draft.
  it('the campaigns of one « Lancer » see each other: a draft with a plan holds its places', async () => {
    await db.update(dispatchConfig).set({ fMaxSeconds: 3600 }); // CAP_heure = 1
    const first = await seedCampaign(advertiser, '150.00');
    const second = await seedCampaign(advertiser, '150.00');
    await db.update(campaigns).set({ status: 'draft' }).where(eq(campaigns.id, first));
    const prepared = await prepareActivation({
      campaign: await loadCampaign(first),
      contentValidationStatus: 'approved',
      creativeDurationSeconds: 30,
      fromStatus: 'draft',
    });
    if (prepared.status !== 'READY') throw new Error(`not ready: ${prepared.status}`);
    expect((await loadCampaign(first)).status).toBe('draft');
    const held = prepared.allocations.find((a) => a.screenhostId === A)?.creneaux.length ?? 0;
    expect(held).toBeGreaterThan(0);
    const pool = await assembleToursPool(
      db,
      { id: second, startDate: '2026-11-09', endDate: '2026-11-18' },
      3600,
      { typicalWeek: 'live' },
    );
    expect(cellsOf(pool, A)).toBe(40 - held);
  });

  // Mariem 05/11 point 5 — launched at 13 h, a same-day campaign had taken 8 h → 12 h.
  it('a same-day launch never takes an hour already started: at 17:10, the day starts at 18 h', async () => {
    vi.setSystemTime(new Date('2026-11-09T16:10:00Z')); // Monday 9 November 2026, 17:10 in Tunis
    const campaignId = await seedCampaign(advertiser, '150.00');
    expect((await activate(campaignId)).status).toBe('OK');
    const creneaux = (
      await db
        .select({ creneaux: campaignDispatchAllocation.creneaux })
        .from(campaignDispatchAllocation)
    ).flatMap((a) => a.creneaux);
    const monday = creneaux.filter((c) => c.date === '2026-11-09');
    expect(monday.filter((c) => c.hour <= 17)).toEqual([]);
    expect(monday.map((c) => c.hour)).toContain(18);
    const pool = await assembleToursPool(
      db,
      { id: campaignId, startDate: '2026-11-09', endDate: '2026-11-18' },
      600,
      { typicalWeek: 'live', now: new Date('2026-11-09T16:10:00Z') },
    );
    expect(cellsOf(pool, B)).toBe(38); // Café B: 4 hours × 10 days, less Monday's 16 h and 17 h
  });

  it('airs only inside its créneaux, at each hour’s passages; blacked out in between', async () => {
    const campaignId = await seedCampaign(advertiser, '150.00');
    expect((await activate(campaignId)).status).toBe('OK');
    await db.update(campaigns).set({ status: 'active' }).where(eq(campaigns.id, campaignId));
    await db.update(campaignDispatchAllocation).set({ statutAcceptation: 'ACCEPTE' });
    // Monday 9 November 2026, Tunis (UTC+1): 17 h is a tour-1 hour (20), 16 h a tour-2 one (11).
    const at17 = new Date('2026-11-09T16:30:00Z');
    const at16 = new Date('2026-11-09T15:30:00Z');
    const at12 = new Date('2026-11-09T11:00:00Z');
    expect((await activeAllocationsForScreenhost(A, at17))[0]?.repsPerHour).toBe(20);
    expect((await activeAllocationsForScreenhost(A, at16))[0]?.repsPerHour).toBe(11);
    expect(await activeAllocationsForScreenhost(A, at12)).toHaveLength(0);
    const [offHours] = await activeAllocationsForScreenhost(A, at12, undefined, {
      includeOffHours: true,
    });
    expect(offHours?.airableNow).toBe(false);
    expect(offHours?.repsPerHour).toBe(11); // the next allocated hour, 16 h
    expect(offHours?.offWindows?.[0]).toEqual({
      start: at12,
      end: new Date('2026-11-09T15:00:00Z'),
    });
  });

  it('the admin fiche shows the frozen calculation of a launched campaign', async () => {
    const campaignId = await seedCampaign(advertiser, '150.00');
    const live = await campaignEligibleHosts(campaignId);
    expect(live.status).toBe('OK');
    if (live.status !== 'OK') return;
    expect(live.report.tours?.source).toBe('live');
    expect(live.report.tours?.prix_tnd).toBe(149.904);
    expect((await activate(campaignId)).status).toBe('OK');
    const frozen = await campaignEligibleHosts(campaignId);
    if (frozen.status !== 'OK') throw new Error('not ok');
    const tours = frozen.report.tours;
    expect(tours?.source).toBe('plan');
    expect(tours?.i_alloue).toBe(12492);
    expect(tours?.venues.map((v) => [v.name, v.statut])).toEqual([
      ['Café A', 'retenu'],
      ['Café B', 'retire_budget'],
      ['Café C', 'exclu_plein'],
    ]);
    const a = tours?.venues[0];
    expect(a?.tours).toEqual([
      { tour: 1, passages: 20 },
      { tour: 2, passages: 11 },
    ]);
    expect(a?.week.find((c) => c.day_of_week === 1 && c.hour === 17)).toMatchObject({
      affluence: 30,
      n: 2,
      tour: 1,
      passages: 20,
    });
    expect(tours?.journal.map((j) => j.phase)).toEqual([
      'precalcul',
      'file',
      'remplissage',
      'anti_miette',
      'verification',
    ]);
  });
});
