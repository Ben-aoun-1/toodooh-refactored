import { eq } from 'drizzle-orm';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { mainDb } from '../src/db/client.js';
import { type NewUser, screenhosts, simulations, users } from '../src/db/schema.js';
import { adminSimulationsRoutes } from '../src/routes/admin-simulations.js';
import { closeAllSandboxes } from '../src/simulator/pools.js';
import { dropSandboxDatabase, listSandboxDatabases } from '../src/simulator/provisioning.js';

type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;
const mockSession = (userId: string): void => {
  vi.spyOn(auth.api, 'getSession').mockResolvedValue({
    session: {},
    user: { id: userId, role: 'admin', status: 'approved' },
  } as unknown as GetSessionResult);
};

interface SimulationView {
  id: string;
  name: string;
  status: 'creating' | 'ready' | 'failed' | 'deleting';
  virtual_now: string;
  error: string | null;
  created_at: string;
  last_used_at: string;
}
interface ListView {
  simulations: SimulationView[];
  max: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let adminId = '';
let app: FastifyInstance;

describe('admin simulations lifecycle (SIM-0)', () => {
  beforeAll(async () => {
    const values: NewUser = {
      email: `lifecycle-${Date.now()}@example.com`,
      contactName: 'Life',
      role: 'admin',
      status: 'approved',
    };
    const [u] = await mainDb.insert(users).values(values).returning();
    adminId = u?.id ?? '';
    app = Fastify({ logger: false });
    await app.register(adminSimulationsRoutes, { enabled: true, maxSandboxes: 5 });
    await app.ready();
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    const rows = await mainDb.select({ dbName: simulations.dbName }).from(simulations);
    for (const r of rows) await dropSandboxDatabase(r.dbName);
    await mainDb.delete(simulations);
    await closeAllSandboxes();
    await app.close();
  }, 60_000);

  const waitSettled = async (id: string): Promise<SimulationView> => {
    for (let i = 0; i < 300; i += 1) {
      const res = await app.inject({ method: 'GET', url: `/api/admin/simulations/${id}` });
      const body = res.json<SimulationView>();
      if (body.status === 'ready' || body.status === 'failed') return body;
      await sleep(200);
    }
    throw new Error('sandbox never settled');
  };

  it('creates (202) → ready; probe counts THROUGH the sandbox; delete drops the database', async () => {
    mockSession(adminId);
    const create = await app.inject({
      method: 'POST',
      url: '/api/admin/simulations',
      payload: { name: 'Monde 1', virtual_start: '2026-03-01T08:00:00Z' },
    });
    expect(create.statusCode).toBe(202);
    const created = create.json<SimulationView>();
    expect(created.status).toBe('creating');
    expect(created.virtual_now).toBe('2026-03-01T08:00:00.000Z');
    expect(Object.keys(created)).not.toContain('db_name');

    const ready = await waitSettled(created.id);
    expect(ready.status).toBe('ready');
    expect(ready.error).toBeNull();

    // Main gets one extra venue the probe must NOT see (main is shared with the worker's other
    // files, so pin a delta, never an absolute count on main).
    const [mainVenue] = await mainDb
      .insert(screenhosts)
      .values({ name: 'Main-only venue' })
      .returning({ id: screenhosts.id });
    const probe = await app.inject({
      method: 'GET',
      url: `/api/admin/simulations/${created.id}/probe`,
    });
    expect(probe.statusCode).toBe(200);
    expect(probe.json()).toEqual({
      screenhosts: 0,
      campaigns: 0,
      users: 0,
      dispatch_config_present: true,
    });
    await mainDb.delete(screenhosts).where(eq(screenhosts.id, mainVenue?.id ?? ''));

    const list = await app.inject({ method: 'GET', url: '/api/admin/simulations' });
    expect(list.json<ListView>().max).toBe(5);
    expect(list.json<ListView>().simulations.map((s) => s.id)).toContain(created.id);
    const [touched] = await mainDb
      .select({ lastUsedAt: simulations.lastUsedAt, createdAt: simulations.createdAt })
      .from(simulations)
      .where(eq(simulations.id, created.id));
    expect((touched?.lastUsedAt.getTime() ?? 0) >= (touched?.createdAt.getTime() ?? 1)).toBe(true);

    const [row] = await mainDb.select().from(simulations).where(eq(simulations.id, created.id));
    const del = await app.inject({ method: 'DELETE', url: `/api/admin/simulations/${created.id}` });
    expect(del.statusCode).toBe(204);
    expect(await listSandboxDatabases()).not.toContain(row?.dbName);
    const again = await app.inject({
      method: 'DELETE',
      url: `/api/admin/simulations/${created.id}`,
    });
    expect(again.statusCode).toBe(404);
  }, 300_000);

  it('refuses to delete a simulation still creating (409 SIMULATION_BUSY)', async () => {
    mockSession(adminId);
    const [row] = await mainDb
      .insert(simulations)
      .values({ name: 'busy', dbName: 'busy_db', virtualNow: new Date(), createdBy: adminId })
      .returning();
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/admin/simulations/${row?.id ?? ''}`,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'SIMULATION_BUSY' });
    await mainDb.delete(simulations).where(eq(simulations.id, row?.id ?? ''));
  });
});
