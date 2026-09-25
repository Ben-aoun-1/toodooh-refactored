import { eq, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { z } from 'zod';

import { db } from '../../db/client.js';
import { proofOfPlay, screens } from '../../db/schema.js';

import { resolveAirableVideo } from './playlist-service.js';
import { proofPlayedAt } from './proof-instant.js';
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

// PROOF-R1 — what became of a proof, for the PROOF_ACK the player needs to drop it from its outbox:
// recorded, duplicate (a resend of a play already recorded), or rejected (never recordable: malformed
// or not airable at its play instant). A legacy player sends no play_id and gets no ack (playId null).
// A transient failure THROWS instead — no ack, so the player keeps the proof and replays it.
export interface ProofOutcome {
  playId: string | null;
  status: 'recorded' | 'duplicate' | 'rejected';
}

// Resolve the played video_id (= the campaign id we sent) back to its campaign + creative through the
// SAME airability gates the playlist composes (resolveAirableVideo, playlist-service.ts) — a screen
// only records proof for content the server authorized it to air, classic campaign or event
// positioning alike. PROOF-R1: judged at the PLAY instant (lib/playout/proof-instant.ts), so a proof
// replayed from the player's outbox is credited to — and checked against — the hour it aired. A
// play_id makes a resend idempotent (unique per screen × play × event). Unresolvable or malformed
// events are logged + ignored (no orphan proof, no crash). VIDEO_ENDED carries played_duration_ms
// (bounded); VIDEO_STARTED records null duration.
const recordProof = async (
  msg: ScreenEventMessage,
  ctx: ScreenContext,
  eventType: 'VIDEO_STARTED' | 'VIDEO_ENDED',
  log: FastifyBaseLogger,
  receivedAt: Date,
): Promise<ProofOutcome> => {
  const rawPlayId = asString(msg.data['play_id']);
  const playId = rawPlayId && z.uuid().safeParse(rawPlayId).success ? rawPlayId : null;
  const videoId = asString(msg.data['video_id']);
  if (!videoId || !z.uuid().safeParse(videoId).success) {
    log.warn(
      { event: eventType, screenId: ctx.screenId },
      'screen-ws: proof missing/invalid video_id',
    );
    return { playId, status: 'rejected' };
  }

  const tsMs = asNumber(msg.data['timestamp']);
  const playedAt = proofPlayedAt(tsMs, receivedAt);
  const resolved = await resolveAirableVideo(ctx.screenhostId, videoId, playedAt);
  if (!resolved) {
    log.warn(
      { event: eventType, videoId, screenhostId: ctx.screenhostId },
      'screen-ws: proof for a non-airable campaign ignored',
    );
    return { playId, status: 'rejected' };
  }

  const durationRaw = eventType === 'VIDEO_ENDED' ? asNumber(msg.data['played_duration_ms']) : null;
  const inserted = await db
    .insert(proofOfPlay)
    .values({
      screenId: ctx.screenId,
      screenhostId: ctx.screenhostId,
      campaignId: resolved.campaignId,
      creativeId: resolved.creativeId,
      videoIdAsSent: videoId,
      eventType,
      playedDurationMs: boundDurationMs(durationRaw, resolved.durationSeconds),
      eventTs: tsMs !== null ? new Date(tsMs) : null,
      receivedAt,
      playId,
      playedAt,
    })
    .onConflictDoNothing({
      target: [proofOfPlay.screenId, proofOfPlay.playId, proofOfPlay.eventType],
      where: sql`${proofOfPlay.playId} IS NOT NULL`,
    })
    .returning({ id: proofOfPlay.id });
  return { playId, status: inserted.length > 0 ? 'recorded' : 'duplicate' };
};

// Handle one parsed screen→server event. HEARTBEAT → liveness; VIDEO_STARTED/VIDEO_ENDED →
// proof-of-play (VIDEO_ENDED carries played_duration_ms — the binary "it aired" proof), returning its
// outcome for the PROOF_ACK; PLAYBACK_ERROR / STATUS_REPORT / other → logged. `receivedAt` is the
// server's receipt instant (injectable for deterministic tests).
export const handleScreenEvent = async (
  msg: ScreenEventMessage,
  ctx: ScreenContext,
  log: FastifyBaseLogger,
  receivedAt: Date = new Date(),
): Promise<ProofOutcome | null> => {
  switch (msg.event) {
    case 'HEARTBEAT':
      await db.update(screens).set({ lastSeenAt: receivedAt }).where(eq(screens.id, ctx.screenId));
      return null;
    case 'VIDEO_STARTED':
    case 'VIDEO_ENDED':
      return recordProof(msg, ctx, msg.event, log, receivedAt);
    default:
      log.info({ event: msg.event, screenId: ctx.screenId }, 'screen-ws event');
      return null;
  }
};
