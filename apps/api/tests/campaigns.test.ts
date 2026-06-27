import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import { type NewUser, campaigns, creatives, users } from '../src/db/schema.js';
import { campaignsRoutes } from '../src/routes/campaigns.js';
import { apiRoutes } from '../src/routes/index.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// Integration suite — real Postgres (DATABASE_URL). auth.api.getSession is mocked so we drive the
// session identity (id/role/status) directly; resetAuthTables TRUNCATE ... CASCADE wipes campaigns
// via the advertiser_id FK between tests. Every assertion targets the advertiser draft lifecycle:
// owner-scoping (a foreign id is a 404, never a leak) and the draft→pending status guard.
type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;

const buildApp = () => Fastify({ logger: false });

const mockSession = (userId: string, role = 'advertiser', status = 'approved'): void => {
  vi.spyOn(auth.api, 'getSession').mockResolvedValue({
    session: {},
    user: { id: userId, role, status },
  } as unknown as GetSessionResult);
};

const mockNoSession = (): void => {
  vi.spyOn(auth.api, 'getSession').mockResolvedValue(null as unknown as GetSessionResult);
};

let seq = 0;
const seedUser = async (values: Partial<NewUser> = {}): Promise<string> => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `camp${seq}@example.com`,
      contactName: `User ${seq}`,
      role: 'advertiser',
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

const seedCampaign = async (
  advertiserId: string,
  opts: {
    name?: string;
    type?: string;
    status?: 'draft' | 'pending' | 'active' | 'rejected';
  } = {},
): Promise<string> => {
  const [c] = await db
    .insert(campaigns)
    .values({
      advertiserId,
      name: opts.name ?? 'Campaign Test',
      campaignType: opts.type ?? 'standard',
      status: opts.status ?? 'draft',
    })
    .returning();
  return c?.id ?? '';
};

const readCampaign = async (id: string): Promise<typeof campaigns.$inferSelect | undefined> => {
  const [c] = await db.select().from(campaigns).where(eq(campaigns.id, id)).limit(1);
  return c;
};

const seedCreative = async (
  advertiserId: string,
  status: 'pending' | 'approved' | 'rejected' = 'pending',
): Promise<string> => {
  seq += 1;
  const [c] = await db
    .insert(creatives)
    .values({
      advertiserId,
      creativeType: 'video',
      storageKey: `creatives/${advertiserId}/seed${seq}`,
      durationSeconds: 20,
      validationStatus: status,
    })
    .returning();
  return c?.id ?? '';
};

describe('campaigns draft lifecycle (advertiser, real Postgres)', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    await resetAuthTables();
    app = buildApp();
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

  // ── POST /api/campaigns ──────────────────────────────────────────────────────
  it('creates a draft owned by the advertiser (201, status=draft, dates persisted)', async () => {
    const me = await seedUser();
    mockSession(me);
    const res = await app.inject({
      method: 'POST',
      url: '/api/campaigns',
      payload: {
        name: 'Ramadan Promo',
        campaign_type: 'standard',
        start_date: '2026-07-01',
        end_date: '2026-07-31',
        description: 'A test campaign',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as Record<string, unknown>;
    expect(body).toMatchObject({
      name: 'Ramadan Promo',
      campaign_type: 'standard',
      status: 'draft',
      start_date: '2026-07-01',
      end_date: '2026-07-31',
      description: 'A test campaign',
    });
    expect(body['id']).toBeDefined();

    const row = await readCampaign(body['id'] as string);
    expect(row?.advertiserId).toBe(me);
    expect(row?.status).toBe('draft');
    expect(row?.submittedAt).toBeNull();
  });

  it('creates a draft with only the required fields (dates/description default to null)', async () => {
    const me = await seedUser();
    mockSession(me);
    const res = await app.inject({
      method: 'POST',
      url: '/api/campaigns',
      payload: { name: 'Minimal', campaign_type: 'event' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      name: 'Minimal',
      campaign_type: 'event',
      status: 'draft',
      start_date: null,
      end_date: null,
      description: null,
    });
  });

  it('rejects a create missing a required field (400)', async () => {
    const me = await seedUser();
    mockSession(me);
    const res = await app.inject({
      method: 'POST',
      url: '/api/campaigns',
      payload: { name: 'No type given' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('requires authentication to create (401)', async () => {
    mockNoSession();
    const res = await app.inject({
      method: 'POST',
      url: '/api/campaigns',
      payload: { name: 'X', campaign_type: 'y' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('forbids a non-advertiser from creating (403)', async () => {
    const owner = await seedUser({ role: 'individual_owner' });
    mockSession(owner, 'individual_owner', 'approved');
    const res = await app.inject({
      method: 'POST',
      url: '/api/campaigns',
      payload: { name: 'X', campaign_type: 'y' },
    });
    expect(res.statusCode).toBe(403);
  });

  // ── GET /api/campaigns/mine ──────────────────────────────────────────────────
  it('lists only the caller’s own campaigns', async () => {
    const me = await seedUser();
    const other = await seedUser();
    await seedCampaign(me, { name: 'Mine 1' });
    await seedCampaign(me, { name: 'Mine 2' });
    await seedCampaign(other, { name: 'Theirs' });
    mockSession(me);

    const res = await app.inject({ method: 'GET', url: '/api/campaigns/mine' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ name: string }>;
    expect(body).toHaveLength(2);
    expect(body.map((r) => r.name).sort()).toEqual(['Mine 1', 'Mine 2']);
  });

  it('forbids a non-advertiser from listing (403)', async () => {
    const owner = await seedUser({ role: 'fleet_owner' });
    mockSession(owner, 'fleet_owner', 'approved');
    const res = await app.inject({ method: 'GET', url: '/api/campaigns/mine' });
    expect(res.statusCode).toBe(403);
  });

  // ── GET /api/campaigns/:id ───────────────────────────────────────────────────
  it('returns the caller’s own campaign (200)', async () => {
    const me = await seedUser();
    const id = await seedCampaign(me, { name: 'Readable' });
    mockSession(me);
    const res = await app.inject({ method: 'GET', url: `/api/campaigns/${id}` });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { name: string }).name).toBe('Readable');
  });

  it('returns 404 reading another advertiser’s campaign (owner-scope)', async () => {
    const me = await seedUser();
    const other = await seedUser();
    const foreign = await seedCampaign(other);
    mockSession(me);
    const res = await app.inject({ method: 'GET', url: `/api/campaigns/${foreign}` });
    expect(res.statusCode).toBe(404);
  });

  it('rejects a non-uuid id (400)', async () => {
    const me = await seedUser();
    mockSession(me);
    const res = await app.inject({ method: 'GET', url: '/api/campaigns/not-a-uuid' });
    expect(res.statusCode).toBe(400);
  });

  // ── PATCH /api/campaigns/:id ─────────────────────────────────────────────────
  it('edits a draft the caller owns (200)', async () => {
    const me = await seedUser();
    const id = await seedCampaign(me, { name: 'Before' });
    mockSession(me);
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/campaigns/${id}`,
      payload: { name: 'After', description: 'updated' },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { name: string }).name).toBe('After');
    const row = await readCampaign(id);
    expect(row?.name).toBe('After');
    expect(row?.description).toBe('updated');
  });

  it('returns 404 patching another advertiser’s campaign (owner-scope, untouched)', async () => {
    const me = await seedUser();
    const other = await seedUser();
    const foreign = await seedCampaign(other, { name: 'Theirs' });
    mockSession(me);
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/campaigns/${foreign}`,
      payload: { name: 'hijack' },
    });
    expect(res.statusCode).toBe(404);
    expect((await readCampaign(foreign))?.name).toBe('Theirs');
  });

  it('blocks editing once submitted (409)', async () => {
    const me = await seedUser();
    const id = await seedCampaign(me, { status: 'pending' });
    mockSession(me);
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/campaigns/${id}`,
      payload: { name: 'too late' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('rejects an empty patch body (400)', async () => {
    const me = await seedUser();
    const id = await seedCampaign(me);
    mockSession(me);
    const res = await app.inject({ method: 'PATCH', url: `/api/campaigns/${id}`, payload: {} });
    expect(res.statusCode).toBe(400);
  });

  // ── POST /api/campaigns/:id/submit ───────────────────────────────────────────
  it('submits a draft → pending and stamps submitted_at (200)', async () => {
    const me = await seedUser();
    const id = await seedCampaign(me, { status: 'draft' });
    mockSession(me);
    const res = await app.inject({ method: 'POST', url: `/api/campaigns/${id}/submit` });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { status: string }).status).toBe('pending');
    const row = await readCampaign(id);
    expect(row?.status).toBe('pending');
    expect(row?.submittedAt).not.toBeNull();
  });

  it('returns 409 submitting a non-draft', async () => {
    const me = await seedUser();
    const id = await seedCampaign(me, { status: 'pending' });
    mockSession(me);
    const res = await app.inject({ method: 'POST', url: `/api/campaigns/${id}/submit` });
    expect(res.statusCode).toBe(409);
  });

  it('returns 404 submitting another advertiser’s campaign (owner-scope)', async () => {
    const me = await seedUser();
    const other = await seedUser();
    const foreign = await seedCampaign(other);
    mockSession(me);
    const res = await app.inject({ method: 'POST', url: `/api/campaigns/${foreign}/submit` });
    expect(res.statusCode).toBe(404);
  });

  // ── DELETE /api/campaigns/:id ────────────────────────────────────────────────
  it('deletes a draft the caller owns (204)', async () => {
    const me = await seedUser();
    const id = await seedCampaign(me);
    mockSession(me);
    const res = await app.inject({ method: 'DELETE', url: `/api/campaigns/${id}` });
    expect(res.statusCode).toBe(204);
    expect(await readCampaign(id)).toBeUndefined();
  });

  it('returns 409 deleting a non-draft (kept)', async () => {
    const me = await seedUser();
    const id = await seedCampaign(me, { status: 'pending' });
    mockSession(me);
    const res = await app.inject({ method: 'DELETE', url: `/api/campaigns/${id}` });
    expect(res.statusCode).toBe(409);
    expect(await readCampaign(id)).toBeDefined();
  });

  it('returns 404 deleting another advertiser’s campaign (owner-scope, kept)', async () => {
    const me = await seedUser();
    const other = await seedUser();
    const foreign = await seedCampaign(other);
    mockSession(me);
    const res = await app.inject({ method: 'DELETE', url: `/api/campaigns/${foreign}` });
    expect(res.statusCode).toBe(404);
    expect(await readCampaign(foreign)).toBeDefined();
  });

  // ── derived content gate (L-spot, bifurcated approval) ───────────────────────
  it('derives content_validation_status = null when no creative is linked', async () => {
    const me = await seedUser();
    const id = await seedCampaign(me);
    mockSession(me);
    const res = await app.inject({ method: 'GET', url: `/api/campaigns/${id}` });
    expect(res.statusCode).toBe(200);
    expect(
      (res.json() as { content_validation_status: string | null }).content_validation_status,
    ).toBeNull();
  });

  it('derives content_validation_status from the linked creative (reflects approval)', async () => {
    const me = await seedUser();
    const [creative] = await db
      .insert(creatives)
      .values({
        advertiserId: me,
        creativeType: 'video',
        storageKey: `creatives/${me}/c`,
        durationSeconds: 20,
        validationStatus: 'approved',
      })
      .returning();
    const [campaign] = await db
      .insert(campaigns)
      .values({
        advertiserId: me,
        name: 'Linked',
        campaignType: 'standard',
        creativeId: creative?.id,
      })
      .returning();
    mockSession(me);
    const res = await app.inject({ method: 'GET', url: `/api/campaigns/${campaign?.id}` });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { content_validation_status: string }).content_validation_status).toBe(
      'approved',
    );
  });

  // ── PATCH creative_id (link / unlink the creative) ───────────────────────────
  it('links an own creative via PATCH (200); GET then derives its content_validation_status', async () => {
    const me = await seedUser();
    const campaignId = await seedCampaign(me);
    const creativeId = await seedCreative(me, 'approved');
    mockSession(me);
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/campaigns/${campaignId}`,
      payload: { creative_id: creativeId },
    });
    expect(res.statusCode).toBe(200);
    const get = await app.inject({ method: 'GET', url: `/api/campaigns/${campaignId}` });
    expect((get.json() as { content_validation_status: string }).content_validation_status).toBe(
      'approved',
    );
  });

  it('returns 404 linking another advertiser’s creative (owner-scope)', async () => {
    const me = await seedUser();
    const other = await seedUser();
    const campaignId = await seedCampaign(me);
    const foreign = await seedCreative(other, 'approved');
    mockSession(me);
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/campaigns/${campaignId}`,
      payload: { creative_id: foreign },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 linking a nonexistent creative', async () => {
    const me = await seedUser();
    const campaignId = await seedCampaign(me);
    mockSession(me);
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/campaigns/${campaignId}`,
      payload: { creative_id: '00000000-0000-0000-0000-000000000000' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 409 linking a creative on a non-draft campaign', async () => {
    const me = await seedUser();
    const campaignId = await seedCampaign(me, { status: 'pending' });
    const creativeId = await seedCreative(me);
    mockSession(me);
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/campaigns/${campaignId}`,
      payload: { creative_id: creativeId },
    });
    expect(res.statusCode).toBe(409);
  });

  it('unlinks with creative_id=null (200) → content gate back to null', async () => {
    const me = await seedUser();
    const creativeId = await seedCreative(me, 'approved');
    const [campaign] = await db
      .insert(campaigns)
      .values({ advertiserId: me, name: 'Linked', campaignType: 'standard', creativeId })
      .returning();
    mockSession(me);
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/campaigns/${campaign?.id}`,
      payload: { creative_id: null },
    });
    expect(res.statusCode).toBe(200);
    const get = await app.inject({ method: 'GET', url: `/api/campaigns/${campaign?.id}` });
    expect(
      (get.json() as { content_validation_status: string | null }).content_validation_status,
    ).toBeNull();
  });

  // ── apiRoutes wiring ─────────────────────────────────────────────────────────
  it('is wired into the apiRoutes aggregate (reachable through the full app)', async () => {
    const me = await seedUser();
    mockSession(me);
    // A SEPARATE app built from the apiRoutes aggregate (not the per-test campaignsRoutes app):
    // proves routes/index.ts actually registers campaignsRoutes, not just the direct plugin.
    const aggregate = buildApp();
    await aggregate.register(apiRoutes);
    await aggregate.ready();
    try {
      const res = await aggregate.inject({ method: 'GET', url: '/api/campaigns/mine' });
      expect(res.statusCode).toBe(200);
    } finally {
      await aggregate.close();
    }
  });
});
