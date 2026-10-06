import multipart from '@fastify/multipart';
import { asc, eq, or, sql } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { db } from '../db/client.js';
import { eventMatches, teams } from '../db/schema.js';
import { teamWire } from '../lib/event-catalogue.js';
import { declaredMatchesSniffed, sniffContainer } from '../lib/media-probe.js';
import { requireAdmin, requireAuth } from '../middleware/require-auth.js';
import { storage } from '../storage/s3-storage.js';

// EVT-CAT2 (operator rulings 2026-10-06) — the admin's TEAMS: what the new « Événements » cards
// show. Name, national team or club, three #RRGGBB colours (main, second, optional crowd tint),
// and an OPTIONAL logo/flag image (POST /:id/logo, JPEG/PNG/WebP ≤ 2 MB — the event-affiche
// idiom: storage key stored, presigned on read). A team used by a match is never deleted.

const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const LOGO_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const HEX = /^#[0-9A-Fa-f]{6}$/;

const idParamSchema = z.object({ id: z.uuid() });
const teamBodySchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  is_national: z.boolean().optional(),
  color_main: z.string().regex(HEX).optional(),
  color_second: z.string().regex(HEX).optional(),
  color_crowd: z.string().regex(HEX).nullable().optional(),
  /** PATCH-only: null removes the logo. */
  logo: z.null().optional(),
});

const invalidField = (reply: FastifyReply, field: string, reason: string) =>
  reply
    .status(400)
    .send({ error: 'INVALID_INPUT', message: 'Validation échouée', fields: [{ field, reason }] });

const sendNotFound = (reply: FastifyReply) =>
  reply.status(404).send({ error: 'NOT_FOUND', message: 'Équipe introuvable.' });

const nameTaken = async (name: string, exceptId?: string): Promise<boolean> => {
  const rows = await db
    .select({ id: teams.id })
    .from(teams)
    .where(sql`lower(${teams.name}) = lower(${name})`);
  return rows.some((r) => r.id !== exceptId);
};

export const adminTeamsRoutes: FastifyPluginAsync = async (app) => {
  await app.register(multipart, { limits: { fileSize: MAX_LOGO_BYTES, files: 1, fields: 0 } });
  const adminGuard = { preHandler: [requireAuth, requireAdmin] };

  // GET /api/admin/teams — every team, by name.
  app.get('/api/admin/teams', adminGuard, async (_request, reply) => {
    const rows = await db.select().from(teams).orderBy(asc(teams.name));
    return reply.status(200).send({ teams: await Promise.all(rows.map(teamWire)) });
  });

  // POST /api/admin/teams — create (name required; colours default to the neutral pair).
  app.post('/api/admin/teams', adminGuard, async (request, reply) => {
    const parsed = teamBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      const field = String(parsed.error.issues[0]?.path[0] ?? 'body');
      return invalidField(reply, field, 'Champ invalide (couleurs au format #RRGGBB).');
    }
    const body = parsed.data;
    if (!body.name) return invalidField(reply, 'name', "Le nom de l'équipe est obligatoire.");
    if (await nameTaken(body.name)) {
      return reply
        .status(409)
        .send({ error: 'TEAM_EXISTS', message: 'Une équipe porte déjà ce nom.', statusCode: 409 });
    }
    const [created] = await db
      .insert(teams)
      .values({
        name: body.name,
        isNational: body.is_national ?? false,
        ...(body.color_main ? { colorMain: body.color_main.toUpperCase() } : {}),
        ...(body.color_second ? { colorSecond: body.color_second.toUpperCase() } : {}),
        colorCrowd: body.color_crowd ? body.color_crowd.toUpperCase() : null,
      })
      .returning();
    if (!created) {
      return reply
        .status(500)
        .send({ error: 'INTERNAL', message: "L'équipe n'a pas pu être créée." });
    }
    return reply.status(201).send(await teamWire(created));
  });

  // PATCH /api/admin/teams/:id — edit any field; `logo: null` removes the image.
  app.patch('/api/admin/teams/:id', adminGuard, async (request, reply) => {
    const params = idParamSchema.safeParse(request.params);
    if (!params.success) return invalidField(reply, 'id', 'must be a uuid');
    const parsed = teamBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      const field = String(parsed.error.issues[0]?.path[0] ?? 'body');
      return invalidField(reply, field, 'Champ invalide (couleurs au format #RRGGBB).');
    }
    const body = parsed.data;
    const [row] = await db.select().from(teams).where(eq(teams.id, params.data.id)).limit(1);
    if (!row) return sendNotFound(reply);
    if (body.name !== undefined && (await nameTaken(body.name, row.id))) {
      return reply
        .status(409)
        .send({ error: 'TEAM_EXISTS', message: 'Une équipe porte déjà ce nom.', statusCode: 409 });
    }
    const patch: Partial<typeof teams.$inferInsert> = {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.is_national !== undefined ? { isNational: body.is_national } : {}),
      ...(body.color_main ? { colorMain: body.color_main.toUpperCase() } : {}),
      ...(body.color_second ? { colorSecond: body.color_second.toUpperCase() } : {}),
      ...(body.color_crowd !== undefined
        ? { colorCrowd: body.color_crowd ? body.color_crowd.toUpperCase() : null }
        : {}),
      ...(body.logo === null ? { logoKey: null } : {}),
    };
    if (Object.keys(patch).length === 0) return reply.status(200).send(await teamWire(row));
    const [updated] = await db.update(teams).set(patch).where(eq(teams.id, row.id)).returning();
    if (!updated) return sendNotFound(reply);
    return reply.status(200).send(await teamWire(updated));
  });

  // DELETE /api/admin/teams/:id — only a team no match uses.
  app.delete('/api/admin/teams/:id', adminGuard, async (request, reply) => {
    const params = idParamSchema.safeParse(request.params);
    if (!params.success) return invalidField(reply, 'id', 'must be a uuid');
    const used = await db
      .select({ id: eventMatches.id })
      .from(eventMatches)
      .where(
        or(
          eq(eventMatches.homeTeamId, params.data.id),
          eq(eventMatches.awayTeamId, params.data.id),
        ),
      )
      .limit(1);
    if (used.length > 0) {
      return reply.status(409).send({
        error: 'TEAM_IN_USE',
        message: 'Cette équipe figure dans un match — retirez-la du match avant de la supprimer.',
        statusCode: 409,
      });
    }
    const deleted = await db.delete(teams).where(eq(teams.id, params.data.id)).returning();
    if (deleted.length === 0) return sendNotFound(reply);
    return reply.status(204).send();
  });

  // POST /api/admin/teams/:id/logo — multipart, ONE image (JPEG/PNG/WebP ≤ 2 MB, type sniffed
  // from the bytes); replaces the previous one.
  app.post('/api/admin/teams/:id/logo', adminGuard, async (request: FastifyRequest, reply) => {
    const params = idParamSchema.safeParse(request.params);
    if (!params.success) return invalidField(reply, 'id', 'must be a uuid');
    const [row] = await db.select().from(teams).where(eq(teams.id, params.data.id)).limit(1);
    if (!row) return sendNotFound(reply);
    if (!request.isMultipart()) return invalidField(reply, 'file', 'multipart attendu');
    let file: { bytes: Buffer; mime: string } | null = null;
    try {
      const part = await request.file();
      if (part) {
        const bytes = await part.toBuffer();
        if (part.file.truncated) return invalidField(reply, 'file', 'Le logo dépasse 2 Mo.');
        file = { bytes, mime: part.mimetype };
      }
    } catch {
      return invalidField(reply, 'file', 'Le logo dépasse 2 Mo.');
    }
    if (!file || file.bytes.length === 0) return invalidField(reply, 'file', 'Ajoutez une image.');
    if (
      !LOGO_MIMES.has(file.mime) ||
      !declaredMatchesSniffed(file.mime, sniffContainer(file.bytes))
    ) {
      return invalidField(reply, 'file', 'Le logo doit être une image JPEG, PNG ou WebP.');
    }
    const key = `teams/${row.id}/${Date.now()}`;
    const uploaded = await storage.upload({ key, body: file.bytes, contentType: file.mime });
    if ('error' in uploaded) {
      return reply
        .status(502)
        .send({ error: 'STORAGE_ERROR', message: 'Le stockage du logo a échoué. Réessayez.' });
    }
    const [updated] = await db
      .update(teams)
      .set({ logoKey: key })
      .where(eq(teams.id, row.id))
      .returning();
    if (!updated) return sendNotFound(reply);
    return reply.status(200).send(await teamWire(updated));
  });
};
