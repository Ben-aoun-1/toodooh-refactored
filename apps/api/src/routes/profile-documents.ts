import multipart from '@fastify/multipart';
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { db } from '../db/client.js';
import { users } from '../db/schema.js';
import { requireAuth } from '../middleware/require-auth.js';
import { storage } from '../storage/s3-storage.js';

// RNE (company registry) → registration_doc_url; CIN (individual ID) → cin_doc_url; BANK
// (relevé d'identité bancaire, QA-fix lane) → bank_doc_url. The columns hold the STORAGE KEY
// (`rne/<userId>` | `cin/<userId>` | `bank/<userId>`), NOT a presigned URL — presigned URLs
// expire (Commit-2 decision). The "_url" column names are cosmetically wrong (they hold keys);
// not worth a rename migration.
const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB — matches the frontend cap (signup + owner-settings)
const ALLOWED_MIME = new Set(['application/pdf', 'image/jpeg', 'image/png']);

const typeParamSchema = z.object({ type: z.enum(['rne', 'cin', 'bank']) });

const DOC_COLUMN = {
  rne: 'registrationDocUrl',
  cin: 'cinDocUrl',
  bank: 'bankDocUrl',
} as const;

export const profileDocumentsRoutes: FastifyPluginAsync = async (app) => {
  // Framework-level guard: busboy stops at fileSize, so an oversized upload is never fully
  // buffered. Registered inside this plugin (fastify-plugin skip-override → decorates this
  // context) so the routes + their tests self-contain the multipart dependency.
  await app.register(multipart, {
    limits: { fileSize: MAX_FILE_BYTES, files: 1, fields: 0 },
  });

  // POST /api/profile/documents/:type — single-file multipart upload. type in the PATH
  // (symmetric with the GET; order-independent vs a multipart field). The column gets the key
  // ONLY on a genuine StorageProvider success (no orphan key references).
  app.post('/api/profile/documents/:type', { preHandler: requireAuth }, async (request, reply) => {
    const parsedParams = typeParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: [{ field: 'type', reason: 'must be rne, cin or bank' }],
      });
    }

    const userId = request.user?.id;
    if (!userId) {
      return reply
        .status(401)
        .send({ error: 'UNAUTHENTICATED', message: 'Authentication required.' });
    }

    const { type } = parsedParams.data;

    const data = await request.file();
    if (!data) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: [{ field: 'file', reason: 'a file is required' }],
      });
    }

    // Drain the stream (toBuffer) BEFORE MIME validation — avoids a hung request. The
    // fileSize limit makes toBuffer throw (throwFileSizeLimit default) on oversize → 413.
    let body: Buffer;
    try {
      body = await data.toBuffer();
    } catch {
      return reply.status(413).send({
        error: 'PAYLOAD_TOO_LARGE',
        message: `File exceeds the ${MAX_FILE_BYTES}-byte limit.`,
      });
    }
    if (data.file.truncated) {
      return reply.status(413).send({
        error: 'PAYLOAD_TOO_LARGE',
        message: `File exceeds the ${MAX_FILE_BYTES}-byte limit.`,
      });
    }
    if (!ALLOWED_MIME.has(data.mimetype)) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: [{ field: 'file', reason: `unsupported content type: ${data.mimetype}` }],
      });
    }

    const key = `${type}/${userId}`;
    const result = await storage.upload({ key, body, contentType: data.mimetype });
    if ('error' in result) {
      // Storage failed → do NOT touch the column. User retries; no orphan key reference.
      return reply.status(502).send({
        error: 'STORAGE_ERROR',
        message: 'Document storage failed. Please retry.',
      });
    }

    await db
      .update(users)
      .set({ [DOC_COLUMN[type]]: key })
      .where(eq(users.id, userId));

    return reply.status(200).send({ type, key });
  });

  // GET /api/profile/documents/:type — presign the stored key on demand (3600s default). 404
  // if the user has no document of that type. Own-documents-only (userId from the guard).
  app.get('/api/profile/documents/:type', { preHandler: requireAuth }, async (request, reply) => {
    const parsedParams = typeParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: [{ field: 'type', reason: 'must be rne, cin or bank' }],
      });
    }

    const userId = request.user?.id;
    if (!userId) {
      return reply
        .status(401)
        .send({ error: 'UNAUTHENTICATED', message: 'Authentication required.' });
    }

    const { type } = parsedParams.data;

    const [row] = await db
      .select({
        registrationDocUrl: users.registrationDocUrl,
        cinDocUrl: users.cinDocUrl,
        bankDocUrl: users.bankDocUrl,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const key = row?.[DOC_COLUMN[type]];
    if (!key) {
      return reply.status(404).send({
        error: 'NOT_FOUND',
        message: `No ${type} document on file.`,
      });
    }

    const result = await storage.getPresignedUrl({ key });
    if ('error' in result) {
      return reply.status(502).send({
        error: 'STORAGE_ERROR',
        message: 'Could not generate a document URL. Please retry.',
      });
    }
    return reply.status(200).send({ url: result.url });
  });
};
