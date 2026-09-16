import { createHash, timingSafeEqual } from 'node:crypto';

import type { onRequestHookHandler } from 'fastify';

// S-T1 — service-key guard for the /api/internal/* surface (wedooh → toodooh). FACTORY form: it
// takes the expected key explicitly (not read from the env singleton) so tests pass a key directly,
// mirroring buildErrorHandler(env). When `expected` is undefined the sync is DISABLED → 503
// SYNC_DISABLED (never silently open). wedooh presents `Authorization: Bearer <WEDOOH_SYNC_KEY>`;
// the compare is timing-safe over sha-256 digests (fixed length — no early-exit length leak).
// HUB-413 — an onRequest hook, NOT a preHandler: it reads headers only, and onRequest is the one
// phase that runs BEFORE Fastify reads and parses the body. A 401/503 sent here ends the request
// unparsed, so a keyless caller cannot make the api buffer and JSON.parse a body (up to the route's
// bodyLimit — 20 MiB on the hub batch routes) before being turned away.
const sha256 = (value: string): Buffer => createHash('sha256').update(value).digest();

export const requireSyncKey =
  (expected: string | undefined): onRequestHookHandler =>
  async (request, reply) => {
    if (!expected) {
      return reply.status(503).send({
        error: 'SYNC_DISABLED',
        message: 'The sync integration is not configured.',
        statusCode: 503,
        requestId: request.id,
      });
    }
    const header = request.headers.authorization ?? '';
    const presented = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
    if (presented.length === 0 || !timingSafeEqual(sha256(presented), sha256(expected))) {
      return reply.status(401).send({
        error: 'UNAUTHENTICATED',
        message: 'Invalid or missing sync key.',
        statusCode: 401,
        requestId: request.id,
      });
    }
  };
