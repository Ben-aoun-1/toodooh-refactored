import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '../src/db/client.js';
import {
  type NewUser,
  businessSectors,
  campaignDispatchAllocation,
  campaignDispatchPlan,
  campaignRedispatchRounds,
  campaigns,
  creatives,
  dispatchConfig,
  notifications,
  proofOfPlay,
  recharges,
  screenhostAffluence,
  screenhosts,
  screens,
  users,
} from '../src/db/schema.js';
import { activateCampaign } from '../src/lib/activation-service.js';
import { runBoost } from '../src/lib/boost.js';
import { runRefusalCascade } from '../src/lib/dispatch/cascade.js';
import { runRedispatchRound } from '../src/lib/dispatch/redispatch.js';
import { reconcileCampaignById } from '../src/lib/reconcile/reconcile-service.js';

import { bothHalves, resetAuthTables } from './helpers/db-test-setup.js';
import { seedInstalledScreen } from './helpers/installed-screen.js';

// DISP-TOURS — placing more of a LAUNCHED tours campaign (Mariem's spec R14) on a real Postgres:
// the redispatching of a missed day, a Host's refusal, the booster. Café A open 16 h → 20 h,
// Café B open 16 h → 22 h (its 20 h and 21 h barely attended: its rangs 5 and 6), Mariem's
// typical weeks, a 30 s spot, CPM 12, F = 600 s. At 260 DT both hold the campaign: A full (tours
// 1–2), B its tour 1 and its tour 2 at 12 passages — B's 20 h and 21 h stay FREE for it. The
// launch runs on a clock pinned to Thursday 5 November 2026, before the window (an hour already
// started is never usable); each round below passes its own instant.

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';

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
  [10, 15, 12, 8, 4, 3],
  [12, 10, 15, 8, 4, 3],
  [8, 12, 15, 10, 4, 3],
  [15, 12, 10, 8, 4, 3],
  [10, 15, 18, 12, 4, 3],
  [12, 18, 20, 15, 4, 3],
  [15, 12, 10, 8, 4, 3],
];

let seq = 0;
const seedUser = async (values: Partial<NewUser> = {}): Promise<string> => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `tours-place${seq}@example.com`,
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
  closing: number,
): Promise<string> => {
  await db.insert(screenhosts).values({
    id,
    name: `Café ${id.slice(-1).toUpperCase()}`,
    ownerId,
    businessSectorId: sectorId,
    class: 'moyen',
    openingHour: 16,
    closingHour: closing,
    broadcastCapacity: 4,
  });
  await db.insert(screenhostAffluence).values(
    bothHalves(
      week.flatMap((row, d) =>
        row.map((estimatedImpressions, i) => ({
          screenhostId: id,
          dayOfWeek: d + 1,
          hour: 16 + i,
          estimatedImpressions,
        })),
      ),
    ),
  );
  return seedInstalledScreen(id);
};

describe('DISP-TOURS — redispatching, refusal and booster on a tours plan (real Postgres)', () => {
  let advertiser = '';
  let ownerB = '';
  let screenA = '';
  let screenB = '';
  let campaignId = '';
  let creativeId = '';

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-05T10:00:00Z'));
    await resetAuthTables();
    await db.update(dispatchConfig).set({ fMaxSeconds: 600 });
    const [sector] = await db
      .select({ id: businessSectors.id })
      .from(businessSectors)
      .where(eq(businessSectors.audience, 'owner'))
      .limit(1);
    const ownerA = await seedUser({ role: 'individual_owner' });
    ownerB = await seedUser({ role: 'individual_owner' });
    screenA = await seedVenue(A, ownerA, sector?.id ?? '', WEEK_A, 20);
    screenB = await seedVenue(B, ownerB, sector?.id ?? '', WEEK_B, 22);
    advertiser = await seedUser();
    await db.insert(recharges).values({
      advertiserId: advertiser,
      amountTnd: '5000.00',
      status: 'confirmed',
      reference: `TOURS-P-${seq}`,
    });
    const [creative] = await db
      .insert(creatives)
      .values({
        advertiserId: advertiser,
        creativeType: 'video',
        storageKey: `creatives/tours-place/${seq}`,
        durationSeconds: 30,
        validationStatus: 'approved',
      })
      .returning();
    creativeId = creative?.id ?? '';
    const [c] = await db
      .insert(campaigns)
      .values({
        advertiserId: advertiser,
        name: 'Tours placement',
        campaignType: 'standard',
        status: 'pending',
        startDate: '2026-11-09',
        endDate: '2026-11-18',
        creativeId,
        requestedBudget: '260.00',
        standardCpmTnd: '12.000',
        t10s: '0.60',
        t20s: '0.70',
        t30s: '0.80',
      })
      .returning();
    campaignId = c?.id ?? '';
    const [row] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId));
    if (!row) throw new Error('campaign missing');
    const outcome = await activateCampaign({
      campaign: row,
      contentValidationStatus: 'approved',
      creativeDurationSeconds: 30,
      activatedBy: null,
      fromStatus: 'pending',
    });
    expect(outcome.status).toBe('OK');
  });

  afterEach(async () => {
    vi.useRealTimers();
    await db.update(dispatchConfig).set({ fMaxSeconds: 300 });
  });

  const allocationOf = async (venue: string) => {
    const [plan] = await db
      .select()
      .from(campaignDispatchPlan)
      .where(eq(campaignDispatchPlan.campaignId, campaignId));
    const [a] = await db
      .select()
      .from(campaignDispatchAllocation)
      .where(
        and(
          eq(campaignDispatchAllocation.planId, plan?.id ?? ''),
          eq(campaignDispatchAllocation.screenhostId, venue),
        ),
      );
    if (!plan || !a) throw new Error('allocation missing');
    return { plan, a };
  };

  it('launches both venues; B keeps its 20 h and 21 h free for the campaign', async () => {
    const { a: a } = await allocationOf(A);
    const { a: b } = await allocationOf(B);
    expect(a.creneaux.every((c) => c.reps === 20)).toBe(true);
    expect(new Set(b.creneaux.map((c) => c.reps))).toEqual(new Set([20, 12]));
    expect(b.creneaux.some((c) => c.hour >= 20)).toBe(false);
  });

  // B airs its four hours on the given days; A airs nothing.
  const bAired = async (dates: string[], lastSeen: Date) => {
    await db.update(campaigns).set({ status: 'active' }).where(eq(campaigns.id, campaignId));
    await db.update(campaignDispatchAllocation).set({ statutAcceptation: 'ACCEPTE' });
    await db.update(screens).set({ lastSeenAt: lastSeen }).where(eq(screens.id, screenB));
    for (const date of dates) {
      for (const hour of [16, 17, 18, 19]) {
        await db.insert(proofOfPlay).values({
          screenId: screenB,
          screenhostId: B,
          campaignId,
          creativeId,
          videoIdAsSent: campaignId,
          eventType: 'VIDEO_ENDED',
          playedDurationMs: 30000,
          receivedAt: new Date(`${date}T${String(hour - 1).padStart(2, '0')}:10:00Z`),
        });
      }
    }
  };
  const window = {
    id: '',
    name: 'Tours placement',
    startDate: '2026-11-09',
    endDate: '2026-11-18',
  };

  it('a loss under 30 DT waits (Mariem Q3: the 20 TND trigger is 30 DT on a tours plan)', async () => {
    // Monday 9 November, 20 h 30 in Tunis: A's Monday alone, (20 + 30 + 25 + 10) × 20 × 0,80 =
    // 1 360 qualified impressions — 16,32 DT.
    const now = new Date('2026-11-09T19:30:00Z');
    await bAired(['2026-11-09'], now);
    const outcome = await runRedispatchRound({ ...window, id: campaignId }, now);
    expect(outcome).toEqual({ status: 'BELOW_THRESHOLD', totalValueTnd: 16.32 });
  });

  it('A’s missed Monday and Tuesday go to B, already in the campaign, on its free hours, never to A', async () => {
    // Tuesday 10 November, 20 h 30 in Tunis: + A's Tuesday, (20 + 25 + 30 + 15) × 20 × 0,80 =
    // 1 440 — 2 800 in all, 33,60 DT.
    const now = new Date('2026-11-10T19:30:00Z');
    await bAired(['2026-11-09', '2026-11-10'], now);
    const before = (await allocationOf(B)).a.creneaux.length;

    const outcome = await runRedispatchRound({ ...window, id: campaignId }, now);
    expect(outcome.status).toBe('PLACED');
    if (outcome.status !== 'PLACED') return;
    expect(outcome.placedTo.map((p) => p.screenhost_id)).toEqual([B]);
    expect(outcome.placedTo[0]?.merged).toBe(true);
    expect(outcome.vFact).toBe(2800);
    expect(outcome.placedFact).toBeGreaterThan(0);
    expect(outcome.placedFact).toBeLessThanOrEqual(2800);

    const { a: b } = await allocationOf(B);
    expect(b.statutAcceptation).toBe('ACCEPTE'); // no re-acceptance for a venue in the campaign
    const added = b.creneaux.slice(before);
    expect(added.length).toBeGreaterThan(0);
    expect(added.every((c) => c.hour >= 20)).toBe(true); // B's free hours only
    expect(added.every((c) => c.date > '2026-11-10' || c.hour > 20)).toBe(true); // future only
    const notices = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, ownerB), eq(notifications.type, 'dispatch_slots_added')));
    expect(notices).toHaveLength(1);
    const rounds = await db
      .select()
      .from(campaignRedispatchRounds)
      .where(eq(campaignRedispatchRounds.campaignId, campaignId));
    expect(rounds).toHaveLength(1);
    expect((await allocationOf(A)).a.creneaux.length).toBe(40); // A gets nothing back
  });

  it('a refusal at A re-places its share onto B’s free hours; the rest waits for the refund', async () => {
    const { plan, a } = await allocationOf(A);
    await db
      .update(campaignDispatchAllocation)
      .set({ statutAcceptation: 'REFUSE' })
      .where(eq(campaignDispatchAllocation.id, a.id));
    const outcome = await db.transaction((tx) =>
      runRefusalCascade(tx, {
        plan,
        campaign: {
          id: campaignId,
          name: 'Tours placement',
          startDate: '2026-11-09',
          endDate: '2026-11-18',
        },
        refused: { id: a.id, screenhostId: A, iiPotentiel: a.iiPotentiel },
      }),
    );
    expect(outcome.v).toBe(15120);
    expect(outcome.absorbed).toBeGreaterThan(0);
    expect(outcome.absorbed).toBeLessThan(15120);
    expect(outcome.updatedAllocations).toBe(1);
    expect(outcome.createdAllocations).toBe(0);
    const { a: b } = await allocationOf(B);
    expect(b.creneaux.filter((c) => c.hour >= 20).length).toBeGreaterThan(0);
  });

  // Every créneau of the plan airs (one proof in its hour), except those `missed` keeps.
  const airAllBut = async (missed: (venue: string, date: string) => boolean) => {
    const { plan } = await allocationOf(A);
    const allocations = await db
      .select()
      .from(campaignDispatchAllocation)
      .where(eq(campaignDispatchAllocation.planId, plan.id));
    const screenOf = new Map([
      [A, screenA],
      [B, screenB],
    ]);
    for (const a of allocations) {
      for (const c of a.creneaux) {
        if (missed(a.screenhostId, c.date)) continue;
        await db.insert(proofOfPlay).values({
          screenId: screenOf.get(a.screenhostId) ?? '',
          screenhostId: a.screenhostId,
          campaignId,
          creativeId,
          videoIdAsSent: campaignId,
          eventType: 'VIDEO_ENDED',
          playedDurationMs: 30000,
          receivedAt: new Date(`${c.date}T${String(c.hour - 1).padStart(2, '0')}:10:00Z`),
        });
      }
    }
    await db.update(campaigns).set({ status: 'completed' }).where(eq(campaigns.id, campaignId));
  };

  it('settlement (Mariem Q3): a net loss under 30 DT is not refunded', async () => {
    // A's Monday 16 h only: 20 × 20 passages × 0,80 = 320 qualified impressions — 3,84 DT.
    let skipped = false;
    await airAllBut((venue, date) => {
      if (skipped || venue !== A || date !== '2026-11-09') return false;
      skipped = true;
      return true;
    });
    const result = await reconcileCampaignById(campaignId, null);
    expect(result.status).toBe('OK');
    if (result.status !== 'OK') return;
    expect(Number(result.reconciliation.refundTnd)).toBe(0);
  });

  it('settlement (Mariem Q3): a net loss of 30 DT or more is refunded', async () => {
    // A's whole Monday and Tuesday: 1 360 + 1 440 = 2 800 qualified impressions — 33,60 DT.
    await airAllBut(
      (venue, date) => venue === A && (date === '2026-11-09' || date === '2026-11-10'),
    );
    const result = await reconcileCampaignById(campaignId, null);
    expect(result.status).toBe('OK');
    if (result.status !== 'OK') return;
    expect(Number(result.reconciliation.refundTnd)).toBeCloseTo(33.6, 2);
  });

  it('the booster prices the free hours and engages only the exact placed price', async () => {
    await db.update(campaigns).set({ status: 'upcoming' }).where(eq(campaigns.id, campaignId));
    const now = new Date('2026-11-05T10:00:00Z');
    const widened = await runBoost(
      campaignId,
      advertiser,
      { newEndDate: '2026-11-19' },
      {
        previewOnly: true,
        now,
      },
    );
    expect(widened.status).toBe('PREVIEW');
    if (widened.status !== 'PREVIEW') return;
    expect(widened.cMaxBoostTnd).toBeGreaterThan(0);
    const [before] = await db
      .select({ budget: campaigns.requestedBudget })
      .from(campaigns)
      .where(eq(campaigns.id, campaignId));
    const applied = await runBoost(
      campaignId,
      advertiser,
      { newEndDate: '2026-11-19' },
      {
        previewOnly: false,
        amountTnd: 20,
        now,
      },
    );
    expect(applied.status).toBe('APPLIED');
    const [after] = await db
      .select({ budget: campaigns.requestedBudget })
      .from(campaigns)
      .where(eq(campaigns.id, campaignId));
    const engaged = Number(after?.budget) - Number(before?.budget);
    expect(engaged).toBeGreaterThan(0);
    expect(engaged).toBeLessThanOrEqual(20);
  });
});
