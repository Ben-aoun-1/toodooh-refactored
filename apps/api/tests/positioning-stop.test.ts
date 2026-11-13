import { and, eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import {
  type NewUser,
  campaignReconciliation,
  campaigns,
  creatives,
  eventAllocations,
  events,
  hourReservations,
  notifications,
  proofOfPlay,
  reversementLines,
  screenhosts,
  screens,
  users,
} from '../src/db/schema.js';
import { CAMPAIGN_REPORT_READY_TYPE } from '../src/lib/campaign-report-notification.js';
import { CAMPAIGN_STOPPED_TYPE, stopCampaign } from '../src/lib/campaign-stop.js';
import { decideEventAllocation } from '../src/lib/event-allocation-decision.js';
import { fenetreDiffusion } from '../src/lib/fenetre-diffusion.js';
import { adminCampaignDeleteRoutes } from '../src/routes/admin-campaign-delete.js';
import { adminCampaignStopRoutes } from '../src/routes/admin-campaign-stop.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// Mariem 05/11 (ruling 1A) — a superadmin STOPS a match positioning (what aired is billed and paid
// to the venues, the rest refunded; its places, holds and the match's 1-minute rule freed), then
// DELETES it when nothing of it aired. Real Postgres. One venue share: six blocs, 300 TND.

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
      email: `pstop-${seq}@example.com`,
      contactName: `Positioning Stop ${seq}`,
      role: 'advertiser',
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

const seedVenue = async (): Promise<{ id: string; ownerId: string }> => {
  const ownerId = await seedUser({ role: 'individual_owner' });
  const [sh] = await db
    .insert(screenhosts)
    .values({ name: `Stop Venue ${seq}`, ownerId })
    .returning();
  return { id: sh?.id ?? '', ownerId };
};

// Kick-off 20:00, end 22:00 (Tunis) on 10 June 2027 — a match still to come.
const KICKOFF = new Date('2027-06-10T20:00:00+01:00');
const ENDS = new Date('2027-06-10T22:00:00+01:00');
const GRID = fenetreDiffusion(KICKOFF, ENDS);
const bloc = (i: number) => {
  const b = GRID.blocs[i];
  if (!b) throw new Error(`no bloc ${i}`);
  return b;
};

const seedEvent = async (seatMinutes: number | null = null): Promise<string> => {
  seq += 1;
  const [row] = await db
    .insert(events)
    .values({
      name: `Match ${seq}`,
      type: 'sport',
      kickoffAt: KICKOFF,
      endsAt: ENDS,
      source: 'official',
      seatMinutes,
    })
    .returning();
  return row?.id ?? '';
};

const seedPositioning = async (
  eventId: string,
  venueId: string,
  opts: { status: 'active' | 'upcoming'; statut?: 'EN_ATTENTE' | 'ACCEPTE' },
): Promise<{ campaignId: string; allocationId: string; creativeId: string }> => {
  const advertiserId = await seedUser();
  const [creative] = await db
    .insert(creatives)
    .values({
      advertiserId,
      creativeType: 'video',
      storageKey: `creatives/pstop/${seq}`,
      durationSeconds: 15,
      validationStatus: 'approved',
    })
    .returning();
  const [campaign] = await db
    .insert(campaigns)
    .values({
      advertiserId,
      name: `Positionnement ${seq}`,
      campaignType: 'event',
      status: opts.status,
      startDate: '2027-06-10',
      endDate: '2027-06-10',
      requestedBudget: '300.00',
      eventMinutes: 2,
      eventId,
      creativeId: creative?.id,
    })
    .returning();
  const statut = opts.statut ?? 'ACCEPTE';
  const [allocation] = await db
    .insert(eventAllocations)
    .values({
      campaignId: campaign?.id ?? '',
      screenhostId: venueId,
      blocs: GRID.blocs.slice(0, 6).map((b) => ({
        start: b.start.toISOString(),
        end: b.end.toISOString(),
        impressions: 2000,
      })),
      impressionsTotal: 12_000,
      montantTnd: '300.000',
      statut,
      ...(statut === 'ACCEPTE' ? { decidedAt: new Date() } : {}),
    })
    .returning();
  return {
    campaignId: campaign?.id ?? '',
    allocationId: allocation?.id ?? '',
    creativeId: creative?.id ?? '',
  };
};

/** A VIDEO_ENDED proof of the positioning at its venue, played at `at`. */
const seedProof = async (
  p: { campaignId: string; creativeId: string },
  venueId: string,
  at: Date,
): Promise<void> => {
  const [screen] = await db
    .insert(screens)
    .values({ screenhostId: venueId, name: `TV ${seq}` })
    .returning();
  await db.insert(proofOfPlay).values({
    screenId: screen?.id ?? '',
    screenhostId: venueId,
    campaignId: p.campaignId,
    creativeId: p.creativeId,
    videoIdAsSent: p.campaignId,
    eventType: 'VIDEO_ENDED',
    receivedAt: at,
  });
};

const campaignOf = async (id: string) =>
  (await db.select().from(campaigns).where(eq(campaigns.id, id)))[0];
const settlementOf = async (id: string) =>
  (
    await db.select().from(campaignReconciliation).where(eq(campaignReconciliation.campaignId, id))
  )[0];
const holdsAt = async (eventId: string, venueId: string): Promise<number> =>
  (
    await db
      .select({ id: hourReservations.id })
      .from(hourReservations)
      .where(and(eq(hourReservations.eventId, eventId), eq(hourReservations.screenhostId, venueId)))
  ).length;

describe('« Arrêter » then « Supprimer » a match positioning (superadmin, real Postgres)', () => {
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

  const call = async (method: 'POST' | 'DELETE', campaignId: string) => {
    if (!app.hasRoute({ method: 'POST', url: '/api/admin/campaigns/:id/stop' })) {
      await app.register(adminCampaignStopRoutes);
      await app.register(adminCampaignDeleteRoutes);
      await app.ready();
    }
    return method === 'POST'
      ? app.inject({
          method,
          url: `/api/admin/campaigns/${campaignId}/stop`,
          payload: { reason: 'Tests terminés' },
        })
      : app.inject({ method, url: `/api/admin/campaigns/${campaignId}` });
  };

  it('an upcoming positioning: refunded in full; its holds and the match’s 1-minute rule freed', async () => {
    const venue = await seedVenue();
    const eventId = await seedEvent(1);
    const p = await seedPositioning(eventId, venue.id, { status: 'upcoming' });
    await db
      .insert(hourReservations)
      .values({ screenhostId: venue.id, day: '2027-06-10', hour: 20, eventId });
    mockSession(await seedUser({ role: 'superadmin' }));

    const res = await call('POST', p.campaignId);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'completed', refund_tnd: 300, spend_tnd: 0 });
    const row = await campaignOf(p.campaignId);
    expect(row).toMatchObject({ status: 'completed', stopReason: 'Tests terminés' });
    expect(row?.stoppedAt).not.toBeNull();
    expect(row?.endDate).toBe('2027-06-10'); // a positioning keeps its dates
    const settled = await settlementOf(p.campaignId);
    expect(Number(settled?.spendTnd)).toBe(0);
    expect(Number(settled?.refundTnd)).toBe(300);
    expect(
      await db.select().from(reversementLines).where(eq(reversementLines.campaignId, p.campaignId)),
    ).toEqual([]);
    expect(await holdsAt(eventId, venue.id)).toBe(0);
    const [event] = await db
      .select({ seatMinutes: events.seatMinutes })
      .from(events)
      .where(eq(events.id, eventId));
    expect(event?.seatMinutes).toBeNull();
    const notices = await db
      .select({ type: notifications.type, title: notifications.title })
      .from(notifications)
      .where(eq(notifications.campaignId, p.campaignId));
    expect(notices.map((n) => n.type).sort()).toEqual(
      [CAMPAIGN_REPORT_READY_TYPE, CAMPAIGN_STOPPED_TYPE].sort(),
    );
    expect(notices.find((n) => n.type === CAMPAIGN_STOPPED_TYPE)?.title).toBe(
      `Votre positionnement « ${row?.name ?? ''} » a été arrêté par Toodooh`,
    );
  });

  it('stopped during the match: the bloc that aired is billed and paid, a proof after the stop is not', async () => {
    const venue = await seedVenue();
    const eventId = await seedEvent();
    const p = await seedPositioning(eventId, venue.id, { status: 'active' });
    await seedProof(p, venue.id, new Date(bloc(0).start.getTime() + 60_000));
    await seedProof(p, venue.id, new Date(bloc(1).start.getTime() + 60_000)); // after the stop
    const superId = await seedUser({ role: 'superadmin' });

    const outcome = await stopCampaign({
      campaignId: p.campaignId,
      adminId: superId,
      reason: 'Arrêt en cours de match',
      now: bloc(1).start,
    });
    expect(outcome).toEqual({ ok: true, refundTnd: 250, spendTnd: 50 });
    expect(Number((await settlementOf(p.campaignId))?.spendTnd)).toBe(50);
    const lines = await db
      .select()
      .from(reversementLines)
      .where(eq(reversementLines.campaignId, p.campaignId));
    expect(lines.map((l) => [l.screenhostId, Number(l.baseValueTnd)])).toEqual([[venue.id, 50]]);
  });

  it('the owner can no longer answer a stopped positioning’s share', async () => {
    const venue = await seedVenue();
    const p = await seedPositioning(await seedEvent(), venue.id, {
      status: 'upcoming',
      statut: 'EN_ATTENTE',
    });
    const superId = await seedUser({ role: 'superadmin' });
    expect(
      (await stopCampaign({ campaignId: p.campaignId, adminId: superId, reason: 'Test' })).ok,
    ).toBe(true);
    expect(
      await decideEventAllocation({
        allocationId: p.allocationId,
        ownerId: venue.ownerId,
        statut: 'ACCEPTE',
      }),
    ).toEqual({ kind: 'not_found' });
  });

  it('a venue keeps the match’s holds while another live positioning still airs there', async () => {
    const venue = await seedVenue();
    const eventId = await seedEvent(1);
    const stopped = await seedPositioning(eventId, venue.id, { status: 'upcoming' });
    await seedPositioning(eventId, venue.id, { status: 'upcoming' });
    await db
      .insert(hourReservations)
      .values({ screenhostId: venue.id, day: '2027-06-10', hour: 20, eventId });
    const superId = await seedUser({ role: 'superadmin' });
    await stopCampaign({ campaignId: stopped.campaignId, adminId: superId, reason: 'Test' });
    expect(await holdsAt(eventId, venue.id)).toBe(1);
    const [event] = await db
      .select({ seatMinutes: events.seatMinutes })
      .from(events)
      .where(eq(events.id, eventId));
    expect(event?.seatMinutes).toBe(1); // the other positioning still binds the 1-minute seats
  });

  it('« Supprimer »: only once stopped, only when nothing aired, only a superadmin', async () => {
    const venue = await seedVenue();
    const eventId = await seedEvent();
    const superId = await seedUser({ role: 'superadmin' });
    mockSession(superId);

    const idle = await seedPositioning(eventId, venue.id, { status: 'upcoming' });
    expect((await call('DELETE', idle.campaignId)).json()).toMatchObject({ error: 'NOT_STOPPED' });
    expect((await call('POST', idle.campaignId)).statusCode).toBe(200);
    expect((await call('DELETE', idle.campaignId)).statusCode).toBe(204);
    expect(await campaignOf(idle.campaignId)).toBeUndefined();
    expect(await settlementOf(idle.campaignId)).toBeUndefined();

    const aired = await seedPositioning(eventId, venue.id, { status: 'active' });
    await seedProof(aired, venue.id, new Date(bloc(0).start.getTime() + 60_000));
    await stopCampaign({
      campaignId: aired.campaignId,
      adminId: superId,
      reason: 'Test',
      now: bloc(1).start,
    });
    expect((await call('DELETE', aired.campaignId)).json()).toMatchObject({ error: 'AIRED' });
    expect(await campaignOf(aired.campaignId)).toBeDefined();

    vi.restoreAllMocks();
    mockSession(await seedUser({ role: 'admin' }), 'admin');
    expect((await call('DELETE', aired.campaignId)).statusCode).toBe(403);
  });
});
