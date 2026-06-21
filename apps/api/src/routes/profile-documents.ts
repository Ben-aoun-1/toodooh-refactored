import { randomUUID } from 'node:crypto';

import multipart from '@fastify/multipart';
import { and, asc, eq } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';

import { db } from '../db/client.js';
import { userDocuments } from '../db/schema.js';
import {
  ALLOWED_DOCUMENT_MIME as ALLOWED_MIME,
  CATEGORY_CAPS,
  MAX_DOCUMENT_BYTES as MAX_FILE_BYTES,
  docView,
  groupedDocuments,
  isRowOwnedKey,
} from '../lib/user-documents.js';
import { requireAuth } from '../middleware/require-auth.js';
import { storage } from '../storage/s3-storage.js';

// Multi-document model (F-docs Commit 1). One user_documents row per upload; the legacy
// users.*_doc_url columns are FROZEN (never written here — backfilled by migration 0013).
// Categories + caps (Kais's ruling): cin ≤2 with SEMANTIC positions (1=recto, 2=verso —
// position REQUIRED), rne ≤2, complementaire ≤10, bank ≤1. Same-slot re-upload REPLACES.
// New uploads key as `<category>/<userId>/<rowId>` (stable per slot → S3 overwrite on
// replace); backfilled rows keep their legacy `<type>/<userId>` keys, and those objects
// are NEVER deleted (the frozen columns still reference them). MIME/size guards are shared
// with the owner signup volets (lib/user-documents.ts).

const categoryParamSchema = z.object({
  category: z.enum(['cin', 'rne', 'complementaire', 'bank']),
});
const idParamSchema = z.object({ id: z.uuid() });
// find-my-way requires one param NAME per segment position within a method — the two GET
// routes under /documents share `:ref` (a document uuid for /url, a legacy type otherwise).
const refUrlParamSchema = z.object({ ref: z.uuid() });
const refCompatParamSchema = z.object({ ref: z.enum(['rne', 'cin', 'bank']) });
// position rides the querystring (the multipart config stays fields:0, file-only).
const positionQuerySchema = z.object({ position: z.coerce.number().int().min(1).optional() });

// Legacy single-slot reads (`rne`/`cin`/`bank`) map onto the table as position 1 — the compat
// GET below keeps the pre-reshape web call sites (F1 bank read) working until they move.
const LEGACY_TYPE_TO_CATEGORY = { rne: 'rne', cin: 'cin', bank: 'bank' } as const;

const sendUnauthenticated = (reply: FastifyReply) =>
  reply.status(401).send({ error: 'UNAUTHENTICATED', message: 'Authentication required.' });

export const profileDocumentsRoutes: FastifyPluginAsync = async (app) => {
  // Framework-level guard: busboy stops at fileSize, so an oversized upload is never fully
  // buffered. Registered inside this plugin (fastify-plugin skip-override → decorates this
  // context) so the routes + their tests self-contain the multipart dependency.
  await app.register(multipart, {
    limits: { fileSize: MAX_FILE_BYTES, files: 1, fields: 0 },
  });

  // GET /api/profile/documents — every document the user has, grouped by category.
  app.get('/api/profile/documents', { preHandler: requireAuth }, async (request, reply) => {
    const userId = request.user?.id;
    if (!userId) return sendUnauthenticated(reply);

    const rows = await db
      .select()
      .from(userDocuments)
      .where(eq(userDocuments.userId, userId))
      .orderBy(asc(userDocuments.category), asc(userDocuments.position));
    return reply.status(200).send({ documents: groupedDocuments(rows) });
  });

  // POST /api/profile/documents/:category — single-file multipart upload into a slot.
  // ?position selects the slot: REQUIRED + semantic for cin (1=recto, 2=verso); optional
  // elsewhere (defaults to the lowest free slot). Same-slot re-upload replaces. The row is
  // written ONLY on a genuine StorageProvider success (no orphan key references).
  app.post(
    '/api/profile/documents/:category',
    { preHandler: requireAuth },
    async (request, reply) => {
      const parsedParams = categoryParamSchema.safeParse(request.params);
      if (!parsedParams.success) {
        return reply.status(400).send({
          error: 'INVALID_INPUT',
          message: 'Validation failed',
          fields: [{ field: 'category', reason: 'must be cin, rne, complementaire or bank' }],
        });
      }
      const parsedQuery = positionQuerySchema.safeParse(request.query);
      if (!parsedQuery.success) {
        return reply.status(400).send({
          error: 'INVALID_INPUT',
          message: 'Validation failed',
          fields: [{ field: 'position', reason: 'must be a positive integer' }],
        });
      }

      const userId = request.user?.id;
      if (!userId) return sendUnauthenticated(reply);

      const { category } = parsedParams.data;
      const cap = CATEGORY_CAPS[category];

      // cin slots are SEMANTIC (1=recto, 2=verso) — an implicit default would silently
      // mislabel a verso as a recto, so the caller must say which side it is.
      if (category === 'cin' && parsedQuery.data.position === undefined) {
        return reply.status(400).send({
          error: 'INVALID_INPUT',
          message: 'Validation failed',
          fields: [{ field: 'position', reason: 'cin requires position (1=recto, 2=verso)' }],
        });
      }
      if (parsedQuery.data.position !== undefined && parsedQuery.data.position > cap) {
        return reply.status(400).send({
          error: 'INVALID_INPUT',
          message: 'Validation failed',
          fields: [{ field: 'position', reason: `${category} allows positions 1-${cap}` }],
        });
      }

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

      const existing = await db
        .select()
        .from(userDocuments)
        .where(and(eq(userDocuments.userId, userId), eq(userDocuments.category, category)))
        .orderBy(asc(userDocuments.position));

      // Resolve the target slot: explicit position, else the lowest free one. A cap-1
      // category (bank) has only one possible slot, so an omitted position means slot 1 —
      // re-upload REPLACES, exactly the pre-reshape behavior the F1 web flow relies on.
      // Multi-slot categories 409 when full instead: silently overwriting an arbitrary
      // document would be destructive.
      let position = parsedQuery.data.position;
      if (position === undefined && cap === 1) position = 1;
      if (position === undefined) {
        const taken = new Set(existing.map((r) => r.position));
        for (let p = 1; p <= cap; p += 1) {
          if (!taken.has(p)) {
            position = p;
            break;
          }
        }
        if (position === undefined) {
          return reply.status(409).send({
            error: 'CATEGORY_FULL',
            message: `${category} already holds the maximum of ${cap} document(s). Delete one first.`,
          });
        }
      }

      const slotRow = existing.find((r) => r.position === position);

      // The slot's storage key is stable (`<category>/<userId>/<rowId>`): a replace is an S3
      // overwrite of the same key. A backfilled row migrates to a row-owned key on its first
      // replace; its legacy object is left untouched (the frozen column still points at it).
      const rowId = slotRow?.id ?? randomUUID();
      const key = `${category}/${userId}/${rowId}`;

      const result = await storage.upload({ key, body, contentType: data.mimetype });
      if ('error' in result) {
        // Storage failed → do NOT touch the table. User retries; no orphan key reference.
        return reply.status(502).send({
          error: 'STORAGE_ERROR',
          message: 'Document storage failed. Please retry.',
        });
      }

      const meta = {
        storageKey: key,
        originalFilename: data.filename,
        mimeType: data.mimetype,
        sizeBytes: body.length,
        uploadedAt: new Date(),
      };
      const [row] = slotRow
        ? await db
            .update(userDocuments)
            .set(meta)
            .where(eq(userDocuments.id, slotRow.id))
            .returning()
        : await db
            .insert(userDocuments)
            .values({ id: rowId, userId, category, position, ...meta })
            .returning();

      if (!row) {
        return reply
          .status(500)
          .send({ error: 'INTERNAL_ERROR', message: 'Document record write failed.' });
      }
      // `type`/`key` are DEPRECATED compat fields for the pre-reshape web call sites (the F1
      // bank hook reads `key`). Commit 2 moves the web onto `document`; drop them after.
      return reply
        .status(200)
        .send({ document: docView(row), type: category, key: row.storageKey });
    },
  );

  // GET /api/profile/documents/:ref/url — presign one document (by uuid) on demand (3600s
  // default). Owner-scoped: a foreign id is indistinguishable from a missing one (404).
  app.get(
    '/api/profile/documents/:ref/url',
    { preHandler: requireAuth },
    async (request, reply) => {
      const parsed = refUrlParamSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.status(400).send({
          error: 'INVALID_INPUT',
          message: 'Validation failed',
          fields: [{ field: 'id', reason: 'must be a uuid' }],
        });
      }
      const userId = request.user?.id;
      if (!userId) return sendUnauthenticated(reply);

      const [row] = await db
        .select()
        .from(userDocuments)
        .where(and(eq(userDocuments.id, parsed.data.ref), eq(userDocuments.userId, userId)))
        .limit(1);
      if (!row) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: 'No such document.' });
      }

      const result = await storage.getPresignedUrl({ key: row.storageKey });
      if ('error' in result) {
        return reply.status(502).send({
          error: 'STORAGE_ERROR',
          message: 'Could not generate a document URL. Please retry.',
        });
      }
      return reply.status(200).send({ url: result.url });
    },
  );

  // DELETE /api/profile/documents/:id — owner-scoped. Deletes the row; the MinIO object is
  // removed best-effort ONLY when row-owned (new-format key). Legacy backfilled objects stay.
  app.delete('/api/profile/documents/:id', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = idParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: [{ field: 'id', reason: 'must be a uuid' }],
      });
    }
    const userId = request.user?.id;
    if (!userId) return sendUnauthenticated(reply);

    const [row] = await db
      .delete(userDocuments)
      .where(and(eq(userDocuments.id, parsed.data.id), eq(userDocuments.userId, userId)))
      .returning();
    if (!row) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'No such document.' });
    }
    if (isRowOwnedKey(row)) {
      await storage.delete({ key: row.storageKey }).catch(() => undefined);
    }
    return reply.status(200).send({ deleted: true, id: row.id });
  });

  // GET /api/profile/documents/:category — COMPAT shim (pre-reshape web call sites: the F1
  // bank read, owner-settings rne/cin). Presigns the category's position-1 document, now read
  // from the table. Removed once the web moves to the grouped GET + per-id presign (Commit 2).
  app.get('/api/profile/documents/:ref', { preHandler: requireAuth }, async (request, reply) => {
    const parsedParams = refCompatParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: [{ field: 'type', reason: 'must be rne, cin or bank' }],
      });
    }
    const userId = request.user?.id;
    if (!userId) return sendUnauthenticated(reply);

    const category = LEGACY_TYPE_TO_CATEGORY[parsedParams.data.ref];
    const [row] = await db
      .select()
      .from(userDocuments)
      .where(
        and(
          eq(userDocuments.userId, userId),
          eq(userDocuments.category, category),
          eq(userDocuments.position, 1),
        ),
      )
      .limit(1);
    if (!row) {
      return reply.status(404).send({
        error: 'NOT_FOUND',
        message: `No ${category} document on file.`,
      });
    }

    const result = await storage.getPresignedUrl({ key: row.storageKey });
    if ('error' in result) {
      return reply.status(502).send({
        error: 'STORAGE_ERROR',
        message: 'Could not generate a document URL. Please retry.',
      });
    }
    return reply.status(200).send({ url: result.url });
  });
};
