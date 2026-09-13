import Fastify from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { mainDb } from '../src/db/client.js';
import { type NewUser, simulations, users } from '../src/db/schema.js';
import { adminSimulationsRoutes } from '../src/routes/admin-simulations.js';
import { closeAllSandboxes } from '../src/simulator/pools.js';

type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;
const mockSession = (userId: string, role = 'admin'): void => {
  vi.spyOn(auth.api, 'getSession').mockResolvedValue({
    session: {},
    user: { id: userId, role, status: 'approved' },
  } as unknown as GetSessionResult);
};

let adminId = '';
let advertiserId = '';
let seq = 0;
const seedUser = async (role: NewUser['role']): Promise<string> => {
  seq += 1;
  const values: NewUser = {
    email: `guards-${role}-${Date.now()}-${seq}@example.com`,
    contactName: `U ${role}`,
    status: 'approved',
    role,
  };
  const [u] = await mainDb.insert(users).values(values).returning();
  return u?.id ?? '';
};

const build = async (opts: { enabled: boolean; maxSandboxes: number }) => {
  const app = Fastify({ logger: false });
  await app.register(adminSimulationsRoutes, opts);
  await app.ready();
  return app;
};

describe('admin simulations guards (SIM-0)', () => {
  beforeAll(async () => {
    adminId = await seedUser('admin');
    advertiserId = await seedUser('advertiser');
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await mainDb.delete(simulations);
    await closeAllSandboxes();
  });

  it('answers 503 SIMULATOR_DISABLED on every route when disabled', async () => {
    const app = await build({ enabled: false, maxSandboxes: 5 });
    mockSession(adminId);
    const res = await app.inject({ method: 'GET', url: '/api/admin/simulations' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: 'SIMULATOR_DISABLED' });
    const post = await app.inject({
      method: 'POST',
      url: '/api/admin/simulations',
      payload: { name: 'x' },
    });
    expect(post.statusCode).toBe(503);
    const probe = await app.inject({
      method: 'GET',
      url: '/api/admin/simulations/00000000-0000-4000-8000-0000000000ff/probe',
    });
    expect(probe.statusCode).toBe(503);
    await app.close();
  });

  it('403s a non-admin, 401s no session', async () => {
    const app = await build({ enabled: true, maxSandboxes: 5 });
    mockSession(advertiserId, 'advertiser');
    expect((await app.inject({ method: 'GET', url: '/api/admin/simulations' })).statusCode).toBe(
      403,
    );
    vi.restoreAllMocks();
    vi.spyOn(auth.api, 'getSession').mockResolvedValue(null as unknown as GetSessionResult);
    expect((await app.inject({ method: 'GET', url: '/api/admin/simulations' })).statusCode).toBe(
      401,
    );
    await app.close();
  });

  it('409 SIMULATOR_FULL at the cap (failed rows do not count)', async () => {
    const app = await build({ enabled: true, maxSandboxes: 1 });
    mockSession(adminId);
    await mainDb.insert(simulations).values([
      { name: 'a', dbName: 'cap_a', virtualNow: new Date(), createdBy: adminId, status: 'failed' },
      { name: 'b', dbName: 'cap_b', virtualNow: new Date(), createdBy: adminId, status: 'ready' },
    ]);
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/simulations',
      payload: { name: 'c' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'SIMULATOR_FULL', max: 1 });
    await mainDb.delete(simulations);
    await app.close();
  });

  it('409 SIMULATION_NOT_READY on a routed route while creating; 404 unknown id', async () => {
    const app = await build({ enabled: true, maxSandboxes: 5 });
    mockSession(adminId);
    const [row] = await mainDb
      .insert(simulations)
      .values({ name: 'nr', dbName: 'nr_db', virtualNow: new Date(), createdBy: adminId })
      .returning();
    const res = await app.inject({
      method: 'GET',
      url: `/api/admin/simulations/${row?.id ?? ''}/probe`,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'SIMULATION_NOT_READY', status: 'creating' });
    const missing = await app.inject({
      method: 'GET',
      url: '/api/admin/simulations/00000000-0000-4000-8000-0000000000ff/probe',
    });
    expect(missing.statusCode).toBe(404);
    await mainDb.delete(simulations);
    await app.close();
  });

  it('400 on a bad name or a bad virtual_start', async () => {
    const app = await build({ enabled: true, maxSandboxes: 5 });
    mockSession(adminId);
    const empty = await app.inject({
      method: 'POST',
      url: '/api/admin/simulations',
      payload: { name: '   ' },
    });
    expect(empty.statusCode).toBe(400);
    expect(empty.json()).toMatchObject({ error: 'INVALID_INPUT' });
    const badDate = await app.inject({
      method: 'POST',
      url: '/api/admin/simulations',
      payload: { name: 'ok', virtual_start: 'yesterday' },
    });
    expect(badDate.statusCode).toBe(400);
    await app.close();
  });
});
