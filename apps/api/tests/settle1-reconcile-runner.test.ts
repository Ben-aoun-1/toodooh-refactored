import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { collectSettlementInventory, runSettlementWalk } from '../scripts/reconcile-run.js';
import { db, sql } from '../src/db/client.js';
import {
  type DispatchCreneau,
  type NewUser,
  campaignDispatchAllocation,
  campaignDispatchPlan,
  campaignReconciliation,
  campaignScreenhostPayout,
  campaigns,
  creatives,
  events,
  proofOfPlay,
  recharges,
  reversementLines,
  screenhosts,
  screens,
  users,
} from '../src/db/schema.js';
import { walletLedger } from '../src/lib/wallet-ledger.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// SETTLE1 — the settlement runner against real Postgres, on fixtures shaped like prod's zombies:
// ENDED campaigns (status 'completed' — the lifecycle tick has flipped them, which is exactly why
// the admin route can no longer reconcile them) that never settled. cpm=10 (0.01 TND/imp), T=1.0
// (the admin-reconcile suite's convention: route/wallet mechanics here, T-math pinned in e6).
// NOW is real time; fixtures end in 2024 — ended long ago under any clock.

let seq = 0;
const seedUser = async (values: Partial<NewUser> = {}): Promise<string> => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `settle${seq}@example.com`,
      contactName: `Settle User ${seq}`,
      role: 'advertiser',
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

interface Scenario {
  advertiser: string;
  campaignId: string;
  screenhostId: string;
  screenId: string;
  creativeId: string;
}

const DEFAULT_CRENEAUX: DispatchCreneau[] = [
  { date: '2024-01-01', hour: 10, reps: 100, impressions: 3000 },
  { date: '2024-01-01', hour: 11, reps: 100, impressions: 3000 },
];

/** An ENDED-unreconciled zombie: completed campaign + frozen plan + one venue allocation. */
const seedZombie = async (
  opts: {
    creneaux?: DispatchCreneau[];
    advertiser?: string;
    advertiserName?: string;
    status?: 'active' | 'completed' | 'pending';
    eventBound?: boolean;
    noPlan?: boolean;
    name?: string;
  } = {},
): Promise<Scenario> => {
  const creneaux = opts.creneaux ?? DEFAULT_CRENEAUX;
  const iiPotentiel = creneaux.reduce((s, c) => s + c.impressions, 0);
  const advertiser =
    opts.advertiser ??
    (await seedUser(opts.advertiserName === undefined ? {} : { contactName: opts.advertiserName }));
  const owner = await seedUser({ role: 'individual_owner' });
  const [sh] = await db
    .insert(screenhosts)
    .values({ name: `Venue ${seq}`, ownerId: owner })
    .returning();
  const [screen] = await db
    .insert(screens)
    .values({ screenhostId: sh?.id ?? '', name: 'Screen' })
    .returning();
  const [creative] = await db
    .insert(creatives)
    .values({
      advertiserId: advertiser,
      creativeType: 'video',
      storageKey: `creatives/settle/${seq}`,
      durationSeconds: 20,
      validationStatus: 'approved',
    })
    .returning();
  let eventId: string | null = null;
  if (opts.eventBound) {
    const [ev] = await db
      .insert(events)
      .values({
        name: `Settle Event ${seq}`,
        kickoffAt: new Date('2024-01-01T18:00:00Z'),
        endsAt: new Date('2024-01-01T20:00:00Z'),
      })
      .returning();
    eventId = ev?.id ?? null;
  }
  const [campaign] = await db
    .insert(campaigns)
    .values({
      advertiserId: advertiser,
      name: opts.name ?? `Zombie ${seq}`,
      campaignType: 'standard',
      status: opts.status ?? 'completed',
      startDate: '2024-01-01',
      endDate: '2024-01-02',
      creativeId: creative?.id,
      requestedBudget: '400.00',
      eventId,
    })
    .returning();
  if (!opts.noPlan && !opts.eventBound) {
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
      creneaux,
    });
  }
  return {
    advertiser,
    campaignId: campaign?.id ?? '',
    screenhostId: sh?.id ?? '',
    screenId: screen?.id ?? '',
    creativeId: creative?.id ?? '',
  };
};

/** Deliver a créneau: VIDEO_ENDED proofs whose received_at lands in (date, tunisHour) — UTC+1. */
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

const settledRowsOf = (campaignId: string) =>
  db.select().from(campaignReconciliation).where(eq(campaignReconciliation.campaignId, campaignId));

describe('SETTLE1 — the settlement runner (real Postgres)', () => {
  let admin: string;

  beforeEach(async () => {
    await resetAuthTables();
    admin = await seedUser({ role: 'admin' });
  });
  afterAll(async () => {
    await sql.end();
  });

  it('DRY-RUN mutates nothing: full inventory with previews, zero rows written', async () => {
    const partial = await seedZombie({ name: 'ky' });
    await deliverSlot(partial, '2024-01-01', 10); // 1 of 2 slots delivered
    await seedZombie({ name: 'khvutfyu' }); // zero proofs, value 60 TND ≥ S_min → refund-full
    await seedZombie({ noPlan: true, name: 'sans-plan' });
    await seedZombie({ eventBound: true, name: 'position-event' });
    await seedZombie({ status: 'pending', name: 'jamais-lancée' });

    const inv = await collectSettlementInventory();
    expect(inv.rows).toHaveLength(3); // ky + khvutfyu + sans-plan (classic, active/completed)
    expect(inv.eventPositioningsSkipped).toBe(1);
    expect(inv.neverLaunchedSkipped).toBe(1);
    expect(inv.protectedViolations).toHaveLength(0);

    const byName = new Map(inv.rows.map((r) => [r.name, r]));
    // partial: 3000 of 6000 delivered @0.01 → spend 30, refund 30 (gap ≥ S_min 20).
    expect(byName.get('ky')).toMatchObject({
      outcome: 'partial',
      preview: { deliveredImp: 3000, spendTnd: 30, refundTnd: 30, status: 'partial' },
    });
    // zero proofs, full 60 TND gap → full refund.
    expect(byName.get('khvutfyu')).toMatchObject({
      outcome: 'refund-full',
      preview: { deliveredImp: 0, spendTnd: 0, refundTnd: 60 },
    });
    expect(byName.get('sans-plan')).toMatchObject({ outcome: 'no-plan-skip', preview: null });

    // NOTHING written — the dry-run is a pure read.
    expect(await db.select().from(campaignReconciliation)).toHaveLength(0);
    expect(await db.select().from(campaignScreenhostPayout)).toHaveLength(0);
    expect(await db.select().from(reversementLines)).toHaveLength(0);
  });

  it('réussie shape: ended + zero proofs but a sub-S_min plan → FULL SPEND, no refund', async () => {
    await seedZombie({
      name: 'petit',
      creneaux: [{ date: '2024-01-01', hour: 10, reps: 100, impressions: 1500 }], // value 15 TND < S_min 20
    });
    const inv = await collectSettlementInventory();
    expect(inv.rows[0]).toMatchObject({
      outcome: 'spend',
      preview: { deliveredImp: 0, spendTnd: 15, refundTnd: 0, status: 'reussie' },
    });
  });

  it('--execute settles each shape CONSERVED (spend + refund = plan value), preview ≡ persisted', async () => {
    const partial = await seedZombie({ name: 'ky' });
    await deliverSlot(partial, '2024-01-01', 10);
    const fullRefund = await seedZombie({ name: 'khvutfyu' });

    const inv = await collectSettlementInventory();
    const walk = await runSettlementWalk(inv, admin);
    expect(walk.settled).toHaveLength(2);
    expect(walk.skipped).toHaveLength(0);

    for (const s of [partial, fullRefund]) {
      const [row] = await settledRowsOf(s.campaignId);
      const preview = inv.rows.find((r) => r.campaignId === s.campaignId)?.preview;
      // The dry-run PREVIEW is exactly what --execute persisted (same load + same pure math).
      expect(Number(row?.spendTnd)).toBe(preview?.spendTnd);
      expect(Number(row?.refundTnd)).toBe(preview?.refundTnd);
      expect(row?.status).toBe(preview?.status);
      // E6 conservation: spend + refund ≡ the plan's promised value (6000 imp @ 0.01, T=1).
      expect(Number(row?.spendTnd) + Number(row?.refundTnd)).toBe(60);
    }

    // The delivered venue got its E7 reversement line; the zero-delivery one none.
    const lines = await db.select().from(reversementLines);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.screenhostId).toBe(partial.screenhostId);
    expect(lines[0]?.campaignId).toBe(partial.campaignId);
  });

  it('running the walk twice is idempotent — the second pass no-ops with ALREADY_RECONCILED', async () => {
    const z = await seedZombie({ name: 'ky' });
    await deliverSlot(z, '2024-01-01', 10);

    const first = await runSettlementWalk(await collectSettlementInventory(), admin);
    expect(first.settled).toHaveLength(1);

    // The settled campaign leaves the inventory entirely (left-join-null); forcing the walk over
    // a stale inventory still no-ops through the service's unique(campaign_id) guard.
    const freshInv = await collectSettlementInventory();
    expect(freshInv.rows).toHaveLength(0);
    const second = await runSettlementWalk(
      { ...freshInv, rows: (await collectSettlementInventory(new Date(), z.campaignId)).rows },
      admin,
    );
    expect(second.settled).toHaveLength(0);
    expect(await settledRowsOf(z.campaignId)).toHaveLength(1);
  });

  it('the FIX2 ledger: a limbo campaign gains its settlement row through the walk', async () => {
    const z = await seedZombie({ name: 'ky' });
    await deliverSlot(z, '2024-01-01', 10);
    await db.insert(recharges).values({
      advertiserId: z.advertiser,
      amountTnd: '5000.00',
      status: 'confirmed',
      reference: `ST1-${Math.random().toString(16).slice(2, 8)}`,
    });

    // Before: LIMBO — ended-unreconciled shows NEITHER engagé NOR settlement (FIX2b ruling).
    const before = await walletLedger(z.advertiser);
    expect(before.transactions.filter((r) => r.type !== 'recharge')).toHaveLength(0);
    expect(before.solde).toMatchObject({ total_tnd: 5000, engaged_tnd: 0, spendable_tnd: 5000 });

    await runSettlementWalk(await collectSettlementInventory(), admin);

    // After: the limbo resolves into the NET settlement row; « Solde total » turns truthful.
    const after = await walletLedger(z.advertiser);
    const settlement = after.transactions.find((r) => r.type === 'settlement');
    expect(settlement).toMatchObject({ label: 'ky', amount_tnd: -30, campaign_id: z.campaignId });
    expect(after.solde).toMatchObject({ total_tnd: 4970, engaged_tnd: 0, spendable_tnd: 4970 });
  });

  it('PROTECTED accounts: a matching advertiser flags the inventory and the walk REFUSES', async () => {
    // A synthetic local user carrying a protected marker — pins the guard; the real accounts
    // live only in prod and are never touched by fixtures.
    await seedZombie({ name: 'interdite', advertiserName: 'BILEL KHALED' });
    const inv = await collectSettlementInventory();
    expect(inv.protectedViolations).toHaveLength(1);
    expect(inv.rows[0]?.outcome).toBe('protected-VIOLATION');
    await expect(runSettlementWalk(inv, admin)).rejects.toThrow(/protected-account violation/);
    expect(await db.select().from(campaignReconciliation)).toHaveLength(0);
  });
});
