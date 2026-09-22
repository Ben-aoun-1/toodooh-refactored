import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { and, eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import {
  type NewUser,
  businessSectors,
  campaignDispatchAllocation,
  campaignDispatchPlan,
  campaigns,
  cartItems,
  creatives,
  events,
  notifications,
  recharges,
  screenhostAffluence,
  screenhosts,
  users,
} from '../src/db/schema.js';
import { computeCampaignCmax } from '../src/lib/campaign-cmax.js';
import { plusCalendarDays, tunisDateOf } from '../src/lib/campaign-dates.js';
import {
  DRAFT_REMINDER_TITLE,
  EVENT_DRAFT_REMINDER_TITLE,
  eventDraftReminderBody,
  runCampaignLifecycleTick,
} from '../src/lib/campaign-lifecycle.js';
import { getDispatchConfig } from '../src/lib/dispatch/config.js';
import { computeEventCmax } from '../src/lib/event-pricing/pricing.js';
import { adminCampaignsRoutes } from '../src/routes/admin-campaigns.js';
import { campaignBoostRoutes } from '../src/routes/campaign-boost.js';
import { campaignDispatchRoutes } from '../src/routes/campaign-dispatch.js';
import { campaignsRoutes } from '../src/routes/campaigns.js';
import { cartRoutes } from '../src/routes/cart.js';
import { creativesRoutes } from '../src/routes/creatives.js';
import { eventsRoutes } from '../src/routes/events.js';

import { resetAuthTables, bothHalves } from './helpers/db-test-setup.js';
import { seedInstalledScreen } from './helpers/installed-screen.js';

// EV3 — the positioning parcours' API layer: a positioning IS a campaign row (campaign_type
// 'event' + event_id BINDING — the binding, not the type string, is the discriminator; legacy
// 'event'-TYPED rows without a binding stay fully classic, pinned below). The engine boundary is
// hard: no positioning ever reaches runDispatch/assemblePool/computeCampaignCmax — a validated
// positioning sits À venir/Active with NO plan and NO allocations (bloc dispatch = EV4).
// No business_sectors/zones rows added (the fixture footgun); sector flags untouched (event
// eligibility defaults on).

type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;
const mockSession = (userId: string, role = 'advertiser'): void => {
  vi.spyOn(auth.api, 'getSession').mockResolvedValue({
    session: {},
    user: { id: userId, role, status: 'approved' },
  } as unknown as GetSessionResult);
};

const silentLog = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
  fatal: () => undefined,
  trace: () => undefined,
  child: () => silentLog,
  level: 'silent',
} as never;

let seq = 0;
const seedUser = async (values: Partial<NewUser> = {}): Promise<string> => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `ev3-${seq}@example.com`,
      contactName: `EV3 User ${seq}`,
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

/** A venue open 8–23 with A_max 100 (one affluence cell) — 6 blocs for an evening match. */
const seedVenue = async (): Promise<string> => {
  const ownerId = await seedUser({ role: 'individual_owner' });
  seq += 1;
  const [sh] = await db
    .insert(screenhosts)
    .values({
      name: `EV3 Venue ${seq}`,
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
  await seedInstalledScreen(id);
  return id;
};

// A Tunis-evening fixture: kickoff 20:00, ends 22:00 → window 19:00–23:00, all on ONE Tunis date.
const KICKOFF = new Date('2027-06-10T20:00:00+01:00');
const ENDS = new Date('2027-06-10T22:00:00+01:00');

const seedEvent = async (over: Partial<typeof events.$inferInsert> = {}): Promise<string> => {
  seq += 1;
  const [row] = await db
    .insert(events)
    .values({
      name: `Tunisie – Brésil ${seq}`,
      type: 'sport',
      kickoffAt: KICKOFF,
      endsAt: ENDS,
      source: 'official',
      ...over,
    })
    .returning();
  return row?.id ?? '';
};

const seedCreative = async (
  advertiserId: string,
  opts: {
    type?: 'video' | 'photo';
    duration?: number;
    status?: 'pending' | 'approved' | 'rejected';
  } = {},
): Promise<string> => {
  seq += 1;
  const [c] = await db
    .insert(creatives)
    .values({
      advertiserId,
      creativeType: opts.type ?? 'video',
      storageKey: `creatives/ev3/${seq}-${Math.random().toString(16).slice(2)}`,
      durationSeconds: opts.duration ?? 12,
      validationStatus: opts.status ?? 'approved',
      fileHash: `ev3-hash-${seq}-${Math.random().toString(16).slice(2)}`,
    })
    .returning();
  return c?.id ?? '';
};

const fund = (advertiserId: string, amountTnd: string) =>
  db.insert(recharges).values({
    advertiserId,
    amountTnd,
    status: 'confirmed',
    reference: `EV3-${seq}-${Math.random().toString(16).slice(2, 8)}`,
  });

// Dependency-free multipart body (the creatives.test idiom — real media, byte-sniffed).
const multipartBody = (file: { filename: string; contentType: string; content: Buffer }) => {
  const boundary = `----toodoohtest${Date.now()}${Math.random().toString(16).slice(2)}`;
  const head = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${file.filename}"\r\n` +
      `Content-Type: ${file.contentType}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    payload: Buffer.concat([head, file.content, tail]),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
};
const fixture = (name: string): Buffer => readFileSync(join(import.meta.dirname, 'fixtures', name));

const buildApp = () => Fastify({ logger: false });

describe('EV3 — the positioning parcours API (real Postgres)', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    await resetAuthTables();
    app = buildApp();
    await app.register(eventsRoutes);
    await app.register(campaignsRoutes);
    await app.register(cartRoutes);
    await app.register(adminCampaignsRoutes);
    await app.register(campaignBoostRoutes);
    await app.register(campaignDispatchRoutes);
    await app.register(creativesRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await sql.end();
  });

  const positionner = (eventId: string) =>
    app.inject({ method: 'POST', url: `/api/events/${eventId}/positionner` });
  const patchCampaign = (id: string, payload: Record<string, unknown>) =>
    app.inject({ method: 'PATCH', url: `/api/campaigns/${id}`, payload });
  const addToCart = (campaignId: string) =>
    app.inject({ method: 'POST', url: '/api/cart/items', payload: { campaign_id: campaignId } });
  const confirmCart = () => app.inject({ method: 'POST', url: '/api/cart/confirm' });

  /** A complete positioning draft: bound row + approved/pending spot + budget. */
  const seedPositioning = async (
    advId: string,
    opts: { eventId?: string; spot?: 'approved' | 'pending'; budget?: string } = {},
  ): Promise<{ campaignId: string; eventId: string }> => {
    const eventId = opts.eventId ?? (await seedEvent());
    mockSession(advId);
    const created = await positionner(eventId);
    expect(created.statusCode).toBe(201);
    const campaignId = (created.json() as { id: string }).id;
    const creativeId = await seedCreative(advId, { status: opts.spot ?? 'approved' });
    await db
      .update(campaigns)
      .set({ creativeId, requestedBudget: opts.budget ?? '150.00' })
      .where(eq(campaigns.id, campaignId));
    return { campaignId, eventId };
  };

  describe('POST /api/events/:id/positionner — the parcours entry', () => {
    it('creates the DRAFT bound row: match name, event_id, window dates SNAPSHOTTED', async () => {
      const advId = await seedUser();
      const eventId = await seedEvent({ name: 'Tunisie – Brésil' });
      mockSession(advId);
      const res = await positionner(eventId);
      expect(res.statusCode).toBe(201);
      const body = res.json() as Record<string, unknown>;
      expect(body['name']).toBe('Tunisie – Brésil');
      expect(body['campaign_type']).toBe('event');
      expect(body['event_id']).toBe(eventId);
      expect(body['status']).toBe('draft');
      // Window 19:00–23:00 on 2027-06-10 (Tunis) → both dates land on the match date.
      expect(body['start_date']).toBe('2027-06-10');
      expect(body['end_date']).toBe('2027-06-10');
    });

    it('snapshots CROSS-MIDNIGHT windows on their real Tunis dates', async () => {
      const advId = await seedUser();
      const eventId = await seedEvent({
        kickoffAt: new Date('2027-06-11T00:30:00+01:00'),
        endsAt: new Date('2027-06-11T02:30:00+01:00'),
      });
      mockSession(advId);
      const body = (await positionner(eventId)).json() as Record<string, unknown>;
      // Window 23:30 (June 10) → 03:30 (June 11).
      expect(body['start_date']).toBe('2027-06-10');
      expect(body['end_date']).toBe('2027-06-11');
    });

    it('404 on an unknown event; 409 annulé; 409 terminé', async () => {
      const advId = await seedUser();
      mockSession(advId);
      expect((await positionner('00000000-0000-4000-8000-000000000000')).statusCode).toBe(404);
      const annule = await seedEvent({ annule: true });
      const resAnnule = await positionner(annule);
      expect(resAnnule.statusCode).toBe(409);
      expect((resAnnule.json() as { error: string }).error).toBe('EVENT_ANNULE');
      const past = await seedEvent({
        kickoffAt: new Date('2020-01-01T20:00:00+01:00'),
        endsAt: new Date('2020-01-01T22:00:00+01:00'),
      });
      const resPast = await positionner(past);
      expect(resPast.statusCode).toBe(409);
      expect((resPast.json() as { error: string }).error).toBe('EVENT_TERMINE');
    });

    it('the row rides the CLASSIC draft machinery: budget/description PATCH + Reprendre read', async () => {
      const advId = await seedUser();
      const { campaignId, eventId } = await seedPositioning(advId);
      const res = await patchCampaign(campaignId, {
        description: 'Mi-temps',
        requested_budget: 120,
      });
      expect(res.statusCode).toBe(200);
      const read = await app.inject({ method: 'GET', url: `/api/campaigns/${campaignId}` });
      expect(read.statusCode).toBe(200);
      const body = read.json() as Record<string, unknown>;
      expect(body['event_id']).toBe(eventId);
      expect(body['requested_budget']).toBe(120);
    });

    it('the SNAPSHOT LOCK: dates and type are not PATCHable on a positioning', async () => {
      const advId = await seedUser();
      const { campaignId } = await seedPositioning(advId);
      const res = await patchCampaign(campaignId, { start_date: '2027-07-01' });
      expect(res.statusCode).toBe(400);
      expect((res.json() as { error: string }).error).toBe('EVENT_FIELDS_LOCKED');
      expect((await patchCampaign(campaignId, { campaign_type: 'standard' })).statusCode).toBe(400);
    });
  });

  describe('the 15-second spot matrix (attach + upload)', () => {
    it('ATTACH refuses a video over 15 s on a positioning; 15 s passes; photos pass', async () => {
      const advId = await seedUser();
      const { campaignId } = await seedPositioning(advId);
      const long = await seedCreative(advId, { duration: 16 });
      const res = await patchCampaign(campaignId, { creative_id: long });
      expect(res.statusCode).toBe(400);
      expect((res.json() as { error: string }).error).toBe('EVENT_SPOT_TOO_LONG');
      const exact = await seedCreative(advId, { duration: 15 });
      expect((await patchCampaign(campaignId, { creative_id: exact })).statusCode).toBe(200);
      const photo = await seedCreative(advId, { type: 'photo', duration: 20 });
      expect((await patchCampaign(campaignId, { creative_id: photo })).statusCode).toBe(200);
    });

    it('a CLASSIC campaign still attaches a 16 s video (the guard is positioning-only)', async () => {
      const advId = await seedUser();
      mockSession(advId);
      const created = await app.inject({
        method: 'POST',
        url: '/api/campaigns',
        payload: { name: 'Classique', campaign_type: 'standard' },
      });
      const campaignId = (created.json() as { id: string }).id;
      const long = await seedCreative(advId, { duration: 16 });
      expect((await patchCampaign(campaignId, { creative_id: long })).statusCode).toBe(200);
    });

    it('UPLOAD with for_event refuses a long video BEFORE storing; photos pass', async () => {
      const advId = await seedUser();
      mockSession(advId);
      const video = multipartBody({
        filename: 'clip.mp4',
        contentType: 'video/mp4',
        content: fixture('h264-169.mp4'),
      });
      const refused = await app.inject({
        method: 'POST',
        url: '/api/creatives?type=video&duration_seconds=20&for_event=1',
        payload: video.payload,
        headers: video.headers,
      });
      expect(refused.statusCode).toBe(400);
      expect((refused.json() as { error: string }).error).toBe('EVENT_SPOT_TOO_LONG');
      const photo = multipartBody({
        filename: 'shot.jpg',
        contentType: 'image/jpeg',
        content: fixture('photo.jpg'),
      });
      const ok = await app.inject({
        method: 'POST',
        url: '/api/creatives?type=photo&duration_seconds=20&for_event=1',
        payload: photo.payload,
        headers: photo.headers,
      });
      expect(ok.statusCode).toBe(201);
    });
  });

  describe('the cart gates — min 100, EVENT ceiling, no J+2 floor', () => {
    it('refuses below the 100 TND floor and above the EVENT C_max; accepts inside', async () => {
      await seedVenue(); // A_max 100 × 6 blocs × 20 → I_max 12 000
      const advId = await seedUser();
      const { campaignId, eventId } = await seedPositioning(advId, { budget: '50.00' });
      const below = await addToCart(campaignId);
      expect(below.statusCode).toBe(400);
      expect((below.json() as { error: string }).error).toBe('BUDGET_BELOW_MINIMUM');

      const [ev] = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
      const ceiling = await computeEventCmax(
        { id: eventId, kickoffAt: ev?.kickoffAt ?? KICKOFF, endsAt: ev?.endsAt ?? ENDS },
        (await getDispatchConfig()).eventCpmTnd,
      );
      expect(ceiling.cMaxEvtTnd).toBeGreaterThanOrEqual(100);

      await db
        .update(campaigns)
        .set({ requestedBudget: `${ceiling.cMaxEvtTnd + 1}.00` })
        .where(eq(campaigns.id, campaignId));
      const over = await addToCart(campaignId);
      expect(over.statusCode).toBe(400);
      expect((over.json() as { error: string }).error).toBe('BUDGET_EXCEEDS_CMAX');

      await db
        .update(campaigns)
        .set({ requestedBudget: '150.00' })
        .where(eq(campaigns.id, campaignId));
      expect((await addToCart(campaignId)).statusCode).toBe(200);
    });

    it('the J+2 working-day floor does NOT gate a positioning (kickoff TOMORROW adds fine)', async () => {
      await seedVenue();
      const advId = await seedUser();
      const tomorrow = plusCalendarDays(tunisDateOf(new Date()), 1);
      const eventId = await seedEvent({
        kickoffAt: new Date(`${tomorrow}T20:00:00+01:00`),
        endsAt: new Date(`${tomorrow}T22:00:00+01:00`),
      });
      const { campaignId } = await seedPositioning(advId, { eventId });
      const res = await addToCart(campaignId);
      expect(res.statusCode).toBe(200);
    });

    it('an event annulé after positioning refuses at add', async () => {
      await seedVenue();
      const advId = await seedUser();
      const { campaignId, eventId } = await seedPositioning(advId);
      await db.update(events).set({ annule: true }).where(eq(events.id, eventId));
      const res = await addToCart(campaignId);
      expect(res.statusCode).toBe(400);
      expect((res.json() as { error: string }).error).toBe('EVENT_ANNULE');
    });

    it('GET /api/cart carries the match + derived window for event items', async () => {
      await seedVenue();
      const advId = await seedUser();
      const { campaignId, eventId } = await seedPositioning(advId);
      await addToCart(campaignId);
      const res = await app.inject({ method: 'GET', url: '/api/cart' });
      const items = (res.json() as { items: Record<string, unknown>[] }).items;
      expect(items).toHaveLength(1);
      const event = items[0]?.['event'] as Record<string, unknown>;
      expect(event['id']).toBe(eventId);
      expect((event['fenetre'] as Record<string, unknown>)['window_start']).toBe(
        '2027-06-10T18:00:00.000Z', // 19:00 Tunis
      );
    });
  });

  describe('cart confirm — both paths, THE PHASING PIN', () => {
    const planRowsOf = async (campaignId: string) =>
      db
        .select({ id: campaignDispatchPlan.id })
        .from(campaignDispatchPlan)
        .where(eq(campaignDispatchPlan.campaignId, campaignId));

    it('spot VALIDÉ: confirm flips date-routed to À venir with NO plan and NO allocations', async () => {
      await seedVenue();
      const advId = await seedUser();
      await fund(advId, '500.00');
      const { campaignId } = await seedPositioning(advId, { spot: 'approved' });
      await addToCart(campaignId);
      const res = await confirmCart();
      expect(res.statusCode).toBe(200);
      const [row] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId)).limit(1);
      expect(row?.status).toBe('upcoming'); // 2027 window → future start
      expect(row?.activatedBy).toBeNull(); // system activation (the SK1 idiom)
      // THE PIN — the engine boundary: nothing dispatched, nothing allocated, nobody notified.
      expect(await planRowsOf(campaignId)).toHaveLength(0);
      const allocs = await db
        .select({ id: campaignDispatchAllocation.id })
        .from(campaignDispatchAllocation)
        .innerJoin(
          campaignDispatchPlan,
          eq(campaignDispatchAllocation.planId, campaignDispatchPlan.id),
        )
        .where(eq(campaignDispatchPlan.campaignId, campaignId));
      expect(allocs).toHaveLength(0);
      const [cart] = await db.select().from(cartItems).where(eq(cartItems.campaignId, campaignId));
      expect(cart).toBeUndefined();
    });

    it('spot NOUVEAU: confirm routes to the SHARED pending queue; admin activate then flips WITHOUT dispatch', async () => {
      await seedVenue();
      const advId = await seedUser();
      await fund(advId, '500.00');
      const { campaignId } = await seedPositioning(advId, { spot: 'pending' });
      await addToCart(campaignId);
      expect((await confirmCart()).statusCode).toBe(200);
      const [pending] = await db
        .select({ status: campaigns.status, creativeId: campaigns.creativeId })
        .from(campaigns)
        .where(eq(campaigns.id, campaignId))
        .limit(1);
      expect(pending?.status).toBe('pending');

      // The admin validates the spot, then activates — same queue, no distinction (§9).
      if (pending?.creativeId) {
        await db
          .update(creatives)
          .set({ validationStatus: 'approved' })
          .where(eq(creatives.id, pending.creativeId));
      }
      const adminId = await seedUser({ role: 'admin' });
      mockSession(adminId, 'admin');
      const activate = await app.inject({
        method: 'POST',
        url: `/api/admin/campaigns/${campaignId}/activate`,
      });
      expect(activate.statusCode).toBe(200);
      const body = activate.json() as { plan: unknown; allocations: unknown[] };
      expect(body.plan).toBeNull();
      expect(body.allocations).toEqual([]);
      expect(await planRowsOf(campaignId)).toHaveLength(0);
      const [row] = await db
        .select({ status: campaigns.status })
        .from(campaigns)
        .where(eq(campaigns.id, campaignId))
        .limit(1);
      expect(row?.status).toBe('upcoming');
    });

    it('the solde gate still holds (funded ≥ Σ budgets before anything flips)', async () => {
      await seedVenue();
      const advId = await seedUser();
      const { campaignId } = await seedPositioning(advId); // no funds
      await addToCart(campaignId);
      const res = await confirmCart();
      expect(res.statusCode).toBe(400);
      const [row] = await db
        .select({ status: campaigns.status })
        .from(campaigns)
        .where(eq(campaigns.id, campaignId))
        .limit(1);
      expect(row?.status).toBe('draft');
    });
  });

  describe('THE ENGINE BOUNDARY pins', () => {
    it('computeCampaignCmax THROWS on an event-bound row', async () => {
      await expect(
        computeCampaignCmax(
          {
            id: '00000000-0000-4000-8000-000000000000',
            startDate: '2027-06-10',
            endDate: '2027-06-10',
            campaignType: 'event',
            eventId: '00000000-0000-4000-8000-000000000001',
            standardCpmTnd: '15.000',
            eventCpmTnd: '15.000',
            t10s: '0.600',
            t20s: '0.700',
            t30s: '0.800',
          },
          10,
        ),
      ).rejects.toThrow(/EV3 engine boundary/);
    });

    it('GET /:id/cmax on a positioning prices via the EVENT engine (no creative needed)', async () => {
      await seedVenue();
      const advId = await seedUser();
      const eventId = await seedEvent();
      mockSession(advId);
      const campaignId = ((await positionner(eventId)).json() as { id: string }).id;
      const res = await app.inject({ method: 'GET', url: `/api/campaigns/${campaignId}/cmax` });
      expect(res.statusCode).toBe(200);
      const body = res.json() as Record<string, number>;
      const [ev] = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
      const expected = await computeEventCmax(
        { id: eventId, kickoffAt: ev?.kickoffAt ?? KICKOFF, endsAt: ev?.endsAt ?? ENDS },
        (await getDispatchConfig()).eventCpmTnd,
      );
      expect(body['c_max_tnd']).toBe(expected.cMaxEvtTnd);
      expect(body['i_max_facturable']).toBe(expected.iMax);
    });

    it('the classic dispatch route refuses a positioning (409 EVENT_POSITIONING)', async () => {
      const advId = await seedUser();
      const { campaignId } = await seedPositioning(advId);
      const adminId = await seedUser({ role: 'admin' });
      mockSession(adminId, 'admin');
      const res = await app.inject({
        method: 'POST',
        url: `/api/campaigns/${campaignId}/dispatch`,
        payload: { i_cible: 1000, cpm: 15, s: 10 },
      });
      expect(res.statusCode).toBe(409);
      expect((res.json() as { error: string }).error).toBe('EVENT_POSITIONING');
    });

    it('booster refuses a positioning (409 EVENT_POSITIONING — event boost is EV6)', async () => {
      const advId = await seedUser();
      const { campaignId } = await seedPositioning(advId);
      mockSession(advId);
      const res = await app.inject({
        method: 'POST',
        url: `/api/campaigns/${campaignId}/boost/preview`,
        payload: { new_end_date: '2027-06-12' },
      });
      expect(res.statusCode).toBe(409);
      expect((res.json() as { error: string }).error).toBe('EVENT_POSITIONING');
    });

    it('LEGACY compat: an unbound campaign_type=event row stays fully CLASSIC', async () => {
      const advId = await seedUser();
      mockSession(advId);
      // The pre-EV3 shape: 'event' as a CPM discriminator, no binding — still creatable, still
      // priced by the classic C_max (the binding, not the type string, forks).
      const created = await app.inject({
        method: 'POST',
        url: '/api/campaigns',
        payload: {
          name: 'Legacy event-typed',
          campaign_type: 'event',
          start_date: '2027-06-10',
          end_date: '2027-06-11',
        },
      });
      expect(created.statusCode).toBe(201);
      const campaignId = (created.json() as { id: string }).id;
      const creativeId = await seedCreative(advId, { duration: 16 }); // >15 s: no event cap here
      expect((await patchCampaign(campaignId, { creative_id: creativeId })).statusCode).toBe(200);
      const cmax = await app.inject({ method: 'GET', url: `/api/campaigns/${campaignId}/cmax` });
      expect(cmax.statusCode).toBe(200); // the classic read (throws nowhere)
      expect(typeof (cmax.json() as { c_max_tnd: number }).c_max_tnd).toBe('number');
    });
  });

  describe('lifecycle §8 — J-3 vs KICKOFF + past-kickoff auto-delete', () => {
    // The tick's clock is INJECTED, but the positionner route reads the REAL clock (statut
    // gate) — so the anchor sits in the future: 2027-06-07 10:00 UTC = 11:00 Tunis.
    const NOW = new Date('2027-06-07T10:00:00Z');

    const seedBoundDraft = async (
      advId: string,
      kickoff: Date,
      ends: Date,
    ): Promise<{ campaignId: string; eventId: string }> => {
      const eventId = await seedEvent({ kickoffAt: kickoff, endsAt: ends });
      mockSession(advId);
      const res = await positionner(eventId);
      expect(res.statusCode).toBe(201);
      return { campaignId: (res.json() as { id: string }).id, eventId };
    };

    it('J-3: the EVENT copy fires on the kickoff day, idempotent; classic drafts keep theirs', async () => {
      const advId = await seedUser();
      // Kickoff on 2027-06-10 (today+3), late evening — the day matches, not the instant.
      const { campaignId } = await seedBoundDraft(
        advId,
        new Date('2027-06-10T21:00:00+01:00'),
        new Date('2027-06-10T23:00:00+01:00'),
      );
      const [classicRow] = await db
        .insert(campaigns)
        .values({
          advertiserId: advId,
          name: 'Classique J-3',
          campaignType: 'standard',
          status: 'draft',
          startDate: '2027-06-10',
          endDate: '2027-06-12',
        })
        .returning();
      const first = await runCampaignLifecycleTick(silentLog, NOW);
      expect(first.reminded).toBe(2);
      const eventNotifs = await db
        .select()
        .from(notifications)
        .where(eq(notifications.campaignId, campaignId));
      expect(eventNotifs).toHaveLength(1);
      expect(eventNotifs[0]?.title).toBe(EVENT_DRAFT_REMINDER_TITLE);
      const [ev] = await db
        .select({ name: campaigns.name })
        .from(campaigns)
        .where(eq(campaigns.id, campaignId));
      expect(eventNotifs[0]?.body).toBe(eventDraftReminderBody(ev?.name ?? ''));
      const classicNotifs = await db
        .select()
        .from(notifications)
        .where(eq(notifications.campaignId, classicRow?.id ?? ''));
      expect(classicNotifs[0]?.title).toBe(DRAFT_REMINDER_TITLE);
      // Idempotent: the stamp blocks a re-send.
      const second = await runCampaignLifecycleTick(silentLog, NOW);
      expect(second.reminded).toBe(0);
    });

    it('past-kickoff positioning drafts are DELETED — carted ones too; same-day future kickoff survives', async () => {
      const advId = await seedUser();
      // Kickoff 09:00 Tunis today — already passed at 11:00.
      const dead = await seedBoundDraft(
        advId,
        new Date('2027-06-07T09:00:00+01:00'),
        new Date('2027-06-07T10:30:00+01:00'),
      );
      // Kickoff 20:00 Tunis today — still ahead: survives (INSTANT precision, not day).
      const alive = await seedBoundDraft(
        advId,
        new Date('2027-06-07T20:00:00+01:00'),
        new Date('2027-06-07T22:00:00+01:00'),
      );
      // A CARTED past-kickoff positioning dies too (« unconfirmed » is literal — nothing left
      // to launch once the match started; the CF-C1 exemption is a classic-draft rule).
      const carted = await seedBoundDraft(
        advId,
        new Date('2027-06-07T08:00:00+01:00'),
        new Date('2027-06-07T09:30:00+01:00'),
      );
      await db.insert(cartItems).values({ userId: advId, campaignId: carted.campaignId });
      // A carted CLASSIC past-start draft still survives (the CF-C1 exemption intact).
      const [classicCarted] = await db
        .insert(campaigns)
        .values({
          advertiserId: advId,
          name: 'Classique panier',
          campaignType: 'standard',
          status: 'draft',
          startDate: '2027-06-02',
          endDate: '2027-06-12',
        })
        .returning();
      await db.insert(cartItems).values({ userId: advId, campaignId: classicCarted?.id ?? '' });

      const result = await runCampaignLifecycleTick(silentLog, NOW);
      expect(result.deleted).toBe(2); // dead + carted positioning — nothing else
      const remaining = await db
        .select({ id: campaigns.id })
        .from(campaigns)
        .where(eq(campaigns.advertiserId, advId));
      const ids = remaining.map((r) => r.id);
      expect(ids).toContain(alive.campaignId);
      expect(ids).toContain(classicCarted?.id ?? '');
      expect(ids).not.toContain(dead.campaignId);
      expect(ids).not.toContain(carted.campaignId);
    });

    it('a confirmed positioning rides the CLASSIC upcoming→active flip on its window day', async () => {
      const advId = await seedUser();
      const eventId = await seedEvent({
        kickoffAt: new Date('2027-06-07T20:00:00+01:00'),
        endsAt: new Date('2027-06-07T22:00:00+01:00'),
      });
      mockSession(advId);
      const campaignId = ((await positionner(eventId)).json() as { id: string }).id;
      await db.update(campaigns).set({ status: 'upcoming' }).where(eq(campaigns.id, campaignId));
      await runCampaignLifecycleTick(silentLog, NOW);
      const [row] = await db
        .select({ status: campaigns.status })
        .from(campaigns)
        .where(and(eq(campaigns.id, campaignId), eq(campaigns.status, 'active')));
      expect(row).toBeDefined();
    });
  });
});
