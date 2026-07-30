import { eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';

import { db } from '../../db/client.js';
import { campaignDispatchAllocation, campaignDispatchPlan, screens } from '../../db/schema.js';

import { computeScreenPlaylist } from './playlist-service.js';
import { screenRegistry } from './registry.js';
import { serverMessage } from './ws-protocol.js';

// CF-HF4 — the live playlist re-push. V1 pushed only on socket CONNECT, so a screen aired a
// stale playlist until its next reconnect. The three producers of airable change now re-push:
// an owner's ACCEPTE flip, campaign activation, and the boost append. Same protocol, same
// message (UPDATE_PLAYLIST — no new types), same computeScreenPlaylist truth as the connect
// path. Idempotent by construction (the playlist is recomputed whole); a dead socket only
// warns — a push can never break the flip that triggered it.

/**
 * Recompute the venue's playlist and send it to EVERY connected socket of the venue's screens.
 * No connected socket → no-op (0). Send failures warn per socket and never throw.
 */
export const pushPlaylistToVenue = async (
  screenhostId: string,
  log?: FastifyBaseLogger,
): Promise<number> => {
  const venueScreens = await db
    .select({ id: screens.id })
    .from(screens)
    .where(eq(screens.screenhostId, screenhostId));
  const sockets = venueScreens.flatMap((s) => screenRegistry.get(s.id));
  if (sockets.length === 0) return 0;
  const playlist = await computeScreenPlaylist(screenhostId, new Date());
  let sent = 0;
  for (const socket of sockets) {
    try {
      socket.send(serverMessage('UPDATE_PLAYLIST', playlist));
      sent += 1;
    } catch (err) {
      log?.warn({ err, screenhostId }, 'playlist re-push failed for a socket');
    }
  }
  return sent;
};

/** Re-push every venue holding an allocation of the campaign (activation / boost append). */
export const pushPlaylistToCampaignVenues = async (
  campaignId: string,
  log?: FastifyBaseLogger,
): Promise<void> => {
  const rows = await db
    .selectDistinct({ screenhostId: campaignDispatchAllocation.screenhostId })
    .from(campaignDispatchAllocation)
    .innerJoin(campaignDispatchPlan, eq(campaignDispatchAllocation.planId, campaignDispatchPlan.id))
    .where(eq(campaignDispatchPlan.campaignId, campaignId));
  for (const r of rows) {
    try {
      await pushPlaylistToVenue(r.screenhostId, log);
    } catch (err) {
      log?.warn({ err, screenhostId: r.screenhostId }, 'campaign playlist re-push failed');
    }
  }
};
