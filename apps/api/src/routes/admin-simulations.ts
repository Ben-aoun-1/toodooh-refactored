import { desc, eq, ne, sql } from 'drizzle-orm';
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
  campaigns,
  dispatchConfig,
  screenhosts,
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
};
