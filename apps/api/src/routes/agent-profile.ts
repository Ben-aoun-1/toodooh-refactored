import { randomUUID } from 'node:crypto';

import multipart from '@fastify/multipart';
import { and, desc, eq } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { db } from '../db/client.js';
import {
  agentCgeAcceptances,
  agentCgeVersions,
  agentProfileChanges,
  agents,
  users,
} from '../db/schema.js';
import { isAgentRole } from '../lib/agent-sheet.js';
import { imageDims } from '../lib/image-dims.js';
import { requireAuth, requireRole } from '../middleware/require-auth.js';
import { storage } from '../storage/s3-storage.js';
import { validatePhone } from '../validation/phone.js';

import { agentCgeGate } from './agent-account.js';

// AGT-1b (agent specs v1.0 §9 « Paramètres ») — the agent's own sheet. Profil: first and last
// name, phone; Informations légales: photo, address, city, postal code, governorate (email, code,
// tax number and covered zone stay read-only: « demande via Support »). Every change is
// timestamped in agent_profile_changes (the admin reads it); saving or confirming completes the
// onboarding step « Vérifier mes informations ». Notifications: the two toggles. The accepted CGE
// stay downloadable.

const guard = {
  preHandler: [requireAuth, requireRole('screenhost_agent', 'screencast_agent'), agentCgeGate],
};

const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
const PHOTO_MIN_PX = 400;

const profileSchema = z
  .object({
    first_name: z.string().trim().min(1).max(100),
    last_name: z.string().trim().min(1).max(100),
    phone: z.string().refine(validatePhone, 'Téléphone invalide (ex. +21612345678)'),
    street_address: z.string().trim().min(1).max(200),
    city: z.string().trim().min(1).max(100),
    postal_code: z.string().regex(/^\d{4}$/, 'Le code postal doit comporter 4 chiffres'),
    governorate_id: z.uuid(),
  })
  .partial();

const prefsSchema = z.object({ news: z.boolean(), reminders: z.boolean() });
const idParam = z.object({ id: z.uuid() });

const invalid = (reply: FastifyReply, issues: z.core.$ZodIssue[]) =>
  reply.status(400).send({
    error: 'INVALID_INPUT',
    message: issues[0]?.message ?? 'Validation failed',
    fields: issues.map((i) => ({ field: i.path.join('.'), reason: i.message })),
  });

const callerId = (request: FastifyRequest): string | null =>
  isAgentRole(request.user?.role) ? (request.user?.id ?? null) : null;

const loadSheet = async (id: string) => {
  const [row] = await db
    .select({ agent: agents, user: users })
    .from(agents)
    .innerJoin(users, eq(users.id, agents.userId))
    .where(eq(agents.userId, id))
    .limit(1);
  return row ?? null;
};

/** The agent's own sheet view (spec §9). */
const profileView = async (row: NonNullable<Awaited<ReturnType<typeof loadSheet>>>) => {
  const photo = row.agent.photoKey
    ? await storage.getPresignedUrl({ key: row.agent.photoKey })
    : null;
  const [lastAccepted] = await db
    .select({
      id: agentCgeVersions.id,
      version: agentCgeVersions.version,
      acceptedAt: agentCgeAcceptances.acceptedAt,
    })
    .from(agentCgeAcceptances)
    .innerJoin(agentCgeVersions, eq(agentCgeVersions.id, agentCgeAcceptances.cgeVersionId))
    .where(eq(agentCgeAcceptances.agentUserId, row.user.id))
    .orderBy(desc(agentCgeAcceptances.acceptedAt))
    .limit(1);
  return {
    email: row.user.email,
    code: row.agent.code,
    first_name: row.agent.firstName,
    last_name: row.agent.lastName,
    phone: row.user.contactPhone,
    street_address: row.user.streetAddress,
    city: row.user.city,
    postal_code: row.user.postalCode,
    governorate_id: row.user.governorateId,
    tax_number: row.user.taxNumber,
    covered_zone: row.agent.coveredZone,
    photo_url: photo && !('error' in photo) ? photo.url : null,
    notify_news: row.user.notifyNewsUpdates,
    notify_reminders: row.user.notifyRemindersEvents,
    info_verified_at: row.agent.infoVerifiedAt?.toISOString() ?? null,
    accepted_cge: lastAccepted
      ? {
          id: lastAccepted.id,
          version: lastAccepted.version,
          accepted_at: lastAccepted.acceptedAt.toISOString(),
        }
      : null,
  };
};

export const agentProfileRoutes: FastifyPluginAsync = async (app) => {
  await app.register(multipart, { limits: { fileSize: PHOTO_MAX_BYTES, files: 1, fields: 0 } });

  // GET /api/agent/profile — the sheet the Paramètres tabs edit.
  app.get('/api/agent/profile', guard, async (request, reply) => {
    const id = callerId(request);
    if (!id) return reply.status(403).send({ error: 'FORBIDDEN', message: 'Agents only.' });
    const row = await loadSheet(id);
    if (!row) return reply.status(404).send({ error: 'NOT_FOUND', message: 'No agent sheet.' });
    return reply.status(200).send(await profileView(row));
  });

  // PATCH /api/agent/profile — save (an empty body = « confirmer »): every changed field is
  // journaled; the onboarding step « Vérifier mes informations » is completed either way.
  app.patch('/api/agent/profile', guard, async (request, reply) => {
    const id = callerId(request);
    if (!id) return reply.status(403).send({ error: 'FORBIDDEN', message: 'Agents only.' });
    const body = profileSchema.safeParse(request.body ?? {});
    if (!body.success) return invalid(reply, body.error.issues);
    const row = await loadSheet(id);
    if (!row) return reply.status(404).send({ error: 'NOT_FOUND', message: 'No agent sheet.' });
    const d = body.data;
    const before: Record<string, string | null> = {
      first_name: row.agent.firstName,
      last_name: row.agent.lastName,
      phone: row.user.contactPhone,
      street_address: row.user.streetAddress,
      city: row.user.city,
      postal_code: row.user.postalCode,
      governorate_id: row.user.governorateId,
    };
    const changes = Object.entries(d).flatMap(([field, value]) =>
      value !== undefined && value !== before[field]
        ? [{ agentUserId: id, field, oldValue: before[field] ?? null, newValue: value }]
        : [],
    );
    const firstName = d.first_name ?? row.agent.firstName ?? '';
    const lastName = d.last_name ?? row.agent.lastName ?? '';
    await db.transaction(async (tx) => {
      await tx
        .update(agents)
        .set({
          ...(d.first_name !== undefined ? { firstName: d.first_name } : {}),
          ...(d.last_name !== undefined ? { lastName: d.last_name } : {}),
          infoVerifiedAt: new Date(),
        })
        .where(eq(agents.userId, id));
      const userSet = {
        ...(d.first_name !== undefined || d.last_name !== undefined
          ? { contactName: `${firstName} ${lastName}`.trim() }
          : {}),
        ...(d.phone !== undefined ? { contactPhone: d.phone } : {}),
        ...(d.street_address !== undefined ? { streetAddress: d.street_address } : {}),
        ...(d.city !== undefined ? { city: d.city } : {}),
        ...(d.postal_code !== undefined ? { postalCode: d.postal_code } : {}),
        ...(d.governorate_id !== undefined ? { governorateId: d.governorate_id } : {}),
      };
      if (Object.keys(userSet).length > 0) {
        await tx.update(users).set(userSet).where(eq(users.id, id));
      }
      if (changes.length > 0) await tx.insert(agentProfileChanges).values(changes);
    });
    const fresh = await loadSheet(id);
    return reply.status(200).send(fresh ? await profileView(fresh) : null);
  });

  // POST /api/agent/photo (PNG / JPEG, ≥ 400 × 400 px, 5 Mo) — replaces the profile photo.
  app.post('/api/agent/photo', guard, async (request, reply) => {
    const id = callerId(request);
    if (!id) return reply.status(403).send({ error: 'FORBIDDEN', message: 'Agents only.' });
    const data = await request.file();
    if (!data)
      return reply.status(400).send({ error: 'INVALID_INPUT', message: 'Fichier requis.' });
    let body: Buffer;
    try {
      body = await data.toBuffer();
    } catch {
      return reply
        .status(413)
        .send({ error: 'PAYLOAD_TOO_LARGE', message: 'Photo trop lourde (5 Mo max).' });
    }
    const dims = imageDims(body);
    if (!dims) {
      return reply
        .status(400)
        .send({ error: 'UNSUPPORTED_FILE', message: 'Formats acceptés : PNG, JPEG.' });
    }
    if (dims.width < PHOTO_MIN_PX || dims.height < PHOTO_MIN_PX) {
      return reply.status(400).send({
        error: 'PHOTO_TOO_SMALL',
        message: `La photo doit faire au moins ${PHOTO_MIN_PX} × ${PHOTO_MIN_PX} px.`,
      });
    }
    const key = `agent-photo/${id}/${randomUUID()}`;
    const up = await storage.upload({
      key,
      body,
      contentType: dims.format === 'png' ? 'image/png' : 'image/jpeg',
    });
    if ('error' in up)
      return reply.status(502).send({ error: 'STORAGE_ERROR', message: 'Storage.' });
    const row = await loadSheet(id);
    await db.transaction(async (tx) => {
      await tx.update(agents).set({ photoKey: key }).where(eq(agents.userId, id));
      await tx.insert(agentProfileChanges).values({
        agentUserId: id,
        field: 'photo',
        oldValue: row?.agent.photoKey ?? null,
        newValue: key,
      });
    });
    const fresh = await loadSheet(id);
    return reply.status(200).send(fresh ? await profileView(fresh) : null);
  });

  // DELETE /api/agent/photo — removes it (the avatar falls back to the initials).
  app.delete('/api/agent/photo', guard, async (request, reply) => {
    const id = callerId(request);
    if (!id) return reply.status(403).send({ error: 'FORBIDDEN', message: 'Agents only.' });
    const row = await loadSheet(id);
    if (row?.agent.photoKey) {
      await db.transaction(async (tx) => {
        await tx.update(agents).set({ photoKey: null }).where(eq(agents.userId, id));
        await tx.insert(agentProfileChanges).values({
          agentUserId: id,
          field: 'photo',
          oldValue: row.agent.photoKey,
          newValue: null,
        });
      });
    }
    const fresh = await loadSheet(id);
    return reply.status(200).send(fresh ? await profileView(fresh) : null);
  });

  // PATCH /api/agent/notification-prefs {news, reminders} — the only two switchable categories
  // (money, affiliation and appointment notifications always go out, spec §8).
  app.patch('/api/agent/notification-prefs', guard, async (request, reply) => {
    const id = callerId(request);
    if (!id) return reply.status(403).send({ error: 'FORBIDDEN', message: 'Agents only.' });
    const body = prefsSchema.safeParse(request.body ?? {});
    if (!body.success) return invalid(reply, body.error.issues);
    await db
      .update(users)
      .set({ notifyNewsUpdates: body.data.news, notifyRemindersEvents: body.data.reminders })
      .where(eq(users.id, id));
    return reply.status(200).send(body.data);
  });

  // GET /api/agent/cge/:id/url — download a CGE version this agent accepted.
  app.get('/api/agent/cge/:id/url', guard, async (request, reply) => {
    const id = callerId(request);
    const params = idParam.safeParse(request.params);
    if (!id || !params.success)
      return reply.status(400).send({ error: 'INVALID_INPUT', message: 'id' });
    const [row] = await db
      .select({ key: agentCgeVersions.storageKey })
      .from(agentCgeAcceptances)
      .innerJoin(agentCgeVersions, eq(agentCgeVersions.id, agentCgeAcceptances.cgeVersionId))
      .where(
        and(
          eq(agentCgeAcceptances.agentUserId, id),
          eq(agentCgeAcceptances.cgeVersionId, params.data.id),
        ),
      )
      .limit(1);
    if (!row) return reply.status(404).send({ error: 'NOT_FOUND', message: 'Not accepted.' });
    const url = await storage.getPresignedUrl({ key: row.key });
    if ('error' in url)
      return reply.status(502).send({ error: 'STORAGE_ERROR', message: 'Storage.' });
    return reply.status(200).send({ url: url.url });
  });
};
