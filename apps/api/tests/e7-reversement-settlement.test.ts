import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { db, sql } from '../src/db/client.js';
import {
  type DispatchCreneau,
  type NewUser,
  agentReferrals,
  agents,
  campaignDispatchAllocation,
  campaignDispatchPlan,
  campaignReconciliation,
  campaignScreenhostPayout,
  campaigns,
  creatives,
  dispatchConfig,
  proofOfPlay,
  reversementLines,
  screenhosts,
  screens,
  users,
} from '../src/db/schema.js';
import { reconcileCampaignById } from '../src/lib/reconcile/reconcile-service.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// E7 (VF EPIC 5) — settlement writes the 50/44/3/3 reversement lines and the venue payable
// becomes the 50 % SH line (was 100 % of delivered value). Real Postgres; the E6 valuation math
// (refund gate, conservation identity) is UNTOUCHED — only the CREDIT and the new ledger change.
// Harness mirrors admin-reconcile.test.ts: cpm=10 (0.01 TND/imp), T=1, s_min=10.

let seq = 0;
const seedUser = async (values: Partial<NewUser> = {}): Promise<string> => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `e7-${seq}@example.com`,
      contactName: `User ${seq}`,
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

const DEFAULT_CRENEAUX: DispatchCreneau[] = [
  { date: '2024-01-01', hour: 8, reps: 100, impressions: 10000 },
  { date: '2024-01-02', hour: 8, reps: 100, impressions: 10000 },
];

interface VenueFixture {
  screenhostId: string;
  screenId: string;
  ownerId: string;
  creneaux: DispatchCreneau[];
}

interface Scenario {
  admin: string;
  advertiser: string;
  campaignId: string;
  planId: string;
  creativeId: string;
  venues: VenueFixture[];
}

// Multi-venue scenario: one campaign + frozen plan, one allocation per venue spec.
const seedScenario = async (venueCreneaux: DispatchCreneau[][]): Promise<Scenario> => {
  const admin = await seedUser({ role: 'admin' });
  const advertiser = await seedUser({ role: 'advertiser' });
  const iCible = venueCreneaux.flat().reduce((s, c) => s + c.impressions, 0);

  const [creative] = await db
    .insert(creatives)
    .values({
      advertiserId: advertiser,
      creativeType: 'video',
      storageKey: `creatives/${advertiser}/c`,
      durationSeconds: 20,
      validationStatus: 'approved',
    })
    .returning();
  const [campaign] = await db
    .insert(campaigns)
    .values({
      advertiserId: advertiser,
      name: 'E7 Settlement',
      campaignType: 'standard',
      status: 'active',
      startDate: '2024-01-01',
      endDate: '2024-01-02',
      creativeId: creative?.id,
    })
    .returning();
  const [plan] = await db
    .insert(campaignDispatchPlan)
    .values({
      campaignId: campaign?.id ?? '',
      iCible,
      cpm: '10',
      sSpotSeconds: 10,
      tTierCoef: '1.0',
      seuilDiffusable: 1000,
      sMin: '10',
      gJour: '3.33',
      fMaxSeconds: 300,
      rMinEfficace: 2,
      couvert: iCible,
      nMin: 1,
      nMax: 20,
      nRetenus: venueCreneaux.length,
    })
    .returning();

  const venues: VenueFixture[] = [];
  for (const creneaux of venueCreneaux) {
    const ownerId = await seedUser({ role: 'individual_owner' });
    const [sh] = await db
      .insert(screenhosts)
      .values({ name: `Venue ${seq}`, ownerId })
      .returning();
    const [screen] = await db
      .insert(screens)
      .values({ screenhostId: sh?.id ?? '', name: `Screen ${seq}` })
      .returning();
    const iiPotentiel = creneaux.reduce((s, c) => s + c.impressions, 0);
    await db.insert(campaignDispatchAllocation).values({
      planId: plan?.id ?? '',
      screenhostId: sh?.id ?? '',
      iiPotentiel,
      rI: 100,
      revenuPrevisionnel: String((iiPotentiel * 10) / 1000),
      creneaux,
    });
    venues.push({ screenhostId: sh?.id ?? '', screenId: screen?.id ?? '', ownerId, creneaux });
  }

  return {
    admin,
    advertiser,
    campaignId: campaign?.id ?? '',
    planId: plan?.id ?? '',
    creativeId: creative?.id ?? '',
    venues,
  };
};

// Deliver a créneau: a VIDEO_ENDED proof whose SERVER received_at lands in (date, tunisHour)
// (Africa/Tunis = UTC+1 → H−1:30 UTC).
const deliverSlot = async (
  s: Scenario,
  venue: VenueFixture,
  date: string,
  tunisHour: number,
): Promise<void> => {
  const utcHour = String(tunisHour - 1).padStart(2, '0');
  await db.insert(proofOfPlay).values({
    screenId: venue.screenId,
    screenhostId: venue.screenhostId,
    campaignId: s.campaignId,
    creativeId: s.creativeId,
    videoIdAsSent: s.campaignId,
    eventType: 'VIDEO_ENDED' as const,
    receivedAt: new Date(`${date}T${utcHour}:30:00Z`),
  });
};

const linesFor = async (campaignId: string) =>
  db.select().from(reversementLines).where(eq(reversementLines.campaignId, campaignId));

const payoutsFor = async (campaignId: string) =>
  db
    .select()
    .from(campaignScreenhostPayout)
    .where(eq(campaignScreenhostPayout.campaignId, campaignId));

describe('E7 reversement settlement (real Postgres)', () => {
  beforeEach(async () => {
    await resetAuthTables();
    await db.delete(dispatchConfig);
  });

  afterEach(async () => {
    await db.delete(dispatchConfig);
  });

  afterAll(async () => {
    // E4 fixture repair: this suite runs config-less on purpose (deterministic default splits),
    // but it used to LEAVE the singleton deleted — every later file then read the code fallback
    // instead of the migration-seeded row, an invisible coupling until the 0056 CPM move made
    // row-vs-fallback observable. Put the seeded row back before handing the DB on.
    await db.insert(dispatchConfig).values({
      seuilDiffusable: 1000,
      gMois: '100',
      joursActifs: 30,
      rMinEfficace: 2,
    });
    await sql.end();
  });

  it('full delivery: the venue payable is EXACTLY 50 % of the base (delta vs the old 100 % pinned)', async () => {
    const s = await seedScenario([DEFAULT_CRENEAUX]);
    const venue = s.venues[0]!;
    await deliverSlot(s, venue, '2024-01-01', 8);
    await deliverSlot(s, venue, '2024-01-02', 8);

    const result = await reconcileCampaignById(s.campaignId, s.admin);
    expect(result.status).toBe('OK');

    // Base = delivered × cpm/1000 = 20000 × 10/1000 = 200 TND (the OLD credit was this 100 %).
    const lines = await linesFor(s.campaignId);
    expect(lines).toHaveLength(1);
    const line = lines[0]!;
    expect(line.source).toBe('campaign');
    expect(line.screenhostId).toBe(venue.screenhostId);
    expect(Number(line.baseValueTnd)).toBe(200);
    expect(Number(line.shAmountTnd)).toBe(100);
    expect(Number(line.toodoohAmountTnd)).toBe(88);
    expect(Number(line.agentShAmountTnd)).toBe(6);
    expect(Number(line.agentScAmountTnd)).toBe(6);
    expect(line.settledAt).toBeInstanceOf(Date);

    // The four lines sum EXACTLY to the base.
    expect(
      Number(line.shAmountTnd) +
        Number(line.toodoohAmountTnd) +
        Number(line.agentShAmountTnd) +
        Number(line.agentScAmountTnd),
    ).toBe(Number(line.baseValueTnd));

    // The venue-visible payable (payout ledger) is the 50 % line — NOT the old 100 %.
    const payouts = await payoutsFor(s.campaignId);
    expect(payouts).toHaveLength(1);
    expect(Number(payouts[0]!.earningsTnd)).toBe(100);

    // No agent referrals seeded → attribution NULL, amounts still recorded.
    expect(line.agentShId).toBeNull();
    expect(line.agentScId).toBeNull();
  });

  it('partial + refund: the base excludes the refunded part; the E6 refund math is untouched', async () => {
    const s = await seedScenario([DEFAULT_CRENEAUX]);
    const venue = s.venues[0]!;
    await deliverSlot(s, venue, '2024-01-01', 8); // 10000 of 20000 delivered

    const result = await reconcileCampaignById(s.campaignId, s.admin);
    expect(result.status).toBe('OK');
    if (result.status !== 'OK') return;

    // E6 (untouched): budget 200, delivered value 100, P_perte 100 ≥ s_min → refund 100, spend 100.
    expect(Number(result.reconciliation.refundTnd)).toBe(100);
    expect(Number(result.reconciliation.spendTnd)).toBe(100);

    // The split base is the DELIVERED value only — the refunded 100 TND is in NO line.
    const lines = await linesFor(s.campaignId);
    expect(lines).toHaveLength(1);
    expect(Number(lines[0]!.baseValueTnd)).toBe(100);
    expect(Number(lines[0]!.shAmountTnd)).toBe(50);
    // Accounting identity (refunding settlement): Σ bases + refund = C_cible (= budget 200).
    expect(Number(lines[0]!.baseValueTnd) + Number(result.reconciliation.refundTnd)).toBe(200);
  });

  it('defaulter (US-3.7): the non-delivering venue gets NO line; its part is refund, not split', async () => {
    const delivering = DEFAULT_CRENEAUX;
    const defaulter: DispatchCreneau[] = [
      { date: '2024-01-01', hour: 10, reps: 100, impressions: 5000 },
    ];
    const s = await seedScenario([delivering, defaulter]);
    await deliverSlot(s, s.venues[0]!, '2024-01-01', 8);
    await deliverSlot(s, s.venues[0]!, '2024-01-02', 8);
    // venue[1] (the defaulter) airs NOTHING.

    const result = await reconcileCampaignById(s.campaignId, s.admin);
    expect(result.status).toBe('OK');
    if (result.status !== 'OK') return;

    const lines = await linesFor(s.campaignId);
    expect(lines).toHaveLength(1); // only the delivering venue
    expect(lines[0]!.screenhostId).toBe(s.venues[0]!.screenhostId);
    expect(Number(lines[0]!.baseValueTnd)).toBe(200);
    // The defaulter's 50 TND of undelivered value: refunded (≥ s_min), in NO reversement line.
    expect(Number(result.reconciliation.refundTnd)).toBe(50);
    expect(Number(lines[0]!.baseValueTnd) + Number(result.reconciliation.refundTnd)).toBe(250);
  });

  it('RÉUSSIE with a sub-S_min gap: the residue rests with the platform, in NO line', async () => {
    const creneaux: DispatchCreneau[] = [
      { date: '2024-01-01', hour: 8, reps: 100, impressions: 10000 },
      { date: '2024-01-02', hour: 8, reps: 100, impressions: 500 }, // 5 TND < s_min 10
    ];
    const s = await seedScenario([creneaux]);
    await deliverSlot(s, s.venues[0]!, '2024-01-01', 8); // miss the 500-imp slot

    const result = await reconcileCampaignById(s.campaignId, s.admin);
    expect(result.status).toBe('OK');
    if (result.status !== 'OK') return;

    // Sub-S_min: no refund; the advertiser pays the full 105 TND promise.
    expect(result.reconciliation.status).toBe('reussie');
    expect(Number(result.reconciliation.refundTnd)).toBe(0);
    expect(Number(result.reconciliation.spendTnd)).toBe(105);

    const lines = await linesFor(s.campaignId);
    expect(lines).toHaveLength(1);
    expect(Number(lines[0]!.baseValueTnd)).toBe(100);
    // The 5-TND residue: spend − Σ bases — kept by the platform OUTSIDE the split (no line).
    expect(Number(result.reconciliation.spendTnd) - Number(lines[0]!.baseValueTnd)).toBe(5);
  });

  it('resolves agent attribution from agent_referrals (owner → agent SH, advertiser → agent SC)', async () => {
    const s = await seedScenario([DEFAULT_CRENEAUX]);
    const venue = s.venues[0]!;

    const agentSh = await seedUser({ role: 'screenhost_agent' });
    const agentSc = await seedUser({ role: 'screenhost_agent' });
    await db.insert(agents).values([
      { userId: agentSh, code: `AGSH${seq}` },
      { userId: agentSc, code: `AGSC${seq}` },
    ]);
    await db.insert(agentReferrals).values([
      { agentUserId: agentSh, referredUserId: venue.ownerId, agentCodeUsed: `AGSH${seq}` },
      { agentUserId: agentSc, referredUserId: s.advertiser, agentCodeUsed: `AGSC${seq}` },
    ]);

    await deliverSlot(s, venue, '2024-01-01', 8);
    await deliverSlot(s, venue, '2024-01-02', 8);
    const result = await reconcileCampaignById(s.campaignId, s.admin);
    expect(result.status).toBe('OK');

    const lines = await linesFor(s.campaignId);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.agentShId).toBe(agentSh);
    expect(lines[0]!.agentScId).toBe(agentSc);
  });

  it('reads the split from dispatch_config and fails LOUDLY (full rollback) on a drifted config', async () => {
    // Calibrated config: 60/34/3/3.
    await db.insert(dispatchConfig).values({
      seuilDiffusable: 1000,
      gMois: '100',
      joursActifs: 30,
      rMinEfficace: 2,
      fMaxSeconds: 300,
      pctSh: '60.00',
      pctToodooh: '34.00',
      pctAgentSh: '3.00',
      pctAgentSc: '3.00',
    });
    const s1 = await seedScenario([DEFAULT_CRENEAUX]);
    await deliverSlot(s1, s1.venues[0]!, '2024-01-01', 8);
    await deliverSlot(s1, s1.venues[0]!, '2024-01-02', 8);
    const r1 = await reconcileCampaignById(s1.campaignId, s1.admin);
    expect(r1.status).toBe('OK');
    const lines1 = await linesFor(s1.campaignId);
    expect(Number(lines1[0]!.shAmountTnd)).toBe(120); // 60 % of 200
    expect(Number(lines1[0]!.toodoohAmountTnd)).toBe(68);

    // Drifted config (Σ = 106): the settlement must throw and persist NOTHING.
    await db.update(dispatchConfig).set({ pctToodooh: '50.00' });
    const s2 = await seedScenario([DEFAULT_CRENEAUX]);
    await deliverSlot(s2, s2.venues[0]!, '2024-01-01', 8);
    await expect(reconcileCampaignById(s2.campaignId, s2.admin)).rejects.toThrow(/100/);
    const [recon] = await db
      .select()
      .from(campaignReconciliation)
      .where(eq(campaignReconciliation.campaignId, s2.campaignId));
    expect(recon).toBeUndefined(); // full rollback — no half-settlement
    expect(await linesFor(s2.campaignId)).toHaveLength(0);
  });

  it('never restates: a second reconcile is ALREADY_RECONCILED and writes no new lines', async () => {
    const s = await seedScenario([DEFAULT_CRENEAUX]);
    await deliverSlot(s, s.venues[0]!, '2024-01-01', 8);
    await deliverSlot(s, s.venues[0]!, '2024-01-02', 8);
    expect((await reconcileCampaignById(s.campaignId, s.admin)).status).toBe('OK');
    expect((await reconcileCampaignById(s.campaignId, s.admin)).status).toBe('ALREADY_RECONCILED');
    expect(await linesFor(s.campaignId)).toHaveLength(1);
  });

  it("origin-neutral schema: a source='event' line persists against a synthetic base (no event entity)", async () => {
    const s = await seedScenario([DEFAULT_CRENEAUX]);
    const venue = s.venues[0]!;
    const [row] = await db
      .insert(reversementLines)
      .values({
        source: 'event',
        campaignId: s.campaignId,
        screenhostId: venue.screenhostId,
        baseValueTnd: '10.000',
        shAmountTnd: '5.000',
        toodoohAmountTnd: '4.400',
        agentShAmountTnd: '0.300',
        agentScAmountTnd: '0.300',
        settledAt: new Date(),
      })
      .returning();
    expect(row?.source).toBe('event');
  });
});
