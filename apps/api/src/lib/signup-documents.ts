import { randomUUID } from 'node:crypto';

import type { FastifyBaseLogger } from 'fastify';

import { db } from '../db/client.js';
import { userDocuments } from '../db/schema.js';
import { storage } from '../storage/s3-storage.js';

import { ALLOWED_DOCUMENT_MIME, CATEGORY_CAPS, type DocumentCategory } from './user-documents.js';

// ── The documents a new account attaches to POST /api/signup ─────────────────────────────────────
// A signup with documents posts multipart: a `payload` field (the signup JSON) + one named file part
// per file. Who may attach what:
// • Owners (R7/N4, reverses F5 for owners; CIN-2b 2026-09-12) — EVERY owner (individual_owner and
//   fleet_owner) may attach ONE RNE volet (`rne`) and ONE RIB volet (`bank`).
// • Screencasters — advertiser and agency (DOC-CAST1, ruling A 2026-09-22) — the RNE (`rne`, ≤ 2) and
//   the documents complémentaires (`complementaire`, ≤ 10): the CATEGORY_CAPS profile-documents
//   enforces. Before DOC-CAST1 they posted JSON and their « Documents » step's files were lost.
//
// SIGN-2 (operator ruling 2026-08-31) took the CIN volets out of signup, and CIN-HOST1 (2026-09-21)
// removed the CIN from every other surface too: no route uploads, lists or presigns a CIN any more
// (the rows already on file are kept, invisible). A part outside the kind's categories is ignored, so
// a stale client still signs up cleanly; its CIN parts are simply dropped, not rejected.
export type SignupFile = { buffer: Buffer; mimetype: string; filename: string };

/** One file part of the request, as it arrived (arrival order is kept). */
export type SignupFilePart = { field: string; file: SignupFile };

/** A part that will be stored: its category and its 1-based slot. */
export type SignupDocument = { category: DocumentCategory; position: number; file: SignupFile };

type SignupKind = 'owner' | 'screencaster';

export const signupKind = (profileType: string | undefined): SignupKind =>
  profileType === 'individual_owner' || profileType === 'fleet_owner' ? 'owner' : 'screencaster';

// The categories each kind may attach, with their slot count, in validation + storage order.
const SIGNUP_SLOTS: Readonly<Record<SignupKind, readonly (readonly [DocumentCategory, number])[]>> =
  {
    owner: [
      ['rne', 1],
      ['bank', 1],
    ],
    screencaster: [
      ['rne', CATEGORY_CAPS.rne],
      ['complementaire', CATEGORY_CAPS.complementaire],
    ],
  };

// More file parts than the kind's slots + 2 → 413 with NO account. The owner limit was the multipart
// plugin's `files: 4` (rne + bank + headroom for a stale client's CIN recto/verso); the screencaster
// limit keeps the same headroom over its 12 slots. The plugin itself is registered with the larger
// limit (it cannot know the kind before the payload is read), so the route re-checks per kind.
const FILE_PART_HEADROOM = 2;

export const signupFileLimit = (kind: SignupKind): number =>
  SIGNUP_SLOTS[kind].reduce((sum, [, slots]) => sum + slots, FILE_PART_HEADROOM);

export const MAX_SIGNUP_FILE_PARTS = Math.max(
  signupFileLimit('owner'),
  signupFileLimit('screencaster'),
);

// Surplus parts of a category are never refused: a later part supersedes an earlier one, exactly as
// a repeated owner volet always has (one slot → the last part wins). So each category keeps its LAST
// `slots` parts, numbered 1..n in arrival order.
export const slotSignupDocuments = (
  parts: readonly SignupFilePart[],
  kind: SignupKind,
): SignupDocument[] =>
  SIGNUP_SLOTS[kind].flatMap(([category, slots]) =>
    parts
      .filter((part) => part.field === category)
      .slice(-slots)
      .map((part, index) => ({ category, position: index + 1, file: part.file })),
  );

// Documents are OPTIONAL at signup (provide-later — Kais QA 2026-06-24): presence/completeness is an
// approval signal via documentPresence, NOT a signup-submit gate. So a missing or partial set is never
// rejected — only the MIME of a part that WILL be stored is validated (size is already capped by the
// multipart fileSize limit → 413 on parse). Mirrors profile-documents' MIME guard via the shared set.
// Returns the problems (empty = valid).
export const signupDocumentErrors = (
  documents: readonly SignupDocument[],
): { field: string; reason: string }[] =>
  documents
    .filter((doc) => !ALLOWED_DOCUMENT_MIME.has(doc.file.mimetype))
    .map((doc) => ({
      field: doc.category,
      reason: `unsupported content type: ${doc.file.mimetype}`,
    }));

// Persist one document AFTER account creation. Storage-FIRST so a row never references a missing
// object (the profile-documents no-orphan-key rule); on a row-insert failure, best-effort delete the
// object we just wrote so no orphan object lingers. Degraded, NEVER thrown: a failure leaves the
// document absent → the onboarding indicator (C1) shows incomplete → the user finishes via the
// post-signin /api/profile/documents path. Same storage key format + table as that path.
export const persistSignupDocument = async (
  userId: string,
  { category, position, file }: SignupDocument,
  log: FastifyBaseLogger,
): Promise<void> => {
  const rowId = randomUUID();
  const key = `${category}/${userId}/${rowId}`;
  const uploaded = await storage.upload({ key, body: file.buffer, contentType: file.mimetype });
  if ('error' in uploaded) {
    log.error({ userId, category, position }, 'signup document upload failed (degraded)');
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
    log.error({ userId, category, position, err }, 'signup document row insert failed (degraded)');
  }
};
