import multipart from '@fastify/multipart';
import { and, desc, eq } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { db } from '../db/client.js';
import { events } from '../db/schema.js';
import { declaredMatchesSniffed, sniffContainer } from '../lib/media-probe.js';
import { requireAdmin, requireAuth } from '../middleware/require-auth.js';
import { storage } from '../storage/s3-storage.js';

import { eventView } from './events.js';

// EV1 — the admin event surface, rebuilt per the §10 field set: Nom (required), Description,
// Image (affiche), Type LOCKED « Sport », Catégorie, Date/heure début + fin. The removed legacy
// fields (audience attendue, priorité, Actif/Mettre en avant, Ville/Lieu/Adresse) do NOT exist —
// there is nothing to migrate; the Supabase-era special_events table never lived in this DB.
// Suggested events are LISTED here (badge in the UI) but not editable — an admin curates the
// official catalogue, the suggestion list belongs to the advertisers; annuler works on both
// (the operator's kill switch for junk suggestions). The diffusion window is ALWAYS derived —
// no window column exists to recompute (pinned in tests).

const idParamSchema = z.object({ id: z.uuid() });

const MAX_EVENT_IMAGE_BYTES = 10 * 1024 * 1024; // affiche: JPEG/PNG ≤ 10 MB (the CF-M2 posture)
const IMAGE_MIMES = new Set(['image/jpeg', 'image/png']);

const invalidField = (reply: FastifyReply, field: string, reason: string) =>
  reply
    .status(400)
    .send({ error: 'INVALID_INPUT', message: 'Validation échouée', fields: [{ field, reason }] });

const sendNotFound = (reply: FastifyReply) =>
  reply.status(404).send({ error: 'NOT_FOUND', message: 'Événement introuvable.' });

// Shared create/edit scalar validation. `type` is LOCKED: absent or 'sport' passes, anything
// else is refused — the lock is a server rule, not a UI convention.
const upsertBodySchema = z.object({
  name: z.string().optional(),
  description: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  type: z.string().optional(),
  kickoff_at: z.string().optional(),
  ends_at: z.string().optional(),
});

const parseInstant = (value: string): Date | null => {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

export const adminEventsRoutes: FastifyPluginAsync = async (app) => {
  await app.register(multipart, {
    limits: { fileSize: MAX_EVENT_IMAGE_BYTES, files: 1, fields: 0 },
  });

  const adminGuard = { preHandler: [requireAuth, requireAdmin] };

  // GET /api/admin/events — EVERYTHING (official + suggested, annulé included, past included):
  // the management list, kickoff descending (the upcoming slate first).
  app.get('/api/admin/events', adminGuard, async (_request, reply) => {
    const now = new Date();
    const rows = await db.select().from(events).orderBy(desc(events.kickoffAt));
    return reply.status(200).send({
      events: rows.map((r) => ({
        ...eventView(r, now),
        annule: r.annule,
        suggested_by: r.suggestedBy,
        created_at: r.createdAt.toISOString(),
      })),
    });
  });

  // POST /api/admin/events — create an OFFICIAL event (JSON; the optional affiche arrives via
  // POST /:id/image afterwards, the attach-to-existing-row idiom).
  app.post('/api/admin/events', adminGuard, async (request, reply) => {
    const parsed = upsertBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) return invalidField(reply, 'body', 'corps de requête invalide');
    const body = parsed.data;
    const name = body.name?.trim() ?? '';
    if (name === '') return invalidField(reply, 'name', "Le nom de l'événement est obligatoire.");
    if (body.type !== undefined && body.type !== 'sport')
      return invalidField(reply, 'type', 'Le type est verrouillé sur « Sport ».');
    if (body.kickoff_at === undefined)
      return invalidField(reply, 'kickoff_at', 'La date et heure de début est obligatoire.');
    if (body.ends_at === undefined)
      return invalidField(reply, 'ends_at', 'La date et heure de fin est obligatoire.');
    const kickoffAt = parseInstant(body.kickoff_at);
    if (!kickoffAt)
      return invalidField(reply, 'kickoff_at', 'La date et heure de début est invalide.');
    const endsAt = parseInstant(body.ends_at);
    if (!endsAt) return invalidField(reply, 'ends_at', 'La date et heure de fin est invalide.');
    if (endsAt.getTime() <= kickoffAt.getTime())
      return invalidField(reply, 'ends_at', 'La fin doit être postérieure au début.');
    const [created] = await db
      .insert(events)
      .values({
        name,
        description: body.description?.trim() || null,
        category: body.category?.trim() || null,
        type: 'sport',
        kickoffAt,
        endsAt,
        source: 'official',
      })
      .returning();
    if (!created)
      return reply
        .status(500)
        .send({ error: 'INTERNAL', message: "L'événement n'a pas pu être créé." });
    return reply.status(201).send(eventView(created, new Date()));
  });

  // PATCH /api/admin/events/:id — edit the §10 scalars of an OFFICIAL event. Editing dates
  // stores the new instants and nothing else — the window is re-derived on every read, never
  // recomputed into a column (none exists). Suggested events are not editable.
  app.patch('/api/admin/events/:id', adminGuard, async (request, reply) => {
    const params = idParamSchema.safeParse(request.params);
    if (!params.success) return invalidField(reply, 'id', 'must be a uuid');
    const parsed = upsertBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) return invalidField(reply, 'body', 'corps de requête invalide');
    const body = parsed.data;
    if (body.type !== undefined && body.type !== 'sport')
      return invalidField(reply, 'type', 'Le type est verrouillé sur « Sport ».');
    const [row] = await db.select().from(events).where(eq(events.id, params.data.id)).limit(1);
    if (!row) return sendNotFound(reply);
    if (row.source === 'suggested') {
      return reply.status(409).send({
        error: 'CONFLICT',
        message: "Un match suggéré n'est pas modifiable — il appartient aux screencasters.",
        statusCode: 409,
        requestId: request.id,
      });
    }
    const patch: Partial<typeof events.$inferInsert> = {};
    if (body.name !== undefined) {
      const name = body.name.trim();
      if (name === '') return invalidField(reply, 'name', "Le nom de l'événement est obligatoire.");
      patch.name = name;
    }
    if (body.description !== undefined) patch.description = body.description?.trim() || null;
    if (body.category !== undefined) patch.category = body.category?.trim() || null;
    let kickoffAt = row.kickoffAt;
    let endsAt = row.endsAt;
    if (body.kickoff_at !== undefined) {
      const d = parseInstant(body.kickoff_at);
      if (!d) return invalidField(reply, 'kickoff_at', 'La date et heure de début est invalide.');
      kickoffAt = d;
      patch.kickoffAt = d;
    }
    if (body.ends_at !== undefined) {
      const d = parseInstant(body.ends_at);
      if (!d) return invalidField(reply, 'ends_at', 'La date et heure de fin est invalide.');
      endsAt = d;
      patch.endsAt = d;
    }
    if (endsAt.getTime() <= kickoffAt.getTime())
      return invalidField(reply, 'ends_at', 'La fin doit être postérieure au début.');
    if (Object.keys(patch).length === 0) return reply.status(200).send(eventView(row, new Date()));
    const [updated] = await db
      .update(events)
      .set(patch)
      .where(eq(events.id, params.data.id))
      .returning();
    if (!updated) return sendNotFound(reply);
    return reply.status(200).send(eventView(updated, new Date()));
  });

  // POST /api/admin/events/:id/annuler — soft cancel (official OR suggested: the operator's kill
  // switch). A second annuler is a 409, not a silent no-op.
  app.post('/api/admin/events/:id/annuler', adminGuard, async (request, reply) => {
    const params = idParamSchema.safeParse(request.params);
    if (!params.success) return invalidField(reply, 'id', 'must be a uuid');
    const [row] = await db.select().from(events).where(eq(events.id, params.data.id)).limit(1);
    if (!row) return sendNotFound(reply);
    if (row.annule) {
      return reply.status(409).send({
        error: 'CONFLICT',
        message: 'Événement déjà annulé.',
        statusCode: 409,
        requestId: request.id,
      });
    }
    const [updated] = await db
      .update(events)
      .set({ annule: true })
      .where(eq(events.id, params.data.id))
      .returning();
    if (!updated) return sendNotFound(reply);
    return reply.status(200).send({ ...eventView(updated, new Date()), annule: updated.annule });
  });

  // POST /api/admin/events/:id/image — attach/replace the affiche (single-file multipart,
  // JPEG/PNG byte-sniffed, ≤ 10 MB — the CF-M2 attach idiom). storage-first / no-orphan.
  app.post('/api/admin/events/:id/image', adminGuard, async (request: FastifyRequest, reply) => {
    const params = idParamSchema.safeParse(request.params);
    if (!params.success) return invalidField(reply, 'id', 'must be a uuid');
    const [row] = await db
      .select({ id: events.id })
      .from(events)
      .where(eq(events.id, params.data.id))
      .limit(1);
    if (!row) return sendNotFound(reply);
    const data = await request.file();
    if (!data) return invalidField(reply, 'file', 'un fichier est requis');
    let body: Buffer;
    try {
      body = await data.toBuffer();
    } catch {
      return reply.status(413).send({
        error: 'PAYLOAD_TOO_LARGE',
        message: `Le fichier dépasse la limite de ${MAX_EVENT_IMAGE_BYTES} octets.`,
      });
    }
    if (data.file.truncated) {
      return reply.status(413).send({
        error: 'PAYLOAD_TOO_LARGE',
        message: `Le fichier dépasse la limite de ${MAX_EVENT_IMAGE_BYTES} octets.`,
      });
    }
    if (!IMAGE_MIMES.has(data.mimetype))
      return invalidField(reply, 'file', `type de contenu non pris en charge : ${data.mimetype}`);
    const sniffed = sniffContainer(body);
    if (!declaredMatchesSniffed(data.mimetype, sniffed)) {
      return reply.status(400).send({
        error: 'MEDIA_TYPE_MISMATCH',
        message: `Les octets du fichier ne correspondent pas au type déclaré (déclaré ${data.mimetype}, détecté ${sniffed ?? 'inconnu'}).`,
      });
    }
    const key = `events/${params.data.id}/affiche`;
    const result = await storage.upload({ key, body, contentType: data.mimetype });
    if ('error' in result) {
      return reply.status(502).send({
        error: 'STORAGE_ERROR',
        message: "L'affiche n'a pas pu être enregistrée. Veuillez réessayer.",
      });
    }
    const [updated] = await db
      .update(events)
      .set({ imageKey: key })
      .where(eq(events.id, params.data.id))
      .returning();
    if (!updated) return sendNotFound(reply);
    return reply.status(200).send(eventView(updated, new Date()));
  });

  // GET /api/admin/events/:id/image-url — presign the affiche for the admin surface.
  app.get('/api/admin/events/:id/image-url', adminGuard, async (request, reply) => {
    const params = idParamSchema.safeParse(request.params);
    if (!params.success) return invalidField(reply, 'id', 'must be a uuid');
    const [row] = await db
      .select({ imageKey: events.imageKey })
      .from(events)
      .where(and(eq(events.id, params.data.id)))
      .limit(1);
    if (!row) return sendNotFound(reply);
    if (row.imageKey === null)
      return reply
        .status(404)
        .send({ error: 'NOT_FOUND', message: 'Aucune affiche pour cet événement.' });
    const result = await storage.getPresignedUrl({ key: row.imageKey });
    if ('error' in result) {
      return reply.status(502).send({
        error: 'STORAGE_ERROR',
        message: "Impossible de générer l'URL de l'affiche. Veuillez réessayer.",
      });
    }
    return reply.status(200).send({ url: result.url });
  });
};
