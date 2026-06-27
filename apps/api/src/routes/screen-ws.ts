import websocket from '@fastify/websocket';
import type { FastifyPluginAsync } from 'fastify';

import { handleScreenEvent } from '../lib/playout/ingest.js';
import { computeScreenPlaylist } from '../lib/playout/playlist-service.js';
import { screenRegistry } from '../lib/playout/registry.js';
import { authenticateScreenWs } from '../lib/playout/ws-auth.js';
import { parseScreenEvent, serverMessage } from '../lib/playout/ws-protocol.js';

interface ScreenWsQuery {
  screen_id?: string;
  token?: string;
}

// Screen WebSocket (L-playout). Raw WS (matches toodooh-streamer / mock-server.js): the player
// connects to GET /ws/screen?screen_id=&token=. Authenticated on connect via the device-session
// token + screen ownership; a bad token closes 4401, an unowned screen 4403. On success the server
// sends CONNECTED (+ UPDATE_PLAYLIST in Commit 2), registers the socket, and ingests screen events.
export const screenWsRoutes: FastifyPluginAsync = async (app) => {
  await app.register(websocket);

  app.get('/ws/screen', { websocket: true }, async (socket, request) => {
    const { screen_id: screenIdParam, token } = request.query as ScreenWsQuery;
    const auth = await authenticateScreenWs(token, screenIdParam);
    if (!auth.ok) {
      socket.close(auth.closeCode, auth.reason);
      return;
    }
    const { screenId, screenhostId } = auth;

    screenRegistry.add(screenId, socket);

    // Attach the event listeners SYNCHRONOUSLY — before the playlist push (which awaits). Otherwise a
    // message the player sends right after CONNECTED could arrive before the listener is attached and
    // be dropped by ws (no buffering).
    socket.on('message', (raw: Buffer) => {
      const msg = parseScreenEvent(raw.toString());
      if (!msg) {
        request.log.warn('screen-ws: malformed message ignored');
        return;
      }
      void handleScreenEvent(msg, { screenId, screenhostId }, request.log).catch((err: unknown) =>
        request.log.warn({ err }, 'screen-ws: event handler error'),
      );
    });
    const cleanup = (): void => screenRegistry.remove(screenId, socket);
    socket.on('close', cleanup);
    socket.on('error', cleanup);

    socket.send(serverMessage('CONNECTED', null));

    // Push the screen's playlist on connect (derived from its screenhost's active dispatch
    // allocations → approved creatives → presigned MinIO urls). Live re-push on plan change is
    // deferred (V1: push on connect only).
    try {
      const playlist = await computeScreenPlaylist(screenhostId, new Date());
      socket.send(serverMessage('UPDATE_PLAYLIST', playlist));
    } catch (err) {
      request.log.warn({ err }, 'screen-ws: playlist push failed');
    }
  });
};
