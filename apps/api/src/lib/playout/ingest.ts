import { eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';

import { db } from '../../db/client.js';
import { screens } from '../../db/schema.js';

import { type ScreenEventMessage } from './ws-protocol.js';

export interface ScreenContext {
  screenId: string;
  screenhostId: string;
}

// Handle one parsed screen→server event. Defensive: any failure is logged by the caller, never
// thrown to the socket. Commit 1 handles HEARTBEAT (liveness via screens.last_seen_at); the
// VIDEO_STARTED/VIDEO_ENDED proof-of-play ingest lands in Commit 3.
export const handleScreenEvent = async (
  msg: ScreenEventMessage,
  ctx: ScreenContext,
  log: FastifyBaseLogger,
): Promise<void> => {
  switch (msg.event) {
    case 'HEARTBEAT':
      await db.update(screens).set({ lastSeenAt: new Date() }).where(eq(screens.id, ctx.screenId));
      return;
    default:
      log.info({ event: msg.event, screenId: ctx.screenId }, 'screen-ws event');
      return;
  }
};
