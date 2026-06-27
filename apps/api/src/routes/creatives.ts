import { randomUUID } from 'node:crypto';

import multipart from '@fastify/multipart';
import { and, desc, eq } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';

import { db } from '../db/client.js';
import { creatives } from '../db/schema.js';
import {
  MAX_CREATIVE_BYTES,
  creativeView,
  isValidDuration,
  mimeAllowedForKind,
} from '../lib/creatives.js';
import { requireAdvertiser } from '../middleware/require-advertiser.js';
import { requireAuth } from '../middleware/require-auth.js';
import { storage } from '../storage/s3-storage.js';

// Advertiser creative library (L-spot) — greenfield. An advertiser uploads a VIDEO or PHOTO
// creative; the object lands in MinIO under creatives/<advertiserId>/<creativeId> (the KEY is
// persisted, presigned on read — never a stored URL). storage-first / no-orphan: the row is written
// ONLY on a genuine storage success. Every read is owner-scoped to the authenticated advertiser
// (a foreign id is indistinguishable from a missing one → 404, never a leak). Admin moderation +
// the campaign's DERIVED content-gate live in routes/admin-creatives.ts + routes/campaigns.ts.

const idParamSchema = z.object({ id: z.uuid() });

// Scalars ride the querystring (the multipart body stays file-only, fields:0 — the house pattern
// from profile-documents). type + duration_seconds are required; title is optional.
const uploadQuerySchema = z.object({
  type: z.enum(['video', 'photo']),
  duration_seconds: z.coerce.number().int(),
  title: z.string().min(1).max(200).optional(),
});

const sendUnauthenticated = (reply: FastifyReply) =>
  reply.status(401).send({ error: 'UNAUTHENTICATED', message: 'Authentication required.' });

const invalidField = (reply: FastifyReply, field: string, reason: string) =>
  reply
    .status(400)
    .send({ error: 'INVALID_INPUT', message: 'Validation failed', fields: [{ field, reason }] });

export const creativesRoutes: FastifyPluginAsync = async (app) => {
  // Framework-level guard: busboy stops at fileSize, so an oversized upload is never fully buffered.
  await app.register(multipart, {
    limits: { fileSize: MAX_CREATIVE_BYTES, files: 1, fields: 0 },
  });

  const advertiserGuard = { preHandler: [requireAuth, requireAdvertiser] };

  // POST /api/creatives?type=video&duration_seconds=25[&title=] — single-file multipart upload.
  // The row is written ONLY on a genuine storage success (no orphan key references).
  app.post('/api/creatives', advertiserGuard, async (request, reply) => {
    const parsedQuery = uploadQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: parsedQuery.error.issues.map((i) => ({
          field: i.path.join('.'),
          reason: i.message,
        })),
      });
    }
    const { type, duration_seconds: durationSeconds, title } = parsedQuery.data;

    // Duration bound (server-side, on the stored value): video ≤ 30s; photo ∈ {10,20,30}.
    if (!isValidDuration(type, durationSeconds)) {
      return invalidField(
        reply,
        'duration_seconds',
        type === 'video'
          ? 'a video creative must be 1-30 seconds'
          : 'a photo creative duration must be 10, 20 or 30 seconds',
      );
    }

    const userId = request.user?.id;
    if (!userId) return sendUnauthenticated(reply);

    const data = await request.file();
    if (!data) return invalidField(reply, 'file', 'a file is required');

    // Drain the stream BEFORE MIME validation — avoids a hung request. The fileSize limit makes
    // toBuffer throw (throwFileSizeLimit default) on oversize → 413.
    let body: Buffer;
    try {
      body = await data.toBuffer();
    } catch {
      return reply
        .status(413)
        .send({
          error: 'PAYLOAD_TOO_LARGE',
          message: `File exceeds the ${MAX_CREATIVE_BYTES}-byte limit.`,
        });
    }
    if (data.file.truncated) {
      return reply
        .status(413)
        .send({
          error: 'PAYLOAD_TOO_LARGE',
          message: `File exceeds the ${MAX_CREATIVE_BYTES}-byte limit.`,
        });
    }
    if (!mimeAllowedForKind(type, data.mimetype)) {
      return invalidField(
        reply,
        'file',
        `unsupported content type for a ${type} creative: ${data.mimetype}`,
      );
    }

    const creativeId = randomUUID();
    const key = `creatives/${userId}/${creativeId}`;

    const result = await storage.upload({ key, body, contentType: data.mimetype });
    if ('error' in result) {
      // Storage failed → do NOT touch the table. Advertiser retries; no orphan key reference.
      return reply
        .status(502)
        .send({ error: 'STORAGE_ERROR', message: 'Creative storage failed. Please retry.' });
    }

    const [row] = await db
      .insert(creatives)
      .values({
        id: creativeId,
        advertiserId: userId,
        creativeType: type,
        title: title ?? null,
        storageKey: key,
        durationSeconds,
        mimeType: data.mimetype,
        originalFilename: data.filename,
        sizeBytes: body.length,
      })
      .returning();
    if (!row) {
      return reply
        .status(500)
        .send({ error: 'INTERNAL_ERROR', message: 'Creative record write failed.' });
    }
    return reply.status(201).send(creativeView(row));
  });

  // GET /api/creatives/mine — the caller's own creatives, newest first.
  app.get('/api/creatives/mine', advertiserGuard, async (request, reply) => {
    const userId = request.user?.id;
    if (!userId) return sendUnauthenticated(reply);
    const rows = await db
      .select()
      .from(creatives)
      .where(eq(creatives.advertiserId, userId))
      .orderBy(desc(creatives.createdAt));
    return reply.status(200).send(rows.map(creativeView));
  });

  // GET /api/creatives/:id — owner-scoped read (404 on a foreign or missing id).
  app.get('/api/creatives/:id', advertiserGuard, async (request, reply) => {
    const parsed = idParamSchema.safeParse(request.params);
    if (!parsed.success) return invalidField(reply, 'id', 'must be a uuid');
    const userId = request.user?.id;
    if (!userId) return sendUnauthenticated(reply);
    const [row] = await db
      .select()
      .from(creatives)
      .where(and(eq(creatives.id, parsed.data.id), eq(creatives.advertiserId, userId)))
      .limit(1);
    if (!row) return reply.status(404).send({ error: 'NOT_FOUND', message: 'No such creative.' });
    return reply.status(200).send(creativeView(row));
  });

  // GET /api/creatives/:id/url — presign the object on demand (owner-scoped, 404 on foreign).
  app.get('/api/creatives/:id/url', advertiserGuard, async (request, reply) => {
    const parsed = idParamSchema.safeParse(request.params);
    if (!parsed.success) return invalidField(reply, 'id', 'must be a uuid');
    const userId = request.user?.id;
    if (!userId) return sendUnauthenticated(reply);
    const [row] = await db
      .select({ storageKey: creatives.storageKey })
      .from(creatives)
      .where(and(eq(creatives.id, parsed.data.id), eq(creatives.advertiserId, userId)))
      .limit(1);
    if (!row) return reply.status(404).send({ error: 'NOT_FOUND', message: 'No such creative.' });
    const result = await storage.getPresignedUrl({ key: row.storageKey });
    if ('error' in result) {
      return reply
        .status(502)
        .send({
          error: 'STORAGE_ERROR',
          message: 'Could not generate a creative URL. Please retry.',
        });
    }
    return reply.status(200).send({ url: result.url });
  });
};
