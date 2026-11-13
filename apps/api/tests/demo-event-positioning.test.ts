import { randomUUID } from 'node:crypto';

import { and, eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import {
  type NewUser,
  businessSectors,
  campaignReconciliation,
  campaignScreenhostPayout,
  campaigns,
  creatives,
  demoScreenhosts,
  dispatchConfig,
  eventAllocations,
  events,
  hourReservations,
  notifications,
  proofOfPlay,
  recharges,
  reversementLines,
  screenhostAffluence,
  screenhosts,
  users,
} from '../src/db/schema.js';
import { demoEventStartDate } from '../src/lib/demo-event.js';
import { decideEventAllocation } from '../src/lib/event-allocation-decision.js';
import { previewEventBoost } from '../src/lib/event-dispatch/boost.js';
import { settleEventPositioning } from '../src/lib/event-playout/settlement.js';
import { activeEventSpots } from '../src/lib/event-playout/spots.js';
import { loadOwnerEventCampaigns } from '../src/lib/owner-event-campaigns.js';
import { DEFAULT_REVERSEMENT_PCTS } from '../src/lib/reversement/split.js';
import { campaignsRoutes } from '../src/routes/campaigns.js';
import { cartRoutes } from '../src/routes/cart.js';
import { eventsRoutes } from '../src/routes/events.js';

import { bothHalves, resetAuthTables } from './helpers/db-test-setup.js';
import { seedInstalledScreen } from './helpers/installed-screen.js';

// DEMO-3 (operator 2026-11-04, ruling 1B — Mariem's Délice demo hit « La campagne n'est pas
// prête pour le panier ») — a demo account positions on a match: priced on the demo venues, its
// spot approved at « Lancer », its allocations accepted on the owner's behalf with no owner told,
// its blocs moved onto the demo timeline (the confirm + the demo delay), so the prospect watches
// the match break on the demo TV right away. The owner sees, decides and earns nothing.

type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;
const mockSession = (userId: string, role = 'advertiser'): void => {
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
      email: `demo-event-${seq}@example.com`,
      contactName: `Demo Event ${seq}`,
      role: 'advertiser',
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

/** A venue open 8–23 with A_max 100: the six blocs of an evening match are all free. */
const seedVenue = async (ownerId: string): Promise<{ id: string; screenId: string }> => {
  seq += 1;
  const [sh] = await db
    .insert(screenhosts)
    .values({
      name: `Café démo ${seq}`,
      ownerId,
      businessSectorId: await ownerSectorId(),
      class: 'premium',
      openingHour: 8,
      closingHour: 23,
      broadcastCapacity: 4,
    })
    .returning();
  const id = sh?.id ?? '';
  await db
    .insert(screenhostAffluence)
    .values(bothHalves({ screenhostId: id, dayOfWeek: 1, hour: 8, estimatedImpressions: 100 }));
  return { id, screenId: await seedInstalledScreen(id) };
};

// Kickoff 20:00, end 22:00 (Tunis) → the window 19:00–23:00 holds six blocs, on ONE Tunis date.
const MATCH_DAY = '2027-06-10';
const KICKOFF = new Date(`${MATCH_DAY}T20:00:00+01:00`);
const ENDS = new Date(`${MATCH_DAY}T22:00:00+01:00`);
const MIN = 60_000;

describe('DEMO-3 — a demo account positions on a match (real Postgres)', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    await resetAuthTables();
    await db.delete(demoScreenhosts);
    await db.update(dispatchConfig).set({ demoDelayMinutes: 5 });
    app = Fastify({ logger: false });
    await app.register(eventsRoutes);
    await app.register(campaignsRoutes);
    await app.register(cartRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await sql.end();
  });

  /** Two real venues — one opened to demos —, a funded demo account and a match. */
  const world = async () => {
    const demoOwner = await seedUser({ role: 'individual_owner' });
    const otherOwner = await seedUser({ role: 'individual_owner' });
    const demoVenue = await seedVenue(demoOwner);
    const otherVenue = await seedVenue(otherOwner);
    await db.insert(demoScreenhosts).values({ screenhostId: demoVenue.id });
    const demo = await seedUser({ isDemo: true, businessName: 'Délice' });
    await db.insert(recharges).values({
      advertiserId: demo,
      amountTnd: '2000.00',
      status: 'confirmed',
      reference: `DEMO-EVT-${seq}`,
    });
    const [ev] = await db
      .insert(events)
      .values({
        name: 'Soirée Ligue des champions',
        type: 'sport',
        kickoffAt: KICKOFF,
        endsAt: ENDS,
        source: 'official',
      })
      .returning();
    return { demoOwner, otherOwner, demoVenue, otherVenue, demo, eventId: ev?.id ?? '' };
  };

  /** The parcours: « Je me positionne », a spot awaiting validation, then the minutes. */
  const positionAs = async (advertiserId: string, eventId: string): Promise<string> => {
    mockSession(advertiserId);
    const created = await app.inject({ method: 'POST', url: `/api/events/${eventId}/positionner` });
    expect(created.statusCode).toBe(201);
    const campaignId = (created.json() as { id: string }).id;
    seq += 1;
    const [creative] = await db
      .insert(creatives)
      .values({
        advertiserId,
        creativeType: 'video',
        storageKey: `creatives/demo-event/${seq}`,
        durationSeconds: 12,
        validationStatus: 'pending',
        fileHash: `demo-event-hash-${seq}`,
      })
      .returning();
    await db
      .update(campaigns)
      .set({ creativeId: creative?.id ?? null })
      .where(eq(campaigns.id, campaignId));
    return campaignId;
  };
  const patch = (id: string, payload: Record<string, unknown>) =>
    app.inject({ method: 'PATCH', url: `/api/campaigns/${id}`, payload });
  const cmaxOf = async (id: string) =>
    (await app.inject({ method: 'GET', url: `/api/campaigns/${id}/cmax` })).json() as {
      max_minutes: number;
      eligible_count: number;
    };

  it('priced on the demo venues only; a real account keeps the whole network', async () => {
    const w = await world();
    const demoPositioning = await positionAs(w.demo, w.eventId);
    // One demo venue → its six blocs, twelve minutes (2-minute seats); the real network: 24.
    expect(await cmaxOf(demoPositioning)).toMatchObject({ max_minutes: 12, eligible_count: 1 });
    expect((await patch(demoPositioning, { event_minutes: 14 })).statusCode).toBe(400);
    expect((await patch(demoPositioning, { event_minutes: 2 })).statusCode).toBe(200);

    const real = await seedUser();
    const realPositioning = await positionAs(real, w.eventId);
    expect(await cmaxOf(realPositioning)).toMatchObject({ max_minutes: 24, eligible_count: 2 });
  });

  it('« Lancer »: in the cart, launched, accepted unannounced, on the demo timeline', async () => {
    const w = await world();
    const id = await positionAs(w.demo, w.eventId);
    expect((await patch(id, { event_minutes: 4 })).statusCode).toBe(200);
    const added = await app.inject({
      method: 'POST',
      url: '/api/cart/items',
      payload: { campaign_id: id },
    });
    expect(added.statusCode).toBe(200); // was 400 DEMO_EVENTS_UNAVAILABLE
    const before = Date.now();
    const confirmed = await app.inject({ method: 'POST', url: '/api/cart/confirm' });
    const after = Date.now();
    expect(confirmed.statusCode).toBe(200);
    expect((confirmed.json() as { launched: { id: string }[] }).launched.map((c) => c.id)).toEqual([
      id,
    ]);

    const allocations = await db
      .select()
      .from(eventAllocations)
      .where(eq(eventAllocations.campaignId, id));
    expect(allocations).toHaveLength(1);
    const [allocation] = allocations;
    expect(allocation?.screenhostId).toBe(w.demoVenue.id);
    expect(allocation?.statut).toBe('ACCEPTE');
    expect(allocation?.decidedAt).not.toBeNull();
    // Four minutes = two 2-minute seats = two blocs, moved: the first opens the demo delay after
    // the confirm, on a whole minute; the second follows it.
    const blocs = allocation?.blocs as { start: string; end: string }[];
    expect(blocs).toHaveLength(2);
    const first = new Date(blocs[0]?.start ?? '').getTime();
    expect(first % MIN).toBe(0);
    expect(first).toBeGreaterThanOrEqual(before + 5 * MIN);
    expect(first).toBeLessThanOrEqual(after + 6 * MIN);
    expect(new Date(blocs[0]?.end ?? '').getTime()).toBe(first + 20 * MIN);
    expect(new Date(blocs[1]?.start ?? '').getTime()).toBe(first + 20 * MIN);

    // Active from the demo day; its end stays the match's (the event settlement closes it).
    const [row] = await db.select().from(campaigns).where(eq(campaigns.id, id));
    expect(row?.status).toBe('active');
    expect(row?.startDate).toBe(demoEventStartDate(new Date(first)));
    expect(row?.endDate).toBe(MATCH_DAY);
    expect(row?.airsAt).not.toBeNull();
    // The spot was approved at « Lancer » (no admin review for a demo).
    const [spot] = await db
      .select()
      .from(creatives)
      .where(eq(creatives.id, row?.creativeId ?? ''));
    expect(spot?.validationStatus).toBe('approved');

    // No owner told, no hour held.
    const told = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, w.demoOwner), eq(notifications.campaignId, id)));
    expect(told).toHaveLength(0);
    const held = await db
      .select()
      .from(hourReservations)
      .where(eq(hourReservations.screenhostId, w.demoVenue.id));
    expect(held).toHaveLength(0);

    // The demo TV plays its pod when the first moved bloc opens.
    const onAir = await activeEventSpots(w.demoVenue.id, new Date(first + 10_000));
    expect(onAir.map((s) => s.campaignId)).toContain(id);
    expect(await activeEventSpots(w.otherVenue.id, new Date(first + 10_000))).toHaveLength(0);
  });

  it('the owner never sees nor decides it; the booster is closed; the venue earns nothing', async () => {
    const w = await world();
    const id = await positionAs(w.demo, w.eventId);
    expect((await patch(id, { event_minutes: 4 })).statusCode).toBe(200);
    await app.inject({ method: 'POST', url: '/api/cart/items', payload: { campaign_id: id } });
    expect((await app.inject({ method: 'POST', url: '/api/cart/confirm' })).statusCode).toBe(200);
    const [allocation] = await db
      .select()
      .from(eventAllocations)
      .where(eq(eventAllocations.campaignId, id));
    if (!allocation) throw new Error('no allocation');

    expect(await loadOwnerEventCampaigns(w.demoOwner, DEFAULT_REVERSEMENT_PCTS)).toHaveLength(0);
    const decided = await decideEventAllocation({
      allocationId: allocation.id,
      ownerId: w.demoOwner,
      statut: 'REFUSE',
    });
    expect(decided.kind).toBe('not_found');
    expect(await previewEventBoost(id, w.demo, [randomUUID()])).toEqual({
      status: 'DEMO_NOT_BOOSTABLE',
    });

    // The demo TV aired its first pod; the match window closes; the settlement debits the demo
    // wallet for what aired, and pays the venue nothing.
    const blocs = allocation.blocs as { start: string }[];
    const [row] = await db.select().from(campaigns).where(eq(campaigns.id, id));
    if (!row?.creativeId) throw new Error('no spot');
    await db.insert(proofOfPlay).values({
      screenId: w.demoVenue.screenId,
      screenhostId: w.demoVenue.id,
      campaignId: id,
      creativeId: row.creativeId,
      videoIdAsSent: id,
      eventType: 'VIDEO_ENDED',
      playedDurationMs: 12_000,
      playedAt: new Date(new Date(blocs[0]?.start ?? '').getTime() + 30_000),
    });
    const settled = await settleEventPositioning(id, new Date(`${MATCH_DAY}T23:30:00Z`));
    expect(settled.status).toBe('SETTLED');
    const [recon] = await db
      .select()
      .from(campaignReconciliation)
      .where(eq(campaignReconciliation.campaignId, id));
    expect(Number(recon?.spendTnd)).toBeGreaterThan(0);
    expect(
      await db
        .select()
        .from(campaignScreenhostPayout)
        .where(eq(campaignScreenhostPayout.campaignId, id)),
    ).toHaveLength(0);
    expect(
      await db.select().from(reversementLines).where(eq(reversementLines.campaignId, id)),
    ).toHaveLength(0);
  });
});
