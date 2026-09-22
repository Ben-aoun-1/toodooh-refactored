import { randomUUID } from 'node:crypto';

import type { FastifyBaseLogger } from 'fastify';

import { db } from '../db/client.js';
import { userDocuments } from '../db/schema.js';
import { storage } from '../storage/s3-storage.js';

import { ALLOWED_DOCUMENT_MIME } from './user-documents.js';

// ── R7/N4 — owner signup document volets (reverses F5 for owners) ──────────────────────────────
// Owners post multipart: a `payload` field (the signup JSON) + the volet files. CIN-2b (2026-09-12):
// EVERY owner (individual_owner and fleet_owner) may attach its RNE (`rne`) and its RIB (`bank`).
// Advertisers/agencies still post JSON and submit no documents.
//
// SIGN-2 (operator ruling 2026-08-31) took the CIN volets out of signup, and CIN-HOST1 (2026-09-21)
// removed the CIN from every other surface too: no route uploads, lists or presigns a CIN any more
// (the rows already on file are kept, invisible). An unknown file part is ignored by the parser in
// routes/signup.ts, so a stale client still signs up cleanly; its CIN parts are simply dropped, not
// rejected.
export type VoletFile = { buffer: Buffer; mimetype: string; filename: string };

export const VOLET_FIELDS = ['rne', 'bank'] as const;
export type VoletField = (typeof VOLET_FIELDS)[number];
export const isVoletField = (name: string): name is VoletField =>
  (VOLET_FIELDS as readonly string[]).includes(name);

export const isOwnerType = (t: string | undefined): boolean =>
  t === 'individual_owner' || t === 'fleet_owner';

// Owner documents are OPTIONAL at signup (provide-later — Kais QA 2026-06-24): presence/completeness
// is an approval signal via documentPresence, NOT a signup-submit gate. So we never reject a missing
// or partial volet — only the MIME of an ATTACHED file is validated (size is already capped by the
// multipart fileSize limit → 413 on parse). Mirrors profile-documents' MIME guard via the shared set.
// Returns the problems (empty = valid).
export const attachedVoletErrors = (
  files: Partial<Record<VoletField, VoletFile>>,
): { field: string; reason: string }[] => {
  const errs: { field: string; reason: string }[] = [];
  for (const field of VOLET_FIELDS) {
    const file = files[field];
    if (file && !ALLOWED_DOCUMENT_MIME.has(file.mimetype)) {
      errs.push({ field, reason: `unsupported content type: ${file.mimetype}` });
    }
  }
  return errs;
};

// Persist one volet AFTER account creation. Storage-FIRST so a row never references a missing object
// (the profile-documents no-orphan-key rule); on a row-insert failure, best-effort delete the object
// we just wrote so no orphan object lingers. Degraded, NEVER thrown: a failure leaves the volet absent
// → the onboarding indicator (C1) shows incomplete → the user finishes via the post-signin
// /api/profile/documents path. Same storage key format + table as that path (no new storage path).
export const persistVolet = async (
  userId: string,
  category: VoletField,
  position: number,
  file: VoletFile,
  log: FastifyBaseLogger,
): Promise<void> => {
  const rowId = randomUUID();
  const key = `${category}/${userId}/${rowId}`;
  const uploaded = await storage.upload({ key, body: file.buffer, contentType: file.mimetype });
  if ('error' in uploaded) {
    log.error({ userId, category, position }, 'signup volet upload failed (degraded)');
    return;
  }
  try {
    await db.insert(userDocuments).values({
      // The row id MUST equal the UUID embedded in storageKey (<cat>/<uid>/<rowId>) so isRowOwnedKey
      // holds — else a later DELETE/REPLACE via /api/profile/documents skips storage.delete and
      // orphans the object. Mirrors profile-documents.ts's `.values({ id: rowId, ... })`.
      id: rowId,
      userId,
      category,
      position,
      storageKey: key,
      originalFilename: file.filename,
      mimeType: file.mimetype,
      sizeBytes: file.buffer.length,
    });
  } catch (err) {
    // The row didn't land — drop the object we just wrote so it isn't orphaned in MinIO.
    await storage.delete({ key }).catch(() => undefined);
    log.error({ userId, category, position, err }, 'signup volet row insert failed (degraded)');
  }
};
