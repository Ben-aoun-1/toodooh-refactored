import { and, eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { db, mainDb } from '../src/db/client.js';
import { applyMigrations } from '../src/db/migrate-runner.js';
import {
  type NewUser,
  campaignReconciliation,
  campaigns,
  eventAllocations,
  proofOfPlay,
  simulationActors,
  simulations,
  users,
} from '../src/db/schema.js';
import { env } from '../src/env.js';
import { upsertEventAttestation } from '../src/lib/event-playout/attestation.js';
import { measureEventDelivery } from '../src/lib/event-playout/settlement.js';
import { runInSandbox } from '../src/simulator/context.js';
import { inspectCampaign } from '../src/simulator/inspect/campaign.js';
import { mainDatabaseName, sandboxDatabaseName, sandboxUrl } from '../src/simulator/naming.js';
import { closeAllSandboxes, sandboxHandleFor } from '../src/simulator/pools.js';
import { createSandboxDatabase, dropSandboxDatabase } from '../src/simulator/provisioning.js';
import { momentOf } from '../src/simulator/tick/clock.js';
import { launchCampaign, launchEvent } from '../src/simulator/tick/launch.js';
import { runTick } from '../src/simulator/tick/run.js';
import { simulationState } from '../src/simulator/tick/state.js';
import { generateWorld } from '../src/simulator/world/spec.js';
import { writeWorld } from '../src/simulator/world/write.js';

// SIM-6 phase 1 — a simulated MATCH is lived end to end: booked by the REAL event pricing and
// dispatch, accepted, aired by the screens inside its blocs (the new event playout actor, through
// the REAL event airability gate), attested, and settled by the REAL EV5 sweep. Before this actor
// the screens never aired an event spot, so every simulated event settled as a FULL refund.

const SEED = 'sim6evt1';
const START = '2026-04-06T06:00:00Z'; // a Monday, 07h Tunis
const dbName = sandboxDatabaseName(mainDatabaseName(env.DATABASE_URL));
const silent = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
  trace: () => undefined,
  fatal: () => undefined,
  child: () => silent,
  level: 'silent',
  silent: () => undefined,
};
const log = silent as unknown as import('fastify').FastifyBaseLogger;

let simulationId = '';
const inSandbox = <T>(fn: () => Promise<T>): Promise<T> =>
  runInSandbox(sandboxHandleFor(simulationId, dbName), fn);
const simulation = async () => {
  const [row] = await mainDb.select().from(simulations).where(eq(simulations.id, simulationId));
  return row!;
};

describe('SIM-6 — events live in the simulator (playout in blocs → settlement)', () => {
  beforeAll(async () => {
    const [admin] = await mainDb
      .insert(users)
      .values({
        email: `sim6-${Date.now()}@example.com`,
        contactName: 'Sim6',
        role: 'admin',
        status: 'approved',
      } satisfies NewUser)
      .returning();
    const [row] = await mainDb
      .insert(simulations)
      .values({
        name: 'sim6',
        dbName,
        virtualNow: new Date(START),
        createdBy: admin?.id ?? '',
        status: 'ready',
      })
      .returning();
    simulationId = row?.id ?? '';
    await createSandboxDatabase(dbName);
    await applyMigrations(sandboxUrl(env.DATABASE_URL, dbName));
    const spec = generateWorld({
      seed: SEED,
      venues: 6,
      owners: 4,
      advertisers: 2,
      agents: 2,
      historyDays: 3,
      walletMinTnd: 4000,
      walletMaxTnd: 6000,
      virtualToday: '2026-04-06',
    });
    await inSandbox(() => writeWorld(spec, { simulationId }));
    // Screens that never drop: the bloc proofs are then a function of the rule, not of the dice.
    await mainDb
      .update(simulationActors)
      .set({ params: sql`${simulationActors.params} || '{"offline_probability": 0}'::jsonb` })
      .where(
        and(eq(simulationActors.simulationId, simulationId), eq(simulationActors.kind, 'screen')),
      );
  }, 300_000);

  afterAll(async () => {
    await closeAllSandboxes();
    await dropSandboxDatabase(dbName);
    await mainDb.delete(simulations).where(eq(simulations.id, simulationId));
  }, 180_000);

  it('a booked, accepted match airs in its blocs, shows on the board, and settles as DELIVERED', async () => {
    const booked = await inSandbox(() =>
      launchEvent({
        moment: momentOf(new Date(START)),
        seed: SEED,
        name: 'Derby SIM-6',
        inDays: 2,
        durationHours: 2,
        spotSeconds: 10,
        budgetShare: 0.5,
      }),
    );
    if ('error' in booked) throw new Error(booked.error);
    expect(booked.allocations).toBeGreaterThan(1);

    // A STANDARD campaign runs beside the match (Wednesday, one day) — the inspector covers both.
    const standard = await inSandbox(() =>
      launchCampaign({
        moment: momentOf(new Date(START)),
        seed: SEED,
        name: 'Campagne SIM-6',
        durationDays: 1,
        spotSeconds: 10,
        startInDays: 2,
        budgetShare: 0.4,
      }),
    );
    if ('error' in standard) throw new Error(standard.error);

    // The owners said yes (the refusal cascade is not what this test is about).
    const allocated = await inSandbox(async () => {
      await db
        .update(eventAllocations)
        .set({ statut: 'ACCEPTE', decidedAt: new Date(START) })
        .where(eq(eventAllocations.campaignId, booked.campaign_id));
      return db
        .select({ screenhostId: eventAllocations.screenhostId })
        .from(eventAllocations)
        .where(eq(eventAllocations.campaignId, booked.campaign_id));
    });
    const [attested, ...kept] = allocated.map((a) => a.screenhostId);

    // The board now counts the EVENT allocations (it read only the standard table before).
    const board = await inSandbox(() => simulationState(momentOf(new Date(START))));
    const campaignRow = board.campaigns.find((c) => c.id === booked.campaign_id);
    expect(campaignRow?.accepted).toBe(allocated.length);

    // An agent records « non respecté » on one venue before the window closes.
    const eventId = await inSandbox(async () => {
      const [c] = await db
        .select({ eventId: campaigns.eventId })
        .from(campaigns)
        .where(eq(campaigns.id, booked.campaign_id));
      const [agent] = await db
        .select({ id: users.id })
        .from(users)
        .where(inArray(users.role, ['screenhost_agent', 'screencast_agent']))
        .limit(1);
      const written = await upsertEventAttestation({
        eventId: c?.eventId ?? '',
        screenhostId: attested ?? '',
        authorId: agent?.id ?? '',
        respecte: false,
      });
      expect(written.status).toBe('OK');
      return c?.eventId ?? '';
    });

    // Monday 07h → Thursday 07h: the match (Wednesday 20h Tunis) and its window are over, and the
    // hourly EV5 sweep has settled the positioning.
    const result = await inSandbox(async () =>
      runTick({ simulation: await simulation(), hours: 72, log }),
    );
    expect(result.counters.event_proofs).toBeGreaterThan(0);
    expect(result.counters.event_blocs_aired).toBeGreaterThan(0);
    expect(result.counters.events_settled).toBeGreaterThanOrEqual(1);

    const outcome = await inSandbox(async () => {
      const proofs = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(proofOfPlay)
        .where(eq(proofOfPlay.campaignId, booked.campaign_id));
      const [recon] = await db
        .select()
        .from(campaignReconciliation)
        .where(eq(campaignReconciliation.campaignId, booked.campaign_id));
      const delivery = await measureEventDelivery(booked.campaign_id, eventId);
      return { proofs: proofs[0]?.n ?? 0, recon, delivery };
    });
    expect(outcome.proofs).toBeGreaterThan(0);
    // DELIVERED, not the old full refund: spend > 0.
    expect(Number(outcome.recon?.spendTnd)).toBeGreaterThan(0);
    // The attested venue is negated whatever its screens reported; the others delivered blocs.
    const lineOf = (id: string | undefined) =>
      outcome.delivery.venues.find((v) => v.screenhostId === id);
    expect(lineOf(attested)?.attestationNegated).toBe(true);
    expect(lineOf(attested)?.deliveredTnd).toBe(0);
    for (const id of kept) expect(lineOf(id)?.blocsDelivered).toBeGreaterThan(0);

    // ── SIM-6 phase 2 — the inspector reads every stage for both kinds ──────────
    const eventView = await inSandbox(() => inspectCampaign(booked.campaign_id));
    expect(eventView?.campaign.kind).toBe('event');
    expect(eventView?.pricing.c_max_tnd).toBeGreaterThan(0);
    expect(eventView?.event_placement?.length).toBe(allocated.length);
    expect(eventView?.event_placement?.[0]?.blocs.length).toBeGreaterThan(0);
    expect(eventView?.settlement?.spend_tnd).toBeGreaterThan(0);
    expect(eventView?.settlement?.event_delivery?.some((v) => v.attestation_negated)).toBe(true);

    const standardView = await inSandbox(() => inspectCampaign(standard.campaign_id));
    expect(standardView?.campaign.kind).toBe('standard');
    expect(standardView?.pricing.objectif).toBe(
      Math.floor(
        (standard.budget_tnd * 1000) / (standardView?.pricing.campaign_rates.standard_cpm_tnd ?? 1),
      ),
    );
    expect(standardView?.plan?.allocations.length).toBe(standard.allocations);
    expect(standardView?.plan?.i_cible).toBe(standardView?.pricing.objectif);
    expect(standardView?.journal.some((r) => r.phase === 'dispatch')).toBe(true);
    expect(standardView?.settlement).not.toBeNull();
  }, 900_000);
});
