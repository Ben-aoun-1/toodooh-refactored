import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
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
  notifications,
  proofOfPlay,
  screenhosts,
  screens,
  users,
} from '../src/db/schema.js';
import { plusCalendarDays, tunisDateOf } from '../src/lib/campaign-dates.js';
import { CAMPAIGN_STOPPED_TYPE } from '../src/lib/campaign-stop.js';
import { reconcileCampaignById } from '../src/lib/reconcile/reconcile-service.js';
import { adminCampaignStopRoutes } from '../src/routes/admin-campaign-stop.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// STOP-1 (operator rulings 2026-10-27) — « Arrêter la campagne », real Postgres: a superadmin
// ends an active campaign today (venues paid for the hours that aired, the rest refunded — even
// under the 20 TND floor) or an upcoming one (dates untouched, all refunded); the stop is
// recorded; a demo venue's planned hours after the stop are not counted; the advertiser is told.
// cpm = 10, T = 1.0: a 3000-impression créneau is worth 30 TND, a 1000 one 10 TND.

type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;
const mockSession = (userId: string, role = 'superadmin'): void => {
  vi.spyOn(auth.api, 'getSession').mockResolvedValue({
    session: {},
    user: { id: userId, role, status: 'approved' },
  } as unknown as GetSessionResult);
};

let seq = 0;
const seedUser = async (values: Partial<NewUser> = {}): Promise<string> => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `stop-${seq}@example.com`,
      contactName: `Stop User ${seq}`,
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
  advertiserId: string;
}

const seed = async (opts: {
  creneaux: DispatchCreneau[];
  status?: 'active' | 'upcoming' | 'pending';
  startDate?: string;
  endDate?: string;
  demoVenue?: boolean;
  withPlan?: boolean;
  eventCampaign?: boolean;
}): Promise<Scenario> => {
  const advertiser = await seedUser();
  const owner = await seedUser({ role: 'individual_owner' });
  const [sh] = await db
    .insert(screenhosts)
    .values({ name: `Stop Venue ${seq}`, ownerId: owner, demoOnly: opts.demoVenue ?? false })
    .returning();
  const [screen] = await db
    .insert(screens)
    .values({ screenhostId: sh?.id ?? '', name: 'Stop TV' })
    .returning();
  const [creative] = await db
    .insert(creatives)
    .values({
      advertiserId: advertiser,
      creativeType: 'video',
      storageKey: `creatives/stop/${seq}`,
      durationSeconds: 20,
      validationStatus: 'approved',
    })
    .returning();
  const ii = opts.creneaux.reduce((s, c) => s + c.impressions, 0);
  const [campaign] = await db
    .insert(campaigns)
    .values({
      advertiserId: advertiser,
      name: `Campagne arrêt ${seq}`,
      campaignType: opts.eventCampaign ? 'event' : 'standard',
      status: opts.status ?? 'active',
      startDate: opts.startDate ?? '2024-01-01',
      endDate: opts.endDate ?? '2024-01-05',
      creativeId: creative?.id,
      requestedBudget: '400.00',
    })
    .returning();
  if (opts.withPlan !== false) {
    const [plan] = await db
      .insert(campaignDispatchPlan)
      .values({
        campaignId: campaign?.id ?? '',
        iCible: ii,
        cpm: '10',
        sSpotSeconds: 10,
        tTierCoef: '1.0',
        seuilDiffusable: 1000,
        sMin: '10',
        gJour: '3.33',
        fMaxSeconds: 300,
        rMinEfficace: 2,
        couvert: ii,
        nMin: 1,
        nMax: 20,
        nRetenus: 1,
      })
      .returning();
    await db.insert(campaignDispatchAllocation).values({
      planId: plan?.id ?? '',
      screenhostId: sh?.id ?? '',
      iiPotentiel: ii,
      rI: 100,
      revenuPrevisionnel: String((ii * 10) / 1000),
      creneaux: opts.creneaux,
      statutAcceptation: 'ACCEPTE',
    });
  }
  return {
    campaignId: campaign?.id ?? '',
    screenhostId: sh?.id ?? '',
    screenId: screen?.id ?? '',
    creativeId: creative?.id ?? '',
    advertiserId: advertiser,
  };
};

/** A VIDEO_ENDED proof in Tunis hour `tunisHour` of `date` (Tunis = UTC+1). */
const deliverSlot = async (s: Scenario, date: string, tunisHour: number): Promise<void> => {
  await db.insert(proofOfPlay).values({
    screenId: s.screenId,
    screenhostId: s.screenhostId,
    campaignId: s.campaignId,
    creativeId: s.creativeId,
    videoIdAsSent: s.creativeId,
    eventType: 'VIDEO_ENDED',
    playedDurationMs: 10_000,
    receivedAt: new Date(`${date}T${String(tunisHour - 1).padStart(2, '0')}:30:00Z`),
  });
};

const settlementOf = async (campaignId: string) => {
  const [r] = await db
    .select()
    .from(campaignReconciliation)
    .where(eq(campaignReconciliation.campaignId, campaignId));
  return r;
};

const campaignOf = async (campaignId: string) => {
  const [c] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId));
  return c;
};

describe('STOP-1 — « Arrêter la campagne » (superadmin)', () => {
  const app = Fastify({ logger: false });

  beforeEach(async () => {
    await resetAuthTables();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await app.close();
    await sql.end();
  });

  const stop = async (campaignId: string, reason: unknown = 'Demande de l’annonceur') => {
    if (!app.hasRoute({ method: 'POST', url: '/api/admin/campaigns/:id/stop' })) {
      await app.register(adminCampaignStopRoutes);
      await app.ready();
    }
    return app.inject({
      method: 'POST',
      url: `/api/admin/campaigns/${campaignId}/stop`,
      payload: { reason },
    });
  };

  it('an active campaign ends today: the aired hour is paid, the rest refunded, the stop recorded', async () => {
    const s = await seed({
      creneaux: [
        { date: '2024-01-01', hour: 10, reps: 100, impressions: 3000 },
        { date: '2024-01-01', hour: 11, reps: 100, impressions: 3000 },
      ],
    });
    await deliverSlot(s, '2024-01-01', 10);
    const superId = await seedUser({ role: 'superadmin' });
    mockSession(superId);

    const res = await stop(s.campaignId);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'completed', refund_tnd: 30, spend_tnd: 30 });

    const c = await campaignOf(s.campaignId);
    expect(c).toMatchObject({
      status: 'completed',
      endDate: tunisDateOf(new Date()),
      originalEndDate: '2024-01-05',
      stoppedBy: superId,
      stopReason: 'Demande de l’annonceur',
    });
    expect(c?.stoppedAt).toBeInstanceOf(Date);

    const settled = await settlementOf(s.campaignId);
    expect(Number(settled?.refundTnd)).toBe(30);
    expect(Number(settled?.spendTnd)).toBe(30);
    const [payout] = await db
      .select()
      .from(campaignScreenhostPayout)
      .where(eq(campaignScreenhostPayout.campaignId, s.campaignId));
    expect(payout?.screenhostId).toBe(s.screenhostId);

    const notices = await db
      .select({ type: notifications.type, title: notifications.title, body: notifications.body })
      .from(notifications)
      .where(eq(notifications.userId, s.advertiserId));
    expect(notices).toContainEqual({
      type: CAMPAIGN_STOPPED_TYPE,
      title: `Votre campagne « ${c?.name ?? ''} » a été arrêtée par Toodooh`,
      body: 'Sa diffusion est terminée. 30,000 TND non diffusés reviennent sur votre solde.',
    });

    // Stopping twice is refused: it is no longer active.
    expect((await stop(s.campaignId)).statusCode).toBe(409);
  });

  it('a stop refunds even under the 20 TND floor an ordinary settlement keeps', async () => {
    const creneaux: DispatchCreneau[] = [
      { date: '2024-01-01', hour: 10, reps: 100, impressions: 1000 },
      { date: '2024-01-01', hour: 11, reps: 100, impressions: 1000 },
    ];
    // The ordinary settlement of the same delivery keeps the 10 TND gap (under S_min).
    const ordinary = await seed({ creneaux });
    await deliverSlot(ordinary, '2024-01-01', 10);
    const settled = await reconcileCampaignById(ordinary.campaignId, null);
    expect(settled.status === 'OK' ? settled.valuation.refundTnd : -1).toBe(0);

    const stopped = await seed({ creneaux });
    await deliverSlot(stopped, '2024-01-01', 10);
    mockSession(await seedUser({ role: 'superadmin' }));
    expect((await stop(stopped.campaignId)).json()).toMatchObject({
      refund_tnd: 10,
      spend_tnd: 10,
    });
  });

  it('an upcoming campaign keeps its dates and is refunded in full', async () => {
    const start = plusCalendarDays(tunisDateOf(new Date()), 5);
    const s = await seed({
      status: 'upcoming',
      startDate: start,
      endDate: plusCalendarDays(start, 3),
      creneaux: [{ date: start, hour: 10, reps: 100, impressions: 3000 }],
    });
    mockSession(await seedUser({ role: 'superadmin' }));
    expect((await stop(s.campaignId)).json()).toEqual({
      status: 'completed',
      refund_tnd: 30,
      spend_tnd: 0,
    });
    expect(await campaignOf(s.campaignId)).toMatchObject({
      status: 'completed',
      startDate: start,
      endDate: plusCalendarDays(start, 3),
      originalEndDate: plusCalendarDays(start, 3),
    });
  });

  it('a demo campaign: planned hours after the stop are not counted as aired', async () => {
    const today = tunisDateOf(new Date());
    const s = await seed({
      demoVenue: true,
      creneaux: [
        { date: plusCalendarDays(today, -1), hour: 10, reps: 100, impressions: 3000 },
        { date: plusCalendarDays(today, 2), hour: 10, reps: 100, impressions: 3000 },
      ],
    });
    mockSession(await seedUser({ role: 'superadmin' }));
    expect((await stop(s.campaignId)).json()).toMatchObject({ refund_tnd: 30, spend_tnd: 30 });
  });

  it('refusals: an admin, a pending or event campaign, no plan, no reason', async () => {
    const s = await seed({
      creneaux: [{ date: '2024-01-01', hour: 10, reps: 1, impressions: 10 }],
    });
    mockSession(await seedUser({ role: 'admin' }), 'admin');
    expect((await stop(s.campaignId)).statusCode).toBe(403);

    mockSession(await seedUser({ role: 'superadmin' }));
    expect((await stop(s.campaignId, '')).statusCode).toBe(400);
    const pending = await seed({ status: 'pending', withPlan: false, creneaux: [] });
    expect((await stop(pending.campaignId)).json()).toMatchObject({ error: 'NOT_STOPPABLE' });
    const event = await seed({ eventCampaign: true, creneaux: [] });
    expect((await stop(event.campaignId)).json()).toMatchObject({ error: 'EVENT_CAMPAIGN' });
    const noPlan = await seed({ withPlan: false, creneaux: [] });
    expect((await stop(noPlan.campaignId)).json()).toMatchObject({ error: 'NO_PLAN' });
    expect(await campaignOf(noPlan.campaignId)).toMatchObject({
      status: 'active',
      stoppedAt: null,
    });
  });
});
