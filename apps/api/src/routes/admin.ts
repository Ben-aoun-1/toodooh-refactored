import { and, desc, eq, notInArray } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { db } from '../db/client.js';
import { type User, users } from '../db/schema.js';
import { toProfileType } from '../lib/profile-type.js';
import { requireAdmin, requireAuth } from '../middleware/require-auth.js';
import { storage } from '../storage/s3-storage.js';

// Every admin route runs the keystone first, then the role gate (require-auth.ts):
// requireAuth → 401 on no session; requireAdmin → 403 on a non-admin authenticated user.
const adminGuard = { preHandler: [requireAuth, requireAdmin] };

const listQuerySchema = z.object({ status: z.enum(['pending', 'approved', 'rejected']) });
const idParamSchema = z.object({ id: z.uuid() });
const docParamSchema = z.object({ id: z.uuid(), type: z.enum(['rne', 'cin']) });
// Approve notes are optional (an admin may approve without comment); reject notes are required
// non-empty (D-G1-4 — a rejection benefits from feedback; the rebuild establishes the contract
// the dead-Supabase FE lacked, CF-24 class-b).
const approveBodySchema = z.object({ notes: z.string().optional() });
const rejectBodySchema = z.object({ notes: z.string().trim().min(1) });

// The snake_case admin view G2 renders: the /api/me projection (identity + business profile)
// + created_at + the validation trio. The trio is single-state — it describes the CURRENT
// status's validation context, not multi-state history (D4 ruled out an action-log).
const toAdminUserView = (row: User) => ({
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
  documents: {
    registration: row.registrationDocUrl !== null,
    cin: row.cinDocUrl !== null,
  },
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

    return reply.status(200).send({ users: rows.map(toAdminUserView) });
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

    return reply.status(200).send({ user: toAdminUserView(updated as User) });
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
      })
      .where(eq(users.id, id))
      .returning();

    return reply.status(200).send({ user: toAdminUserView(updated as User) });
  });

  // GET /api/admin/users/:id/documents/:type — presign another user's stored document key on
  // demand (the doc-review the approval decision rests on). Mirrors the self-serve presign
  // (profile-documents.ts) but keyed by :id. Distinct 404 codes: USER_NOT_FOUND (stale link) vs
  // DOCUMENT_NOT_UPLOADED (account for a missing doc in review) — G2 branches on the code.
  app.get('/api/admin/users/:id/documents/:type', adminGuard, async (request, reply) => {
    const parsed = docParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        statusCode: 400,
        requestId: request.id,
        fields: parsed.error.issues.map((i) => ({ field: i.path.join('.'), reason: i.message })),
      });
    }

    const { id, type } = parsed.data;
    const [row] = await db
      .select({
        registrationDocUrl: users.registrationDocUrl,
        cinDocUrl: users.cinDocUrl,
      })
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    if (!row) {
      return reply.status(404).send({
        error: 'USER_NOT_FOUND',
        message: 'No user with that id.',
        statusCode: 404,
        requestId: request.id,
      });
    }

    const key = type === 'rne' ? row.registrationDocUrl : row.cinDocUrl;
    if (!key) {
      return reply.status(404).send({
        error: 'DOCUMENT_NOT_UPLOADED',
        message: `No ${type} document on file for this user.`,
        statusCode: 404,
        requestId: request.id,
        documentType: type,
      });
    }

    const result = await storage.getPresignedUrl({ key });
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
