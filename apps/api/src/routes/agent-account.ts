import { randomUUID } from 'node:crypto';

import multipart from '@fastify/multipart';
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { db } from '../db/client.js';
import { agentCgeAcceptances, agentRibSubmissions, agents, users } from '../db/schema.js';
import {
  type AgentRole,
  agentOnboarding,
  agentRibState,
  currentCge,
  cgeAcceptance,
  isAgentRole,
} from '../lib/agent-sheet.js';
import { ALLOWED_DOCUMENT_MIME, MAX_DOCUMENT_BYTES } from '../lib/user-documents.js';
import { requireAuth, requireRole } from '../middleware/require-auth.js';
import { storage } from '../storage/s3-storage.js';

// AGT-1 (agent specs v1.0 §2) — the agent's own account: its state and the « Finalisez votre
// compte » steps, the CGE acceptance (blocking: every other agent route answers 403 CGE_REQUIRED
// until the CGE in force is accepted — agentCgeGate), and the RIB deposit. Agent roles only.

const agentGuard = {
  preHandler: [requireAuth, requireRole('screenhost_agent', 'screencast_agent')],
};
const acceptSchema = z.object({ cge_version_id: z.uuid() });

const roleOf = (request: FastifyRequest): AgentRole | null => {
  const role = request.user?.role;
  return isAgentRole(role) ? role : null;
};

/**
 * preHandler for the agent's data routes: 403 CGE_REQUIRED while the CGE in force is not accepted
 * (spec §2: « aucune page ni aucune donnée … y compris par URL directe »).
 */
export const agentCgeGate = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
  const role = roleOf(request);
  const id = request.user?.id;
  if (!role || !id) return;
  const cge = await currentCge(role);
  if (cge && (await cgeAcceptance(id, cge.id)) === null) {
    await reply.status(403).send({
      error: 'CGE_REQUIRED',
      message: 'Acceptez les Conditions Générales d’Engagement pour continuer.',
    });
  }
};

export const agentAccountRoutes: FastifyPluginAsync = async (app) => {
  await app.register(multipart, {
    limits: { fileSize: MAX_DOCUMENT_BYTES, files: 1, fields: 0 },
  });

  // GET /api/agent/account — status, CGE in force (and whether to accept it), onboarding, RIB.
  app.get('/api/agent/account', agentGuard, async (request, reply) => {
    const role = roleOf(request);
    const id = request.user?.id;
    if (!role || !id)
      return reply.status(403).send({ error: 'FORBIDDEN', message: 'Agents only.' });
    const [row] = await db
      .select({ agent: agents, user: users })
      .from(agents)
      .innerJoin(users, eq(users.id, agents.userId))
      .where(eq(agents.userId, id))
      .limit(1);
    if (!row) return reply.status(404).send({ error: 'NOT_FOUND', message: 'No agent sheet.' });
    const cge = await currentCge(role);
    const accepted = cge ? await cgeAcceptance(id, cge.id) : null;
    const rib = await agentRibState(id);
    return reply.status(200).send({
      role,
      code: row.agent.code,
      first_name: row.agent.firstName,
      last_name: row.agent.lastName,
      account_status: row.agent.accountStatus,
      cge: cge
        ? {
            id: cge.id,
            version: cge.version,
            accepted_at: accepted?.acceptedAt.toISOString() ?? null,
          }
        : null,
      cge_required: cge !== null && accepted === null,
      onboarding: await agentOnboarding(id, role),
      rib: {
        status: rib.state,
        validated: rib.validated,
        file_name: rib.latest?.fileName ?? null,
        refusal_reason: rib.latest?.status === 'refuse' ? rib.latest.refusalReason : null,
        submitted_at: rib.latest?.submittedAt.toISOString() ?? null,
      },
    });
  });

  // GET /api/agent/cge/url — a short-lived link to the CGE in force (readable before accepting).
  app.get('/api/agent/cge/url', agentGuard, async (request, reply) => {
    const role = roleOf(request);
    if (!role) return reply.status(403).send({ error: 'FORBIDDEN', message: 'Agents only.' });
    const cge = await currentCge(role);
    if (!cge) return reply.status(404).send({ error: 'NO_CGE', message: 'No CGE published.' });
    const url = await storage.getPresignedUrl({ key: cge.storageKey });
    if ('error' in url)
      return reply.status(502).send({ error: 'STORAGE_ERROR', message: 'Storage.' });
    return reply.status(200).send({ url: url.url, version: cge.version });
  });

  // POST /api/agent/cge/accept {cge_version_id} — records date, version and IP; a pending account
  // becomes 'actif' (its code is now accepted at signup).
  app.post('/api/agent/cge/accept', agentGuard, async (request, reply) => {
    const role = roleOf(request);
    const id = request.user?.id;
    if (!role || !id)
      return reply.status(403).send({ error: 'FORBIDDEN', message: 'Agents only.' });
    const body = acceptSchema.safeParse(request.body ?? {});
    if (!body.success) {
      return reply
        .status(400)
        .send({ error: 'INVALID_INPUT', message: 'cge_version_id required.' });
    }
    const cge = await currentCge(role);
    if (!cge || cge.id !== body.data.cge_version_id) {
      return reply.status(409).send({ error: 'NOT_CURRENT', message: 'Not the CGE in force.' });
    }
    await db.transaction(async (tx) => {
      await tx
        .insert(agentCgeAcceptances)
        .values({ agentUserId: id, cgeVersionId: cge.id, ip: request.ip })
        .onConflictDoNothing();
      const [agent] = await tx
        .select({ status: agents.accountStatus })
        .from(agents)
        .where(eq(agents.userId, id))
        .limit(1);
      if (agent?.status === 'en_attente') {
        await tx.update(agents).set({ accountStatus: 'actif' }).where(eq(agents.userId, id));
      }
    });
    return reply.status(204).send();
  });

  // POST /api/agent/rib (multipart: PDF / JPG / PNG, 5 Mo) — a deposit goes « En attente de
  // validation »; a previously validated RIB stays in use until the admin validates the new one.
  app.post(
    '/api/agent/rib',
    { preHandler: [...agentGuard.preHandler, agentCgeGate] },
    async (request, reply) => {
      const id = request.user?.id;
      if (!id)
        return reply.status(401).send({ error: 'UNAUTHENTICATED', message: 'Auth required.' });
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
        return reply
          .status(413)
          .send({ error: 'PAYLOAD_TOO_LARGE', message: 'Fichier trop lourd (5 Mo max).' });
      }
      if (data.file.truncated) {
        return reply
          .status(413)
          .send({ error: 'PAYLOAD_TOO_LARGE', message: 'Fichier trop lourd (5 Mo max).' });
      }
      if (!ALLOWED_DOCUMENT_MIME.has(data.mimetype)) {
        return reply.status(400).send({
          error: 'UNSUPPORTED_FILE',
          message: 'Formats acceptés : PDF, JPG, JPEG, PNG.',
        });
      }
      const key = `agent-rib/${id}/${randomUUID()}`;
      const up = await storage.upload({ key, body, contentType: data.mimetype });
      if ('error' in up)
        return reply.status(502).send({ error: 'STORAGE_ERROR', message: 'Storage.' });
      const [row] = await db
        .insert(agentRibSubmissions)
        .values({
          agentUserId: id,
          storageKey: key,
          fileName: data.filename,
          mimeType: data.mimetype,
          sizeBytes: body.length,
        })
        .returning();
      return reply.status(201).send({ id: row?.id, status: row?.status });
    },
  );
};
