import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { db, sql } from '../src/db/client.js';
import {
  type DispatchCreneau,
  type NewUser,
  campaignDispatchAllocation,
  campaignDispatchPlan,
  campaignReconciliation,
  campaigns,
  creatives,
  proofOfPlay,
  screenhosts,
  screens,
  users,
} from '../src/db/schema.js';
import { runCampaignLifecycleTick } from '../src/lib/campaign-lifecycle.js';
import { reconcileCampaignById } from '../src/lib/reconcile/reconcile-service.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// The service is mocked AT THE MODULE BOUNDARY (the renderSpy idiom — ESM local bindings defeat
// namespace spies): passthrough to the real service by default, overridable per test.
type ReconcileFn =
  (typeof import('../src/lib/reconcile/reconcile-service.js'))['reconcileCampaignById'];
const seam = vi.hoisted(() => ({
  spy: vi.fn() as ReturnType<typeof vi.fn>,
  actual: undefined as ReconcileFn | undefined,
}));
vi.mock('../src/lib/reconcile/reconcile-service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/reconcile/reconcile-service.js')>();
  seam.actual = actual.reconcileCampaignById;
  return { ...actual, reconcileCampaignById: seam.spy };
});

// SETTLE2 (operator ruling 2026-08-10) — the ARMED auto-settlement trigger, real Postgres: a
// campaign the lifecycle tick flips active→completed settles ON THAT TICK through the untouched
// reconcile service, with NULL = system actor, one log line per attempt, and failure isolation
// (a throwing settlement never breaks the tick or its siblings). cpm=10, T=1.0 (the
// admin-reconcile suite's fixture convention).

const CRENEAUX: DispatchCreneau[] = [
  { date: '2024-01-01', hour: 10, reps: 100, impressions: 3000 },
  { date: '2024-01-01', hour: 11, reps: 100, impressions: 3000 },
];

let seq = 0;
const seedUser = async (values: Partial<NewUser> = {}): Promise<string> => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `settle2-${seq}@example.com`,
      contactName: `S2 User ${seq}`,
      role: 'advertiser',
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

interface Scenario {
  campaignId: string;
  screenhostId: string;
  screenId: string;
  creativeId: string;
}

/** An ACTIVE campaign past its end date (the tick will flip it) + frozen plan + allocation. */
const seedEndingCampaign = async (name: string): Promise<Scenario> => {
  const advertiser = await seedUser();
  const owner = await seedUser({ role: 'individual_owner' });
  const [sh] = await db
    .insert(screenhosts)
    .values({ name: `S2 Venue ${seq}`, ownerId: owner })
    .returning();
  const [screen] = await db
    .insert(screens)
    .values({ screenhostId: sh?.id ?? '', name: 'S2 TV' })
    .returning();
  const [creative] = await db
    .insert(creatives)
    .values({
      advertiserId: advertiser,
      creativeType: 'video',
      storageKey: `creatives/settle2/${seq}`,
      durationSeconds: 20,
      validationStatus: 'approved',
    })
    .returning();
  const iiPotentiel = CRENEAUX.reduce((s, c) => s + c.impressions, 0);
  const [campaign] = await db
    .insert(campaigns)
    .values({
      advertiserId: advertiser,
      name,
      campaignType: 'standard',
      status: 'active',
      startDate: '2024-01-01',
      endDate: '2024-01-02',
      creativeId: creative?.id,
      requestedBudget: '400.00',
    })
    .returning();
  const [plan] = await db
    .insert(campaignDispatchPlan)
    .values({
      campaignId: campaign?.id ?? '',
      iCible: iiPotentiel,
      cpm: '10',
      sSpotSeconds: 10,
      tTierCoef: '1.0',
      seuilDiffusable: 1000,
      sMin: '10',
      gJour: '3.33',
      fMaxSeconds: 300,
      rMinEfficace: 2,
      couvert: iiPotentiel,
      nMin: 1,
      nMax: 20,
      nRetenus: 1,
    })
    .returning();
  await db.insert(campaignDispatchAllocation).values({
    planId: plan?.id ?? '',
    screenhostId: sh?.id ?? '',
    iiPotentiel,
    rI: 100,
    revenuPrevisionnel: String((iiPotentiel * 10) / 1000),
    creneaux: CRENEAUX,
  });
  return {
    campaignId: campaign?.id ?? '',
    screenhostId: sh?.id ?? '',
    screenId: screen?.id ?? '',
    creativeId: creative?.id ?? '',
  };
};

const deliverSlot = async (s: Scenario, date: string, tunisHour: number): Promise<void> => {
  const utcHour = String(tunisHour - 1).padStart(2, '0');
  await db.insert(proofOfPlay).values({
    screenId: s.screenId,
    screenhostId: s.screenhostId,
    campaignId: s.campaignId,
    creativeId: s.creativeId,
    videoIdAsSent: s.creativeId,
    eventType: 'VIDEO_ENDED',
    playedDurationMs: 10_000,
    receivedAt: new Date(`${date}T${utcHour}:30:00Z`),
  });
};

/** A log capture: the per-attempt visibility pin reads these. */
const captureLog = () => {
  const infos: { obj: Record<string, unknown>; msg: string | undefined }[] = [];
  const errors: { obj: Record<string, unknown>; msg: string | undefined }[] = [];
  const log = {
    info: (obj: Record<string, unknown>, msg?: string) => {
      infos.push({ obj, msg });
    },
    error: (obj: Record<string, unknown>, msg?: string) => {
      errors.push({ obj, msg });
    },
    warn: () => undefined,
    debug: () => undefined,
    fatal: () => undefined,
    trace: () => undefined,
    child: () => log,
    level: 'silent',
  };
  return { infos, errors, log: log as unknown as Parameters<typeof runCampaignLifecycleTick>[0] };
};

const attemptsOf = (entries: { obj: Record<string, unknown>; msg: string | undefined }[]) =>
  entries.filter((e) => e.msg?.startsWith('auto-settlement attempt'));

describe('SETTLE2 — the armed auto-settlement trigger (real Postgres)', () => {
  beforeEach(async () => {
    await resetAuthTables();
    // Passthrough by default — the REAL service settles; tests override per campaign.
    seam.spy.mockReset();
    seam.spy.mockImplementation((campaignId, by) => {
      if (!seam.actual) throw new Error('seam.actual not captured');
      return seam.actual(campaignId as string, by as string | null);
    });
  });
  afterAll(async () => {
    await sql.end();
  });

  it('a campaign completing on the tick SETTLES on that tick — system actor NULL, one log line', async () => {
    const z = await seedEndingCampaign('auto-ky');
    await deliverSlot(z, '2024-01-01', 10);
    const { infos, log } = captureLog();

    const result = await runCampaignLifecycleTick(log);
    expect(result.completed).toBe(1);

    const [row] = await db
      .select()
      .from(campaignReconciliation)
      .where(eq(campaignReconciliation.campaignId, z.campaignId));
    expect(row).toBeDefined();
    expect(Number(row?.spendTnd)).toBe(30); // 3000 of 6000 delivered @ 0.01, T=1
    expect(Number(row?.refundTnd)).toBe(30);
    expect(row?.reconciledBy).toBeNull(); // NULL = the SYSTEM actor (the activated_by idiom)

    const attempts = attemptsOf(infos);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.obj).toMatchObject({
      campaignId: z.campaignId,
      outcome: 'settled',
      spendTnd: 30,
      refundTnd: 30,
    });
  });

  it('a THROWING settlement leaves the tick alive and the sibling settled — the error is loud', async () => {
    const failing = await seedEndingCampaign('auto-casse');
    const healthy = await seedEndingCampaign('auto-marche');
    await deliverSlot(healthy, '2024-01-01', 10);
    const { infos, errors, log } = captureLog();

    seam.spy.mockImplementation(async (campaignId, by) => {
      if (campaignId === failing.campaignId) throw new Error('settle2: forced settlement crash');
      if (!seam.actual) throw new Error('seam.actual not captured');
      return seam.actual(campaignId as string, by as string | null);
    });

    const result = await runCampaignLifecycleTick(log);
    expect(result.completed).toBe(2); // the tick finished its pass — it never died

    expect(
      await db
        .select()
        .from(campaignReconciliation)
        .where(eq(campaignReconciliation.campaignId, healthy.campaignId)),
    ).toHaveLength(1);
    expect(
      await db
        .select()
        .from(campaignReconciliation)
        .where(eq(campaignReconciliation.campaignId, failing.campaignId)),
    ).toHaveLength(0); // stays unreconciled — retried naturally next tick

    // Loud per-attempt visibility on BOTH paths: one error line, one settled line.
    expect(attemptsOf(errors)).toHaveLength(1);
    expect(attemptsOf(errors)[0]?.obj).toMatchObject({
      campaignId: failing.campaignId,
      outcome: 'ERROR',
    });
    expect(attemptsOf(infos)).toHaveLength(1);
    expect(attemptsOf(infos)[0]?.obj).toMatchObject({
      campaignId: healthy.campaignId,
      outcome: 'settled',
    });
  });

  it('an already-reconciled campaign skips through the service idempotence — logged, single row', async () => {
    const z = await seedEndingCampaign('auto-deja');
    // Pre-settled (e.g. by the SETTLE1 runner) BEFORE the tick flips it.
    await reconcileCampaignById(z.campaignId, null);
    const { infos, log } = captureLog();

    const result = await runCampaignLifecycleTick(log);
    expect(result.completed).toBe(1);

    expect(
      await db
        .select()
        .from(campaignReconciliation)
        .where(eq(campaignReconciliation.campaignId, z.campaignId)),
    ).toHaveLength(1); // never double-settled
    const attempts = attemptsOf(infos);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.obj).toMatchObject({
      campaignId: z.campaignId,
      outcome: 'ALREADY_RECONCILED',
    });
  });
});
