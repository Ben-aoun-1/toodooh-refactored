import { randomUUID } from 'node:crypto';

import { db } from '../../db/client.js';
import { engineEvents } from '../../db/schema.js';
import { logger } from '../../logger.js';

const log = logger.child({ module: 'engine-journal' });

// LOG1 — the engine journal collector. OBSERVE-ONLY by construction:
//  - Every engine seam takes `trace: EngineTrace = NOOP_TRACE`; callers that don't opt in change
//    NOTHING (the no-op pin: the entire pre-LOG1 engine suite passes untouched).
//  - `event()` only buffers in memory — the engine transaction never sees a journal write.
//  - `finish(outcome)` runs AFTER the tx resolves (commit or rollback — a refused run keeps its
//    trace, which is the operator's whole reason for wanting it) and inserts ONE batch.
//  - A flush failure logs a warn and SWALLOWS — the journal must never fail an engine path.
// Payloads are aggregate-only (reasons, counts, montants); in-run ordering rides payload.seq
// because a single batch shares created_at.

export type EnginePhase = 'dispatch' | 'cascade' | 'redispatch' | 'settlement' | 'boost';
export type EngineOutcome = 'committed' | 'rolled_back';

export interface EngineTrace {
  /** False on the no-op: seams gate their observe-only EXTRA reads on this, so the default path
   * pays zero cost (e.g. pool assembly's inactive-venue lookup). */
  readonly enabled: boolean;
  event(type: string, payload?: Record<string, unknown>, screenhostId?: string | null): void;
  finish(outcome: EngineOutcome, summary?: Record<string, unknown>): Promise<void>;
}

/** The default everywhere — engine behavior byte-unchanged when nobody collects. */
export const NOOP_TRACE: EngineTrace = {
  enabled: false,
  event: () => undefined,
  finish: async () => undefined,
};

interface BufferedEvent {
  type: string;
  payload: Record<string, unknown>;
  screenhostId: string | null;
}

export const createEngineTrace = (phase: EnginePhase, campaignId: string): EngineTrace => {
  const runId = randomUUID();
  const buffer: BufferedEvent[] = [];
  let finished = false;

  return {
    enabled: true,
    event(type, payload = {}, screenhostId = null) {
      if (finished) return;
      buffer.push({ type, payload, screenhostId });
    },
    async finish(outcome, summary = {}) {
      if (finished) return;
      finished = true;
      try {
        await db.insert(engineEvents).values([
          ...buffer.map((e, seq) => ({
            campaignId,
            runId,
            phase,
            eventType: e.type,
            screenhostId: e.screenhostId,
            payload: { ...e.payload, seq },
          })),
          {
            campaignId,
            runId,
            phase,
            eventType: 'run',
            screenhostId: null,
            payload: summary,
            outcome,
          },
        ]);
      } catch (err: unknown) {
        // NEVER throw into an engine path — the journal is diagnostics, not a dependency.
        log.warn({ err, campaignId, phase, runId }, 'engine journal flush failed — trace dropped');
      }
    },
  };
};
