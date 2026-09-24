import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, preHandlerHookHandler } from 'fastify';
import { z } from 'zod';

import { db, mainDb } from '../db/client.js';
import {
  type Simulation,
  businessSectors,
  campaignDispatchAllocation,
  dispatchConfig,
  eventAllocations,
  screenhosts,
  screens,
  simulationActors,
  users,
} from '../db/schema.js';
import { decideAllocation } from '../lib/allocation-decision.js';
import { getDispatchConfig } from '../lib/dispatch/config.js';
import { decideEventAllocation } from '../lib/event-allocation-decision.js';

// SIM-6 phase 3 — the SCENARIO CONTROLS: what the admin needs to steer a test of dispatch,
// redispatch and pricing. Every write lands in the SANDBOX (the routed preHandler enters it) except
// the actor behaviours, which live in MAIN (simulation_actors) like the existing screen poke.
//   • force an owner's answer on one allocation (standard or event) — through the REAL decision
//     functions, so a forced refusal cascades exactly like a real one;
//   • switch a whole venue's screens off / on, or make it « dead since N days » (last_seen_at moved
//     back on the virtual clock — what redispatch and the installed rule read);
//   • the launch options: the sandbox's sectors (targeting) and advertisers (who pays);
//   • the SANDBOX pricing editor (ruled P2 A): CPM, T tiers and F in the sandbox's dispatch_config,
//     and the CPM of the world's advertisers (CPM-3: a campaign prices at its screencaster's own
//     CPM, captured when created — new simulated campaigns take the new price, existing ones keep
//     theirs). Prod's configuration is never touched.

interface ControlHelpers {
  routed: { preHandler: preHandlerHookHandler[] };
  invalid: (reply: FastifyReply, field: string, reason: string) => unknown;
  notFound: (reply: FastifyReply) => unknown;
  loadSimulation: (id: string) => Promise<Simulation | undefined>;
}

const decisionBodySchema = z.object({ statut: z.enum(['ACCEPTE', 'REFUSE']) });
const venueScreensBodySchema = z.object({
  online: z.boolean(),
  dead_days: z.int().min(1).max(365).optional(),
});
const pricingBodySchema = z.object({
  standard_cpm_tnd: z.number().positive().max(1000).optional(),
  event_cpm_tnd: z.number().positive().max(1000).optional(),
  t_10s: z.number().gt(0).max(1).optional(),
  t_20s: z.number().gt(0).max(1).optional(),
  t_30s: z.number().gt(0).max(1).optional(),
  f_max_seconds: z.int().min(10).max(3600).optional(),
});

const pricingView = async () => {
  const c = await getDispatchConfig();
  return {
    standard_cpm_tnd: c.standardCpmTnd,
    event_cpm_tnd: c.eventCpmTnd,
    t_10s: c.t10s,
    t_20s: c.t20s,
    t_30s: c.t30s,
    f_max_seconds: c.fMaxSeconds,
  };
};

export const registerSimulationControls = (app: FastifyInstance, h: ControlHelpers): void => {
  const { routed, invalid, notFound, loadSimulation } = h;

  // Force an owner's answer on ONE allocation — the real decision (a refusal runs the cascade).
  app.post(
    '/api/admin/simulations/:id/allocations/:allocationId/decision',
    routed,
    async (request, reply) => {
      const { id, allocationId } = request.params as { id: string; allocationId: string };
      if (!z.uuid().safeParse(allocationId).success) {
        return invalid(reply, 'allocationId', 'must be a uuid');
      }
      const body = decisionBodySchema.safeParse(request.body ?? {});
      if (!body.success) return invalid(reply, 'statut', 'must be ACCEPTE or REFUSE');
      const simulation = await loadSimulation(id);
      if (!simulation) return notFound(reply);

      const [standard] = await db
        .select({ ownerId: screenhosts.ownerId })
        .from(campaignDispatchAllocation)
        .innerJoin(screenhosts, eq(screenhosts.id, campaignDispatchAllocation.screenhostId))
        .where(eq(campaignDispatchAllocation.id, allocationId))
        .limit(1);
      if (standard?.ownerId) {
        const outcome = await decideAllocation({
          allocationId,
          ownerId: standard.ownerId,
          statut: body.data.statut,
        });
        return { kind: 'standard', outcome };
      }
      const [event] = await db
        .select({ ownerId: screenhosts.ownerId })
        .from(eventAllocations)
        .innerJoin(screenhosts, eq(screenhosts.id, eventAllocations.screenhostId))
        .where(eq(eventAllocations.id, allocationId))
        .limit(1);
      if (event?.ownerId) {
        const outcome = await decideEventAllocation({
          allocationId,
          ownerId: event.ownerId,
          statut: body.data.statut,
          now: simulation.virtualNow,
        });
        return { kind: 'event', outcome };
      }
      return notFound(reply);
    },
  );

  // A whole venue's screens off / on — optionally « dead since N days » on the virtual clock.
  app.post('/api/admin/simulations/:id/venues/:venueId/screens', routed, async (request, reply) => {
    const { id, venueId } = request.params as { id: string; venueId: string };
    if (!z.uuid().safeParse(venueId).success) return invalid(reply, 'venueId', 'must be a uuid');
    const body = venueScreensBodySchema.safeParse(request.body ?? {});
    if (!body.success) {
      const issue = body.error.issues[0];
      return invalid(reply, String(issue?.path[0] ?? 'body'), issue?.message ?? 'invalid');
    }
    const simulation = await loadSimulation(id);
    if (!simulation) return notFound(reply);
    const rows = await db
      .select({ id: screens.id })
      .from(screens)
      .where(eq(screens.screenhostId, venueId));
    if (rows.length === 0) return notFound(reply);
    const screenIds = rows.map((r) => r.id);
    const actors = await mainDb
      .select()
      .from(simulationActors)
      .where(
        and(eq(simulationActors.simulationId, id), inArray(simulationActors.entityId, screenIds)),
      );
    for (const actor of actors) {
      const params = (actor.params ?? {}) as Record<string, unknown>;
      await mainDb
        .update(simulationActors)
        .set({ params: { ...params, offline_probability: body.data.online ? 0 : 1 } })
        .where(eq(simulationActors.id, actor.id));
    }
    if (!body.data.online && body.data.dead_days) {
      const lastSeen = new Date(
        simulation.virtualNow.getTime() - body.data.dead_days * 24 * 60 * 60 * 1000,
      );
      await db.update(screens).set({ lastSeenAt: lastSeen }).where(inArray(screens.id, screenIds));
    }
    return {
      venue_id: venueId,
      screens: screenIds.length,
      online: body.data.online,
      dead_days: body.data.dead_days ?? null,
    };
  });

  // The launch options of the sandbox: its owner sectors (targeting) and its advertisers (who pays).
  app.get('/api/admin/simulations/:id/world/options', routed, async () => {
    const sectors = await db
      .select({ id: businessSectors.id, name: businessSectors.name })
      .from(businessSectors)
      .where(eq(businessSectors.audience, 'owner'))
      .orderBy(businessSectors.name);
    const advertisers = await db
      .select({ id: users.id, name: users.contactName })
      .from(users)
      .where(eq(users.role, 'advertiser'))
      .orderBy(users.contactName);
    return { sectors, advertisers };
  });

  // The SANDBOX pricing editor (ruled P2 A) — never prod's configuration.
  app.get('/api/admin/simulations/:id/pricing', routed, async () => pricingView());

  app.patch('/api/admin/simulations/:id/pricing', routed, async (request, reply) => {
    const body = pricingBodySchema.safeParse(request.body ?? {});
    if (!body.success) {
      const issue = body.error.issues[0];
      return invalid(reply, String(issue?.path[0] ?? 'body'), issue?.message ?? 'invalid');
    }
    const current = await getDispatchConfig();
    const t10 = body.data.t_10s ?? current.t10s;
    const t20 = body.data.t_20s ?? current.t20s;
    const t30 = body.data.t_30s ?? current.t30s;
    if (!(t10 <= t20 && t20 <= t30)) {
      return invalid(reply, 't_10s', 'the attention indices must satisfy t_10s ≤ t_20s ≤ t_30s');
    }
    const [row] = await db.select({ id: dispatchConfig.id }).from(dispatchConfig).limit(1);
    if (!row) {
      return reply.status(409).send({
        error: 'NO_CONFIG',
        message: 'La configuration du bac à sable est absente.',
        statusCode: 409,
      });
    }
    const patch: Partial<typeof dispatchConfig.$inferInsert> = {};
    if (body.data.standard_cpm_tnd !== undefined)
      patch.standardCpmTnd = String(body.data.standard_cpm_tnd);
    if (body.data.event_cpm_tnd !== undefined) patch.eventCpmTnd = String(body.data.event_cpm_tnd);
    if (body.data.t_10s !== undefined) patch.t10s = String(body.data.t_10s);
    if (body.data.t_20s !== undefined) patch.t20s = String(body.data.t_20s);
    if (body.data.t_30s !== undefined) patch.t30s = String(body.data.t_30s);
    if (body.data.f_max_seconds !== undefined) patch.fMaxSeconds = body.data.f_max_seconds;
    if (Object.keys(patch).length > 0) {
      await db.update(dispatchConfig).set(patch).where(eq(dispatchConfig.id, row.id));
    }
    // CPM-3 — the world's advertisers price at their OWN CPM: move it with the sandbox default.
    const cpmPatch: Partial<typeof users.$inferInsert> = {};
    if (body.data.standard_cpm_tnd !== undefined)
      cpmPatch.cpmStandardTnd = String(body.data.standard_cpm_tnd);
    if (body.data.event_cpm_tnd !== undefined)
      cpmPatch.cpmEventTnd = String(body.data.event_cpm_tnd);
    if (Object.keys(cpmPatch).length > 0) {
      await db.update(users).set(cpmPatch).where(eq(users.role, 'advertiser'));
    }
    return pricingView();
  });
};
