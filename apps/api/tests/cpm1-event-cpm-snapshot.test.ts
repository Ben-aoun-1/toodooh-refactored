import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import {
  type NewUser,
  businessSectors,
  campaignZones,
  campaigns,
  creatives,
  eventAllocations,
  events,
  recharges,
  screenhostAffluence,
  screenhosts,
  users,
  zones,
} from '../src/db/schema.js';
import { prepareActivation } from '../src/lib/activation-service.js';
import { decideEventAllocation } from '../src/lib/event-allocation-decision.js';
import { applyEventBoost, previewEventBoost } from '../src/lib/event-dispatch/boost.js';
import { computeEventCmax } from '../src/lib/event-pricing/pricing.js';
import { fenetreDiffusion } from '../src/lib/fenetre-diffusion.js';
import { adminCampaignsRoutes } from '../src/routes/admin-campaigns.js';
import { campaignsRoutes } from '../src/routes/campaigns.js';
import { cartRoutes } from '../src/routes/cart.js';
import { eventsRoutes } from '../src/routes/events.js';

import {
  type CpmConfigSnapshot,
  pinCpmConfig,
  restoreCpmConfig,
  setCpmConfig,
} from './helpers/cpm-config.js';
import { bothHalves, resetAuthTables } from './helpers/db-test-setup.js';

// CPM-1 on the EVENT engine — a positioning keeps the event CPM in effect when it was created:
// its validation (runEventDispatch), its ceilings (cursor, submit, cart, « Hosts éligibles »), the
// owner-refusal cascade and the event booster all price at the positioning's own rate, never at a
// CPM the admin saved afterwards. A_max 100 → a bloc is 2 000 impressions, 6 blocs per venue.

type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;
const mockSession = (userId: string, role: string): void => {
  vi.spyOn(auth.api, 'getSession').mockResolvedValue({
    session: {},
    user: { id: userId, role, status: 'approved' },
  } as unknown as GetSessionResult);
};

let seq = 0;
const tag = (): string => `${seq}-${Math.random().toString(16).slice(2, 10)}`;
const seedUser = async (values: Partial<NewUser> = {}): Promise<string> => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `cpm1-evt-${seq}@example.com`,
      contactName: `CPM1 ${seq}`,
      role: 'advertiser',
      status: 'approved',
      ...values,
    })
    .returning({ id: users.id });
  return u?.id ?? '';
};

const seedZone = async (): Promise<string> => {
  seq += 1;
  const [z] = await db
    .insert(zones)
    .values({ name: `CPM1 Zone ${tag()}`, active: true })
    .returning({ id: zones.id });
  return z?.id ?? '';
};

const seedVenue = async (sps: string, zoneId?: string) => {
  const ownerId = await seedUser({ role: 'individual_owner' });
  const [sector] = await db
    .select({ id: businessSectors.id })
    .from(businessSectors)
    .where(eq(businessSectors.audience, 'owner'))
    .limit(1);
  const [sh] = await db
    .insert(screenhosts)
    .values({
      name: `CPM1 Venue ${seq}`,
      ownerId,
      businessSectorId: sector?.id,
      class: 'premium',
      sps,
      openingHour: 8,
      closingHour: 23,
      broadcastCapacity: 4,
      ...(zoneId ? { zoneId } : {}),
    })
    .returning({ id: screenhosts.id });
  const id = sh?.id ?? '';
  const rows = [];
  for (let dow = 1; dow <= 7; dow += 1)
    for (let h = 8; h < 23; h += 1)
      rows.push({ screenhostId: id, dayOfWeek: dow, hour: h, estimatedImpressions: 100 });
  await db.insert(screenhostAffluence).values(bothHalves(rows));
  return { id, ownerId };
};

const KICKOFF = new Date('2027-06-10T20:00:00+01:00');
const ENDS = new Date('2027-06-10T22:00:00+01:00');
const EVENT_REF = (id: string) => ({ id, kickoffAt: KICKOFF, endsAt: ENDS });

const seedEvent = async (): Promise<string> => {
  seq += 1;
  const [row] = await db
    .insert(events)
    .values({ name: `CPM1 Match ${seq}`, kickoffAt: KICKOFF, endsAt: ENDS })
    .returning({ id: events.id });
  return row?.id ?? '';
};

const buildApp = () => Fastify({ logger: false });

describe('CPM-1 — a positioning keeps its event CPM (real Postgres)', () => {
  let app: ReturnType<typeof buildApp>;
  let pinned: CpmConfigSnapshot;

  beforeEach(async () => {
    await resetAuthTables();
    pinned = await pinCpmConfig('15.000', '15.000');
    app = buildApp();
    await app.register(eventsRoutes);
    await app.register(campaignsRoutes);
    await app.register(cartRoutes);
    await app.register(adminCampaignsRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
    await restoreCpmConfig(pinned);
  });

  afterAll(async () => {
    await sql.end();
  });

  /** A positioning created THROUGH THE ROUTE (event CPM 15 now), funded, spot approved. */
  const positionner = async (eventId: string, budget: string) => {
    const advertiserId = await seedUser();
    await db.insert(recharges).values({
      advertiserId,
      amountTnd: '5000.00',
      status: 'confirmed',
      reference: `CPM1-${tag()}`,
    });
    const [creative] = await db
      .insert(creatives)
      .values({
        advertiserId,
        creativeType: 'video',
        storageKey: `creatives/cpm1/${tag()}`,
        durationSeconds: 10,
        validationStatus: 'approved',
        fileHash: `cpm1-${tag()}`,
      })
      .returning({ id: creatives.id });
    mockSession(advertiserId, 'advertiser');
    const res = await app.inject({ method: 'POST', url: `/api/events/${eventId}/positionner` });
    expect(res.statusCode).toBe(201);
    const campaignId = (res.json() as { id: string }).id;
    await db
      .update(campaigns)
      .set({ requestedBudget: budget, creativeId: creative?.id })
      .where(eq(campaigns.id, campaignId));
    return { campaignId, advertiserId };
  };

  const prepare = async (campaignId: string) => {
    const [full] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId)).limit(1);
    if (!full) throw new Error('no positioning');
    return prepareActivation({
      campaign: full,
      contentValidationStatus: 'approved',
      creativeDurationSeconds: 10,
      fromStatus: 'draft',
    });
  };

  const allocationsOf = (campaignId: string) =>
    db.select().from(eventAllocations).where(eq(eventAllocations.campaignId, campaignId));

  it('validating an existing positioning dispatches its blocs at its own CPM', async () => {
    await seedVenue('80');
    const eventId = await seedEvent();
    const { campaignId } = await positionner(eventId, '150.00');
    await setCpmConfig('15.000', '30.000');

    expect((await prepare(campaignId)).status).toBe('READY');
    const [placed] = await allocationsOf(campaignId);
    // At 15: I_cible = 10 000 → 5 whole blocs. At 30 it would have been 5 000 → 3 blocs (6 000).
    expect(placed?.impressionsTotal).toBe(10_000);
    expect(Number(placed?.montantTnd)).toBe(150);
  });

  it('its ceilings — cursor, submit, cart, « Hosts éligibles » — price at its own CPM', async () => {
    await seedVenue('80');
    const eventId = await seedEvent();
    const { campaignId, advertiserId } = await positionner(eventId, '100.00');
    await setCpmConfig('15.000', '30.000');
    const at15 = await computeEventCmax(EVENT_REF(eventId), 15);
    const at30 = await computeEventCmax(EVENT_REF(eventId), 30);
    expect(at15.cMaxEvtTnd).toBe(180); // 6 blocs × 2 000 × 15 / 1000
    expect(at30.cMaxEvtTnd).toBe(360);

    mockSession(advertiserId, 'advertiser');
    const cursor = await app.inject({ method: 'GET', url: `/api/campaigns/${campaignId}/cmax` });
    expect((cursor.json() as { c_max_tnd: number }).c_max_tnd).toBe(180);

    // A budget the NEW CPM would allow but the positioning's own does not.
    await db
      .update(campaigns)
      .set({ requestedBudget: '181.00' })
      .where(eq(campaigns.id, campaignId));
    const cart = await app.inject({
      method: 'POST',
      url: '/api/cart/items',
      payload: { campaign_id: campaignId },
    });
    expect(cart.statusCode).toBe(400);
    expect((cart.json() as { error: string }).error).toBe('BUDGET_EXCEEDS_CMAX');
    const submit = await app.inject({ method: 'POST', url: `/api/campaigns/${campaignId}/submit` });
    expect(submit.statusCode).toBe(400);
    expect((submit.json() as { c_max_tnd: number }).c_max_tnd).toBe(180);

    const adminId = await seedUser({ role: 'admin' });
    mockSession(adminId, 'admin');
    const hosts = await app.inject({
      method: 'GET',
      url: `/api/admin/campaigns/${campaignId}/eligible-hosts`,
    });
    const report = hosts.json() as { cpm_tnd: number; totals: { c_max_tnd: number } };
    expect(report.cpm_tnd).toBe(15);
    expect(report.totals.c_max_tnd).toBe(180);
  });

  it('an owner refusal re-places the refused VALUE at the positioning’s CPM (== its montant)', async () => {
    const v1 = await seedVenue('90'); // fills first
    const v2 = await seedVenue('40');
    const eventId = await seedEvent();
    const { campaignId } = await positionner(eventId, '150.00');
    expect((await prepare(campaignId)).status).toBe('READY');
    const [refusedRow] = await allocationsOf(campaignId);
    expect(refusedRow?.screenhostId).toBe(v1.id);
    expect(Number(refusedRow?.montantTnd)).toBe(150);

    await setCpmConfig('15.000', '30.000');
    const outcome = await decideEventAllocation({
      allocationId: refusedRow?.id ?? '',
      ownerId: v1.ownerId,
      statut: 'REFUSE',
    });
    expect(outcome.kind).toBe('ok');

    const replaced = (await allocationsOf(campaignId)).find((a) => a.screenhostId === v2.id);
    // At 30 the cascade re-placed 10 000 × 30 / 1000 = 300 TND of a 150 TND share.
    expect(Number(replaced?.montantTnd)).toBe(Number(refusedRow?.montantTnd));
    expect(replaced?.impressionsTotal).toBe(10_000);
  });

  it('the event booster prices its ceiling and its fill at the positioning’s CPM', async () => {
    const baseZone = await seedZone();
    const newZone = await seedZone();
    const held = await seedVenue('90', baseZone);
    const target = await seedVenue('70', newZone);
    const eventId = await seedEvent();
    const { campaignId, advertiserId } = await positionner(eventId, '180.00');
    const grid = fenetreDiffusion(KICKOFF, ENDS);
    await db.insert(campaignZones).values({ campaignId, zoneId: baseZone });
    await db.insert(eventAllocations).values({
      campaignId,
      screenhostId: held.id,
      blocs: grid.blocs.map((b) => ({
        start: b.start.toISOString(),
        end: b.end.toISOString(),
        impressions: 2000,
      })),
      impressionsTotal: 12_000,
      montantTnd: '180.000',
      statut: 'ACCEPTE',
      decidedAt: new Date(),
    });
    await db.update(campaigns).set({ status: 'upcoming' }).where(eq(campaigns.id, campaignId));
    await setCpmConfig('15.000', '30.000');

    const full15 = await computeEventCmax(EVENT_REF(eventId), 15);
    const preview = await previewEventBoost(campaignId, advertiserId, [newZone]);
    expect(preview.status).toBe('PREVIEW');
    if (preview.status !== 'PREVIEW') return;
    expect(preview.cMaxEvtTnd).toBe(full15.cMaxEvtTnd - 180); // 360 − 180, not 720 − 180

    const applied = await applyEventBoost(campaignId, advertiserId, {
      addedZoneIds: [newZone],
      amountTnd: 150,
    });
    expect(applied.status).toBe('APPLIED');
    if (applied.status !== 'APPLIED') return;
    // At 15: 150 TND → 10 000 impressions (5 blocs). At 30 it would have been 6 000 (3 blocs).
    expect(applied.placedImpressions).toBe(10_000);
    const fresh = (await allocationsOf(campaignId)).find((a) => a.screenhostId === target.id);
    expect(Number(fresh?.montantTnd)).toBe(150);
  });
});
