import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import {
  type DispatchCreneau,
  type NewUser,
  campaignDispatchAllocation,
  campaignDispatchPlan,
  campaigns,
  creatives,
  proofOfPlay,
  screenhosts,
  screens,
  users,
} from '../src/db/schema.js';
import { reconcileCampaignById } from '../src/lib/reconcile/reconcile-service.js';
import { adminReconcileRoutes } from '../src/routes/admin-reconcile.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// E7 commit 2 — GET /api/admin/campaigns/:id/reversements: the per-SH split breakdown + exact
// totals for the admin settlement surface. Real Postgres; the writer is the E7 settlement.

type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;

const buildApp = () => Fastify({ logger: false });
const mockSession = (userId: string, role = 'admin', status = 'approved'): void => {
  vi.spyOn(auth.api, 'getSession').mockResolvedValue({
    session: {},
    user: { id: userId, role, status },
  } as unknown as GetSessionResult);
};

let seq = 0;
const seedUser = async (values: Partial<NewUser> = {}): Promise<string> => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `rev${seq}@example.com`,
      contactName: `User ${seq}`,
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

const CRENEAUX: DispatchCreneau[] = [
  { date: '2024-01-01', hour: 8, reps: 100, impressions: 10000 },
  { date: '2024-01-02', hour: 8, reps: 100, impressions: 10000 },
];

interface Scenario {
  admin: string;
  campaignId: string;
  screenhostId: string;
}

const seedSettledScenario = async (): Promise<Scenario> => {
  const admin = await seedUser({ role: 'admin' });
  const advertiser = await seedUser({ role: 'advertiser' });
  const owner = await seedUser({ role: 'individual_owner' });
  const [sh] = await db
    .insert(screenhosts)
    .values({ name: 'Café Reversement', ownerId: owner })
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
      storageKey: `creatives/${advertiser}/c`,
      durationSeconds: 20,
      validationStatus: 'approved',
    })
    .returning();
  const [campaign] = await db
    .insert(campaigns)
    .values({
      advertiserId: advertiser,
      name: 'E7 Rev Surface',
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
      iCible: 20000,
      cpm: '10',
      sSpotSeconds: 10,
      tTierCoef: '1.0',
      seuilDiffusable: 1000,
      sMin: '10',
      gJour: '3.33',
      fMaxSeconds: 300,
      rMinEfficace: 2,
      couvert: 20000,
      nMin: 1,
      nMax: 20,
      nRetenus: 1,
    })
    .returning();
  await db.insert(campaignDispatchAllocation).values({
    planId: plan?.id ?? '',
    screenhostId: sh?.id ?? '',
    iiPotentiel: 20000,
    rI: 100,
    revenuPrevisionnel: '200',
    creneaux: CRENEAUX,
  });
  // Deliver both créneaux, then settle.
  await db.insert(proofOfPlay).values(
    CRENEAUX.map((c) => ({
      screenId: screen?.id ?? '',
      screenhostId: sh?.id ?? '',
      campaignId: campaign?.id ?? '',
      creativeId: creative?.id ?? '',
      videoIdAsSent: campaign?.id ?? '',
      eventType: 'VIDEO_ENDED' as const,
      receivedAt: new Date(`${c.date}T${String(c.hour - 1).padStart(2, '0')}:30:00Z`),
    })),
  );
  const result = await reconcileCampaignById(campaign?.id ?? '', admin);
  if (result.status !== 'OK') throw new Error(`settle failed: ${result.status}`);
  return { admin, campaignId: campaign?.id ?? '', screenhostId: sh?.id ?? '' };
};

describe('GET /api/admin/campaigns/:id/reversements (real Postgres)', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    await resetAuthTables();
    app = buildApp();
    await app.register(adminReconcileRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await sql.end();
  });

  const get = (id: string) =>
    app.inject({ method: 'GET', url: `/api/admin/campaigns/${id}/reversements` });

  it('returns the per-SH breakdown with the venue name and EXACT totals', async () => {
    const s = await seedSettledScenario();
    mockSession(s.admin);
    const res = await get(s.campaignId);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.campaign_id).toBe(s.campaignId);
    expect(body.lines).toHaveLength(1);
    expect(body.lines[0]).toMatchObject({
      screenhost_id: s.screenhostId,
      screenhost_name: 'Café Reversement',
      source: 'campaign',
      base_value_tnd: 200,
      sh_amount_tnd: 100,
      toodooh_amount_tnd: 88,
      agent_sh_amount_tnd: 6,
      agent_sc_amount_tnd: 6,
      agent_sh_id: null,
      agent_sc_id: null,
    });
    expect(typeof body.lines[0].settled_at).toBe('string');
    expect(body.totals).toEqual({
      base_value_tnd: 200,
      sh_amount_tnd: 100,
      toodooh_amount_tnd: 88,
      agent_sh_amount_tnd: 6,
      agent_sc_amount_tnd: 6,
    });
  });

  it('returns empty lines + zero totals for an unsettled campaign', async () => {
    const admin = await seedUser({ role: 'admin' });
    const advertiser = await seedUser({ role: 'advertiser' });
    const [campaign] = await db
      .insert(campaigns)
      .values({
        advertiserId: advertiser,
        name: 'Unsettled',
        campaignType: 'standard',
        status: 'active',
      })
      .returning();
    mockSession(admin);
    const res = await get(campaign?.id ?? '');
    expect(res.statusCode).toBe(200);
    expect(res.json().lines).toEqual([]);
    expect(res.json().totals.base_value_tnd).toBe(0);
  });

  it('404s an unknown campaign and 403s a non-admin', async () => {
    const s = await seedSettledScenario();
    mockSession(s.admin);
    expect((await get('00000000-0000-0000-0000-000000000000')).statusCode).toBe(404);

    const owner = await seedUser({ role: 'individual_owner' });
    mockSession(owner, 'individual_owner');
    expect((await get(s.campaignId)).statusCode).toBe(403);
  });
});
