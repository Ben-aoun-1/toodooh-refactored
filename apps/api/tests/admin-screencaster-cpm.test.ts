import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import { type NewUser, campaigns, users } from '../src/db/schema.js';
import { adminScreencasterCpmRoutes } from '../src/routes/admin-screencaster-cpm.js';

import { type CpmConfigSnapshot, pinCpmConfig, restoreCpmConfig } from './helpers/cpm-config.js';
import { resetAuthTables } from './helpers/db-test-setup.js';

type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;
const buildApp = () => Fastify({ logger: false });
const mockSession = (userId: string, role: string): void => {
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
      email: `sccpm${seq}@example.com`,
      contactName: `User ${seq}`,
      status: 'approved',
      ...values,
    })
    .returning({ id: users.id });
  return u?.id ?? '';
};

describe('admin screencaster CPM — GET/PATCH /api/admin/screencasters/cpm (real Postgres)', () => {
  let app: ReturnType<typeof buildApp>;
  let pinned: CpmConfigSnapshot;

  beforeEach(async () => {
    await resetAuthTables();
    pinned = await pinCpmConfig('15.000', '15.000');
    app = buildApp();
    await app.register(adminScreencasterCpmRoutes);
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

  const patch = (payload: Record<string, unknown>) =>
    app.inject({ method: 'PATCH', url: '/api/admin/screencasters/cpm', payload });

  it('a non-admin gets 403 on both routes', async () => {
    mockSession(await seedUser(), 'advertiser');
    expect(
      (await app.inject({ method: 'GET', url: '/api/admin/screencasters/cpm' })).statusCode,
    ).toBe(403);
    expect((await patch({ user_ids: [], standard_cpm_tnd: 10 })).statusCode).toBe(403);
  });

  it('GET lists the screencasters with numbers in snake_case', async () => {
    const adv = await seedUser({ businessName: 'Café Média' });
    mockSession(await seedUser({ role: 'admin' }), 'admin');
    const res = await app.inject({ method: 'GET', url: '/api/admin/screencasters/cpm' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      screencasters: [
        expect.objectContaining({
          id: adv,
          company_name: 'Café Média',
          cpm_standard_tnd: 15,
          cpm_event_tnd: 15,
          draft_count: 0,
          last_change: null,
        }),
      ],
    });
  });

  it('PATCH applies to several screencasters and reports the drafts it re-priced', async () => {
    const a = await seedUser();
    const b = await seedUser();
    await db
      .insert(campaigns)
      .values({ advertiserId: a, name: 'Brouillon', campaignType: 'standard' });
    mockSession(await seedUser({ role: 'admin' }), 'admin');
    const res = await patch({ user_ids: [a, b], standard_cpm_tnd: 12.5, event_cpm_tnd: 20 });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ updated: 2, drafts_repriced: 1 });
  });

  it('PATCH validation: no id, no CPM, a non-positive CPM → 400 INVALID_INPUT', async () => {
    const adv = await seedUser();
    mockSession(await seedUser({ role: 'admin' }), 'admin');
    for (const body of [
      { user_ids: [], standard_cpm_tnd: 10 },
      { user_ids: [adv] },
      { user_ids: [adv], standard_cpm_tnd: 0 },
      { user_ids: [adv], event_cpm_tnd: -1 },
      { user_ids: ['not-a-uuid'], standard_cpm_tnd: 10 },
      { user_ids: [adv], standard_cpm_tnd: 12.3456 },
    ]) {
      const res = await patch(body);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: 'INVALID_INPUT' });
    }
  });

  it('PATCH accepts a CPM with exactly 3 decimals', async () => {
    const adv = await seedUser();
    mockSession(await seedUser({ role: 'admin' }), 'admin');
    const res = await patch({ user_ids: [adv], standard_cpm_tnd: 12.345 });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ updated: 1, drafts_repriced: 0 });
  });

  it('PATCH with a non-advertiser id → 400 NOT_ADVERTISER naming it', async () => {
    const adv = await seedUser();
    const owner = await seedUser({ role: 'individual_owner' });
    mockSession(await seedUser({ role: 'admin' }), 'admin');
    const res = await patch({ user_ids: [adv, owner], standard_cpm_tnd: 10 });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'NOT_ADVERTISER', user_ids: [owner] });
  });
});
