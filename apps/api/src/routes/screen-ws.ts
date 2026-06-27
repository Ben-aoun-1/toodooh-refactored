import websocket from '@fastify/websocket';
import type { FastifyPluginAsync } from 'fastify';

import { handleScreenEvent } from '../lib/playout/ingest.js';
import { computeScreenPlaylist } from '../lib/playout/playlist-service.js';
import { createRateLimiter } from '../lib/playout/rate-limiter.js';
import { screenRegistry } from '../lib/playout/registry.js';
import { authenticateScreenWs } from '../lib/playout/ws-auth.js';
import { parseScreenEvent, serverMessage } from '../lib/playout/ws-protocol.js';

interface ScreenWsQuery {
  screen_id?: string;
  token?: string;
}

// Per-socket inbound limits (a public, billing-adjacent surface). A real screen sends a heartbeat
// every few seconds plus occasional play events — 20/s is generous; a sustained flood past 100/s
// closes the socket (4429).
const MSG_RATE_MAX_PER_SEC = 20;
const MSG_RATE_CLOSE_AT = 100;
const WS_CLOSE_RATE_LIMIT = 4429;
const WS_CLOSE_INTERNAL = 1011;

// Screen WebSocket (L-playout). Raw WS (matches toodooh-streamer / mock-server.js): the player
// connects to GET /ws/screen?screen_id=&token=. Authenticated on connect via the device-session
// token + screen ownership; a bad token closes 4401, an unowned screen 4403, a server/DB error 1011.
// On success the server sends CONNECTED + UPDATE_PLAYLIST, registers the socket, and ingests events.
// logLevel:'silent' keeps the token-bearing query string out of the request log (see also the
// logger's redacting req serializer).
export const screenWsRoutes: FastifyPluginAsync = async (app) => {
  await app.register(websocket);

  app.get('/ws/screen', { websocket: true, logLevel: 'silent' }, async (socket, request) => {
    const { screen_id: screenIdParam, token } = request.query as ScreenWsQuery;

    let auth;
    try {
      auth = await authenticateScreenWs(token, screenIdParam);
    } catch (err) {
      request.log.error({ err }, 'screen-ws: auth error');
      socket.close(WS_CLOSE_INTERNAL, 'internal error');
      return;
    }
    if (!auth.ok) {
      socket.close(auth.closeCode, auth.reason);
      return;
    }
    const { screenId, screenhostId } = auth;

    screenRegistry.add(screenId, socket);

    // Attach the event listeners SYNCHRONOUSLY — before the playlist push (which awaits). Otherwise a
    // message the player sends right after CONNECTED could arrive before the listener is attached and
    // be dropped by ws (no buffering).
    const limiter = createRateLimiter({
      maxPerWindow: MSG_RATE_MAX_PER_SEC,
      closeAt: MSG_RATE_CLOSE_AT,
    });
    socket.on('message', (raw: Buffer) => {
      const verdict = limiter.hit();
      if (verdict === 'close') {
        request.log.warn({ screenId }, 'screen-ws: inbound flood — closing');
        socket.close(WS_CLOSE_RATE_LIMIT, 'rate limit exceeded');
        return;
      }
      if (verdict === 'drop') return; // over the per-second cap — silently drop
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

    // Push the screen's playlist on connect (the shared airability gate → presigned MinIO urls).
    // Live re-push on plan change is deferred (V1: push on connect only).
    try {
      const playlist = await computeScreenPlaylist(screenhostId, new Date());
      socket.send(serverMessage('UPDATE_PLAYLIST', playlist));
    } catch (err) {
      request.log.warn({ err }, 'screen-ws: playlist push failed');
    }
  });
};
