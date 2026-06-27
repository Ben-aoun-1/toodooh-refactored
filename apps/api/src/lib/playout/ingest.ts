import { and, eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { z } from 'zod';

import { db } from '../../db/client.js';
import {
  campaignDispatchAllocation,
  campaignDispatchPlan,
  campaigns,
  proofOfPlay,
  screens,
} from '../../db/schema.js';

import { type ScreenEventMessage } from './ws-protocol.js';

export interface ScreenContext {
  screenId: string;
  screenhostId: string;
}

const asString = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const asNumber = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

// Resolve the played video_id (= the campaign id we sent) back to the campaign + creative — but ONLY
// if that campaign is actually dispatch-allocated to this screen's screenhost (defensive: never
// record proof for a campaign this screen wasn't serving). Then persist the proof row. Unresolvable
// or malformed events are logged + ignored (the proof_of_play substrate stays clean for L-redisp).
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

  const [resolved] = await db
    .select({ campaignId: campaigns.id, creativeId: campaigns.creativeId })
    .from(campaignDispatchAllocation)
    .innerJoin(campaignDispatchPlan, eq(campaignDispatchAllocation.planId, campaignDispatchPlan.id))
    .innerJoin(campaigns, eq(campaignDispatchPlan.campaignId, campaigns.id))
    .where(
      and(eq(campaignDispatchAllocation.screenhostId, ctx.screenhostId), eq(campaigns.id, videoId)),
    )
    .limit(1);
  if (!resolved || !resolved.creativeId) {
    log.warn(
      { event: eventType, videoId, screenhostId: ctx.screenhostId },
      'screen-ws: proof for an unallocated / creative-less campaign ignored',
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
    playedDurationMs: durationRaw !== null && durationRaw >= 0 ? durationRaw : null,
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
