import { and, asc, desc, eq, inArray, notInArray } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { emailSender } from '../auth/auth.js';
import { db } from '../db/client.js';
import {
  type User,
  screenhosts,
  sessions,
  userBankDetailsAudit,
  userDocuments,
  users,
} from '../db/schema.js';
import {
  rejectionEmailPlainText,
  rejectionEmailSubject,
  rejectionEmailTemplate,
} from '../email/rejection-template.js';
import { toProfileType } from '../lib/profile-type.js';
import { OWNER_ROLES, createMissingScreensForOwner } from '../lib/screens.js';
import {
  type DocumentCategory,
  type DocumentPresence,
  documentPresence,
  groupedDocuments,
} from '../lib/user-documents.js';
import { pushApprovedOwnerLocations } from '../lib/wedooh-sync.js';
import { requireAdmin, requireAuth } from '../middleware/require-auth.js';
import { storage } from '../storage/s3-storage.js';

// Every admin route runs the keystone first, then the role gate (require-auth.ts):
// requireAuth → 401 on no session; requireAdmin → 403 on a non-admin authenticated user.
const adminGuard = { preHandler: [requireAuth, requireAdmin] };

const listQuerySchema = z.object({ status: z.enum(['pending', 'approved', 'rejected']) });
const idParamSchema = z.object({ id: z.uuid() });
// The two GET routes under /:id/documents share the `:ref` segment (find-my-way allows one
// param name per position): a legacy type for the compat presign, a document uuid for /url.
// `bank` rides the same compat path (F6 — the admin bank-details card presigns type=bank).
const docTypeParamSchema = z.object({ id: z.uuid(), ref: z.enum(['rne', 'cin', 'bank']) });
const docIdParamSchema = z.object({ id: z.uuid(), ref: z.uuid() });
// Approve notes are optional (an admin may approve without comment); reject notes are required
// non-empty (D-G1-4 — a rejection benefits from feedback; the rebuild establishes the contract
// the dead-Supabase FE lacked, CF-24 class-b).
const approveBodySchema = z.object({ notes: z.string().optional() });
// N3 Scenario 1 — a rejection must name at least one deficient document area: 'legal' (RNE/CIN)
// and/or 'bank' (RIB). Persisted to users.rejection_topics (text[]); the user is notified by email.
const rejectionTopic = z.enum(['legal', 'bank']);
const rejectBodySchema = z.object({
  notes: z.string().trim().min(1),
  topics: z.array(rejectionTopic).min(1),
});
// N3 Scenario 2 (fraud) — BANIR. A non-empty reason is required (stored in the trio's validationNotes).
const banBodySchema = z.object({ notes: z.string().trim().min(1) });

// The snake_case admin view G2 renders: the /api/me projection (identity + business profile)
// + created_at + the validation trio. The trio is single-state — it describes the CURRENT
// status's validation context, not multi-state history (D4 ruled out an action-log).
// Document presence per user, read from user_documents (F-docs Commit 1 — the users.*_doc_url
// columns are frozen). Batch query: the moderation list maps many users in one round-trip.
const documentsPresenceFor = async (userIds: string[]): Promise<Map<string, DocumentPresence>> => {
  const presence = new Map<string, DocumentPresence>();
  if (userIds.length === 0) return presence;
  const rows = await db
    .select({
      userId: userDocuments.userId,
      category: userDocuments.category,
      position: userDocuments.position,
    })
    .from(userDocuments)
    .where(inArray(userDocuments.userId, userIds));
  // Group each user's documents, then derive presence per user: CIN counts complete only when BOTH
  // faces are on file (recto + verso), so the rule needs the whole document set, not a per-row flag.
  const byUser = new Map<string, { category: DocumentCategory; position: number }[]>();
  for (const row of rows) {
    const list = byUser.get(row.userId) ?? [];
    list.push({ category: row.category, position: row.position });
    byUser.set(row.userId, list);
  }
  for (const [userId, docs] of byUser) presence.set(userId, documentPresence(docs));
  return presence;
};

const NO_DOCUMENTS: DocumentPresence = { registration: false, cin: false, bank: false };

// A screenhost's WiFi state for the admin user-info view. The password is WRITE-ONLY: only its
// presence (wifi_password_set) ever crosses the wire — the cipher/plaintext never does (parallel
// to routes/screenhosts.ts wifiView; the editable counterpart is PATCH /api/admin/screenhosts/:id/wifi).
interface ScreenhostWifiView {
  id: string;
  name: string;
  wifi_ssid: string | null;
  wifi_password_set: boolean;
}

const NO_SCREENHOSTS: ScreenhostWifiView[] = [];

// Batch-load each user's screenhosts (WiFi-redacted), grouped by owner id — one round-trip for the
// moderation list, mirroring documentsPresenceFor. Selects only what the view needs; the encrypted
// password is read solely to derive the boolean and is never returned.
const screenhostsFor = async (userIds: string[]): Promise<Map<string, ScreenhostWifiView[]>> => {
  const byOwner = new Map<string, ScreenhostWifiView[]>();
  if (userIds.length === 0) return byOwner;
  const rows = await db
    .select({
      id: screenhosts.id,
      name: screenhosts.name,
      ownerId: screenhosts.ownerId,
      wifiSsid: screenhosts.wifiSsid,
      wifiPasswordEncrypted: screenhosts.wifiPasswordEncrypted,
    })
    .from(screenhosts)
    .where(inArray(screenhosts.ownerId, userIds))
    .orderBy(asc(screenhosts.name));
  for (const row of rows) {
    if (row.ownerId === null) continue;
    const list = byOwner.get(row.ownerId) ?? [];
    list.push({
      id: row.id,
      name: row.name,
      wifi_ssid: row.wifiSsid,
      wifi_password_set: row.wifiPasswordEncrypted !== null,
    });
    byOwner.set(row.ownerId, list);
  }
  return byOwner;
};

const toAdminUserView = (
  row: User,
  documents = NO_DOCUMENTS,
  screenhostsView: ScreenhostWifiView[] = NO_SCREENHOSTS,
) => ({
  id: row.id,
  email: row.email,
  email_verified: row.emailVerified,
  role: row.role,
  status: row.status,
  onboarding_completed: row.onboardingCompleted,
  profile_type: toProfileType(row.role, row.businessType),
  contact_name: row.contactName,
  business_name: row.businessName,
  business_type: row.businessType,
  tax_number: row.taxNumber,
  contact_phone: row.contactPhone,
  fonction: row.fonction,
  business_sector_id: row.businessSectorId,
  street_address: row.streetAddress,
  city: row.city,
  postal_code: row.postalCode,
  governorate_id: row.governorateId,
  zone: row.zone,
  agent_code: row.agentCode,
  // F6 (Kais QA 2026-06-11): the admin user-info view shows a screenhost's bank details —
  // snake_case mirroring the /api/me projection, not the camelCase PATCH /api/profile/bank body.
  bank_account_holder: row.bankAccountHolder,
  bank_rib: row.bankRib,
  bank_iban: row.bankIban,
  bank_details_updated_at: row.bankDetailsUpdatedAt,
  documents,
  // The owner's screenhosts (WiFi-redacted) for the admin "WiFi du lieu" editor. [] for non-owners.
  screenhosts: screenhostsView,
  created_at: row.createdAt,
  validated_by: row.validatedBy,
  validated_at: row.validatedAt,
  validation_notes: row.validationNotes,
});

// Shaped 409 for a same-state repeat (approve-an-approved / reject-a-rejected). Carries the prior
// validation context so G2 can show "already approved on <date> by <admin>" (D-G1-6).
const sendAlreadyInState = (reply: FastifyReply, request: FastifyRequest, row: User): void => {
  void reply.status(409).send({
    error: 'CONFLICT',
    message: `User already ${row.status}.`,
    statusCode: 409,
    requestId: request.id,
    currentStatus: row.status,
    validatedBy: row.validatedBy,
    validatedAt: row.validatedAt,
    validationNotes: row.validationNotes,
  });
};

export const adminRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/admin/users?status=pending|approved|rejected — the moderation queue for END-USERS.
  // Single-table select on users (the dual-identity collapse: no business_profiles/documents join).
  // status is REQUIRED (no surprise all-users dump); sort by created_at DESC (the UI's "Inscription"
  // column). Internal accounts (admin/superadmin seeded via create-admin; agent roles created via
  // POST /api/admin/accounts — all pre-approved) are NOT in the moderation queue — the endpoint's
  // semantic is "end-users awaiting/with a decision", so they are excluded (the dead-Supabase
  // consumer filtered admin_profiles the same way).
  app.get('/api/admin/users', adminGuard, async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        statusCode: 400,
        requestId: request.id,
        fields: parsed.error.issues.map((i) => ({ field: i.path.join('.'), reason: i.message })),
      });
    }

    const rows = await db
      .select()
      .from(users)
      .where(
        and(
          eq(users.status, parsed.data.status),
          // Internal accounts are not end-users: exclude admin staff (admin/superadmin) AND the
          // admin-created agent roles (screenhost_agent/screencast_agent) from the moderation queue.
          notInArray(users.role, ['admin', 'superadmin', 'screenhost_agent', 'screencast_agent']),
        ),
      )
      .orderBy(desc(users.createdAt));

    const userIds = rows.map((r) => r.id);
    const presence = await documentsPresenceFor(userIds);
    const screenhostsByOwner = await screenhostsFor(userIds);
    return reply.status(200).send({
      users: rows.map((r) =>
        toAdminUserView(r, presence.get(r.id) ?? NO_DOCUMENTS, screenhostsByOwner.get(r.id) ?? []),
      ),
    });
  });

  // POST /api/admin/users/:id/approve — status→approved + onboarding_completed→true + the trio
  // (validated_by = the acting admin). Notes optional. 409 if already approved; a rejected user
  // CAN be approved (different target state) — the trio is overwritten with this decision's context.
  app.post('/api/admin/users/:id/approve', adminGuard, async (request, reply) => {
    const parsedParams = idParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        statusCode: 400,
        requestId: request.id,
        fields: [{ field: 'id', reason: 'must be a valid uuid' }],
      });
    }
    const parsedBody = approveBodySchema.safeParse(request.body ?? {});
    if (!parsedBody.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        statusCode: 400,
        requestId: request.id,
        fields: parsedBody.error.issues.map((i) => ({
          field: i.path.join('.'),
          reason: i.message,
        })),
      });
    }

    const adminId = request.user?.id;
    if (!adminId) {
      return reply
        .status(401)
        .send({ error: 'UNAUTHENTICATED', message: 'Authentication required.' });
    }

    const { id } = parsedParams.data;
    const [existing] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    if (!existing) {
      return reply.status(404).send({
        error: 'USER_NOT_FOUND',
        message: 'No user with that id.',
        statusCode: 404,
        requestId: request.id,
      });
    }
    // 'banned' is TERMINAL — refuse the transition and leave the ban record intact (an un-ban is a
    // deliberate future endpoint, not this path). Mirrors /ban's same-state guard.
    if (existing.status === 'banned') {
      return sendAlreadyInState(reply, request, existing);
    }
    if (existing.status === 'approved') {
      return sendAlreadyInState(reply, request, existing);
    }

    const [updated] = await db
      .update(users)
      .set({
        status: 'approved',
        onboardingCompleted: true,
        validatedBy: adminId,
        validatedAt: new Date(),
        validationNotes: parsedBody.data.notes ?? null,
      })
      .where(eq(users.id, id))
      .returning();

    // MAP M1 — approving a screenhost owner materializes their screens rows ("Écran 1..N"
    // per screenhost, idempotent: a screenhost that already has screens is left alone, so
    // a reject → re-approve cycle never duplicates).
    if (updated && OWNER_ROLES.has(updated.role)) {
      await createMissingScreensForOwner(updated.id);
      // S-T1 B2 — push this owner's now-approved screenhosts to wedooh. Fire-and-forget AFTER the
      // approval commit: a wedooh outage must NEVER fail the approval (export_status flips to
      // 'failed' and the boot/interval sweep retries). No-op when the sync env is unset.
      void pushApprovedOwnerLocations(updated.id, request.log).catch((err: unknown) => {
        request.log.warn({ err }, 'wedooh B2 push (post-approval) failed to start');
      });
    }

    const presence = await documentsPresenceFor([id]);
    return reply
      .status(200)
      .send({ user: toAdminUserView(updated as User, presence.get(id) ?? NO_DOCUMENTS) });
  });

  // POST /api/admin/users/:id/reject — status→rejected + the trio. onboarding_completed is NOT
  // touched. Notes REQUIRED non-empty. 409 if already rejected.
  app.post('/api/admin/users/:id/reject', adminGuard, async (request, reply) => {
    const parsedParams = idParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        statusCode: 400,
        requestId: request.id,
        fields: [{ field: 'id', reason: 'must be a valid uuid' }],
      });
    }
    const parsedBody = rejectBodySchema.safeParse(request.body ?? {});
    if (!parsedBody.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        statusCode: 400,
        requestId: request.id,
        fields: parsedBody.error.issues.map((i) => ({
          field: i.path.join('.'),
          reason: i.message,
        })),
      });
    }

    const adminId = request.user?.id;
    if (!adminId) {
      return reply
        .status(401)
        .send({ error: 'UNAUTHENTICATED', message: 'Authentication required.' });
    }

    const { id } = parsedParams.data;
    const [existing] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    if (!existing) {
      return reply.status(404).send({
        error: 'USER_NOT_FOUND',
        message: 'No user with that id.',
        statusCode: 404,
        requestId: request.id,
      });
    }
    // 'banned' is TERMINAL — refuse the transition and leave the ban record intact (no banned →
    // rejected → resubmit escape hatch). Mirrors /ban's same-state guard.
    if (existing.status === 'banned') {
      return sendAlreadyInState(reply, request, existing);
    }
    if (existing.status === 'rejected') {
      return sendAlreadyInState(reply, request, existing);
    }

    const [updated] = await db
      .update(users)
      .set({
        status: 'rejected',
        validatedBy: adminId,
        validatedAt: new Date(),
        validationNotes: parsedBody.data.notes,
        rejectionTopics: parsedBody.data.topics,
      })
      .where(eq(users.id, id))
      .returning();
    const rejected = updated as User;

    // N3 Scenario 1 — notify the rejected user (reason + topics). Non-blocking, never-throw (mirrors
    // the agent-welcome email): the reject has ALREADY committed, so a send failure is logged but
    // must never fail the response. The user stays able to sign in (C2) to read this and resubmit.
    const emailFields = {
      name: rejected.contactName,
      notes: parsedBody.data.notes,
      topics: parsedBody.data.topics,
    };
    try {
      const result = await emailSender.send({
        to: rejected.email,
        subject: rejectionEmailSubject,
        html: rejectionEmailTemplate(emailFields),
        text: rejectionEmailPlainText(emailFields),
      });
      if ('error' in result) {
        request.log.error({ to: rejected.email, error: result.error }, 'rejection email failed');
      } else {
        request.log.info(
          { to: rejected.email, messageId: result.messageId },
          'rejection email sent',
        );
      }
    } catch (err) {
      request.log.error({ to: rejected.email, err }, 'rejection email threw (swallowed)');
    }

    const presence = await documentsPresenceFor([id]);
    return reply
      .status(200)
      .send({ user: toAdminUserView(rejected, presence.get(id) ?? NO_DOCUMENTS) });
  });

  // POST /api/admin/users/:id/ban — N3 Scenario 2 (fraud). TERMINAL: status→'banned' + the trio
  // (validationNotes = ban reason). The user's sessions are REVOKED (deleted) so they're kicked
  // immediately. The user row + user_documents are RETAINED as fraud evidence (operator ruling
  // 2026-06-20 — NO hard delete). 409 if already banned. Re-registration with this identity is blocked
  // by RETAIN + the existing email/tax uniqueness (no separate check — a banned-specific error would
  // leak banned status). Bannable from ANY non-banned state (fraud can surface post-approval).
  // ADM-2 — a STAFF target (role admin/superadmin) additionally requires a SUPERADMIN actor.
  app.post('/api/admin/users/:id/ban', adminGuard, async (request, reply) => {
    const parsedParams = idParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        statusCode: 400,
        requestId: request.id,
        fields: [{ field: 'id', reason: 'must be a valid uuid' }],
      });
    }
    const parsedBody = banBodySchema.safeParse(request.body ?? {});
    if (!parsedBody.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        statusCode: 400,
        requestId: request.id,
        fields: parsedBody.error.issues.map((i) => ({
          field: i.path.join('.'),
          reason: i.message,
        })),
      });
    }

    const adminId = request.user?.id;
    if (!adminId) {
      return reply
        .status(401)
        .send({ error: 'UNAUTHENTICATED', message: 'Authentication required.' });
    }

    const { id } = parsedParams.data;
    const [existing] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    if (!existing) {
      return reply.status(404).send({
        error: 'USER_NOT_FOUND',
        message: 'No user with that id.',
        statusCode: 404,
        requestId: request.id,
      });
    }
    // ADM-2 — banning a STAFF account is superadmin-only. The UI always hid the button on
    // admin rows, but the route let any admin ban a peer admin or the superadmin by direct
    // call (and /admin-management's deactivate rides this same route). Privilege is checked
    // BEFORE state, mirroring requireRole's 403; end-user bans are unchanged.
    if (
      (existing.role === 'admin' || existing.role === 'superadmin') &&
      request.user?.role !== 'superadmin'
    ) {
      return reply.status(403).send({
        error: 'FORBIDDEN',
        message: 'Privilèges insuffisants pour cette action.',
        statusCode: 403,
        requestId: request.id,
      });
    }
    if (existing.status === 'banned') {
      return sendAlreadyInState(reply, request, existing);
    }

    const [updated] = await db
      .update(users)
      .set({
        status: 'banned',
        validatedBy: adminId,
        validatedAt: new Date(),
        validationNotes: parsedBody.data.notes,
        // A ban supersedes any prior reject context — the doc-deficiency topics no longer apply.
        rejectionTopics: null,
      })
      .where(eq(users.id, id))
      .returning();

    // Revoke the user's sessions so the ban takes effect immediately (mirrors better-auth's
    // revokeSessionsOnPasswordReset). RETAIN everything else — the user row + user_documents are
    // fraud evidence and are never deleted.
    await db.delete(sessions).where(eq(sessions.userId, id));

    const presence = await documentsPresenceFor([id]);
    return reply
      .status(200)
      .send({ user: toAdminUserView(updated as User, presence.get(id) ?? NO_DOCUMENTS) });
  });

  // GET /api/admin/users/:id/bank-audit — REV1's INTERNAL fraud trail: every change to where this
  // owner's money is sent, newest first, each row carrying a BEFORE and an AFTER snapshot.
  //
  // ADMIN-ONLY BY DESIGN. There is deliberately NO owner-facing counterpart: the spec says the
  // previous coordinates are "not kept in HIS history", and an owner who could read the trail could
  // also see what a compromised account changed and when — the trail exists to be read by someone
  // OTHER than whoever might have moved the money. Do not mirror this onto an owner route.
  app.get('/api/admin/users/:id/bank-audit', adminGuard, async (request, reply) => {
    const parsed = idParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        statusCode: 400,
        requestId: request.id,
        fields: parsed.error.issues.map((i) => ({ field: i.path.join('.'), reason: i.message })),
      });
    }
    const { id } = parsed.data;
    const [target] = await db.select({ id: users.id }).from(users).where(eq(users.id, id)).limit(1);
    if (!target) {
      return reply.status(404).send({
        error: 'USER_NOT_FOUND',
        message: 'No such user.',
        statusCode: 404,
        requestId: request.id,
      });
    }
    const rows = await db
      .select()
      .from(userBankDetailsAudit)
      .where(eq(userBankDetailsAudit.userId, id))
      .orderBy(desc(userBankDetailsAudit.createdAt));
    return reply.status(200).send(
      rows.map((r) => ({
        id: r.id,
        changed_by: r.changedBy,
        before: {
          bank_account_holder: r.beforeAccountHolder,
          bank_rib: r.beforeRib,
          bank_iban: r.beforeIban,
          bank_document_id: r.beforeBankDocumentId,
        },
        after: {
          bank_account_holder: r.afterAccountHolder,
          bank_rib: r.afterRib,
          bank_iban: r.afterIban,
          bank_document_id: r.afterBankDocumentId,
        },
        created_at: r.createdAt.toISOString(),
      })),
    );
  });

  // GET /api/admin/users/:id/documents — ALL of a user's documents grouped by category (the
  // multi-doc review surface, Commit 3). Distinct 404 for a stale link (USER_NOT_FOUND).
  app.get('/api/admin/users/:id/documents', adminGuard, async (request, reply) => {
    const parsed = idParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        statusCode: 400,
        requestId: request.id,
        fields: [{ field: 'id', reason: 'must be a valid uuid' }],
      });
    }
    const { id } = parsed.data;
    const [target] = await db.select({ id: users.id }).from(users).where(eq(users.id, id)).limit(1);
    if (!target) {
      return reply.status(404).send({
        error: 'USER_NOT_FOUND',
        message: 'No user with that id.',
        statusCode: 404,
        requestId: request.id,
      });
    }
    const rows = await db
      .select()
      .from(userDocuments)
      .where(eq(userDocuments.userId, id))
      .orderBy(asc(userDocuments.category), asc(userDocuments.position));
    return reply.status(200).send({ documents: groupedDocuments(rows) });
  });

  // GET /api/admin/users/:id/documents/:ref/url — presign ONE document (by uuid) of the
  // reviewed user. The :id scoping is deliberate: a document id alone must not presign
  // across users from a guessable URL shape.
  app.get('/api/admin/users/:id/documents/:ref/url', adminGuard, async (request, reply) => {
    const parsed = docIdParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        statusCode: 400,
        requestId: request.id,
        fields: parsed.error.issues.map((i) => ({ field: i.path.join('.'), reason: i.message })),
      });
    }
    const { id, ref } = parsed.data;
    const [row] = await db
      .select()
      .from(userDocuments)
      .where(and(eq(userDocuments.id, ref), eq(userDocuments.userId, id)))
      .limit(1);
    if (!row) {
      return reply.status(404).send({
        error: 'NOT_FOUND',
        message: 'No such document for that user.',
        statusCode: 404,
        requestId: request.id,
      });
    }
    const result = await storage.getPresignedUrl({ key: row.storageKey });
    if ('error' in result) {
      return reply.status(502).send({
        error: 'STORAGE_ERROR',
        message: 'Could not generate a document URL. Please retry.',
        statusCode: 502,
        requestId: request.id,
      });
    }
    return reply.status(200).send({ url: result.url });
  });

  // GET /api/admin/users/:id/documents/:ref — COMPAT shim (the pre-reshape admin UI's fixed
  // rne/cin slots + the F6 bank-doc button — G2 keeps working until Commit 3 lands). Presigns
  // the category's lowest-position document, now read from user_documents. Distinct 404 codes:
  // USER_NOT_FOUND (stale link) vs DOCUMENT_NOT_UPLOADED (account for a missing doc in review).
  app.get('/api/admin/users/:id/documents/:ref', adminGuard, async (request, reply) => {
    const parsed = docTypeParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        statusCode: 400,
        requestId: request.id,
        fields: parsed.error.issues.map((i) => ({ field: i.path.join('.'), reason: i.message })),
      });
    }

    const { id, ref: type } = parsed.data;
    const [target] = await db.select({ id: users.id }).from(users).where(eq(users.id, id)).limit(1);
    if (!target) {
      return reply.status(404).send({
        error: 'USER_NOT_FOUND',
        message: 'No user with that id.',
        statusCode: 404,
        requestId: request.id,
      });
    }

    const [row] = await db
      .select()
      .from(userDocuments)
      .where(and(eq(userDocuments.userId, id), eq(userDocuments.category, type)))
      .orderBy(asc(userDocuments.position))
      .limit(1);
    if (!row) {
      return reply.status(404).send({
        error: 'DOCUMENT_NOT_UPLOADED',
        message: `No ${type} document on file for this user.`,
        statusCode: 404,
        requestId: request.id,
        documentType: type,
      });
    }

    const result = await storage.getPresignedUrl({ key: row.storageKey });
    if ('error' in result) {
      return reply.status(502).send({
        error: 'STORAGE_ERROR',
        message: 'Could not generate a document URL. Please retry.',
        statusCode: 502,
        requestId: request.id,
      });
    }
    return reply.status(200).send({ url: result.url });
  });
};
