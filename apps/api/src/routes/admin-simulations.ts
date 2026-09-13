import { randomBytes } from 'node:crypto';

import { formatInTimeZone } from 'date-fns-tz';
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import type {
  FastifyPluginAsync,
  FastifyReply,
  FastifyRequest,
  HookHandlerDoneFunction,
} from 'fastify';
import { z } from 'zod';

import { db, mainDb } from '../db/client.js';
import {
  type Simulation,
  businessSectors,
  campaigns,
  dispatchConfig,
  recharges,
  screenhosts,
  screens,
  simulationActors,
  simulations,
  users,
} from '../db/schema.js';
import { env } from '../env.js';
import { requireAdmin, requireAuth } from '../middleware/require-auth.js';
import { requireSimulator } from '../middleware/require-simulator.js';
import { runInSandbox } from '../simulator/context.js';
import { mainDatabaseName, sandboxDatabaseName } from '../simulator/naming.js';
import { sandboxHandleFor } from '../simulator/pools.js';
import { deleteSimulation, provisionSimulation } from '../simulator/provisioning.js';
import { momentOf } from '../simulator/tick/clock.js';
import { launchCampaign, launchEvent } from '../simulator/tick/launch.js';
import { runTick } from '../simulator/tick/run.js';
import { simulationState } from '../simulator/tick/state.js';
import { type WorldParams, generateWorld } from '../simulator/world/spec.js';
import { actorParams, sandboxIsEmpty, writeWorld } from '../simulator/world/write.js';

// SIM-0 — the admin « Simulateur » registry endpoints. A simulation is a sandbox DATABASE on the
// same server; the routes under /:id/* enter its async context in the LAST preHandler (after the
// auth guards, so an unauthenticated request never resolves a pool), and from there every engine
// import of `db` hits the sandbox (db/client.ts). The registry itself lives in MAIN, so this file
// reads/writes it through `mainDb` on purpose — the one place routing is bypassed.

export interface AdminSimulationsOptions {
  enabled: boolean;
  maxSandboxes: number;
}

const idParamSchema = z.object({ id: z.uuid() });
const createBodySchema = z.object({
  name: z.string().trim().min(1).max(80),
  virtual_start: z.iso.datetime({ offset: true }).optional(),
});

const view = (s: Simulation) => ({
  id: s.id,
  name: s.name,
  status: s.status,
  virtual_now: s.virtualNow.toISOString(),
  error: s.error,
  created_at: s.createdAt.toISOString(),
  last_used_at: s.lastUsedAt.toISOString(),
});

const invalid = (reply: FastifyReply, field: string, reason: string) =>
  reply.status(400).send({
    error: 'INVALID_INPUT',
    message: 'Validation failed',
    statusCode: 400,
    fields: [{ field, reason }],
  });

const notFound = (reply: FastifyReply) =>
  reply
    .status(404)
    .send({ error: 'NOT_FOUND', message: 'Simulation introuvable.', statusCode: 404 });

const loadSimulation = async (id: string): Promise<Simulation | undefined> => {
  const [row] = await mainDb.select().from(simulations).where(eq(simulations.id, id)).limit(1);
  return row;
};

const TZ = 'Africa/Tunis';

const worldBodySchema = z.object({
  seed: z.string().trim().min(1).max(32).optional(),
  venues: z.int().min(1).max(60).optional(),
  owners: z.int().min(1).max(60).optional(),
  advertisers: z.int().min(0).max(40).optional(),
  agents: z.int().min(0).max(10).optional(),
  history_days: z.int().min(0).max(90).optional(),
  wallet_min_tnd: z.int().min(0).max(100_000).optional(),
  wallet_max_tnd: z.int().min(0).max(100_000).optional(),
});

const randomSeed = (): string => randomBytes(4).toString('hex');

// SIM-2/3 — a tick is bounded so one click can never run the box out of time: 336 hours is two
// virtual weeks, which is the longest jump the page offers (« + 1 semaine » twice).
const tickBodySchema = z.object({ hours: z.int().min(1).max(336).optional() });

const launchBodySchema = z.object({
  advertiser_id: z.uuid().optional(),
  name: z.string().trim().min(1).max(120).optional(),
  duration_days: z.int().min(1).max(90).optional(),
  spot_seconds: z.int().min(5).max(30).optional(),
  start_in_days: z.int().min(2).max(60).optional(),
  budget_tnd: z.int().min(1).max(1_000_000).optional(),
  budget_share: z.number().min(0.01).max(1).optional(),
});

const eventBodySchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  in_days: z.int().min(1).max(60).optional(),
  duration_hours: z.int().min(1).max(6).optional(),
  spot_seconds: z.int().min(5).max(30).optional(),
  budget_tnd: z.int().min(1).max(1_000_000).optional(),
  budget_share: z.number().min(0.01).max(1).optional(),
});

const actorBodySchema = z.object({
  acceptance_rate: z.number().min(0).max(1).optional(),
  response_delay_hours: z.int().min(1).max(72).optional(),
  offline_probability: z.number().min(0).max(1).optional(),
});

/** The world card: the stored seed/knobs/counts + counts recomputed live through the sandbox. */
const worldView = async (simulationId: string) => {
  const simulation = await loadSimulation(simulationId);
  const stored = simulation?.world as
    | { seed: string; params: WorldParams; counts: Record<string, number>; generated_at: string }
    | null
    | undefined;
  if (!stored) return null;

  const venues = await db
    .select({
      id: screenhosts.id,
      class: screenhosts.class,
      sectorId: screenhosts.businessSectorId,
    })
    .from(screenhosts);
  const sectorRows = await db
    .select({ id: businessSectors.id, name: businessSectors.name })
    .from(businessSectors)
    .where(
      inArray(
        businessSectors.id,
        venues.map((v) => v.sectorId).filter((id): id is string => id !== null),
      ),
    );
  const sectorName = new Map(sectorRows.map((r) => [r.id, r.name]));
  const bySector: Record<string, number> = {};
  const byClass: Record<string, number> = { populaire: 0, moyen: 0, premium: 0 };
  for (const v of venues) {
    const name = (v.sectorId && sectorName.get(v.sectorId)) || 'inconnu';
    bySector[name] = (bySector[name] ?? 0) + 1;
    if (v.class) byClass[v.class] = (byClass[v.class] ?? 0) + 1;
  }
  const [wallet] = await db
    .select({ total: sql<string>`coalesce(sum(${recharges.amountTnd}), 0)` })
    .from(recharges)
    .where(eq(recharges.status, 'confirmed'));
  const [screenCount] = await db.select({ n: sql<number>`count(*)::int` }).from(screens);

  return {
    seed: stored.seed,
    params: stored.params,
    generated_at: stored.generated_at,
    counts: { ...stored.counts, venues: venues.length, screens: screenCount?.n ?? 0 },
    by_sector: bySector,
    by_class: byClass,
    wallet_total_tnd: Number(wallet?.total ?? 0),
  };
};

export const adminSimulationsRoutes: FastifyPluginAsync<AdminSimulationsOptions> = async (
  app,
  opts,
) => {
  const guards = [requireAuth, requireAdmin, requireSimulator(opts.enabled)];

  // Loads the registry row for /:id/* and enters the sandbox context. LAST in the chain.
  // CALLBACK style on purpose: `done()` is called INSIDE runInSandbox, so the handler and every
  // await under it run within the store. An async hook + enterWith does not propagate (see
  // simulator/context.ts). Early replies send and return without calling done (Fastify docs).
  const enterSimulation = (
    request: FastifyRequest,
    reply: FastifyReply,
    done: HookHandlerDoneFunction,
  ): void => {
    const parsed = idParamSchema.safeParse(request.params);
    if (!parsed.success) {
      void invalid(reply, 'id', 'must be a uuid');
      return;
    }
    loadSimulation(parsed.data.id)
      .then(async (row) => {
        if (!row) {
          await notFound(reply);
          return;
        }
        if (row.status !== 'ready') {
          await reply.status(409).send({
            error: 'SIMULATION_NOT_READY',
            message: `La simulation n'est pas prête (${row.status}).`,
            statusCode: 409,
            status: row.status,
          });
          return;
        }
        await mainDb
          .update(simulations)
          .set({ lastUsedAt: new Date() })
          .where(eq(simulations.id, row.id));
        runInSandbox(sandboxHandleFor(row.id, row.dbName), () => done());
      })
      .catch((err: unknown) => done(err instanceof Error ? err : new Error(String(err))));
  };

  app.get('/api/admin/simulations', { preHandler: guards }, async () => {
    const rows = await mainDb.select().from(simulations).orderBy(desc(simulations.createdAt));
    return { simulations: rows.map(view), max: opts.maxSandboxes };
  });

  app.post('/api/admin/simulations', { preHandler: guards }, async (request, reply) => {
    const parsed = createBodySchema.safeParse(request.body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return invalid(reply, String(issue?.path[0] ?? 'body'), issue?.message ?? 'invalid');
    }
    const adminId = request.user?.id;
    if (!adminId) {
      return reply.status(401).send({
        error: 'UNAUTHENTICATED',
        message: 'Authentification requise.',
        statusCode: 401,
      });
    }
    const [counted] = await mainDb
      .select({ count: sql<number>`count(*)::int` })
      .from(simulations)
      .where(ne(simulations.status, 'failed'));
    if ((counted?.count ?? 0) >= opts.maxSandboxes) {
      return reply.status(409).send({
        error: 'SIMULATOR_FULL',
        message: `Nombre maximal de simulations atteint (${opts.maxSandboxes}).`,
        statusCode: 409,
        max: opts.maxSandboxes,
      });
    }
    const virtualNow = parsed.data.virtual_start ? new Date(parsed.data.virtual_start) : new Date();
    const [row] = await mainDb
      .insert(simulations)
      .values({
        name: parsed.data.name,
        dbName: sandboxDatabaseName(mainDatabaseName(env.DATABASE_URL)),
        virtualNow,
        createdBy: adminId,
      })
      .returning();
    if (!row) throw new Error('simulation insert returned no row');
    // Fire-and-forget: provisionSimulation never throws (it flips the row to failed instead).
    void provisionSimulation(row.id, request.log);
    return reply.status(202).send(view(row));
  });

  app.get('/api/admin/simulations/:id', { preHandler: guards }, async (request, reply) => {
    const parsed = idParamSchema.safeParse(request.params);
    if (!parsed.success) return invalid(reply, 'id', 'must be a uuid');
    const row = await loadSimulation(parsed.data.id);
    if (!row) return notFound(reply);
    return view(row);
  });

  app.delete('/api/admin/simulations/:id', { preHandler: guards }, async (request, reply) => {
    const parsed = idParamSchema.safeParse(request.params);
    if (!parsed.success) return invalid(reply, 'id', 'must be a uuid');
    const row = await loadSimulation(parsed.data.id);
    if (!row) return notFound(reply);
    if (row.status === 'creating' || row.status === 'deleting') {
      return reply.status(409).send({
        error: 'SIMULATION_BUSY',
        message: `La simulation est occupée (${row.status}).`,
        statusCode: 409,
        status: row.status,
      });
    }
    await deleteSimulation(row.id, row.dbName);
    return reply.status(204).send();
  });

  // Routed: every `db` read below hits the SANDBOX — the proof routing works and SIM-1's counters.
  app.get(
    '/api/admin/simulations/:id/probe',
    { preHandler: [...guards, enterSimulation] },
    async () => {
      const count = async (table: typeof screenhosts | typeof campaigns | typeof users) => {
        const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(table);
        return r?.n ?? 0;
      };
      const [cfg] = await db.select({ id: dispatchConfig.id }).from(dispatchConfig).limit(1);
      return {
        screenhosts: await count(screenhosts),
        campaigns: await count(campaigns),
        users: await count(users),
        dispatch_config_present: Boolean(cfg),
      };
    },
  );

  // ── SIM-1 — the world generator ──────────────────────────────────────────────
  const routed = { preHandler: [...guards, enterSimulation] };

  app.post('/api/admin/simulations/:id/world', routed, async (request, reply) => {
    const parsedBody = worldBodySchema.safeParse(request.body ?? {});
    if (!parsedBody.success) {
      const issue = parsedBody.error.issues[0];
      return invalid(reply, String(issue?.path[0] ?? 'body'), issue?.message ?? 'invalid');
    }
    const simulationId = (request.params as { id: string }).id;
    const simulation = await loadSimulation(simulationId);
    if (!simulation) return notFound(reply);
    if (simulation.world !== null || !(await sandboxIsEmpty())) {
      return reply.status(409).send({
        error: 'WORLD_EXISTS',
        message: 'Cette simulation a déjà un monde. Supprime-la et crées-en une autre.',
        statusCode: 409,
      });
    }

    const body = parsedBody.data;
    const venues = body.venues ?? 12;
    const params: WorldParams = {
      seed: body.seed ?? randomSeed(),
      venues,
      owners: Math.min(body.owners ?? Math.ceil((venues * 2) / 3), venues),
      advertisers: body.advertisers ?? 6,
      agents: body.agents ?? 2,
      historyDays: body.history_days ?? 28,
      walletMinTnd: body.wallet_min_tnd ?? 500,
      walletMaxTnd: body.wallet_max_tnd ?? 5000,
      virtualToday: formatInTimeZone(simulation.virtualNow, TZ, 'yyyy-MM-dd'),
    };
    if (params.walletMinTnd > params.walletMaxTnd) {
      return invalid(reply, 'wallet_min_tnd', 'must be ≤ wallet_max_tnd');
    }

    const counts = await writeWorld(generateWorld(params), { simulationId });
    request.log.info({ simulationId, seed: params.seed, counts }, 'simulator: world generated');
    return reply.status(201).send(await worldView(simulationId));
  });

  app.get('/api/admin/simulations/:id/world', routed, async (request, reply) => {
    const view = await worldView((request.params as { id: string }).id);
    if (!view) {
      return reply
        .status(404)
        .send({ error: 'NO_WORLD', message: 'Aucun monde généré.', statusCode: 404 });
    }
    return view;
  });

  // ── SIM-2 / SIM-3 — the clock, the board and the pokes ───────────────────────

  app.post('/api/admin/simulations/:id/tick', routed, async (request, reply) => {
    const parsed = tickBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) return invalid(reply, 'hours', 'must be 1–336');
    const simulationId = (request.params as { id: string }).id;
    const simulation = await loadSimulation(simulationId);
    if (!simulation) return notFound(reply);
    if (simulation.world === null) {
      return reply.status(409).send({
        error: 'NO_WORLD',
        message: 'Génère un monde avant de lancer l\u2019horloge.',
        statusCode: 409,
      });
    }
    const result = await runTick({
      simulation,
      hours: parsed.data.hours ?? 1,
      log: request.log,
    });
    request.log.info({ simulationId, ...result.counters }, 'simulator: tick');
    return result;
  });

  app.get('/api/admin/simulations/:id/state', routed, async (request, reply) => {
    const simulation = await loadSimulation((request.params as { id: string }).id);
    if (!simulation) return notFound(reply);
    return simulationState(momentOf(simulation.virtualNow));
  });

  app.post('/api/admin/simulations/:id/campaigns', routed, async (request, reply) => {
    const parsed = launchBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return invalid(reply, String(issue?.path[0] ?? 'body'), issue?.message ?? 'invalid');
    }
    const simulationId = (request.params as { id: string }).id;
    const simulation = await loadSimulation(simulationId);
    if (!simulation) return notFound(reply);
    const world = simulation.world as { seed?: string } | null;
    const body = parsed.data;
    const result = await launchCampaign({
      moment: momentOf(simulation.virtualNow),
      seed: world?.seed ?? simulation.id,
      ...(body.advertiser_id ? { advertiserId: body.advertiser_id } : {}),
      ...(body.name ? { name: body.name } : {}),
      ...(body.duration_days ? { durationDays: body.duration_days } : {}),
      ...(body.spot_seconds ? { spotSeconds: body.spot_seconds } : {}),
      ...(body.start_in_days ? { startInDays: body.start_in_days } : {}),
      ...(body.budget_tnd ? { budgetTnd: body.budget_tnd } : {}),
      ...(body.budget_share ? { budgetShare: body.budget_share } : {}),
    });
    if ('error' in result) {
      return reply.status(409).send({
        error: result.error,
        message:
          result.error === 'CMAX_TOO_LOW'
            ? 'Le réseau ne peut pas porter une campagne au plancher de 100 TND sur cette fenêtre.'
            : result.error === 'NOT_FUNDED'
              ? 'Aucun annonceur ne dispose du solde minimum.'
              : 'Lancement impossible.',
        statusCode: 409,
      });
    }
    request.log.info(
      { simulationId, campaignId: result.campaign_id, outcome: result.outcome },
      'simulator: campaign launched',
    );
    return reply.status(201).send(result);
  });

  app.post('/api/admin/simulations/:id/events', routed, async (request, reply) => {
    const parsed = eventBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return invalid(reply, String(issue?.path[0] ?? 'body'), issue?.message ?? 'invalid');
    }
    const simulation = await loadSimulation((request.params as { id: string }).id);
    if (!simulation) return notFound(reply);
    const world = simulation.world as { seed?: string } | null;
    const body = parsed.data;
    const result = await launchEvent({
      moment: momentOf(simulation.virtualNow),
      seed: world?.seed ?? simulation.id,
      ...(body.name ? { name: body.name } : {}),
      ...(body.in_days ? { inDays: body.in_days } : {}),
      ...(body.duration_hours ? { durationHours: body.duration_hours } : {}),
      ...(body.spot_seconds ? { spotSeconds: body.spot_seconds } : {}),
      ...(body.budget_tnd ? { budgetTnd: body.budget_tnd } : {}),
      ...(body.budget_share ? { budgetShare: body.budget_share } : {}),
    });
    if ('error' in result) {
      return reply.status(409).send({
        error: result.error,
        message:
          result.error === 'CMAX_TOO_LOW'
            ? 'Aucun établissement éligible aux événements ne peut porter ce match.'
            : 'Réservation impossible.',
        statusCode: 409,
      });
    }
    return reply.status(201).send(result);
  });

  // A poke: make a screen go dark (offline_probability 1), bring it back, or change how an owner
  // answers. The behaviours live in MAIN, so this never touches the sandbox.
  app.patch('/api/admin/simulations/:id/actors/:entityId', routed, async (request, reply) => {
    const parsed = actorBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return invalid(reply, String(issue?.path[0] ?? 'body'), issue?.message ?? 'invalid');
    }
    const { id, entityId } = request.params as { id: string; entityId: string };
    if (!z.uuid().safeParse(entityId).success) return invalid(reply, 'entityId', 'must be a uuid');
    const [row] = await mainDb
      .select()
      .from(simulationActors)
      .where(and(eq(simulationActors.simulationId, id), eq(simulationActors.entityId, entityId)))
      .limit(1);
    if (!row) return notFound(reply);
    const current = (row.params ?? {}) as Record<string, unknown>;
    const next = { ...current, ...parsed.data };
    await mainDb
      .update(simulationActors)
      .set({ params: next })
      .where(eq(simulationActors.id, row.id));
    return { kind: row.kind, entity_id: entityId, params: next };
  });

  app.get('/api/admin/simulations/:id/world/venues', routed, async (request) => {
    const simulationId = (request.params as { id: string }).id;
    const rows = await db
      .select({
        id: screenhosts.id,
        name: screenhosts.name,
        sector: businessSectors.name,
        venueClass: screenhosts.class,
        openingHour: screenhosts.openingHour,
        closingHour: screenhosts.closingHour,
        sps: screenhosts.sps,
        latitude: screenhosts.latitude,
        longitude: screenhosts.longitude,
        ownerId: screenhosts.ownerId,
        ownerName: users.contactName,
        ownerRole: users.role,
      })
      .from(screenhosts)
      .leftJoin(businessSectors, eq(businessSectors.id, screenhosts.businessSectorId))
      .leftJoin(users, eq(users.id, screenhosts.ownerId))
      .orderBy(screenhosts.name);
    const screenRows = await db
      .select({ id: screens.id, screenhostId: screens.screenhostId })
      .from(screens);
    const screensByVenue = new Map<string, number>();
    for (const s of screenRows) {
      screensByVenue.set(s.screenhostId, (screensByVenue.get(s.screenhostId) ?? 0) + 1);
    }
    // Behaviours live in MAIN, keyed by the sandbox entity id — joined here in code, never in SQL.
    const owners = await actorParams(simulationId, 'owner');
    return {
      venues: rows.map((v) => {
        const behaviour = v.ownerId ? owners.get(v.ownerId) : undefined;
        const rate = behaviour?.['acceptance_rate'];
        const delay = behaviour?.['response_delay_hours'];
        return {
          id: v.id,
          name: v.name,
          sector: v.sector,
          class: v.venueClass,
          opening_hour: v.openingHour,
          closing_hour: v.closingHour,
          screens: screensByVenue.get(v.id) ?? 0,
          sps: Number(v.sps),
          lat: v.latitude === null ? null : Number(v.latitude),
          lng: v.longitude === null ? null : Number(v.longitude),
          owner: { id: v.ownerId, name: v.ownerName, role: v.ownerRole },
          acceptance_rate: typeof rate === 'number' ? rate : null,
          response_delay_hours: typeof delay === 'number' ? delay : null,
        };
      }),
    };
  });
};
