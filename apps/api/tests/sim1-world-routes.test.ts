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
let launchedCampaignId = '';
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
  }, 300_000);

  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await closeAllSandboxes();
    if (dbName) await dropSandboxDatabase(dbName);
    await mainDb.delete(simulations).where(eq(simulations.id, simulationId));
  }, 300_000);

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
  }, 300_000);

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

  it('SIM-2 — tick, state, launch and the actor poke ride the same routed guard', async () => {
    mockSession(adminId);

    // the clock moves one hour and reports what happened
    const tick = await app.inject({
      method: 'POST',
      url: `/api/admin/simulations/${simulationId}/tick`,
      payload: { hours: 1 },
    });
    expect(tick.statusCode).toBe(200);
    const ticked = tick.json<{
      hours: number;
      counters: Record<string, number>;
      moment: { date: string };
    }>();
    expect(ticked.hours).toBe(1);
    expect(ticked.moment.date).toBe('2026-03-02');
    expect(ticked.counters['screens_online']).toBeGreaterThan(0);

    // the board
    const state = await app.inject({
      method: 'GET',
      url: `/api/admin/simulations/${simulationId}/state`,
    });
    expect(state.statusCode).toBe(200);
    const board = state.json<{
      clock: { hour: number };
      venues: unknown[];
      totals: Record<string, number>;
    }>();
    expect(board.venues).toHaveLength(5);
    expect(board.totals['screens_online']).toBeGreaterThan(0);

    // an advertiser launches a campaign through the real activation path
    const launch = await app.inject({
      method: 'POST',
      url: `/api/admin/simulations/${simulationId}/campaigns`,
      payload: {
        name: 'Campagne HTTP',
        duration_days: 3,
        spot_seconds: 10,
        start_in_days: 2,
        budget_share: 0.3,
      },
    });
    expect(launch.statusCode).toBe(201);
    const launched = launch.json<{
      campaign_id: string;
      outcome: string;
      allocations: number;
      status: string;
    }>();
    launchedCampaignId = launched.campaign_id;
    expect(launched.outcome).toBe('OK');
    expect(launched.allocations).toBeGreaterThan(0);
    expect(launched.status).toBe('upcoming');

    // a poke: this screen goes dark
    const board2 = await app.inject({
      method: 'GET',
      url: `/api/admin/simulations/${simulationId}/state`,
    });
    const screenId = board2
      .json<{ venues: { screens: { id: string }[] }[] }>()
      .venues.flatMap((v) => v.screens)
      .map((s) => s.id)[0];
    const poke = await app.inject({
      method: 'PATCH',
      url: `/api/admin/simulations/${simulationId}/actors/${screenId}`,
      payload: { offline_probability: 1 },
    });
    expect(poke.statusCode).toBe(200);
    expect(poke.json()).toMatchObject({ kind: 'screen', params: { offline_probability: 1 } });

    const afterPoke = await app.inject({
      method: 'POST',
      url: `/api/admin/simulations/${simulationId}/tick`,
      payload: { hours: 1 },
    });
    expect(
      afterPoke.json<{ counters: Record<string, number> }>().counters['screens_offline'],
    ).toBeGreaterThanOrEqual(1);

    const unknownActor = await app.inject({
      method: 'PATCH',
      url: `/api/admin/simulations/${simulationId}/actors/00000000-0000-4000-8000-0000000000ee`,
      payload: { offline_probability: 0 },
    });
    expect(unknownActor.statusCode).toBe(404);
  }, 300_000);

  it('SIM-5 — the inspectors read the sandbox on the VIRTUAL clock', async () => {
    mockSession(adminId);
    const picker = await app.inject({
      method: 'GET',
      url: `/api/admin/simulations/${simulationId}/testing/screenhosts`,
    });
    expect(picker.statusCode).toBe(200);
    const venues = picker.json<{ screenhosts: { id: string }[] }>().screenhosts;
    expect(venues).toHaveLength(5);

    const report = await app.inject({
      method: 'GET',
      url: `/api/admin/simulations/${simulationId}/testing/screenhosts/${venues[0]!.id}?from=2026-02-23&to=2026-03-02`,
    });
    expect(report.statusCode).toBe(200);
    const body = report.json<{
      periode: { today: string };
      audience: { measured_days: number };
      sps: { live: number };
    }>();
    // The simulation clock sits on 2026-03-02 — the wall clock is months away.
    expect(body.periode.today).toBe('2026-03-02');
    expect(body.audience.measured_days).toBeGreaterThan(0);
    expect(typeof body.sps.live).toBe('number');

    const eligible = await app.inject({
      method: 'GET',
      url: `/api/admin/simulations/${simulationId}/campaigns/${launchedCampaignId}/eligible-hosts`,
    });
    expect(eligible.statusCode).toBe(200);
    const elig = eligible.json<{
      kind: string;
      eligible: unknown[];
      totals: { eligible: number };
    }>();
    expect(elig.kind).toBe('standard');
    expect(elig.totals.eligible).toBe(elig.eligible.length);

    const badVenue = await app.inject({
      method: 'GET',
      url: `/api/admin/simulations/${simulationId}/testing/screenhosts/00000000-0000-4000-8000-0000000000cd?from=2026-02-23&to=2026-03-02`,
    });
    expect(badVenue.statusCode).toBe(404);
    const badRange = await app.inject({
      method: 'GET',
      url: `/api/admin/simulations/${simulationId}/testing/screenhosts/${venues[0]!.id}?from=2026-03-05&to=2026-03-01`,
    });
    expect(badRange.statusCode).toBe(400);
  }, 120_000);

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
