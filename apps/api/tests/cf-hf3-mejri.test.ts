import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import {
  type NewUser,
  businessSectors,
  campaignDispatchAllocation,
  campaignDispatchPlan,
  campaignTargeting,
  campaigns,
  creatives,
  eventAllocations,
  events,
  recharges,
  screenhostAffluence,
  screenhosts,
  users,
} from '../src/db/schema.js';
import { adminCampaignsRoutes } from '../src/routes/admin-campaigns.js';
import { adminCreativesRoutes } from '../src/routes/admin-creatives.js';
import { campaignsRoutes } from '../src/routes/campaigns.js';

import { resetAuthTables, bothHalves } from './helpers/db-test-setup.js';
import { seedInstalledScreen } from './helpers/installed-screen.js';

// CF-HF3 (Mejri retest batch 3) — the api half:
//  (4) an APPROVED IMAGE creative activates end-to-end (the gate is type-agnostic — PINNED; the
//      old English "(or no creative is linked)" conflation is split into two French messages);
//  (5) the admin creative presign access matrix (admin CAN; a non-admin gets the FRENCH 403 —
//      the reported « Administrator access required. » string is GONE) + the role-resolution
//      hardening (a session user WITHOUT the role field resolves from the users row instead of
//      silently degrading a genuine admin to advertiser);
//  (3) « Impressions prévues » — /mine exposes planned_impressions (IMP-UNIT1: the frozen plan's
//      PHYSICAL impressions, Σ créneau.impressions over its non-REFUSE allocations — NOT the
//      facturable Σ ii_potentiel it used to send; null when no plan).
// Real Postgres; the admin-campaigns.test.ts covering fixture (Ai=100, Hi=20 → i_cible 20000).

type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;

const buildApp = () => Fastify({ logger: false });

const mockSession = (userId: string, role = 'admin', status = 'approved'): void => {
  vi.spyOn(auth.api, 'getSession').mockResolvedValue({
    session: {},
    user: { id: userId, role, status },
  } as unknown as GetSessionResult);
};

// The hardening case: a session whose serialized user carries NO role/status additionalFields.
const mockRolelessSession = (userId: string): void => {
  vi.spyOn(auth.api, 'getSession').mockResolvedValue({
    session: {},
    user: { id: userId },
  } as unknown as GetSessionResult);
};

let seq = 0;
const seedUser = async (values: Partial<NewUser> = {}): Promise<string> => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `hf3-${seq}@example.com`,
      contactName: `User ${seq}`,
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

const seedPhotoCreative = async (
  advertiserId: string,
  validationStatus: 'pending' | 'approved' | 'rejected' = 'approved',
): Promise<string> => {
  const [c] = await db
    .insert(creatives)
    .values({
      advertiserId,
      creativeType: 'photo',
      storageKey: `creatives/${advertiserId}/photo`,
      durationSeconds: 20, // the photo's chosen diffusion slot (10/20/30)
      validationStatus,
    })
    .returning();
  return c?.id ?? '';
};

// An activatable IMAGE campaign: funded advertiser + approved PHOTO + targeting + covering venue.
const seedImageActivatable = async (): Promise<{
  admin: string;
  advertiser: string;
  campaignId: string;
  creativeId: string;
}> => {
  const admin = await seedUser({ role: 'admin' });
  const advertiser = await seedUser({ role: 'advertiser' });
  const owner = await seedUser({ role: 'individual_owner' });
  const cat = await ownerSectorId();
  const creativeId = await seedPhotoCreative(advertiser);
  const [c] = await db
    .insert(campaigns)
    .values({
      advertiserId: advertiser,
      name: 'Campagne Image',
      campaignType: 'standard',
      status: 'pending',
      startDate: '2024-01-01',
      endDate: '2024-01-02',
      creativeId,
      requestedBudget: '300',
    })
    .returning();
  const campaignId = c?.id ?? '';
  await db.insert(campaignTargeting).values({ campaignId, categoryId: cat, class: 'premium' });
  const [sh] = await db
    .insert(screenhosts)
    .values({
      name: 'Venue Image',
      ownerId: owner,
      businessSectorId: cat,
      class: 'premium',
      openingHour: 8,
      closingHour: 18,
      broadcastCapacity: 4,
    })
    .returning();
  const rows = [];
  for (const dow of [1, 2])
    for (let h = 8; h < 18; h += 1)
      rows.push({ screenhostId: sh?.id ?? '', dayOfWeek: dow, hour: h, estimatedImpressions: 100 });
  await db.insert(screenhostAffluence).values(bothHalves(rows));
  await seedInstalledScreen(sh?.id ?? '');
  seq += 1;
  await db.insert(recharges).values({
    advertiserId: advertiser,
    amountTnd: '300',
    status: 'confirmed',
    reference: `HF3-${seq}-${advertiser.slice(0, 8)}`,
  });
  return { admin, advertiser, campaignId, creativeId };
};

describe('CF-HF3 (real Postgres)', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    await resetAuthTables();
    app = buildApp();
    await app.register(adminCampaignsRoutes);
    await app.register(adminCreativesRoutes);
    await app.register(campaignsRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await sql.end();
  });

  const activate = (id: string) =>
    app.inject({ method: 'POST', url: `/api/admin/campaigns/${id}/activate` });

  // ── (4) images are first-class at the gate ─────────────────────────────────
  it('an APPROVED IMAGE campaign validates end-to-end: activate → 200, dispatched, active', async () => {
    const s = await seedImageActivatable();
    mockSession(s.admin);
    const res = await activate(s.campaignId);
    expect(res.statusCode).toBe(200);
    const body = res.json() as { campaign: { status: string }; plan: { s: number } };
    expect(body.campaign.status).toBe('active'); // past start date → date-routed active
    // The spot length is the photo's diffusion slot — the engine never cared about the type.
    expect(body.plan.s).toBe(20);
    const [row] = await db
      .select({ status: campaigns.status })
      .from(campaigns)
      .where(eq(campaigns.id, s.campaignId));
    expect(row?.status).toBe('active');
  });

  it('a campaign with NO creative gets the precise French message (the conflated English one is gone)', async () => {
    const admin = await seedUser({ role: 'admin' });
    const advertiser = await seedUser({ role: 'advertiser' });
    const [c] = await db
      .insert(campaigns)
      .values({
        advertiserId: advertiser,
        name: 'Sans spot',
        campaignType: 'standard',
        status: 'pending',
        startDate: '2024-01-01',
        endDate: '2024-01-02',
        requestedBudget: '300',
      })
      .returning();
    mockSession(admin);
    const res = await activate(c?.id ?? '');
    expect(res.statusCode).toBe(422);
    const body = res.json() as { reason: string; message: string };
    expect(body.reason).toBe('content_not_approved');
    expect(body.message).toBe("Aucun spot n'est associé à cette campagne.");
    expect(body.message).not.toContain('creative');
  });

  it('a campaign whose creative awaits moderation gets ITS French message (distinct from no-creative)', async () => {
    const admin = await seedUser({ role: 'admin' });
    const advertiser = await seedUser({ role: 'advertiser' });
    const creativeId = await seedPhotoCreative(advertiser, 'pending');
    const [c] = await db
      .insert(campaigns)
      .values({
        advertiserId: advertiser,
        name: 'Spot en attente',
        campaignType: 'standard',
        status: 'pending',
        startDate: '2024-01-01',
        endDate: '2024-01-02',
        creativeId,
        requestedBudget: '300',
      })
      .returning();
    mockSession(admin);
    const res = await activate(c?.id ?? '');
    expect(res.statusCode).toBe(422);
    expect((res.json() as { message: string }).message).toBe(
      "Le spot lié n'est pas encore approuvé par la modération.",
    );
  });

  // ── (5) the admin creative view access matrix ──────────────────────────────
  it('admin CAN presign a creative for review; a non-admin gets the FRENCH 403 (the reported English string is gone)', async () => {
    const admin = await seedUser({ role: 'admin' });
    const advertiser = await seedUser({ role: 'advertiser' });
    const creativeId = await seedPhotoCreative(advertiser);

    mockSession(admin);
    const ok = await app.inject({ method: 'GET', url: `/api/admin/creatives/${creativeId}/url` });
    expect(ok.statusCode).toBe(200);
    expect((ok.json() as { url: string }).url).toContain('http');

    mockSession(advertiser, 'advertiser');
    const forbidden = await app.inject({
      method: 'GET',
      url: `/api/admin/creatives/${creativeId}/url`,
    });
    expect(forbidden.statusCode).toBe(403);
    const body = forbidden.json() as { message: string };
    expect(body.message).toBe('Accès administrateur requis.');
    // Mejri's exact reported string must be dead.
    expect(forbidden.body.toLowerCase()).not.toContain('administrator access required');
  });

  it('role-resolution hardening: a role-less SESSION for a genuine admin resolves from the users row (200, never a spurious 403)', async () => {
    const admin = await seedUser({ role: 'admin' });
    const advertiser = await seedUser({ role: 'advertiser' });
    const creativeId = await seedPhotoCreative(advertiser);

    mockRolelessSession(admin);
    const ok = await app.inject({ method: 'GET', url: `/api/admin/creatives/${creativeId}/url` });
    expect(ok.statusCode).toBe(200);

    // A role-less session for a NON-admin still 403s (French) — the hardening opens no hole.
    mockRolelessSession(advertiser);
    const forbidden = await app.inject({
      method: 'GET',
      url: `/api/admin/creatives/${creativeId}/url`,
    });
    expect(forbidden.statusCode).toBe(403);
    expect((forbidden.json() as { message: string }).message).toBe('Accès administrateur requis.');
  });

  // ── (3) « Impressions prévues » on the advertiser wire ─────────────────────
  it('/mine exposes planned_impressions: null without a plan, Σ créneaux once frozen', async () => {
    const advertiser = await seedUser({ role: 'advertiser' });
    const owner = await seedUser({ role: 'individual_owner' });
    const [sh] = await db
      .insert(screenhosts)
      .values({ name: 'Venue P', ownerId: owner })
      .returning();
    const [sh2] = await db
      .insert(screenhosts)
      .values({ name: 'Venue Q', ownerId: owner })
      .returning();
    await db.insert(campaigns).values({
      advertiserId: advertiser,
      name: 'Sans plan',
      campaignType: 'standard',
      status: 'pending',
      startDate: '2026-08-01',
      endDate: '2026-08-05',
      requestedBudget: '300',
    });
    const [withPlan] = await db
      .insert(campaigns)
      .values({
        advertiserId: advertiser,
        name: 'Avec plan',
        campaignType: 'standard',
        status: 'active',
        startDate: '2026-08-01',
        endDate: '2026-08-05',
        requestedBudget: '300',
      })
      .returning();
    const [plan] = await db
      .insert(campaignDispatchPlan)
      .values({
        campaignId: withPlan?.id ?? '',
        iCible: 20000,
        cpm: '15',
        sSpotSeconds: 20,
        tTierCoef: '0.7',
        seuilDiffusable: 1000,
        sMin: '20',
        gJour: '3.33',
        fMaxSeconds: 300,
        rMinEfficace: 2,
        couvert: 20000,
        nMin: 1,
        nMax: 20,
        nRetenus: 1,
      })
      .returning();
    // IMP-UNIT1 — the two units are DELIBERATELY different here (ii_potentiel = physical × T,
    // T = 0.60): the wire must carry the 20 000 PHYSICAL, never the 12 000 facturable.
    await db.insert(campaignDispatchAllocation).values([
      {
        planId: plan?.id ?? '',
        screenhostId: sh?.id ?? '',
        iiPotentiel: 7200,
        rI: 10,
        revenuPrevisionnel: '108',
        creneaux: [{ date: '2026-08-01', hour: 9, reps: 10, impressions: 12000 }],
      },
      {
        planId: plan?.id ?? '',
        screenhostId: sh2?.id ?? '',
        iiPotentiel: 4800,
        rI: 10,
        revenuPrevisionnel: '72',
        creneaux: [{ date: '2026-08-02', hour: 9, reps: 10, impressions: 8000 }],
      },
    ]);

    mockSession(advertiser, 'advertiser');
    const res = await app.inject({ method: 'GET', url: '/api/campaigns/mine' });
    expect(res.statusCode).toBe(200);
    const rows = res.json() as { name: string; planned_impressions: number | null }[];
    expect(rows.find((r) => r.name === 'Sans plan')?.planned_impressions).toBeNull();
    expect(rows.find((r) => r.name === 'Avec plan')?.planned_impressions).toBe(20000);
    // The retired figure (Σ ii_potentiel) would have been 12 000.
    expect(rows.find((r) => r.name === 'Avec plan')?.planned_impressions).not.toBe(12000);
  });

  // ADV-DSH1 (Mejri/Kais QA) — an event positioning has NO dispatch plan; its placed impressions
  // live in event_allocations. /mine must expose them as planned_impressions (the dashboard's
  // « Impressions prévues » reads that field and counted 0 for the +38 400 positioning).
  // IMP-UNIT1 — impressions_total is already PHYSICAL; only a REFUSE row leaves the sum.
  it("ADV-DSH1: /mine exposes an event positioning's Σ event_allocations.impressions_total", async () => {
    const advertiser = await seedUser({ role: 'advertiser' });
    const owner = await seedUser({ role: 'individual_owner' });
    const [sh] = await db
      .insert(screenhosts)
      .values({ name: 'Venue E1', ownerId: owner })
      .returning();
    const [sh2] = await db
      .insert(screenhosts)
      .values({ name: 'Venue E2', ownerId: owner })
      .returning();
    const [event] = await db
      .insert(events)
      .values({
        name: 'Derby',
        kickoffAt: new Date('2026-10-01T18:00:00Z'),
        endsAt: new Date('2026-10-01T20:00:00Z'),
      })
      .returning();
    const [positioning] = await db
      .insert(campaigns)
      .values({
        advertiserId: advertiser,
        name: 'Positionnement',
        campaignType: 'event',
        status: 'active',
        eventId: event?.id ?? null,
        startDate: '2026-10-01',
        endDate: '2026-10-01',
        requestedBudget: '500',
      })
      .returning();
    await db.insert(eventAllocations).values([
      {
        campaignId: positioning?.id ?? '',
        screenhostId: sh?.id ?? '',
        blocs: [{ start: '2026-10-01T18:00:00Z', end: '2026-10-01T18:30:00Z', impressions: 30000 }],
        impressionsTotal: 30000,
        montantTnd: '300.000',
        statut: 'ACCEPTE',
      },
      {
        campaignId: positioning?.id ?? '',
        screenhostId: sh2?.id ?? '',
        blocs: [{ start: '2026-10-01T18:00:00Z', end: '2026-10-01T18:30:00Z', impressions: 8400 }],
        impressionsTotal: 8400,
        montantTnd: '84.000',
        statut: 'EN_ATTENTE',
      },
    ]);

    mockSession(advertiser, 'advertiser');
    const res = await app.inject({ method: 'GET', url: '/api/campaigns/mine' });
    expect(res.statusCode).toBe(200);
    const rows = res.json() as { name: string; planned_impressions: number | null }[];
    // 30 000 + 8 400 = the same Σ GET /:id/event-allocations reports as impressions_total.
    expect(rows.find((r) => r.name === 'Positionnement')?.planned_impressions).toBe(38400);
  });
});
