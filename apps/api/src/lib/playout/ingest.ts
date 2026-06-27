import { eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { z } from 'zod';

import { db } from '../../db/client.js';
import { proofOfPlay, screens } from '../../db/schema.js';

import { activeAllocationsForScreenhost } from './active-allocations.js';
import { type ScreenEventMessage } from './ws-protocol.js';

export interface ScreenContext {
  screenId: string;
  screenhostId: string;
}

const asString = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const asNumber = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

// Anti-spam (billing substrate): played_duration_ms is bounded to a sane ceiling so a malicious /
// buggy player can't inflate proof. A real play is at most the creative length; allow a tolerance
// for loop/buffer slack. A null/absent creative duration falls back to FALLBACK_DURATION_SECONDS.
const DURATION_TOLERANCE = 2;
const FALLBACK_DURATION_SECONDS = 300;
export const boundDurationMs = (
  raw: number | null,
  creativeDurationSeconds: number | null,
): number | null => {
  if (raw === null || raw < 0) return null;
  const ceilingMs =
    (creativeDurationSeconds ?? FALLBACK_DURATION_SECONDS) * 1000 * DURATION_TOLERANCE;
  return Math.min(raw, ceilingMs);
};

// Resolve the played video_id (= the campaign id we sent) back to its campaign + creative through the
// SAME airability gate the playlist uses (activeAllocationsForScreenhost) — a screen only records
// proof for content the server authorized it to air (ACCEPTE + campaign active + creative approved +
// window covers now). Unresolvable or malformed events are logged + ignored (no orphan proof, no
// crash). VIDEO_ENDED carries played_duration_ms (bounded); VIDEO_STARTED records null duration.
const recordProof = async (
  msg: ScreenEventMessage,
  ctx: ScreenContext,
  eventType: 'VIDEO_STARTED' | 'VIDEO_ENDED',
  log: FastifyBaseLogger,
): Promise<void> => {
  const videoId = asString(msg.data['video_id']);
  if (!videoId || !z.uuid().safeParse(videoId).success) {
    log.warn(
      { event: eventType, screenId: ctx.screenId },
      'screen-ws: proof missing/invalid video_id',
    );
    return;
  }

  const [resolved] = await activeAllocationsForScreenhost(ctx.screenhostId, new Date(), videoId);
  if (!resolved) {
    log.warn(
      { event: eventType, videoId, screenhostId: ctx.screenhostId },
      'screen-ws: proof for a non-airable campaign ignored',
    );
    return;
  }

  const durationRaw = eventType === 'VIDEO_ENDED' ? asNumber(msg.data['played_duration_ms']) : null;
  const tsMs = asNumber(msg.data['timestamp']);
  await db.insert(proofOfPlay).values({
    screenId: ctx.screenId,
    screenhostId: ctx.screenhostId,
    campaignId: resolved.campaignId,
    creativeId: resolved.creativeId,
    videoIdAsSent: videoId,
    eventType,
    playedDurationMs: boundDurationMs(durationRaw, resolved.durationSeconds),
    eventTs: tsMs !== null ? new Date(tsMs) : null,
  });
};

// Handle one parsed screen→server event. Defensive: any failure is logged by the caller, never
// thrown to the socket. HEARTBEAT → liveness; VIDEO_STARTED/VIDEO_ENDED → proof-of-play (VIDEO_ENDED
// carries played_duration_ms — the binary "it aired" proof). PLAYBACK_ERROR / STATUS_REPORT / other
// → logged.
export const handleScreenEvent = async (
  msg: ScreenEventMessage,
  ctx: ScreenContext,
  log: FastifyBaseLogger,
): Promise<void> => {
  switch (msg.event) {
    case 'HEARTBEAT':
      await db.update(screens).set({ lastSeenAt: new Date() }).where(eq(screens.id, ctx.screenId));
      return;
    case 'VIDEO_STARTED':
    case 'VIDEO_ENDED':
      await recordProof(msg, ctx, msg.event, log);
      return;
    default:
      log.info({ event: msg.event, screenId: ctx.screenId }, 'screen-ws event');
      return;
  }
};
