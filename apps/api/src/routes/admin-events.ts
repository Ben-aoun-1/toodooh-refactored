import multipart from '@fastify/multipart';
import { and, desc, eq } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { db } from '../db/client.js';
import {
  campaigns,
  eventAllocations,
  eventAttestations,
  events,
  screenhosts,
} from '../db/schema.js';
import { MIN_CAMPAIGN_BUDGET_TND } from '../lib/campaign-budget.js';
import { getDispatchConfig } from '../lib/dispatch/config.js';
import { remapEventPositionings, voidEventPositionings } from '../lib/event-playout/reschedule.js';
import { computeEventCmax } from '../lib/event-pricing/pricing.js';
import { declaredMatchesSniffed, sniffContainer } from '../lib/media-probe.js';
import { recomputeVenueSps } from '../lib/sps-score.js';
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

/** EV6 RIDER — who may READ the event catalogue (writes stay admin-only). */
const EVENT_CATALOGUE_ROLES = new Set(['admin', 'superadmin', 'screenhost_agent']);

const idParamSchema = z.object({ id: z.uuid() });
const venueParamsSchema = z.object({ id: z.uuid(), screenhost_id: z.uuid() });

// EV5 — the attestation body: the verdict + an optional note (the agent's field observation).
const attestationBodySchema = z.object({
  respecte: z.boolean(),
  note: z.string().max(2000).nullable().optional(),
});

// EV5 (R4) — reporter: BOTH instants move; the window, the blocs and the reservations follow.
const reporterBodySchema = z.object({
  kickoff_at: z.string(),
  ends_at: z.string().optional(),
});

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
  // EV6 RIDER — the catalogue READ opens to an inspecting screenhost_agent (they must pick the
  // event before attesting on it; the ratified reasoning: agents seeing the catalogue is
  // harmless). Every WRITE below — create, edit, annuler, reporter, image, tarification — keeps
  // the admin-only guard.
  //
  // It is a LOCAL guard rather than requireRole(...) so the refusal keeps requireAdmin's exact
  // French copy: this route's 403 message is pinned (ev1-events), and an advertiser turned away
  // here must read the same sentence it always read — widening WHO may enter must not change
  // what everyone else is told.
  const requireEventCatalogueAccess = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> => {
    const role = request.user?.role;
    if (role === undefined || !EVENT_CATALOGUE_ROLES.has(role)) {
      await reply.status(403).send({
        error: 'FORBIDDEN',
        message: 'Accès administrateur requis.',
        statusCode: 403,
        requestId: request.id,
      });
    }
  };
  const eventReadGuard = { preHandler: [requireAuth, requireEventCatalogueAccess] };

  // GET /api/admin/events — EVERYTHING (official + suggested, annulé included, past included):
  // the management list, kickoff descending (the upcoming slate first).
  app.get('/api/admin/events', eventReadGuard, async (_request, reply) => {
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
    // EV5 (R4) — annuler now also CLOSES the money: every live positioning is voided (holds
    // released, FULL refund settled through E6's movement, closed), and both sides are notified.
    // ONE transaction with the flag itself: an annulé event can never keep live positionings.
    const outcome = await db.transaction(async (tx) => {
      const [flagged] = await tx
        .update(events)
        .set({ annule: true })
        .where(eq(events.id, params.data.id))
        .returning();
      if (!flagged) return null;
      const voided = await voidEventPositionings(tx, { id: flagged.id, name: flagged.name });
      return { flagged, voided };
    });
    if (!outcome) return sendNotFound(reply);
    return reply.status(200).send({
      ...eventView(outcome.flagged, new Date()),
      annule: outcome.flagged.annule,
      positionnements_annules: outcome.voided.positionings,
      remboursement_tnd: outcome.voided.refundedTnd,
    });
  });

  // POST /api/admin/events/:id/reporter { kickoff_at, ends_at? } — EV5 (R4): move the match. The
  // window is re-derived (never stored), every live positioning is re-snapshotted, each
  // allocation's blocs are remapped BY RELATIVE INDEX (the venue keeps the slots it accepted) and
  // its reservations are rewritten; advertisers + owners are notified. An ends_at-only
  // prolongation goes through the SAME path (the pre-match blocs simply do not move).
  app.post('/api/admin/events/:id/reporter', adminGuard, async (request, reply) => {
    const params = idParamSchema.safeParse(request.params);
    if (!params.success) return invalidField(reply, 'id', 'must be a uuid');
    const body = reporterBodySchema.safeParse(request.body ?? {});
    if (!body.success) return invalidField(reply, 'kickoff_at', 'must be an ISO instant');
    const [row] = await db.select().from(events).where(eq(events.id, params.data.id)).limit(1);
    if (!row) return sendNotFound(reply);
    if (row.annule) {
      return reply.status(409).send({
        error: 'CONFLICT',
        message: 'Événement annulé — il ne peut plus être reporté.',
        statusCode: 409,
        requestId: request.id,
      });
    }
    const kickoffAt = parseInstant(body.data.kickoff_at);
    if (!kickoffAt) return invalidField(reply, 'kickoff_at', 'must be an ISO instant');
    const endsAt =
      body.data.ends_at === undefined
        ? // Keep the declared duration when only the kickoff moves.
          new Date(kickoffAt.getTime() + (row.endsAt.getTime() - row.kickoffAt.getTime()))
        : parseInstant(body.data.ends_at);
    if (!endsAt) return invalidField(reply, 'ends_at', 'must be an ISO instant');
    if (endsAt.getTime() <= kickoffAt.getTime()) {
      return invalidField(reply, 'ends_at', 'must be after kickoff_at');
    }

    const outcome = await db.transaction(async (tx) => {
      const [moved] = await tx
        .update(events)
        .set({ kickoffAt, endsAt })
        .where(eq(events.id, params.data.id))
        .returning();
      if (!moved) return null;
      const remapped = await remapEventPositionings(
        tx,
        { id: moved.id, name: moved.name, kickoffAt: moved.kickoffAt, endsAt: moved.endsAt },
        { kickoffAt: row.kickoffAt, endsAt: row.endsAt },
      );
      return { moved, remapped };
    });
    if (!outcome) return sendNotFound(reply);
    return reply.status(200).send({
      ...eventView(outcome.moved, new Date()),
      positionnements_recalcules: outcome.remapped.positionings,
      allocations_recalculees: outcome.remapped.allocations,
    });
  });

  // ── EV5: the respect attestation (admin OR screenhost_agent — the as-found role guard) ───────
  // The agent inspects a venue during an event and records whether it RESPECTED the diffusion
  // (screens on, spot airing). ABSENT IS RESPECTED: no attestation is never a sanction. A
  // respecte=false verdict both lowers the venue's SPS respect variable and negates that venue's
  // per-bloc delivery at settlement (the dual proof).
  const attestationGuard = eventReadGuard;

  // GET /api/admin/events/:id/attestations — the recorded verdicts per allocated venue.
  app.get('/api/admin/events/:id/attestations', attestationGuard, async (request, reply) => {
    const params = idParamSchema.safeParse(request.params);
    if (!params.success) return invalidField(reply, 'id', 'must be a uuid');
    const rows = await db
      .selectDistinct({
        screenhostId: screenhosts.id,
        screenhostName: screenhosts.name,
        statut: eventAllocations.statut,
        respecte: eventAttestations.respecte,
        note: eventAttestations.note,
        attestedAt: eventAttestations.updatedAt,
      })
      .from(eventAllocations)
      .innerJoin(screenhosts, eq(eventAllocations.screenhostId, screenhosts.id))
      .innerJoin(campaigns, eq(eventAllocations.campaignId, campaigns.id))
      .leftJoin(
        eventAttestations,
        and(
          eq(eventAttestations.screenhostId, eventAllocations.screenhostId),
          eq(eventAttestations.eventId, params.data.id),
        ),
      )
      .where(eq(campaigns.eventId, params.data.id));
    return reply.status(200).send(
      rows.map((r) => ({
        screenhost_id: r.screenhostId,
        screenhost_name: r.screenhostName,
        statut: r.statut,
        // null = not attested = RESPECTED by rule (the UI says so explicitly).
        respecte: r.respecte,
        note: r.note,
        attested_at: r.attestedAt,
      })),
    );
  });

  // PUT /api/admin/events/:id/attestations/:screenhost_id { respecte, note? } — upsert the verdict.
  app.put(
    '/api/admin/events/:id/attestations/:screenhost_id',
    attestationGuard,
    async (request, reply) => {
      const params = venueParamsSchema.safeParse(request.params);
      if (!params.success) return invalidField(reply, 'id', 'must be a uuid');
      const body = attestationBodySchema.safeParse(request.body ?? {});
      if (!body.success) return invalidField(reply, 'respecte', 'must be a boolean');
      const authorId = request.user?.id;
      if (!authorId) {
        return reply
          .status(401)
          .send({ error: 'UNAUTHENTICATED', message: 'Authentification requise.' });
      }
      const [event] = await db.select().from(events).where(eq(events.id, params.data.id)).limit(1);
      if (!event) return sendNotFound(reply);
      // The venue must actually hold an allocation for this event — an attestation on an
      // unrelated venue is meaningless (and would silently dent its SPS).
      const [allocated] = await db
        .select({ id: eventAllocations.id })
        .from(eventAllocations)
        .innerJoin(campaigns, eq(eventAllocations.campaignId, campaigns.id))
        .where(
          and(
            eq(campaigns.eventId, params.data.id),
            eq(eventAllocations.screenhostId, params.data.screenhost_id),
          ),
        )
        .limit(1);
      if (!allocated) {
        return reply.status(404).send({
          error: 'NOT_FOUND',
          message: 'Cet établissement ne diffuse pas cet événement.',
        });
      }
      const [saved] = await db
        .insert(eventAttestations)
        .values({
          eventId: params.data.id,
          screenhostId: params.data.screenhost_id,
          authorId,
          respecte: body.data.respecte,
          note: body.data.note ?? null,
        })
        .onConflictDoUpdate({
          target: [eventAttestations.eventId, eventAttestations.screenhostId],
          set: {
            authorId,
            respecte: body.data.respecte,
            note: body.data.note ?? null,
            updatedAt: new Date(),
          },
        })
        .returning();
      if (!saved) {
        return reply
          .status(500)
          .send({ error: 'INTERNAL', message: "L'attestation n'a pas pu être enregistrée." });
      }
      // The respect variable moves with the verdict — recompute this venue's SPS now.
      try {
        await recomputeVenueSps(params.data.screenhost_id);
      } catch (err) {
        request.log.warn(
          { err, screenhostId: params.data.screenhost_id },
          'SPS recompute after attestation failed',
        );
      }
      return reply.status(200).send({
        event_id: saved.eventId,
        screenhost_id: saved.screenhostId,
        respecte: saved.respecte,
        note: saved.note,
        attested_at: saved.updatedAt,
      });
    },
  );

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

  // GET /api/admin/events/:id/tarification — EV2: the per-venue pricing detail (the operator's
  // insight surface). Read-only; annulé events still price (the operator may want the history).
  app.get('/api/admin/events/:id/tarification', adminGuard, async (request, reply) => {
    const params = idParamSchema.safeParse(request.params);
    if (!params.success) return invalidField(reply, 'id', 'must be a uuid');
    const [row] = await db.select().from(events).where(eq(events.id, params.data.id)).limit(1);
    if (!row) return sendNotFound(reply);
    const cfg = await getDispatchConfig();
    const result = await computeEventCmax(
      { id: row.id, kickoffAt: row.kickoffAt, endsAt: row.endsAt },
      cfg.eventCpmTnd,
    );
    return reply.status(200).send({
      c_max_evt_tnd: result.cMaxEvtTnd,
      i_max: result.iMax,
      eligible_count: result.eligibleCount,
      cpm_evt_tnd: result.cpmEvtTnd,
      min_budget_tnd: MIN_CAMPAIGN_BUDGET_TND,
      annule: row.annule,
      venues: result.venues.map((v) => ({
        screenhost_id: v.screenhostId,
        name: v.name,
        amax_pph: v.amaxPph,
        blocs_disponibles: v.blocsDisponibles,
        impressions: v.impressions,
      })),
    });
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
