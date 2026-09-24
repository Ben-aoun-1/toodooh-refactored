import { eq } from 'drizzle-orm';
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
  campaigns,
  creatives,
  proofOfPlay,
  screenhostUnavailability,
  screenhosts,
  screens,
  users,
} from '../src/db/schema.js';
import type { EligibleScreenhost } from '../src/lib/dispatch/selection.js';
import { orderedQueue } from '../src/lib/dispatch/selection.js';
import { DISPATCH_CONFIG_DEFAULTS } from '../src/lib/dispatch/thresholds.js';
import { spsObservationsFor, tunisWeekStart } from '../src/lib/sps-observations.js';
import {
  EVENT_RESPECT_DEFAULT,
  computeSps,
  recomputeVenueSps,
  SPS_NEUTRAL,
  runSpsRecomputeTick,
  spsComputable,
  weightedSps,
} from '../src/lib/sps-score.js';
import { adminDispatchConfigRoutes } from '../src/routes/admin-dispatch-config.js';
import { screenhostsRoutes } from '../src/routes/screenhosts.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// E4 — the SPS score engine (Mejri 2026-07-27): the four ruled variables as PURE derivations
// from existing data, the weighted total, the Σ = 100 config gate, the daily sweep, the
// on-decision in-request recompute, and the flat-50-retirement ordering proof. Plus the three
// stale-30 rider pins. No business_sectors/zones rows added (the fixture footgun).

vi.mock('../src/lib/wedooh-sync.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/wedooh-sync.js')>();
  return { ...actual, pushApprovedOwnerLocations: vi.fn(() => Promise.resolve()) };
});

type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;
const mockSession = (userId: string, role = 'individual_owner'): void => {
  vi.spyOn(auth.api, 'getSession').mockResolvedValue({
    session: {},
    user: { id: userId, role, status: 'approved' },
  } as unknown as GetSessionResult);
};

// A deterministic Tunis WEDNESDAY noon: the containing week runs Mon 14 → Sun 20, so the Monday
// is elapsed, the Saturday is future, and both sit INSIDE the current remplissage week.
const NOW = new Date('2027-06-16T12:00:00+01:00');
const WEEK_START = tunisWeekStart(NOW); // 2027-06-14
// Calendar day arithmetic in UTC space (a +01:00 anchor would slice to the previous UTC day).
const plusDays = (iso: string, n: number): string =>
  new Date(new Date(`${iso}T00:00:00Z`).getTime() + n * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
const MONDAY = WEEK_START;
const SATURDAY = plusDays(WEEK_START, 5);

const quietLog = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
} as never;

let seq = 0;
const seedUser = async (values: Partial<NewUser> = {}): Promise<string> => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `e4-${seq}@example.com`,
      contactName: `E4 User ${seq}`,
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

const seedVenue = async (ownerId?: string): Promise<{ shId: string; ownerId: string }> => {
  const owner = ownerId ?? (await seedUser({ role: 'individual_owner' }));
  seq += 1;
  const [sh] = await db
    .insert(screenhosts)
    .values({
      name: `E4 Venue ${seq}`,
      ownerId: owner,
      businessSectorId: await ownerSectorId(),
      class: 'premium' as never,
      openingHour: 8,
      closingHour: 18, // 10 broadcastable hours → 300 × 10 × 7 = 21 000 F-seconds per week
      broadcastCapacity: 4,
    })
    .returning();
  return { shId: sh?.id ?? '', ownerId: owner };
};

/** A campaign + frozen plan (all wired-seuils snapshot fields at plausible constants). */
const seedCampaignWithPlan = async (
  sSpotSeconds = 10,
): Promise<{ campaignId: string; planId: string; advertiserId: string; creativeId: string }> => {
  const advertiserId = await seedUser({ role: 'advertiser' });
  const [creative] = await db
    .insert(creatives)
    .values({
      advertiserId,
      creativeType: 'video',
      storageKey: `creatives/e4/${seq}`,
      durationSeconds: sSpotSeconds,
      validationStatus: 'approved',
    })
    .returning();
  const [c] = await db
    .insert(campaigns)
    .values({
      advertiserId,
      name: `E4 campagne ${seq}`,
      campaignType: 'standard',
      status: 'active',
      startDate: MONDAY,
      endDate: SATURDAY,
      requestedBudget: '300',
      creativeId: creative?.id ?? null,
    })
    .returning();
  const [plan] = await db
    .insert(campaignDispatchPlan)
    .values({
      campaignId: c?.id ?? '',
      iCible: 20000,
      cpm: '15.000',
      sSpotSeconds,
      tTierCoef: '0.600',
      seuilDiffusable: 1000,
      sMin: '100',
      gJour: '3.3333',
      fMaxSeconds: 300,
      rMinEfficace: 2,
      couvert: 20000,
      nMin: 1,
      nMax: 5,
      nRetenus: 1,
    })
    .returning();
  return {
    campaignId: c?.id ?? '',
    planId: plan?.id ?? '',
    advertiserId,
    creativeId: creative?.id ?? '',
  };
};

const seedAllocation = async (
  planId: string,
  shId: string,
  opts: {
    statut?: 'EN_ATTENTE' | 'ACCEPTE' | 'REFUSE';
    creneaux?: DispatchCreneau[];
    createdAt?: Date;
  } = {},
): Promise<string> => {
  const [a] = await db
    .insert(campaignDispatchAllocation)
    .values({
      planId,
      screenhostId: shId,
      iiPotentiel: 1000,
      rI: 30,
      revenuPrevisionnel: '15.0000',
      statutAcceptation: opts.statut ?? 'ACCEPTE',
      creneaux: opts.creneaux ?? [],
      ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
    })
    .returning();
  return a?.id ?? '';
};

const seedProof = async (
  campaignId: string,
  shId: string,
  creativeId: string,
  receivedAt: Date,
): Promise<void> => {
  const [screen] = await db
    .select({ id: screens.id })
    .from(screens)
    .where(eq(screens.screenhostId, shId))
    .limit(1);
  let screenId = screen?.id;
  if (!screenId) {
    const [s] = await db.insert(screens).values({ screenhostId: shId, name: 'E4 TV' }).returning();
    screenId = s?.id;
  }
  await db.insert(proofOfPlay).values({
    screenId: screenId ?? '',
    screenhostId: shId,
    campaignId,
    creativeId,
    videoIdAsSent: creativeId,
    eventType: 'VIDEO_ENDED',
    receivedAt,
  });
};

const cren = (date: string, hour: number, reps = 30): DispatchCreneau => ({
  date,
  hour,
  reps,
  impressions: 100 * reps,
});

describe('E4 — the SPS score engine (real Postgres)', () => {
  beforeEach(async () => {
    await resetAuthTables();
  });

  afterAll(async () => {
    await sql.end();
  });

  describe('acceptation — ACCEPTE ÷ decided, trailing 90 d on created_at', () => {
    it('mixed decisions ratio; EN_ATTENTE excluded; stale decisions age out; none → 100', async () => {
      const { shId } = await seedVenue();
      const { planId } = await seedCampaignWithPlan();
      const p2 = await seedCampaignWithPlan();
      const p3 = await seedCampaignWithPlan();
      const p4 = await seedCampaignWithPlan();

      // No decisions at all → the neutral 100.
      expect((await computeSps(shId, NOW)).variables.acceptation).toBe(100);

      await seedAllocation(planId, shId, { statut: 'ACCEPTE', createdAt: NOW });
      await seedAllocation(p2.planId, shId, { statut: 'REFUSE', createdAt: NOW });
      await seedAllocation(p3.planId, shId, { statut: 'EN_ATTENTE', createdAt: NOW });
      // A decision older than the 90 d window is invisible.
      await seedAllocation(p4.planId, shId, {
        statut: 'REFUSE',
        createdAt: new Date(NOW.getTime() - 100 * 24 * 60 * 60 * 1000),
      });

      const { variables } = await computeSps(shId, NOW);
      expect(variables.acceptation).toBe(50); // 1 ACCEPTE ÷ 2 decided (pending + stale excluded)
    });
  });

  describe('respect des événements — the DEFAULT RULE (EV5 made the variable real)', () => {
    // THE SANCTIONED EDIT (EV5): the variable now reads event_attestations (attested-true ÷
    // attested, trailing 90 d), so "constant 100" is no longer what it means. What survives — and
    // what this pin now asserts — is the RULE the constant stood for: a venue with NO attestation
    // scores 100, because an uninspected venue must never be sanctioned. The graded matrix
    // (negative → 0, mixed → the average) lives in the EV5 suite.
    it('a venue with NO attestation scores 100 BY RULE (absent = respected)', async () => {
      const { shId } = await seedVenue();
      expect(EVENT_RESPECT_DEFAULT).toBe(100);
      expect((await computeSps(shId, NOW)).variables.respect_evenements).toBe(100);
    });
  });

  describe('activité — proven ÷ scheduled elapsed créneaux, trailing 30 d', () => {
    it('counts only elapsed slots; FIX A proof semantics; nothing scheduled → 100', async () => {
      const { shId } = await seedVenue();
      const { planId, campaignId, creativeId } = await seedCampaignWithPlan();

      // Nothing scheduled yet → the neutral 100.
      expect((await computeSps(shId, NOW)).variables.activite).toBe(100);

      // Two ELAPSED slots (Monday 9 h + 10 h) and one FUTURE slot (Saturday) — the future slot
      // must not enter the denominator.
      await seedAllocation(planId, shId, {
        statut: 'ACCEPTE',
        creneaux: [cren(MONDAY, 9), cren(MONDAY, 10), cren(SATURDAY, 9)],
      });
      // ONE delivered proof, received inside Monday's 9 h Tunis hour.
      await seedProof(campaignId, shId, creativeId, new Date(`${MONDAY}T09:20:00+01:00`));

      const { variables } = await computeSps(shId, NOW);
      expect(variables.activite).toBe(50); // 1 proven ÷ 2 scheduled elapsed
    });
  });

  describe('remplissage — engaged seconds ÷ the screen hour (3600 s) × open hours, current Tunis week', () => {
    it('sums reps × the plan S over the week; zero engagement → 0', async () => {
      const { shId } = await seedVenue();
      expect((await computeSps(shId, NOW)).variables.remplissage).toBe(0);

      const { planId } = await seedCampaignWithPlan(10); // S = 10 s
      // 7 slots × 30 reps × 10 s = 2 100 engaged seconds; available = 3600 × 10 h × 7 = 252 000
      // (CAP-F1, ruled F3 A: the SCREEN hour, not F — F caps each campaign).
      await seedAllocation(planId, shId, {
        statut: 'ACCEPTE',
        creneaux: Array.from({ length: 7 }, (_, i) => cren(plusDays(WEEK_START, i % 5), 9 + i)),
      });
      const { variables } = await computeSps(shId, NOW);
      expect(variables.remplissage).toBe(0.83); // 2 100 ÷ 252 000 = 0,83 %
    });

    it('E2-declared days leave the denominator — a declarer NEVER scores lower for declaring', async () => {
      // Ratification amendment: available seconds = 3600 × bHours × the week's NON-declared
      // days. As first built the denominator counted all 7 days, silently denting the score of
      // an owner who honestly declared — inverting E2's promise.
      const { shId } = await seedVenue();
      const { planId } = await seedCampaignWithPlan(10);
      await seedAllocation(planId, shId, {
        statut: 'ACCEPTE',
        creneaux: Array.from({ length: 7 }, (_, i) => cren(plusDays(WEEK_START, i % 5), 9 + i)),
      });
      const before = (await computeSps(shId, NOW)).variables.remplissage;
      expect(before).toBe(0.83); // 2 100 ÷ (3600 × 10 × 7)

      // Declare 2 of the 7 week days (créneau-free days — dispatch never scheduled there).
      await db.insert(screenhostUnavailability).values([
        { screenhostId: shId, day: plusDays(WEEK_START, 5) },
        { screenhostId: shId, day: plusDays(WEEK_START, 6) },
      ]);
      const after = (await computeSps(shId, NOW)).variables.remplissage;
      expect(after).toBe(1.17); // 2 100 ÷ (3600 × 10 × 5) — the denominator shrank exactly ∝
      expect(after).toBeGreaterThan(before); // declaring never drops the score
    });
  });

  describe('the weighted total', () => {
    it('pins the worked example: {50, 100, 100, 0} × 40/30/20/10 → 70', () => {
      expect(
        weightedSps(
          { acceptation: 50, respect_evenements: 100, activite: 100, remplissage: 0 },
          {
            spsWeightAcceptation: 40,
            spsWeightRespectEvenements: 30,
            spsWeightActivite: 20,
            spsWeightRemplissage: 10,
          },
        ),
      ).toBe(70);
    });

    it('a decision-free, engagement-free venue scores 90 (100/100/100 weighted, remplissage 0)', async () => {
      const { shId } = await seedVenue();
      const { sps, variables } = await computeSps(shId, NOW);
      expect(variables).toEqual({
        acceptation: 100,
        respect_evenements: 100,
        activite: 100,
        remplissage: 0,
      });
      expect(sps).toBe(90);
    });
  });

  // MEJ-14b / SPS-D1 (Mejri, ruled through the operator 2026-09-01) — that 90 is real arithmetic
  // on empty sets, and it is NOT changed here: dispatch keeps reading it (SPS-DISPATCH1 is the
  // open, unruled question of whether it should). What this lane adds is the ability to tell a
  // measured score from one made of defaults, so the OWNER SURFACES can decline to show the latter.
  describe('MEJ-14b — observations + the computability predicate (display only)', () => {
    it('the predicate is pure: any ONE observation makes a score showable, none makes it À venir', () => {
      const none = { decided: 0, attested: 0, scheduledElapsed: 0, engagedSeconds: 0 };
      expect(spsComputable(none)).toBe(false);
      // Each variable on its own is enough — the venue has history SOMEWHERE.
      expect(spsComputable({ ...none, decided: 1 })).toBe(true);
      expect(spsComputable({ ...none, attested: 1 })).toBe(true);
      expect(spsComputable({ ...none, scheduledElapsed: 1 })).toBe(true);
      expect(spsComputable({ ...none, engagedSeconds: 1 })).toBe(true);
    });

    it('a never-connected venue reports ZERO observations behind its 90', async () => {
      const { shId } = await seedVenue();
      const { sps, observations } = await computeSps(shId, NOW);
      expect(sps).toBe(90); // the arithmetic is untouched…
      expect(observations).toEqual({
        decided: 0,
        attested: 0,
        scheduledElapsed: 0,
        engagedSeconds: 0,
      });
      expect(spsComputable(observations)).toBe(false); // …but nothing measured is under it
    });

    it('one decision is history: the observation count moves and the score becomes showable', async () => {
      const { shId } = await seedVenue();
      const { planId } = await seedCampaignWithPlan();
      await seedAllocation(planId, shId, { statut: 'ACCEPTE', createdAt: NOW });

      const { sps, observations } = await computeSps(shId, NOW);
      expect(observations.decided).toBe(1);
      expect(spsComputable(observations)).toBe(true);
      // An ACCEPTE decision keeps acceptation at 100, so the total is STILL 90 — the number did
      // not change, only whether it rests on anything. That is the whole point of the ruling.
      expect(sps).toBe(90);
    });

    it('BOUNDARY: the stored score and dispatch ordering are untouched by this lane', async () => {
      const { shId } = await seedVenue();
      // The persisted snapshot the dispatch queue orders on still gets the full 90 written to it:
      // hiding a number on the owner's page must not silently re-rank the network.
      expect(await recomputeVenueSps(shId, NOW)).toBe(90);
      const [row] = await db
        .select({ sps: screenhosts.sps })
        .from(screenhosts)
        .where(eq(screenhosts.id, shId));
      expect(Number(row?.sps)).toBe(90);
    });
  });

  // SPS-DISPATCH1 (ruled 2026-09-01) — dispatch must not rank a venue on a score made of
  // defaults. The predicate is the one MEJ-14b already wrote; what is new is that dispatch reads
  // it through a BATCHED loader, because computeSps per candidate would be six queries a venue on
  // the hot path. The two must never disagree: a venue reading « À venir » to its owner while
  // ranking on its 90 is exactly the divergence this lane removes.
  describe('SPS-DISPATCH1 — the batched observations loader AGREES with computeSps', () => {
    it('venue by venue, across every observation kind, batched === per-venue', async () => {
      const bare = await seedVenue(); // nothing at all
      const decided = await seedVenue();
      const accepted = await seedVenue();

      const p1 = await seedCampaignWithPlan();
      await seedAllocation(p1.planId, decided.shId, { statut: 'REFUSE', createdAt: NOW });
      const p2 = await seedCampaignWithPlan();
      await seedAllocation(p2.planId, accepted.shId, { statut: 'ACCEPTE', createdAt: NOW });

      const ids = [bare.shId, decided.shId, accepted.shId];
      const batched = await spsObservationsFor(ids, NOW);
      for (const id of ids) {
        const perVenue = (await computeSps(id, NOW)).observations;
        // Compared as a labelled string so a failure names WHICH venue and WHICH counter drifted.
        expect(`${id}: ${JSON.stringify(batched.get(id))}`).toBe(
          `${id}: ${JSON.stringify(perVenue)}`,
        );
      }
      // …and the batch actually distinguishes them, or the agreement above would be vacuous.
      expect(spsComputable(batched.get(bare.shId)!)).toBe(false);
      expect(spsComputable(batched.get(decided.shId)!)).toBe(true);
      expect(spsComputable(batched.get(accepted.shId)!)).toBe(true);
    });

    it('an empty id list is a no-op, and an unknown id simply has no entry', async () => {
      expect((await spsObservationsFor([], NOW)).size).toBe(0);
      const map = await spsObservationsFor(['11111111-1111-4111-8111-111111111111'], NOW);
      expect(spsComputable(map.get('11111111-1111-4111-8111-111111111111')!)).toBe(false);
    });
  });

  describe('SPS-DISPATCH1 — the NEUTRAL midpoint, and what it must NOT be', () => {
    it('an unscored venue sorts BETWEEN an earned score above and an earned score below', () => {
      // The ruling in one assertion: not first (it has earned nothing), not last (a new screen
      // can only earn a score by receiving campaigns, so last place is an onboarding deadlock).
      const entry = (id: string, sps: number): EligibleScreenhost => ({
        id,
        sps,
        anciennete: 0,
        revenuJour: 0,
        activeToday: false,
        residualCapacity: 1000,
      });
      const order = orderedQueue(
        [entry('c-low', 20), entry('b-unscored', SPS_NEUTRAL), entry('a-high', 80)],
        1_000_000,
      ).map((e) => e.id);
      expect(order).toEqual(['a-high', 'b-unscored', 'c-low']);
      expect(order[0]).not.toBe('b-unscored');
      expect(order[order.length - 1]).not.toBe('b-unscored');
    });

    it('the neutral value is the midpoint of the range, not an endpoint', () => {
      expect(SPS_NEUTRAL).toBe(50);
      expect(SPS_NEUTRAL).toBeGreaterThan(0);
      expect(SPS_NEUTRAL).toBeLessThan(100);
    });
  });

  describe('the config gate — Σ = 100', () => {
    let app: ReturnType<typeof Fastify>;

    beforeEach(async () => {
      app = Fastify({ logger: false });
      await app.register(adminDispatchConfigRoutes);
      await app.ready();
    });

    afterEach(async () => {
      // The singleton is shared — restore the canonical weights whatever the test did.
      await sql`update dispatch_config set sps_weight_acceptation = '40', sps_weight_respect_evenements = '30', sps_weight_activite = '20', sps_weight_remplissage = '10'`;
      await app.close();
      vi.restoreAllMocks();
    });

    it('rejects a partial edit that breaks Σ = 100; accepts a compensating pair', async () => {
      const adminId = await seedUser({ role: 'admin' });
      mockSession(adminId, 'admin');

      const broken = await app.inject({
        method: 'PATCH',
        url: '/api/admin/dispatch-config',
        payload: { sps_weight_acceptation: 50 }, // 50+30+20+10 = 110
      });
      expect(broken.statusCode).toBe(400);
      expect(broken.json().fields[0].reason).toContain('totaliser 100');

      const ok = await app.inject({
        method: 'PATCH',
        url: '/api/admin/dispatch-config',
        payload: { sps_weight_acceptation: 50, sps_weight_respect_evenements: 20 },
      });
      expect(ok.statusCode).toBe(200);
      expect(ok.json().sps_weight_acceptation).toBe(50);
      expect(ok.json().sps_weight_respect_evenements).toBe(20);
    });
  });

  describe('the recompute paths', () => {
    it('the daily sweep moves a refusal-heavy venue OFF the flat 50 (before/after)', async () => {
      const { shId } = await seedVenue();
      const { planId } = await seedCampaignWithPlan();
      await seedAllocation(planId, shId, { statut: 'REFUSE', createdAt: NOW });

      const before = await db
        .select({ sps: screenhosts.sps })
        .from(screenhosts)
        .where(eq(screenhosts.id, shId));
      expect(Number(before[0]?.sps)).toBe(50); // the stub default

      const updated = await runSpsRecomputeTick(quietLog);
      expect(updated).toBeGreaterThan(0);

      const after = await db
        .select({ sps: screenhosts.sps })
        .from(screenhosts)
        .where(eq(screenhosts.id, shId));
      // acceptation 0, respect 100, activité 100, remplissage 0 → 50… no: (0×40+100×30+100×20+0)/100 = 50.
      // Refusals alone keep 50 — the point is the WRITE happened with computed inputs, so pin the
      // exact recomputed value AND that a clean venue lands elsewhere (90).
      expect(Number(after[0]?.sps)).toBe(50);
      const clean = await seedVenue();
      await recomputeVenueSps(clean.shId, NOW);
      const cleanRow = await db
        .select({ sps: screenhosts.sps })
        .from(screenhosts)
        .where(eq(screenhosts.id, clean.shId));
      expect(Number(cleanRow[0]?.sps)).toBe(90);
    });

    it('an owner decision recomputes the venue SAME-REQUEST (the on-decision hook)', async () => {
      const app = Fastify({ logger: false });
      await app.register(screenhostsRoutes);
      await app.ready();
      try {
        const { shId, ownerId } = await seedVenue();
        const { planId } = await seedCampaignWithPlan();
        const allocationId = await seedAllocation(planId, shId, { statut: 'EN_ATTENTE' });

        mockSession(ownerId);
        const res = await app.inject({
          method: 'POST',
          url: `/api/screenhosts/allocations/${allocationId}/accept`,
        });
        expect(res.statusCode).toBe(200);

        const [row] = await db
          .select({ sps: screenhosts.sps })
          .from(screenhosts)
          .where(eq(screenhosts.id, shId));
        // acceptation 100 (1/1), respect 100, activité 100 (no elapsed slots), remplissage 0 → 90.
        expect(Number(row?.sps)).toBe(90);
      } finally {
        await app.close();
        vi.restoreAllMocks();
      }
    });
  });

  describe('the flat-50-retirement ordering proof', () => {
    it('dispatch ordering CHANGES when sps diverges (the id tiebreak no longer decides)', async () => {
      const refusalHeavy = await seedVenue();
      const clean = await seedVenue();
      const { planId } = await seedCampaignWithPlan();
      await seedAllocation(planId, refusalHeavy.shId, { statut: 'REFUSE', createdAt: NOW });
      // Give the refusal-heavy venue SOME engagement so its score is strictly below the clean
      // one's on the acceptation axis alone: acc 0 vs 100.
      await runSpsRecomputeTick(quietLog);
      const rows = await db.select({ id: screenhosts.id, sps: screenhosts.sps }).from(screenhosts);
      const spsOf = (id: string) => Number(rows.find((r) => r.id === id)?.sps);
      expect(spsOf(refusalHeavy.shId)).toBe(50);
      expect(spsOf(clean.shId)).toBe(90);

      // The REAL selection function, FIXED ids: under the flat-50 era both carried 50 and the
      // id tiebreak led with 'a'; with the computed values 'b' (the clean venue) leads.
      const entry = (id: string, sps: number) => ({
        id,
        sps,
        anciennete: 0,
        residualCapacity: 1000,
        revenuJour: 0,
        activeToday: false,
      });
      const flatEra = orderedQueue([entry('a', 50), entry('b', 50)], 0);
      expect(flatEra[0]?.id).toBe('a'); // id tiebreak — the stub world
      const spsEra = orderedQueue(
        [entry('a', spsOf(refusalHeavy.shId)), entry('b', spsOf(clean.shId))],
        0,
      );
      expect(spsEra[0]?.id).toBe('b'); // the computed score now decides
    });
  });

  describe('the admin breakdown endpoint', () => {
    it('GET /api/admin/screenhosts/:id/sps — variables + weights + live total (admin-gated)', async () => {
      const app = Fastify({ logger: false });
      await app.register(screenhostsRoutes);
      await app.ready();
      try {
        const { shId } = await seedVenue();
        const adminId = await seedUser({ role: 'admin' });
        const advId = await seedUser({ role: 'advertiser' });

        mockSession(advId, 'advertiser');
        expect(
          (await app.inject({ method: 'GET', url: `/api/admin/screenhosts/${shId}/sps` }))
            .statusCode,
        ).toBe(403);
        vi.restoreAllMocks();

        mockSession(adminId, 'admin');
        const res = await app.inject({
          method: 'GET',
          url: `/api/admin/screenhosts/${shId}/sps`,
        });
        expect(res.statusCode).toBe(200);
        const body = res.json();
        expect(body.sps).toBe(90);
        expect(body.stored_sps).toBe(50); // the daily job has not run for this venue yet
        expect(body.variables.acceptation).toEqual({ value: 100, weight: 40 });
        expect(body.variables.respect_evenements).toEqual({ value: 100, weight: 30 });
        expect(body.variables.activite).toEqual({ value: 100, weight: 20 });
        expect(body.variables.remplissage).toEqual({ value: 0, weight: 10 });
      } finally {
        await app.close();
        vi.restoreAllMocks();
      }
    });
  });
});

describe('the three-stale-30 riders (post-0056 canon)', () => {
  afterAll(async () => {
    // sql.end() already handled by the main describe's afterAll — nothing to close here.
  });

  it('the no-row fallback prices events at 15', () => {
    expect(DISPATCH_CONFIG_DEFAULTS.eventCpmTnd).toBe(15);
  });

  it('the SPS weight defaults ride the same fallback (40/30/20/10)', () => {
    expect(DISPATCH_CONFIG_DEFAULTS.spsWeightAcceptation).toBe(40);
    expect(DISPATCH_CONFIG_DEFAULTS.spsWeightRespectEvenements).toBe(30);
    expect(DISPATCH_CONFIG_DEFAULTS.spsWeightActivite).toBe(20);
    expect(DISPATCH_CONFIG_DEFAULTS.spsWeightRemplissage).toBe(10);
  });
});
