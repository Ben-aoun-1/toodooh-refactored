import { randomUUID } from 'node:crypto';

import multipart from '@fastify/multipart';
import { fromNodeHeaders } from 'better-auth/node';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { auth } from '../auth/auth.js';
import { db } from '../db/client.js';
import {
  agentCgeAcceptances,
  agentCgeVersions,
  agentProfileChanges,
  agentRibSubmissions,
  agents,
  notifications,
  sessions,
  users,
} from '../db/schema.js';
import { env } from '../env.js';
import {
  type AgentRole,
  agentCommissionPct,
  agentOnboarding,
  agentRibState,
  isAgentRole,
} from '../lib/agent-sheet.js';
import { requireAuth, requireRole } from '../middleware/require-auth.js';
import { storage } from '../storage/s3-storage.js';
import { validatePhone } from '../validation/phone.js';

// AGT-1 (agent specs v1.0 §2 and §12, operator ruling Q1 A: the « hub interne » functions live in
// this admin panel) — the agent sheet, its edits, the account lifecycle (suspend / reactivate /
// close), the access-link resend, the RIB validation queue and the CGE publication. Admin and
// superadmin only.

const staffGuard = { preHandler: [requireAuth, requireRole('admin', 'superadmin')] };
const idParam = z.object({ id: z.uuid() });

const CGE_MAX_BYTES = 10 * 1024 * 1024;

const patchSchema = z
  .object({
    first_name: z.string().trim().min(1).max(100),
    last_name: z.string().trim().min(1).max(100),
    phone: z.string().refine(validatePhone, 'Phone must be E.164'),
    tax_number: z
      .string()
      .regex(/^[A-Za-z0-9/]{7,20}$/)
      .nullable(),
    street_address: z.string().trim().min(1).max(200),
    city: z.string().trim().min(1).max(100),
    postal_code: z.string().regex(/^\d{4}$/),
    governorate_id: z.uuid(),
    covered_zone: z.string().trim().min(1).max(200),
    commission_pct: z.number().min(0).max(100).multipleOf(0.01).nullable(),
    certified_at: z.iso.date(),
  })
  .partial()
  .refine((d) => Object.keys(d).length > 0, 'Empty body');

const statusSchema = z.object({ status: z.enum(['actif', 'suspendu', 'cloture']) });
const refuseSchema = z.object({ reason: z.string().trim().min(1).max(1000) });
const cgeQuerySchema = z.object({
  role: z.enum(['screenhost_agent', 'screencast_agent']),
  version: z.string().trim().min(1).max(40),
});

const invalid = (reply: FastifyReply, issues: z.core.$ZodIssue[]) =>
  reply.status(400).send({
    error: 'INVALID_INPUT',
    message: 'Validation failed',
    fields: issues.map((i) => ({ field: i.path.join('.'), reason: i.message })),
  });

const notFound = (reply: FastifyReply) =>
  reply.status(404).send({ error: 'NOT_FOUND', message: 'No such agent.' });

const loadAgent = async (id: string) => {
  const [row] = await db
    .select({ user: users, agent: agents })
    .from(agents)
    .innerJoin(users, eq(users.id, agents.userId))
    .where(eq(agents.userId, id))
    .limit(1);
  return row && isAgentRole(row.user.role) ? row : null;
};

/** The agent sheet as the admin sees it (never a password; the rate IS shown to the admin). */
const sheetView = async (row: NonNullable<Awaited<ReturnType<typeof loadAgent>>>) => {
  const role = row.user.role as AgentRole;
  const onboarding = await agentOnboarding(row.user.id, role);
  const rib = await agentRibState(row.user.id);
  const acceptances = await db
    .select({
      version: agentCgeVersions.version,
      acceptedAt: agentCgeAcceptances.acceptedAt,
      ip: agentCgeAcceptances.ip,
    })
    .from(agentCgeAcceptances)
    .innerJoin(agentCgeVersions, eq(agentCgeVersions.id, agentCgeAcceptances.cgeVersionId))
    .where(eq(agentCgeAcceptances.agentUserId, row.user.id))
    .orderBy(desc(agentCgeAcceptances.acceptedAt));
  return {
    id: row.user.id,
    role,
    email: row.user.email,
    code: row.agent.code,
    first_name: row.agent.firstName,
    last_name: row.agent.lastName,
    contact_name: row.user.contactName,
    phone: row.user.contactPhone,
    tax_number: row.user.taxNumber,
    street_address: row.user.streetAddress,
    city: row.user.city,
    postal_code: row.user.postalCode,
    governorate_id: row.user.governorateId,
    covered_zone: row.agent.coveredZone,
    commission_pct: row.agent.commissionPct === null ? null : Number(row.agent.commissionPct),
    effective_commission_pct: await agentCommissionPct(row.user.id, role),
    account_status: row.agent.accountStatus,
    certified_at: row.agent.certifiedAt,
    created_at: row.agent.createdAt.toISOString(),
    onboarding,
    rib_status: rib.state,
    rib_validated: rib.validated,
    // AGT-1b — the agent's own sheet edits, newest first (spec §9 « horodatée »).
    profile_changes: (
      await db
        .select()
        .from(agentProfileChanges)
        .where(eq(agentProfileChanges.agentUserId, row.user.id))
        .orderBy(desc(agentProfileChanges.changedAt))
        .limit(50)
    ).map((c) => ({
      field: c.field,
      old_value: c.oldValue,
      new_value: c.newValue,
      changed_at: c.changedAt.toISOString(),
    })),
    cge_acceptances: acceptances.map((a) => ({
      version: a.version,
      accepted_at: a.acceptedAt.toISOString(),
      ip: a.ip,
    })),
  };
};

export const adminAgentsRoutes: FastifyPluginAsync = async (app) => {
  await app.register(multipart, { limits: { fileSize: CGE_MAX_BYTES, files: 1, fields: 0 } });

  // GET /api/admin/agents/:id — the full agent sheet.
  app.get('/api/admin/agents/:id', staffGuard, async (request, reply) => {
    const params = idParam.safeParse(request.params);
    if (!params.success) return invalid(reply, params.error.issues);
    const row = await loadAgent(params.data.id);
    if (!row) return notFound(reply);
    return reply.status(200).send(await sheetView(row));
  });

  // PATCH /api/admin/agents/:id — edit the sheet (the rate applies to later commissions only).
  app.patch('/api/admin/agents/:id', staffGuard, async (request, reply) => {
    const params = idParam.safeParse(request.params);
    if (!params.success) return invalid(reply, params.error.issues);
    const body = patchSchema.safeParse(request.body ?? {});
    if (!body.success) return invalid(reply, body.error.issues);
    const row = await loadAgent(params.data.id);
    if (!row) return notFound(reply);
    const d = body.data;
    const firstName = d.first_name ?? row.agent.firstName;
    const lastName = d.last_name ?? row.agent.lastName;
    const agentSet = {
      ...(d.first_name !== undefined ? { firstName: d.first_name } : {}),
      ...(d.last_name !== undefined ? { lastName: d.last_name } : {}),
      ...(d.covered_zone !== undefined ? { coveredZone: d.covered_zone } : {}),
      ...(d.certified_at !== undefined ? { certifiedAt: d.certified_at } : {}),
      ...(d.commission_pct !== undefined
        ? { commissionPct: d.commission_pct === null ? null : d.commission_pct.toFixed(2) }
        : {}),
    };
    const userSet = {
      ...(d.first_name !== undefined || d.last_name !== undefined
        ? { contactName: `${firstName ?? ''} ${lastName ?? ''}`.trim() }
        : {}),
      ...(d.phone !== undefined ? { contactPhone: d.phone } : {}),
      ...(d.tax_number !== undefined ? { taxNumber: d.tax_number } : {}),
      ...(d.street_address !== undefined ? { streetAddress: d.street_address } : {}),
      ...(d.city !== undefined ? { city: d.city } : {}),
      ...(d.postal_code !== undefined ? { postalCode: d.postal_code } : {}),
      ...(d.governorate_id !== undefined ? { governorateId: d.governorate_id } : {}),
    };
    await db.transaction(async (tx) => {
      if (Object.keys(agentSet).length > 0) {
        await tx.update(agents).set(agentSet).where(eq(agents.userId, row.user.id));
      }
      if (Object.keys(userSet).length > 0) {
        await tx.update(users).set(userSet).where(eq(users.id, row.user.id));
      }
    });
    const fresh = await loadAgent(row.user.id);
    return reply.status(200).send(fresh ? await sheetView(fresh) : null);
  });

  // POST /api/admin/agents/:id/status — suspend, reactivate (a suspended account only) or close
  // (terminal). Suspension and closure also ban the users row and revoke its sessions, so the
  // existing sign-in refusal applies; the code is refused at signup (lib/agent-lookup.ts).
  app.post('/api/admin/agents/:id/status', staffGuard, async (request, reply) => {
    const params = idParam.safeParse(request.params);
    if (!params.success) return invalid(reply, params.error.issues);
    const body = statusSchema.safeParse(request.body ?? {});
    if (!body.success) return invalid(reply, body.error.issues);
    const row = await loadAgent(params.data.id);
    if (!row) return notFound(reply);
    const from = row.agent.accountStatus;
    const to = body.data.status;
    const allowed =
      (to === 'suspendu' && (from === 'actif' || from === 'en_attente')) ||
      (to === 'actif' && from === 'suspendu') ||
      (to === 'cloture' && from !== 'cloture');
    if (!allowed) {
      return reply.status(409).send({
        error: 'INVALID_TRANSITION',
        message: `Cannot move an agent account from ${from} to ${to}.`,
      });
    }
    await db.transaction(async (tx) => {
      await tx.update(agents).set({ accountStatus: to }).where(eq(agents.userId, row.user.id));
      await tx
        .update(users)
        .set({ status: to === 'actif' ? 'approved' : 'banned' })
        .where(eq(users.id, row.user.id));
      if (to !== 'actif') await tx.delete(sessions).where(eq(sessions.userId, row.user.id));
    });
    const fresh = await loadAgent(row.user.id);
    return reply.status(200).send(fresh ? await sheetView(fresh) : null);
  });

  // POST /api/admin/agents/:id/resend-access — a new single-use link to set the password.
  app.post('/api/admin/agents/:id/resend-access', staffGuard, async (request, reply) => {
    const params = idParam.safeParse(request.params);
    if (!params.success) return invalid(reply, params.error.issues);
    const row = await loadAgent(params.data.id);
    if (!row) return notFound(reply);
    if (row.agent.accountStatus === 'suspendu' || row.agent.accountStatus === 'cloture') {
      return reply.status(409).send({ error: 'ACCOUNT_INACTIVE', message: 'Account inactive.' });
    }
    try {
      await auth.api.requestPasswordReset({
        body: { email: row.user.email, redirectTo: `${env.WEB_ORIGIN}/update-password` },
        headers: fromNodeHeaders(request.headers),
      });
    } catch (err) {
      request.log.error({ err }, 'agent access link failed');
      return reply.status(502).send({ error: 'EMAIL_FAILED', message: 'Email failed.' });
    }
    return reply.status(204).send();
  });

  // GET /api/admin/agent-ribs?status=en_attente — the RIB validation queue (default: pending).
  app.get('/api/admin/agent-ribs', staffGuard, async (request, reply) => {
    const q = z
      .object({ status: z.enum(['en_attente', 'valide', 'refuse']).default('en_attente') })
      .safeParse(request.query ?? {});
    if (!q.success) return invalid(reply, q.error.issues);
    const rows = await db
      .select({ rib: agentRibSubmissions, user: users, code: agents.code })
      .from(agentRibSubmissions)
      .innerJoin(users, eq(users.id, agentRibSubmissions.agentUserId))
      .innerJoin(agents, eq(agents.userId, agentRibSubmissions.agentUserId))
      .where(eq(agentRibSubmissions.status, q.data.status))
      .orderBy(desc(agentRibSubmissions.submittedAt));
    return reply.status(200).send({
      ribs: rows.map((r) => ({
        id: r.rib.id,
        agent_id: r.user.id,
        agent_name: r.user.contactName,
        agent_code: r.code,
        role: r.user.role,
        file_name: r.rib.fileName,
        status: r.rib.status,
        refusal_reason: r.rib.refusalReason,
        submitted_at: r.rib.submittedAt.toISOString(),
        reviewed_at: r.rib.reviewedAt?.toISOString() ?? null,
      })),
    });
  });

  // GET /api/admin/agent-ribs/:id/url — a short-lived link to the deposited file.
  app.get('/api/admin/agent-ribs/:id/url', staffGuard, async (request, reply) => {
    const params = idParam.safeParse(request.params);
    if (!params.success) return invalid(reply, params.error.issues);
    const [rib] = await db
      .select()
      .from(agentRibSubmissions)
      .where(eq(agentRibSubmissions.id, params.data.id))
      .limit(1);
    if (!rib) return reply.status(404).send({ error: 'NOT_FOUND', message: 'No such RIB.' });
    const url = await storage.getPresignedUrl({ key: rib.storageKey });
    if ('error' in url)
      return reply.status(502).send({ error: 'STORAGE_ERROR', message: 'Storage.' });
    return reply.status(200).send({ url: url.url });
  });

  // POST /api/admin/agent-ribs/:id/validate | /refuse — decide a pending deposit, notify the agent.
  const decide =
    (decision: 'valide' | 'refuse') => async (request: FastifyRequest, reply: FastifyReply) => {
      const params = idParam.safeParse(request.params);
      if (!params.success) return invalid(reply, params.error.issues);
      const reason = decision === 'refuse' ? refuseSchema.safeParse(request.body ?? {}) : null;
      if (reason && !reason.success) return invalid(reply, reason.error.issues);
      const adminId = request.user?.id ?? null;
      const updated = await db.transaction(async (tx) => {
        const [row] = await tx
          .update(agentRibSubmissions)
          .set({
            status: decision,
            refusalReason: reason?.success ? reason.data.reason : null,
            reviewedBy: adminId,
            reviewedAt: new Date(),
          })
          .where(
            and(
              eq(agentRibSubmissions.id, params.data.id),
              eq(agentRibSubmissions.status, 'en_attente'),
            ),
          )
          .returning();
        if (!row) return null;
        await tx.insert(notifications).values({
          userId: row.agentUserId,
          type: decision === 'valide' ? 'agent_rib_validated' : 'agent_rib_refused',
          title:
            decision === 'valide'
              ? 'Vos coordonnées bancaires ont été validées'
              : 'Vos coordonnées bancaires n’ont pas pu être validées',
          body:
            decision === 'valide'
              ? 'Votre RIB est validé : vos versements pourront être émis.'
              : `Motif : ${row.refusalReason ?? '—'}. Déposez un nouveau RIB dans vos Paramètres.`,
        });
        return row;
      });
      if (!updated) {
        return reply.status(409).send({ error: 'NOT_PENDING', message: 'RIB is not pending.' });
      }
      return reply.status(200).send({ id: updated.id, status: updated.status });
    };
  app.post('/api/admin/agent-ribs/:id/validate', staffGuard, decide('valide'));
  app.post('/api/admin/agent-ribs/:id/refuse', staffGuard, decide('refuse'));

  // GET /api/admin/agent-cge — every published version, newest first.
  app.get('/api/admin/agent-cge', staffGuard, async (_request, reply) => {
    const rows = await db
      .select()
      .from(agentCgeVersions)
      .orderBy(desc(agentCgeVersions.publishedAt));
    const counts = await db
      .select({ versionId: agentCgeAcceptances.cgeVersionId })
      .from(agentCgeAcceptances)
      .where(
        inArray(
          agentCgeAcceptances.cgeVersionId,
          rows.length ? rows.map((r) => r.id) : [randomUUID()],
        ),
      );
    return reply.status(200).send({
      versions: rows.map((r) => ({
        id: r.id,
        role: r.agentRole,
        version: r.version,
        file_name: r.fileName,
        published_at: r.publishedAt.toISOString(),
        acceptances: counts.filter((c) => c.versionId === r.id).length,
      })),
    });
  });

  // POST /api/admin/agent-cge?role=…&version=… (multipart PDF) — publish a version: from now on
  // every agent of that role must accept it before anything else (spec §2).
  app.post('/api/admin/agent-cge', staffGuard, async (request, reply) => {
    const q = cgeQuerySchema.safeParse(request.query ?? {});
    if (!q.success) return invalid(reply, q.error.issues);
    const data = await request.file();
    if (!data) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: [{ field: 'file', reason: 'a file is required' }],
      });
    }
    let body: Buffer;
    try {
      body = await data.toBuffer();
    } catch {
      return reply.status(413).send({ error: 'PAYLOAD_TOO_LARGE', message: 'File too large.' });
    }
    if (data.mimetype !== 'application/pdf' || body.subarray(0, 5).toString() !== '%PDF-') {
      return reply.status(400).send({ error: 'NOT_A_PDF', message: 'The CGE must be a PDF.' });
    }
    const [taken] = await db
      .select({ id: agentCgeVersions.id })
      .from(agentCgeVersions)
      .where(
        and(
          eq(agentCgeVersions.agentRole, q.data.role),
          eq(agentCgeVersions.version, q.data.version),
        ),
      )
      .limit(1);
    if (taken)
      return reply.status(409).send({ error: 'VERSION_EXISTS', message: 'Version exists.' });
    const key = `agent-cge/${q.data.role}/${randomUUID()}.pdf`;
    const up = await storage.upload({ key, body, contentType: 'application/pdf' });
    if ('error' in up)
      return reply.status(502).send({ error: 'STORAGE_ERROR', message: 'Storage.' });
    const [row] = await db
      .insert(agentCgeVersions)
      .values({
        agentRole: q.data.role,
        version: q.data.version,
        storageKey: key,
        fileName: data.filename,
        publishedBy: request.user?.id ?? null,
      })
      .returning();
    return reply.status(201).send({ id: row?.id, role: q.data.role, version: q.data.version });
  });
};
