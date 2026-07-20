import { asc, eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import {
  type DispatchCreneau,
  type NewUser,
  businessSectors,
  campaignDispatchAllocation,
  campaignDispatchPlan,
  campaignRedispatchRounds,
  campaignTargeting,
  campaigns,
  creatives,
  notifications,
  proofOfPlay,
  screenhostAffluence,
  screenhosts,
  screens,
  users,
} from '../src/db/schema.js';
import { runCampaignRedispatchTick } from '../src/lib/campaign-redispatch.js';
import {
  REDISPATCH_HEARTBEAT_TOLERANCE_MS,
  detectMissedSlots,
  runRedispatchRound,
} from '../src/lib/dispatch/redispatch.js';
import { screenhostsRoutes } from '../src/routes/screenhosts.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// E6 — redispatching, real Postgres. Fixtures pin the engine numbers: cpm 10 / s 10 → T 0.6,
// seuil = seuilImpressions(10) = 2000; venues aff 100, hours 8–18 over a Mon–Tue window (Hi = 20,
// R = 30) → facturable capacity 36 000. NOW is injected: 2026-07-20 (a Monday) 13:30 Africa/Tunis
// (= 12:30 UTC; Tunis is UTC+1, no DST) unless a test says otherwise.

const NOW = new Date('2026-07-20T12:30:00Z'); // Tunis 13:30 — hours 8..12 have ELAPSED
const MON = '2026-07-20';
const TUE = '2026-07-21';

// The wedooh re-push is mocked for the reject-route pin (same isolation as the allocation suite).
vi.mock('../src/lib/wedooh-sync.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/wedooh-sync.js')>();
  return { ...actual, pushApprovedOwnerLocations: vi.fn(() => Promise.resolve()) };
});

type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;
const mockSession = (userId: string): void => {
  vi.spyOn(auth.api, 'getSession').mockResolvedValue({
    session: {},
    user: { id: userId, role: 'individual_owner', status: 'approved' },
  } as unknown as GetSessionResult);
};

let seq = 0;
const seedUser = async (values: Partial<NewUser> = {}): Promise<string> => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `e6-${seq}@example.com`,
      contactName: `User ${seq}`,
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

interface Venue {
  shId: string;
  screenId: string | null;
  ownerId: string;
}

// A venue with hours 8–18 and uniform affluence on Mon+Tue; `liveness` seeds a screen whose
// last_seen_at makes it alive / dead — or NO screen at all (a device-less venue is dead too).
const seedVenue = async (
  cat: string,
  sps: number,
  aff: number,
  liveness: 'alive' | 'dead' | 'no-screen',
): Promise<Venue> => {
  const ownerId = await seedUser({ role: 'individual_owner' });
  const [sh] = await db
    .insert(screenhosts)
    .values({
      name: `Venue sps${sps}`,
      ownerId,
      businessSectorId: cat,
      class: 'premium' as never,
      sps: String(sps),
      openingHour: 8,
      closingHour: 18,
      broadcastCapacity: 4,
    })
    .returning();
  const shId = sh?.id ?? '';
  const rows = [];
  for (const dow of [1, 2])
    for (let h = 8; h < 18; h += 1)
      rows.push({ screenhostId: shId, dayOfWeek: dow, hour: h, estimatedImpressions: aff });
  await db.insert(screenhostAffluence).values(rows);

  let screenId: string | null = null;
  if (liveness !== 'no-screen') {
    const lastSeenAt =
      liveness === 'alive'
        ? new Date(NOW.getTime() - 60_000)
        : new Date(NOW.getTime() - REDISPATCH_HEARTBEAT_TOLERANCE_MS - 60_000);
    const [screen] = await db
      .insert(screens)
      .values({ screenhostId: shId, name: 'TV', lastSeenAt })
      .returning();
    screenId = screen?.id ?? null;
  }
  return { shId, screenId, ownerId };
};

const creneauxFor = (dates: string[], impPerSlot: number, reps: number): DispatchCreneau[] => {
  const out: DispatchCreneau[] = [];
  for (const date of dates)
    for (let h = 8; h < 18; h += 1) out.push({ date, hour: h, reps, impressions: impPerSlot });
  return out;
};

interface Fixture {
  campaignId: string;
  planId: string;
  creativeId: string;
}

const seedCampaignWithPlan = async (opts: {
  name: string;
  start: string;
  end: string;
  reliquat?: number;
  /** E5.1 — a ZERO-LINE campaign (empty targeting = the whole network). */
  noTargeting?: boolean;
}): Promise<Fixture> => {
  const advertiserId = await seedUser({ role: 'advertiser' });
  const [campaign] = await db
    .insert(campaigns)
    .values({
      advertiserId,
      name: opts.name,
      campaignType: 'standard',
      status: 'active',
      startDate: opts.start,
      endDate: opts.end,
    })
    .returning();
  const campaignId = campaign?.id ?? '';
  if (opts.noTargeting !== true) {
    const cat = await ownerSectorId();
    await db.insert(campaignTargeting).values({ campaignId, categoryId: cat, class: null });
  }
  const [creative] = await db
    .insert(creatives)
    .values({
      advertiserId,
      creativeType: 'video',
      storageKey: `creatives/e6/${campaignId}`,
      durationSeconds: 10,
      validationStatus: 'approved',
    })
    .returning();
  const [plan] = await db
    .insert(campaignDispatchPlan)
    .values({
      campaignId,
      iCible: 20000,
      cpm: '10',
      sSpotSeconds: 10,
      tTierCoef: '0.6',
      seuilDiffusable: 2000,
      sMin: '20',
      gJour: '3.3333',
      fMaxSeconds: 300,
      rMinEfficace: 2,
      couvert: 20000,
      nMin: 1,
      nMax: 10,
      nRetenus: 1,
      reliquatStocke: opts.reliquat ?? 0,
    })
    .returning();
  return { campaignId, planId: plan?.id ?? '', creativeId: creative?.id ?? '' };
};

const seedAllocation = async (
  planId: string,
  shId: string,
  ai: number,
  rI: number,
  creneaux: DispatchCreneau[],
  statut: 'EN_ATTENTE' | 'ACCEPTE' | 'REFUSE' = 'ACCEPTE',
): Promise<string> => {
  const [row] = await db
    .insert(campaignDispatchAllocation)
    .values({
      planId,
      screenhostId: shId,
      iiPotentiel: ai,
      rI,
      revenuPrevisionnel: String((ai * 10) / 1000),
      creneaux,
      statutAcceptation: statut,
    })
    .returning();
  return row?.id ?? '';
};

// Deliver a créneau: Tunis is UTC+1 → received_at = (tunisHour − 1):15 UTC on that date.
const deliverSlot = async (
  f: Fixture,
  venue: Venue,
  date: string,
  tunisHour: number,
): Promise<void> => {
  const utcHour = String(tunisHour - 1).padStart(2, '0');
  await db.insert(proofOfPlay).values({
    screenId: venue.screenId ?? '',
    screenhostId: venue.shId,
    campaignId: f.campaignId,
    creativeId: f.creativeId,
    videoIdAsSent: f.campaignId,
    eventType: 'VIDEO_ENDED' as const,
    receivedAt: new Date(`${date}T${utcHour}:15:00Z`),
  });
};

const roundsFor = (campaignId: string) =>
  db
    .select()
    .from(campaignRedispatchRounds)
    .where(eq(campaignRedispatchRounds.campaignId, campaignId))
    .orderBy(asc(campaignRedispatchRounds.roundTs));

const allocsFor = (planId: string) =>
  db
    .select()
    .from(campaignDispatchAllocation)
    .where(eq(campaignDispatchAllocation.planId, planId))
    .orderBy(asc(campaignDispatchAllocation.createdAt));

const planRow = async (planId: string) => {
  const [p] = await db
    .select()
    .from(campaignDispatchPlan)
    .where(eq(campaignDispatchPlan.id, planId));
  return p;
};

const notifsFor = (userId: string) =>
  db.select().from(notifications).where(eq(notifications.userId, userId));

describe('E6 redispatch (real Postgres)', () => {
  beforeEach(async () => {
    await resetAuthTables();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    await sql.end();
  });

  it('detectMissedSlots: only strictly-elapsed undelivered hours count (fresh hour = no manquement)', () => {
    const creneaux = [
      { date: MON, hour: 12, impressions: 100 }, // elapsed at 13:30
      { date: MON, hour: 13, impressions: 100 }, // IN PROGRESS — not elapsed
      { date: MON, hour: 14, impressions: 100 }, // future
    ];
    const missed = detectMissedSlots(
      [{ screenhostId: 'sh', creneaux, deliveredSlots: new Set() }],
      { date: MON, hour: 13 },
    );
    expect(missed.missedPhysical).toBe(100); // ONLY hour 12
    expect(missed.perScreenhost).toEqual([{ screenhost_id: 'sh', slots: 1, imp_physical: 100 }]);
    // Delivered slots never count as missed.
    const none = detectMissedSlots(
      [{ screenhostId: 'sh', creneaux, deliveredSlots: new Set([`${MON}:12`]) }],
      { date: MON, hour: 13 },
    );
    expect(none.missedPhysical).toBe(0);
  });

  it('WORKED EXAMPLE: a dead screen mid-campaign → missed slots → one round onto the best ALIVE venue (dead beats SPS)', async () => {
    const cat = await ownerSectorId();
    const A = await seedVenue(cat, 90, 100, 'dead'); // the defaulter (screen silent 42 min)
    const B = await seedVenue(cat, 80, 100, 'alive'); // the placement target
    const C = await seedVenue(cat, 85, 100, 'no-screen'); // higher SPS but DEAD — must be skipped
    const f = await seedCampaignWithPlan({ name: 'E6 Worked', start: MON, end: TUE });
    // A carries the whole plan: ai 20 000 fact, r_i 16 → 1 600 physical imp per slot, 20 slots.
    await seedAllocation(f.planId, A.shId, 20000, 16, creneauxFor([MON, TUE], 1600, 16));
    // A aired 08h and 09h then died: elapsed at 13:30 = {8..12}, missed = {10, 11, 12}.
    await deliverSlot(f, A, MON, 8);
    await deliverSlot(f, A, MON, 9);

    const outcome = await runRedispatchRound(
      { id: f.campaignId, name: 'E6 Worked', startDate: MON, endDate: TUE },
      NOW,
    );

    // 3 missed slots × 1 600 phys = 4 800 → ×T 0.6 → 2 880 fact → 28.80 TND ≥ S_min 20 → round.
    expect(outcome.status).toBe('PLACED');
    if (outcome.status !== 'PLACED') return;
    expect(outcome.vFact).toBe(2880);
    expect(outcome.placedFact).toBe(2880);
    expect(outcome.residualFact).toBe(0);
    expect(outcome.reliquatConsumedFact).toBe(0);
    // Dead-screen exclusion beats SPS: C (sps 85, no device) is skipped; B (sps 80, alive) wins.
    expect(outcome.placedTo).toEqual([{ screenhost_id: B.shId, added_fact: 2880, merged: false }]);

    // The placement is a NEW EN_ATTENTE allocation with FUTURE-ONLY créneaux: r_i 2 (⌈4 800 phys
    // over Ai·Hi 2 000⌉ → 2.4 → 2), Mon 14..17 + Tue 8..17 = 14 slots × 200 imp.
    const allocs = await allocsFor(f.planId);
    expect(allocs).toHaveLength(2);
    expect(allocs.some((a) => a.screenhostId === C.shId)).toBe(false); // dead C got NOTHING
    const placed = allocs.find((a) => a.screenhostId === B.shId);
    expect(placed).toMatchObject({ iiPotentiel: 2880, rI: 2, statutAcceptation: 'EN_ATTENTE' });
    expect(placed?.creneaux).toHaveLength(14);
    expect(placed?.creneaux.every((c) => c.date > MON || c.hour > 13)).toBe(true);
    expect(placed?.creneaux[0]?.impressions).toBe(200);

    // The round is recorded (the stateless ledger) and the owner is asked for consent.
    const rounds = await roundsFor(f.campaignId);
    expect(rounds).toHaveLength(1);
    expect(rounds[0]).toMatchObject({
      reliquatConsumedFact: 0,
      missedFact: 2880,
      placedFact: 2880,
      residualFact: 0,
    });
    expect(rounds[0]?.missedFrom).toEqual([
      { screenhost_id: A.shId, slots: 3, imp_physical: 4800 },
    ]);
    expect(await notifsFor(B.ownerId)).toHaveLength(1);
  });

  it('E5.1 PIN: a ZERO-LINE campaign’s manquement redispatches (empty targeting = whole network)', async () => {
    const cat = await ownerSectorId();
    const A = await seedVenue(cat, 90, 100, 'dead');
    const B = await seedVenue(cat, 80, 100, 'alive');
    const f = await seedCampaignWithPlan({
      name: 'E6 WholeNet',
      start: MON,
      end: TUE,
      noTargeting: true, // zero lines — pre-E5.1 the assembly refused and nothing was placeable
    });
    await seedAllocation(f.planId, A.shId, 20000, 16, creneauxFor([MON, TUE], 1600, 16));
    await deliverSlot(f, A, MON, 8);
    await deliverSlot(f, A, MON, 9);

    const outcome = await runRedispatchRound(
      { id: f.campaignId, name: 'E6 WholeNet', startDate: MON, endDate: TUE },
      NOW,
    );
    expect(outcome.status).toBe('PLACED');
    if (outcome.status !== 'PLACED') return;
    expect(outcome.placedTo).toEqual([{ screenhost_id: B.shId, added_fact: 2880, merged: false }]);
  });

  it('IDEMPOTENT: a second tick with no new proofs/slots re-counts nothing and records no round', async () => {
    const cat = await ownerSectorId();
    const A = await seedVenue(cat, 90, 100, 'dead');
    const B = await seedVenue(cat, 80, 100, 'alive');
    const f = await seedCampaignWithPlan({ name: 'E6 Idem', start: MON, end: TUE });
    await seedAllocation(f.planId, A.shId, 20000, 16, creneauxFor([MON, TUE], 1600, 16));
    await deliverSlot(f, A, MON, 8);
    await deliverSlot(f, A, MON, 9);

    const first = await runRedispatchRound(
      { id: f.campaignId, name: 'E6 Idem', startDate: MON, endDate: TUE },
      NOW,
    );
    expect(first.status).toBe('PLACED');

    // Five minutes later, same hour: gross missed unchanged (2 880), already replaced 2 880 →
    // net 0; reliquat 0 → total 0 < S_min. No double-count, no second round.
    const second = await runRedispatchRound(
      { id: f.campaignId, name: 'E6 Idem', startDate: MON, endDate: TUE },
      new Date(NOW.getTime() + 5 * 60_000),
    );
    expect(second.status).toBe('BELOW_THRESHOLD');
    expect(await roundsFor(f.campaignId)).toHaveLength(1);
    expect(await allocsFor(f.planId)).toHaveLength(2);
    expect((await notifsFor(B.ownerId)).length).toBe(1);
  });

  it('BOUNDARY (the amendment): total 19.99 TND stays put; 20.00 TND triggers — reliquat-only composition', async () => {
    const cat = await ownerSectorId();
    const A = await seedVenue(cat, 90, 100, 'alive');
    // Nothing elapsed yet (now = Mon 08:10 Tunis) → missed 0; the total is the STORED reliquat.
    const early = new Date('2026-07-20T07:10:00Z');
    const f = await seedCampaignWithPlan({
      name: 'E6 Boundary',
      start: MON,
      end: TUE,
      reliquat: 1999, // 19.99 TND at CPM 10
    });
    await seedAllocation(f.planId, A.shId, 20000, 16, creneauxFor([MON, TUE], 1600, 16));

    const below = await runRedispatchRound(
      { id: f.campaignId, name: 'E6 Boundary', startDate: MON, endDate: TUE },
      early,
    );
    expect(below).toEqual({ status: 'BELOW_THRESHOLD', totalValueTnd: 19.99 });

    // One facturable impression more: 2 000 → exactly 20.00 TND → the round fires, the reliquat
    // is CONSUMED (zeroed) and — A being alive with residual — MERGES onto A (re-consent).
    await db
      .update(campaignDispatchPlan)
      .set({ reliquatStocke: 2000 })
      .where(eq(campaignDispatchPlan.id, f.planId));
    const at = await runRedispatchRound(
      { id: f.campaignId, name: 'E6 Boundary', startDate: MON, endDate: TUE },
      early,
    );
    expect(at.status).toBe('PLACED');
    if (at.status !== 'PLACED') return;
    expect(at.vFact).toBe(2000);
    expect(at.reliquatConsumedFact).toBe(2000);
    expect((await planRow(f.planId))?.reliquatStocke).toBe(0);
    const rounds = await roundsFor(f.campaignId);
    expect(rounds[0]).toMatchObject({ missedFact: 0, reliquatConsumedFact: 2000 });
  });

  it('MERGE + RE-CONSENT: a retained ALIVE venue absorbs the dead venue’s miss — past créneaux preserved, future appended, back EN_ATTENTE', async () => {
    const cat = await ownerSectorId();
    const A = await seedVenue(cat, 90, 100, 'dead'); // 36 000 fact, dies without airing at all
    const B = await seedVenue(cat, 80, 100, 'alive'); // retained for 2 000, delivered everything
    const f = await seedCampaignWithPlan({ name: 'E6 Merge', start: MON, end: TUE });
    await seedAllocation(f.planId, A.shId, 36000, 30, creneauxFor([MON, TUE], 3000, 30));
    const bAllocId = await seedAllocation(
      f.planId,
      B.shId,
      2000,
      2,
      creneauxFor([MON, TUE], 200, 2),
    );
    for (const h of [8, 9, 10, 11, 12]) await deliverSlot(f, B, MON, h);

    const outcome = await runRedispatchRound(
      { id: f.campaignId, name: 'E6 Merge', startDate: MON, endDate: TUE },
      NOW,
    );

    // A missed its 5 elapsed slots: 15 000 phys → 9 000 fact (90 TND). B's own slots are all
    // delivered → B is NOT a defaulter and absorbs the miss into its EXISTING row.
    expect(outcome.status).toBe('PLACED');
    if (outcome.status !== 'PLACED') return;
    expect(outcome.vFact).toBe(9000);
    expect(outcome.placedTo).toEqual([{ screenhost_id: B.shId, added_fact: 9000, merged: true }]);

    const allocs = await allocsFor(f.planId);
    expect(allocs).toHaveLength(2); // NO new row — the (plan, screenhost) unique row was merged
    const merged = allocs.find((a) => a.id === bAllocId);
    // ai 2 000 + 9 000; r_i 2 + ⌊15 000 / 2 000⌋=7 → 9; the ORIGINAL 20 créneaux survive (the
    // reconciliation needs the past), the 14 future slots ride appended at the DELTA reps (700).
    expect(merged).toMatchObject({ iiPotentiel: 11000, rI: 9, statutAcceptation: 'EN_ATTENTE' });
    expect(merged?.creneaux).toHaveLength(34);
    expect(merged?.creneaux.slice(0, 20).every((c) => c.impressions === 200)).toBe(true);
    expect(
      merged?.creneaux
        .slice(20)
        .every((c) => c.impressions === 700 && (c.date > MON || c.hour > 13)),
    ).toBe(true);
    // The deal changed → the owner is re-asked (dispatch producer pattern).
    expect((await notifsFor(B.ownerId)).length).toBe(1);
  });

  it('NO FUTURE WINDOW: a fully-elapsed campaign records nothing — the residue waits for reconcile', async () => {
    const cat = await ownerSectorId();
    const A = await seedVenue(cat, 90, 100, 'dead');
    await seedVenue(cat, 80, 100, 'alive');
    const lastMon = '2026-07-13';
    const lastTue = '2026-07-14';
    const f = await seedCampaignWithPlan({ name: 'E6 Past', start: lastMon, end: lastTue });
    await seedAllocation(f.planId, A.shId, 20000, 16, creneauxFor([lastMon, lastTue], 1600, 16));

    const outcome = await runRedispatchRound(
      { id: f.campaignId, name: 'E6 Past', startDate: lastMon, endDate: lastTue },
      NOW,
    );
    expect(outcome.status).toBe('NO_FUTURE_WINDOW');
    expect(await roundsFor(f.campaignId)).toHaveLength(0);
    expect(await allocsFor(f.planId)).toHaveLength(1);
  });

  it('REFUSED REPLACEMENT: the reject route handles it (active → no cascade), and the NEXT round excludes the refuser → nothing placeable, no round row', async () => {
    const cat = await ownerSectorId();
    const A = await seedVenue(cat, 90, 100, 'dead');
    const B = await seedVenue(cat, 80, 100, 'alive');
    const f = await seedCampaignWithPlan({ name: 'E6 Refuse', start: MON, end: TUE });
    await seedAllocation(f.planId, A.shId, 20000, 16, creneauxFor([MON, TUE], 1600, 16));
    await deliverSlot(f, A, MON, 8);
    await deliverSlot(f, A, MON, 9);
    const first = await runRedispatchRound(
      { id: f.campaignId, name: 'E6 Refuse', startDate: MON, endDate: TUE },
      NOW,
    );
    expect(first.status).toBe('PLACED');
    const placed = (await allocsFor(f.planId)).find((a) => a.screenhostId === B.shId);

    // Owner B refuses the replacement through the REAL route: the campaign is ACTIVE, so the E3
    // cascade correctly does NOT fire (mid-flight re-placement is E6's job).
    const app = Fastify({ logger: false });
    await app.register(screenhostsRoutes);
    await app.ready();
    mockSession(B.ownerId);
    const res = await app.inject({
      method: 'POST',
      url: `/api/screenhosts/allocations/${placed?.id}/reject`,
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect((await allocsFor(f.planId)).length).toBe(2); // no cascade rows

    // Next morning: A's misses grew and B's refused future slots started elapsing undelivered —
    // but A is dead+defaulting and B is now a REFUSER: the pool is empty → the residue waits.
    const nextMorning = new Date('2026-07-21T09:30:00Z'); // Tue 10:30 Tunis
    const second = await runRedispatchRound(
      { id: f.campaignId, name: 'E6 Refuse', startDate: MON, endDate: TUE },
      nextMorning,
    );
    expect(second.status).toBe('NOTHING_PLACEABLE');
    expect(await roundsFor(f.campaignId)).toHaveLength(1); // only the first round is recorded
  });

  it('TICK WRAPPER: scans ACTIVE campaigns only; a placed round is counted', async () => {
    const cat = await ownerSectorId();
    const A = await seedVenue(cat, 90, 100, 'dead');
    await seedVenue(cat, 80, 100, 'alive');
    const f = await seedCampaignWithPlan({ name: 'E6 Tick', start: MON, end: TUE });
    await seedAllocation(f.planId, A.shId, 20000, 16, creneauxFor([MON, TUE], 1600, 16));
    await deliverSlot(f, A, MON, 8);
    await deliverSlot(f, A, MON, 9);
    // A draft with a plan must NOT be scanned.
    const advertiser = await seedUser({ role: 'advertiser' });
    await db.insert(campaigns).values({
      advertiserId: advertiser,
      name: 'E6 Draft',
      campaignType: 'standard',
      status: 'draft',
      startDate: MON,
      endDate: TUE,
    });

    const fakeLog = { warn: vi.fn(), info: vi.fn() } as never;
    const result = await runCampaignRedispatchTick(fakeLog, NOW);
    expect(result).toEqual({ scanned: 1, placedRounds: 1, failures: 0 });
  });
});
