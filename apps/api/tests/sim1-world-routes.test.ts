import { eq } from 'drizzle-orm';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { mainDb } from '../src/db/client.js';
import { type NewUser, simulations, users } from '../src/db/schema.js';
import { adminSimulationsRoutes } from '../src/routes/admin-simulations.js';
import { closeAllSandboxes } from '../src/simulator/pools.js';
import { dropSandboxDatabase } from '../src/simulator/provisioning.js';

type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;
const mockSession = (userId: string): void => {
  vi.spyOn(auth.api, 'getSession').mockResolvedValue({
    session: {},
    user: { id: userId, role: 'admin', status: 'approved' },
  } as unknown as GetSessionResult);
};

interface WorldView {
  seed: string;
  params: { venues: number; history_days?: number; historyDays: number; virtualToday: string };
  generated_at: string;
  counts: Record<string, number>;
  by_sector: Record<string, number>;
  by_class: Record<string, number>;
  wallet_total_tnd: number;
}
interface VenuesView {
  venues: {
    id: string;
    name: string;
    sector: string | null;
    class: string | null;
    screens: number;
    sps: number;
    owner: { id: string | null; name: string | null; role: string | null };
    acceptance_rate: number | null;
  }[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let app: FastifyInstance;
let adminId = '';
let simulationId = '';
let dbName = '';

describe('SIM-1 world endpoints', () => {
  beforeAll(async () => {
    const [admin] = await mainDb
      .insert(users)
      .values({
        email: `sim1-routes-${Date.now()}@example.com`,
        contactName: 'Sim1 Routes',
        role: 'admin',
        status: 'approved',
      } satisfies NewUser)
      .returning();
    adminId = admin?.id ?? '';
    app = Fastify({ logger: false });
    await app.register(adminSimulationsRoutes, { enabled: true, maxSandboxes: 5 });
    await app.ready();

    mockSession(adminId);
    const create = await app.inject({
      method: 'POST',
      url: '/api/admin/simulations',
      payload: { name: 'Monde routes', virtual_start: '2026-03-02T09:00:00Z' },
    });
    simulationId = create.json<{ id: string }>().id;
    for (let i = 0; i < 300; i += 1) {
      const res = await app.inject({
        method: 'GET',
        url: `/api/admin/simulations/${simulationId}`,
      });
      if (res.json<{ status: string }>().status !== 'creating') break;
      await sleep(200);
    }
    const [row] = await mainDb
      .select({ dbName: simulations.dbName })
      .from(simulations)
      .where(eq(simulations.id, simulationId));
    dbName = row?.dbName ?? '';
    vi.restoreAllMocks();
  }, 180_000);

  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await closeAllSandboxes();
    if (dbName) await dropSandboxDatabase(dbName);
    await mainDb.delete(simulations).where(eq(simulations.id, simulationId));
  }, 180_000);

  it('404 NO_WORLD before anything is generated', async () => {
    mockSession(adminId);
    const res = await app.inject({
      method: 'GET',
      url: `/api/admin/simulations/${simulationId}/world`,
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: 'NO_WORLD' });
  });

  it('400 on out-of-range knobs', async () => {
    mockSession(adminId);
    const tooMany = await app.inject({
      method: 'POST',
      url: `/api/admin/simulations/${simulationId}/world`,
      payload: { venues: 999 },
    });
    expect(tooMany.statusCode).toBe(400);
    const badWallet = await app.inject({
      method: 'POST',
      url: `/api/admin/simulations/${simulationId}/world`,
      payload: { venues: 3, wallet_min_tnd: 900, wallet_max_tnd: 100 },
    });
    expect(badWallet.statusCode).toBe(400);
  });

  it('generates a world (201) with the seed echoed and the counts live from the sandbox', async () => {
    mockSession(adminId);
    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/simulations/${simulationId}/world`,
      payload: {
        seed: 'routes01',
        venues: 5,
        owners: 3,
        advertisers: 2,
        agents: 2,
        history_days: 2,
      },
    });
    expect(res.statusCode).toBe(201);
    const world = res.json<WorldView>();
    expect(world.seed).toBe('routes01');
    expect(world.counts['venues']).toBe(5);
    expect(world.counts['owners']).toBe(3);
    expect(world.counts['history_days']).toBe(2);
    expect(world.params.virtualToday).toBe('2026-03-02');
    expect(Object.values(world.by_class).reduce((a, b) => a + b, 0)).toBe(5);
    expect(Object.values(world.by_sector).reduce((a, b) => a + b, 0)).toBe(5);
    expect(world.wallet_total_tnd).toBeGreaterThan(0);
  }, 120_000);

  it('the probe now counts the generated rows THROUGH the sandbox', async () => {
    mockSession(adminId);
    const probe = await app.inject({
      method: 'GET',
      url: `/api/admin/simulations/${simulationId}/probe`,
    });
    expect(probe.json()).toMatchObject({ screenhosts: 5, users: 7, campaigns: 0 });
  });

  it('lists the venues with their owner and the MAIN-side acceptance rate', async () => {
    mockSession(adminId);
    const res = await app.inject({
      method: 'GET',
      url: `/api/admin/simulations/${simulationId}/world/venues`,
    });
    expect(res.statusCode).toBe(200);
    const { venues } = res.json<VenuesView>();
    expect(venues).toHaveLength(5);
    for (const v of venues) {
      expect(v.sector).toBeTruthy();
      expect(v.class).toBeTruthy();
      expect(v.screens).toBeGreaterThanOrEqual(1);
      expect(v.owner.id).toBeTruthy();
      expect(v.acceptance_rate).toBeGreaterThanOrEqual(0.55);
      expect(v.acceptance_rate).toBeLessThanOrEqual(0.95);
    }
  });

  it('409 WORLD_EXISTS on a second generation', async () => {
    mockSession(adminId);
    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/simulations/${simulationId}/world`,
      payload: { venues: 2 },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'WORLD_EXISTS' });
  });

  it('the same seed reproduces the same venue names', async () => {
    mockSession(adminId);
    const res = await app.inject({
      method: 'GET',
      url: `/api/admin/simulations/${simulationId}/world/venues`,
    });
    const names = res.json<VenuesView>().venues.map((v) => v.name);
    const { generateWorld } = await import('../src/simulator/world/spec.js');
    const regenerated = generateWorld({
      seed: 'routes01',
      venues: 5,
      owners: 3,
      advertisers: 2,
      agents: 2,
      historyDays: 2,
      walletMinTnd: 500,
      walletMaxTnd: 5000,
      virtualToday: '2026-03-02',
    });
    expect(names.sort()).toEqual(regenerated.venues.map((v) => v.name).sort());
  });
});
