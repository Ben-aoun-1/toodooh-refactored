import { and, eq, inArray } from 'drizzle-orm';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, mainDb } from '../src/db/client.js';
import {
  type NewUser,
  campaignDispatchAllocation,
  campaignDispatchPlan,
  campaignTargeting,
  dispatchConfig,
  screens,
  simulationActors,
  simulations,
  users,
} from '../src/db/schema.js';
import { adminSimulationsRoutes } from '../src/routes/admin-simulations.js';
import { runInSandbox } from '../src/simulator/context.js';
import { closeAllSandboxes, sandboxHandleFor } from '../src/simulator/pools.js';
import { dropSandboxDatabase } from '../src/simulator/provisioning.js';

// SIM-6 phase 3 — the scenario controls, through the HTTP routes: a targeted launch, a forced
// owner refusal (the REAL decision), a venue switched off « dead since N days », and the SANDBOX
// pricing editor (config + the world's advertisers' CPM; prod's row is never read or written).

type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;
const mockSession = (userId: string): void => {
  vi.spyOn(auth.api, 'getSession').mockResolvedValue({
    session: {},
    user: { id: userId, role: 'admin', status: 'approved' },
  } as unknown as GetSessionResult);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let app: FastifyInstance;
let adminId = '';
let simulationId = '';
let dbName = '';
const inSandbox = <T>(fn: () => Promise<T>): Promise<T> =>
  runInSandbox(sandboxHandleFor(simulationId, dbName), fn);

describe('SIM-6 phase 3 — scenario controls', () => {
  beforeAll(async () => {
    const [admin] = await mainDb
      .insert(users)
      .values({
        email: `sim6-controls-${Date.now()}@example.com`,
        contactName: 'Sim6 Controls',
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
      payload: { name: 'Contrôles', virtual_start: '2026-04-06T06:00:00Z' },
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
    const world = await app.inject({
      method: 'POST',
      url: `/api/admin/simulations/${simulationId}/world`,
      payload: {
        seed: 'sim6ctl1',
        venues: 8,
        owners: 4,
        advertisers: 2,
        agents: 2,
        history_days: 3,
        wallet_min_tnd: 4000,
        wallet_max_tnd: 6000,
      },
    });
    expect(world.statusCode).toBe(201);
    vi.restoreAllMocks();
  }, 300_000);

  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await closeAllSandboxes();
    if (dbName) await dropSandboxDatabase(dbName);
    await mainDb.delete(simulations).where(eq(simulations.id, simulationId));
  }, 300_000);

  it('a launch carries its targeting lines into campaign_targeting', async () => {
    mockSession(adminId);
    const options = await app.inject({
      method: 'GET',
      url: `/api/admin/simulations/${simulationId}/world/options`,
    });
    expect(options.statusCode).toBe(200);
    const list = options.json<{ sectors: { id: string }[]; advertisers: { id: string }[] }>();
    expect(list.sectors.length).toBeGreaterThan(0);
    expect(list.advertisers.length).toBe(2);

    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/simulations/${simulationId}/campaigns`,
      payload: {
        name: 'Ciblée',
        duration_days: 1,
        start_in_days: 2,
        budget_share: 0.3,
        advertiser_id: list.advertisers[0]?.id,
        targeting: [{ category_id: null, class: null }],
      },
    });
    expect(res.statusCode).toBe(201);
    const launched = res.json<{ campaign_id: string; advertiser_id: string }>();
    expect(launched.advertiser_id).toBe(list.advertisers[0]?.id);
    const campaignId = launched.campaign_id;
    const lines = await inSandbox(() =>
      db.select().from(campaignTargeting).where(eq(campaignTargeting.campaignId, campaignId)),
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]?.categoryId).toBeNull();
  });

  it('400 on a malformed targeting line or kickoff hour', async () => {
    mockSession(adminId);
    const badLine = await app.inject({
      method: 'POST',
      url: `/api/admin/simulations/${simulationId}/campaigns`,
      payload: { targeting: [{ category_id: 'nope', class: null }] },
    });
    expect(badLine.statusCode).toBe(400);
    const badHour = await app.inject({
      method: 'POST',
      url: `/api/admin/simulations/${simulationId}/events`,
      payload: { kickoff_hour: 24 },
    });
    expect(badHour.statusCode).toBe(400);
  });

  it('a forced refusal goes through the real decision (the allocation leaves EN_ATTENTE)', async () => {
    mockSession(adminId);
    const launched = await app.inject({
      method: 'POST',
      url: `/api/admin/simulations/${simulationId}/campaigns`,
      payload: { name: 'Refus forcé', duration_days: 2, start_in_days: 3, budget_share: 0.3 },
    });
    expect(launched.statusCode).toBe(201);
    const campaignId = launched.json<{ campaign_id: string }>().campaign_id;
    const [allocation] = await inSandbox(() =>
      db
        .select({ id: campaignDispatchAllocation.id })
        .from(campaignDispatchAllocation)
        .innerJoin(
          campaignDispatchPlan,
          eq(campaignDispatchPlan.id, campaignDispatchAllocation.planId),
        )
        .where(
          and(
            eq(campaignDispatchPlan.campaignId, campaignId),
            eq(campaignDispatchAllocation.statutAcceptation, 'EN_ATTENTE'),
          ),
        )
        .limit(1),
    );
    expect(allocation).toBeDefined();

    const bad = await app.inject({
      method: 'POST',
      url: `/api/admin/simulations/${simulationId}/allocations/${allocation?.id}/decision`,
      payload: { statut: 'PEUT-ETRE' },
    });
    expect(bad.statusCode).toBe(400);

    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/simulations/${simulationId}/allocations/${allocation?.id}/decision`,
      payload: { statut: 'REFUSE' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ kind: string }>().kind).toBe('standard');
    const [after] = await inSandbox(() =>
      db
        .select({ statut: campaignDispatchAllocation.statutAcceptation })
        .from(campaignDispatchAllocation)
        .where(eq(campaignDispatchAllocation.id, allocation?.id ?? '')),
    );
    expect(after?.statut).not.toBe('EN_ATTENTE');

    const missing = await app.inject({
      method: 'POST',
      url: `/api/admin/simulations/${simulationId}/allocations/00000000-0000-4000-8000-000000000000/decision`,
      payload: { statut: 'ACCEPTE' },
    });
    expect(missing.statusCode).toBe(404);
  });

  it('a venue switched off « dead since 10 days » moves every screen actor and last_seen_at', async () => {
    mockSession(adminId);
    const [screen] = await inSandbox(() =>
      db.select({ screenhostId: screens.screenhostId }).from(screens).limit(1),
    );
    const venueId = screen?.screenhostId ?? '';
    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/simulations/${simulationId}/venues/${venueId}/screens`,
      payload: { online: false, dead_days: 10 },
    });
    expect(res.statusCode).toBe(200);
    const venueScreens = await inSandbox(() =>
      db
        .select({ id: screens.id, lastSeenAt: screens.lastSeenAt })
        .from(screens)
        .where(eq(screens.screenhostId, venueId)),
    );
    const [sim] = await mainDb.select().from(simulations).where(eq(simulations.id, simulationId));
    const tenDaysAgo = (sim?.virtualNow.getTime() ?? 0) - 10 * 24 * 3600 * 1000;
    for (const s of venueScreens) expect(s.lastSeenAt?.getTime()).toBe(tenDaysAgo);
    const actors = await mainDb
      .select({ params: simulationActors.params })
      .from(simulationActors)
      .where(
        and(
          eq(simulationActors.simulationId, simulationId),
          inArray(
            simulationActors.entityId,
            venueScreens.map((s) => s.id),
          ),
        ),
      );
    expect(actors.length).toBe(venueScreens.length);
    for (const a of actors) {
      expect((a.params as Record<string, unknown>)['offline_probability']).toBe(1);
    }

    const back = await app.inject({
      method: 'POST',
      url: `/api/admin/simulations/${simulationId}/venues/${venueId}/screens`,
      payload: { online: true },
    });
    expect(back.statusCode).toBe(200);
  });

  it('the pricing editor writes the SANDBOX config and the world advertisers, never prod', async () => {
    mockSession(adminId);
    const [prodBefore] = await mainDb.select().from(dispatchConfig).limit(1);

    const reversed = await app.inject({
      method: 'PATCH',
      url: `/api/admin/simulations/${simulationId}/pricing`,
      payload: { t_10s: 0.9, t_30s: 0.5 },
    });
    expect(reversed.statusCode).toBe(400);

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/simulations/${simulationId}/pricing`,
      payload: { standard_cpm_tnd: 9, event_cpm_tnd: 18, f_max_seconds: 600 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      standard_cpm_tnd: 9,
      event_cpm_tnd: 18,
      f_max_seconds: 600,
    });
    const advertisers = await inSandbox(() =>
      db
        .select({ std: users.cpmStandardTnd, evt: users.cpmEventTnd })
        .from(users)
        .where(eq(users.role, 'advertiser')),
    );
    expect(advertisers.length).toBeGreaterThan(0);
    for (const a of advertisers) {
      expect(Number(a.std)).toBe(9);
      expect(Number(a.evt)).toBe(18);
    }
    const [prodAfter] = await mainDb.select().from(dispatchConfig).limit(1);
    expect(prodAfter).toEqual(prodBefore);
  });
});
