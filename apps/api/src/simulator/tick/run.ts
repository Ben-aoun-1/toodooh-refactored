import { eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';

import { db, mainDb } from '../../db/client.js';
import { type Simulation, screenhosts, simulations } from '../../db/schema.js';
import { runCampaignLifecycleTick } from '../../lib/campaign-lifecycle.js';
import { runCampaignRedispatchTick } from '../../lib/campaign-redispatch.js';
import { runEventSettlementSweep } from '../../lib/event-playout/settlement.js';
import { runMonthlyBillingSweep } from '../../lib/monthly-billing.js';
import { recomputeVenueSps } from '../../lib/sps-score.js';
import { actorParams } from '../world/write.js';

import {
  type OwnerBehaviour,
  runEventOwnerAnswers,
  runOwnerAnswers,
  runPax,
  runPlayout,
  runScreenLiveness,
} from './actors.js';
import { type VirtualMoment, advance, momentOf } from './clock.js';

// SIM-2 — one virtual HOUR. The emulated actors produce the hour's facts (decisions, footfall,
// proofs), then the REAL engine jobs run over them with the virtual instant injected as `now` —
// the same functions the server's boot jobs call, unmodified. Order matters and mirrors the boot
// sequence: lifecycle first (a campaign that starts today becomes active before anything tries to
// air it), then the hour's activity, then redispatch (which reads this hour's manquements).
//
// Deliberately NOT run here: the monthly PDF report job (it drives a headless chromium per venue
// and would make a tick take minutes — reports are a rendering concern, not an engine rule) and
// the event bloc pusher (it pushes over live websockets; a simulation has none).

export interface TickCounters {
  owners_answered: number;
  accepted: number;
  refused: number;
  screens_online: number;
  screens_offline: number;
  pax_cells: number;
  proofs: number;
  venues_airing: number;
  missed_offline: number;
  activated: number;
  completed: number;
  redispatch_rounds: number;
  sps_recomputed: number;
  invoices_generated: number;
  events_settled: number;
}

export interface TickResult {
  from: string;
  to: string;
  hours: number;
  counters: TickCounters;
  /** The last hour processed, for the page's clock. */
  moment: { date: string; hour: number };
}

const zero = (): TickCounters => ({
  owners_answered: 0,
  accepted: 0,
  refused: 0,
  screens_online: 0,
  screens_offline: 0,
  pax_cells: 0,
  proofs: 0,
  venues_airing: 0,
  missed_offline: 0,
  activated: 0,
  completed: 0,
  redispatch_rounds: 0,
  sps_recomputed: 0,
  invoices_generated: 0,
  events_settled: 0,
});

const behavioursOf = async (
  simulationId: string,
): Promise<{ owners: Map<string, OwnerBehaviour>; screens: Map<string, number> }> => {
  const ownerRows = await actorParams(simulationId, 'owner');
  const screenRows = await actorParams(simulationId, 'screen');
  const owners = new Map<string, OwnerBehaviour>();
  for (const [id, params] of ownerRows) {
    const rate = params['acceptance_rate'];
    const delay = params['response_delay_hours'];
    owners.set(id, {
      acceptanceRate: typeof rate === 'number' ? rate : 0.75,
      responseDelayHours: typeof delay === 'number' ? delay : 12,
    });
  }
  const screensMap = new Map<string, number>();
  for (const [id, params] of screenRows) {
    const p = params['offline_probability'];
    screensMap.set(id, typeof p === 'number' ? p : 0);
  }
  return { owners, screens: screensMap };
};

/** One virtual hour, with every engine the hour would wake in production. */
export const runOneHour = async (input: {
  simulationId: string;
  seed: string;
  moment: VirtualMoment;
  behaviours: { owners: Map<string, OwnerBehaviour>; screens: Map<string, number> };
  log: FastifyBaseLogger;
  counters: TickCounters;
}): Promise<void> => {
  const { moment, log, counters } = input;

  // 1. Lifecycle — upcoming → active → completed (completion settles through the real reconcile).
  const lifecycle = await runCampaignLifecycleTick(log, moment.at);
  counters.activated += lifecycle.activated;
  counters.completed += lifecycle.completed;

  // 2. Owners answer, screens wake or stay dark, sensors report, screens play.
  const answers = await runOwnerAnswers({
    moment,
    seed: input.seed,
    behaviours: input.behaviours.owners,
  });
  counters.owners_answered += answers.answered;
  counters.accepted += answers.accepted;
  counters.refused += answers.refused;

  const eventAnswers = await runEventOwnerAnswers({
    moment,
    seed: input.seed,
    behaviours: input.behaviours.owners,
  });
  counters.owners_answered += eventAnswers.answered;
  counters.accepted += eventAnswers.accepted;
  counters.refused += eventAnswers.refused;

  const liveness = await runScreenLiveness({
    moment,
    seed: input.seed,
    offlineProbability: input.behaviours.screens,
  });
  counters.screens_online = liveness.online;
  counters.screens_offline = liveness.offline;

  counters.pax_cells += await runPax({
    moment,
    seed: input.seed,
    onlineByVenue: liveness.onlineByVenue,
  });

  const playout = await runPlayout({ moment, onlineByVenue: liveness.onlineByVenue });
  counters.proofs += playout.proofs;
  counters.venues_airing = playout.venuesAiring;
  counters.missed_offline += playout.skippedOffline;

  // 3. Rattrapage — reads this hour's manquements against the frozen plan.
  const redispatch = await runCampaignRedispatchTick(log, moment.at);
  counters.redispatch_rounds += redispatch.placedRounds;

  // 4. Event windows that closed settle on the hour, like the boot job.
  const settled = await runEventSettlementSweep(log, moment.at);
  counters.events_settled += settled.settled;

  // 5. The daily SPS sweep, at 03h Tunis — the same per-venue function the daily job calls.
  if (moment.hour === 3) {
    const venues = await db.select({ id: screenhosts.id }).from(screenhosts);
    for (const venue of venues) {
      try {
        await recomputeVenueSps(venue.id, moment.at);
        counters.sps_recomputed += 1;
      } catch (err) {
        log.warn({ err, venueId: venue.id }, 'simulator: SPS recompute failed');
      }
    }
  }

  // 6. Month-end billing, on the 1st at 02h — invoices and venue statements for the closed month.
  if (moment.hour === 2 && moment.date.endsWith('-01')) {
    const billing = await runMonthlyBillingSweep(log, moment.at);
    counters.invoices_generated += billing.invoicesGenerated;
  }
};

/** Advance a simulation by `hours` virtual hours. Runs inside the sandbox context. */
export const runTick = async (input: {
  simulation: Simulation;
  hours: number;
  log: FastifyBaseLogger;
}): Promise<TickResult> => {
  const { simulation, log } = input;
  const world = simulation.world as { seed?: string } | null;
  const seed = world?.seed ?? simulation.id;
  const behaviours = await behavioursOf(simulation.id);
  const counters = zero();

  const from = simulation.virtualNow;
  let at = from;
  let last = momentOf(at);
  for (let i = 0; i < input.hours; i += 1) {
    last = momentOf(at);
    await runOneHour({
      simulationId: simulation.id,
      seed,
      moment: last,
      behaviours,
      log,
      counters,
    });
    at = advance(at, 1);
    // The clock moves after every hour, so an interrupted run leaves a coherent simulation.
    await mainDb
      .update(simulations)
      .set({ virtualNow: at, lastUsedAt: new Date() })
      .where(eq(simulations.id, simulation.id));
  }

  return {
    from: from.toISOString(),
    to: at.toISOString(),
    hours: input.hours,
    counters,
    moment: { date: last.date, hour: last.hour },
  };
};
