import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { db, sql } from '../src/db/client.js';
import {
  type NewUser,
  campaignDispatchAllocation,
  campaignDispatchPlan,
  campaigns,
  creatives,
  events,
  proofOfPlay,
  screenhosts,
  screens,
  users,
} from '../src/db/schema.js';
import { detectMissedSlots } from '../src/lib/dispatch/redispatch.js';
import { reconcileCampaignById } from '../src/lib/reconcile/reconcile-service.js';
import { lateBlackoutShare, slotKey, valueAllocation } from '../src/lib/reconcile/valuation.js';

import { resetAuthTables } from './helpers/db-test-setup.js';
import { eventSector } from './helpers/installed-screen-matrix.js';

// EVT-STOP S5 (docs/daily/2026-09-28.md §2 R5, ruling Q2 A) — a blackout that appears AFTER a
// classic plan was frozen (an event sold later) takes minutes the créneau was priced for. Those
// NEWLY lost minutes count as MISSED explicitly — even when the hour holds a proof (FIX A's
// binary rule alone would call the hour delivered). The owner is paid only the part that could
// air (P3 A); the lost value feeds redispatch (E6) and the NET settlement.

const MON = '2027-03-15';

describe('lateBlackoutShare — the one arithmetic home', () => {
  it('no blackout, or only what the plan already priced, loses nothing', () => {
    expect(lateBlackoutShare({}, 0)).toBe(0);
    expect(lateBlackoutShare({ blackoutMin: 20 }, 20)).toBe(0);
  });

  it('20 new minutes on a full hour lose 1/3; 20 more on a 20-min-priced hour lose 1/2', () => {
    expect(lateBlackoutShare({}, 20)).toBeCloseTo(1 / 3, 12);
    expect(lateBlackoutShare({ blackoutMin: 20 }, 40)).toBeCloseTo(1 / 2, 12);
  });

  it('a full hour now blacked out loses everything; minutes never go negative', () => {
    expect(lateBlackoutShare({}, 60)).toBe(1);
    expect(lateBlackoutShare({ blackoutMin: 40 }, 20)).toBe(0); // an event cancelled: no gain
  });
});

describe('valueAllocation — the owner is paid only what could air', () => {
  const creneaux = [
    { date: MON, hour: 9, impressions: 900 },
    { date: MON, hour: 10, impressions: 900 },
  ];
  const delivered = new Set([slotKey(MON, 9), slotKey(MON, 10)]);

  it('without a late blackout: byte-identical to FIX A (both hours delivered in full)', () => {
    const v = valueAllocation({ screenhostId: 'sh', creneaux, deliveredSlots: delivered }, 10, 1);
    expect(v.deliveredImp).toBe(1800);
    expect(v.manquementImp).toBe(0);
  });

  it('a late 20-min blackout in h9: 1/3 of h9 is missed although the hour holds a proof', () => {
    const v = valueAllocation(
      {
        screenhostId: 'sh',
        creneaux,
        deliveredSlots: delivered,
        blackoutNow: new Map([[slotKey(MON, 9), 20]]),
      },
      10,
      1,
    );
    expect(v.deliveredImp).toBe(1500); // 600 + 900
    expect(v.manquementImp).toBe(300);
    expect(v.earningsTnd).toBe(15); // 1500 × 10 / 1000
  });
});

describe('detectMissedSlots — the late share feeds redispatch', () => {
  it('an elapsed, proven hour with a late 20-min blackout reports 1/3 of it missed', () => {
    const detected = detectMissedSlots(
      [
        {
          screenhostId: 'sh',
          creneaux: [
            { date: MON, hour: 9, impressions: 900 },
            { date: MON, hour: 10, impressions: 600, blackoutMin: 20 }, // priced at plan time
          ],
          deliveredSlots: new Set([slotKey(MON, 9), slotKey(MON, 10)]),
          blackoutNow: new Map([
            [slotKey(MON, 9), 20],
            [slotKey(MON, 10), 20],
          ]),
        },
      ],
      { date: MON, hour: 12 },
    );
    expect(detected.missedPhysical).toBe(300); // h9 only; h10's minutes were already priced
    expect(detected.perScreenhost).toEqual([{ screenhost_id: 'sh', slots: 1, imp_physical: 300 }]);
  });

  it('without blackoutNow the detector is unchanged (proven = delivered)', () => {
    const detected = detectMissedSlots(
      [
        {
          screenhostId: 'sh',
          creneaux: [{ date: MON, hour: 9, impressions: 900 }],
          deliveredSlots: new Set([slotKey(MON, 9)]),
        },
      ],
      { date: MON, hour: 12 },
    );
    expect(detected.missedPhysical).toBe(0);
  });
});

let seq = 0;
const seedUser = async (values: Partial<NewUser> = {}): Promise<string> => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `evtstop-loss-${seq}@example.com`,
      contactName: `EVTSTOP loss ${seq}`,
      role: 'advertiser',
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

describe('reconcileCampaignById — a LATE blackout takes its share of a proven hour (real Postgres)', () => {
  beforeEach(async () => {
    await resetAuthTables();
  });
  afterAll(async () => {
    await sql.end();
  });

  it('EVT-PLAY1 — a match confirmed after the freeze reserves h9: h9 refunded, the owner paid for h8 only', async () => {
    const DAY = '2026-07-13';
    const admin = await seedUser({ role: 'admin' });
    const advertiser = await seedUser();
    const owner = await seedUser({ role: 'individual_owner' });
    const [campaign] = await db
      .insert(campaigns)
      .values({
        advertiserId: advertiser,
        name: 'Classique gelée avant l’événement',
        campaignType: 'standard',
        status: 'completed',
        startDate: DAY,
        endDate: DAY,
      })
      .returning();
    const campaignId = campaign?.id ?? '';
    // A venue that shows events (event switch on, event-eligible sector) — it honours the window.
    const [sh] = await db
      .insert(screenhosts)
      .values({
        name: 'A',
        ownerId: owner,
        businessSectorId: await eventSector(),
        broadcastCapacity: 1,
      })
      .returning();
    const [screen] = await db
      .insert(screens)
      .values({ screenhostId: sh?.id ?? '', name: 'TV-A' })
      .returning();
    const [creative] = await db
      .insert(creatives)
      .values({
        advertiserId: advertiser,
        creativeType: 'video',
        storageKey: `creatives/evtstop-loss/${campaignId}`,
        durationSeconds: 10,
        validationStatus: 'approved',
      })
      .returning();
    const [plan] = await db
      .insert(campaignDispatchPlan)
      .values({
        campaignId,
        iCible: 6000,
        cpm: '10',
        sSpotSeconds: 10,
        tTierCoef: '0.6',
        seuilDiffusable: 2000,
        sMin: '20',
        gJour: '3.3333',
        fMaxSeconds: 300,
        rMinEfficace: 2,
        couvert: 6000,
        nMin: 1,
        nMax: 3,
        nRetenus: 1,
      })
      .returning();
    // Planned BEFORE the event existed: two full hours, no blackoutMin.
    await db.insert(campaignDispatchAllocation).values({
      planId: plan?.id ?? '',
      screenhostId: sh?.id ?? '',
      iiPotentiel: 6000,
      rI: 2,
      revenuPrevisionnel: '60',
      creneaux: [
        { date: DAY, hour: 8, reps: 2, impressions: 5000 },
        { date: DAY, hour: 9, reps: 2, impressions: 5000 },
      ],
      statutAcceptation: 'ACCEPTE',
    });
    // Both hours proven (Tunis h8 = 07:xx Z, h9 = 08:xx Z).
    for (const utc of ['07:05', '08:05']) {
      await db.insert(proofOfPlay).values({
        screenId: screen?.id ?? '',
        screenhostId: sh?.id ?? '',
        campaignId,
        creativeId: creative?.id ?? '',
        videoIdAsSent: campaignId,
        eventType: 'VIDEO_ENDED' as const,
        receivedAt: new Date(`${DAY}T${utc}:00Z`),
      });
    }
    // THEN a match is confirmed (never sold): kickoff 09:00Z → its window 08:00Z–11:00Z takes the
    // whole of Tunis h9 (08:xx Z) from the frozen plan.
    await db.insert(events).values({
      name: 'Confirmé après le gel',
      kickoffAt: new Date(`${DAY}T09:00:00Z`),
      endsAt: new Date(`${DAY}T10:00:00Z`),
      source: 'official',
    });

    const result = await reconcileCampaignById(campaignId, admin);
    expect(result.status).toBe('OK');
    if (result.status !== 'OK') return;
    // h9 lost in full (5 000 phys × 0.6 = 3 000 fact = 30 TND ≥ S_min 20) → refunded.
    expect(result.valuation.refundTnd).toBe(30);
    // The owner is paid its delivered h8 only: 5 000 × 0.6 × 0.01 × 50 % = 15.
    expect(result.payouts.map((p) => Number(p.earningsTnd))).toEqual([15]);
  });
});
