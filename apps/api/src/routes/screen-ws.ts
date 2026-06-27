import websocket from '@fastify/websocket';
import type { FastifyPluginAsync } from 'fastify';

import { handleScreenEvent } from '../lib/playout/ingest.js';
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
    socket.send(serverMessage('CONNECTED', null));
    // (Commit 2) push UPDATE_PLAYLIST here, and on a STATUS_REQUEST event.

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
  });
};
