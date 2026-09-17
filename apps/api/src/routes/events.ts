import { and, asc, eq, gte, lt } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';

import { db } from '../db/client.js';
import { type EventRow, campaigns, events } from '../db/schema.js';
import { MIN_CAMPAIGN_BUDGET_TND } from '../lib/campaign-budget.js';
import { tunisDateOf } from '../lib/campaign-dates.js';
import { getDispatchConfig } from '../lib/dispatch/config.js';
import { computeEventCmax } from '../lib/event-pricing/pricing.js';
import {
  SUGGESTED_MATCH_DURATION_HOURS,
  fenetreDiffusion,
  statutEvenement,
} from '../lib/fenetre-diffusion.js';
import { requireAdvertiser } from '../middleware/require-advertiser.js';
import { requireAuth } from '../middleware/require-auth.js';
import { storage } from '../storage/s3-storage.js';

// EV1 — the advertiser-facing event catalogue (sport-only V1). Reads are SHARED (no owner
// scoping — every advertiser sees the same catalogue and the same suggested list; suggestions are
// a communal surface by design). The diffusion window/blocs are ALWAYS derived per response via
// lib/fenetre-diffusion — never stored. EV3 adds POST /:id/positionner (the parcours entry —
// creates the campaign_type='event' draft row); hour_reservations is still written by nothing.

const idParamSchema = z.object({ id: z.uuid() });

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const sendUnauthenticated = (reply: FastifyReply) =>
  reply.status(401).send({ error: 'UNAUTHENTICATED', message: 'Authentification requise.' });

const invalidField = (reply: FastifyReply, field: string, reason: string) =>
  reply
    .status(400)
    .send({ error: 'INVALID_INPUT', message: 'Validation échouée', fields: [{ field, reason }] });

// The shared wire shape. `statut` is derived at read time (Tunis wall-clock = the instant — the
// comparison is instant-vs-instant, timezone-free); the window rides along so no client ever
// recomputes it.
export const eventView = (row: EventRow, now: Date) => {
  const fenetre = fenetreDiffusion(row.kickoffAt, row.endsAt);
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    type: row.type,
    category: row.category,
    kickoff_at: row.kickoffAt.toISOString(),
    ends_at: row.endsAt.toISOString(),
    statut: statutEvenement(now, row.kickoffAt, row.endsAt),
    source: row.source,
    has_image: row.imageKey !== null,
    fenetre: {
      window_start: fenetre.windowStart.toISOString(),
      window_end: fenetre.windowEnd.toISOString(),
      blocs: fenetre.blocs.map((b) => ({
        phase: b.phase,
        start: b.start.toISOString(),
        end: b.end.toISOString(),
      })),
    },
  };
};

// « Suggérer un match » — all four fields required; kickoff is composed in Tunis wall-clock
// (UTC+1, no DST since 2008 — the campaign-dates posture) and the end is fixed by the product
// constant (+2 h), since a suggestion declares no end of its own.
const suggestBodySchema = z.object({
  team_a: z.string().optional(),
  team_b: z.string().optional(),
  date: z.string().optional(),
  kickoff_time: z.string().optional(),
});

export const eventsRoutes: FastifyPluginAsync = async (app) => {
  const advertiserGuard = { preHandler: [requireAuth, requireAdvertiser] };

  // GET /api/events — the OFFICIAL catalogue: not annulé, live-or-future (an event stays listed
  // while en cours), kickoff ascending. Suggested matches NEVER appear here.
  app.get('/api/events', advertiserGuard, async (_request, reply) => {
    const now = new Date();
    const rows = await db
      .select()
      .from(events)
      .where(and(eq(events.source, 'official'), eq(events.annule, false), gte(events.endsAt, now)))
      .orderBy(asc(events.kickoffAt));
    return reply.status(200).send({ events: rows.map((r) => eventView(r, now)) });
  });

  // GET /api/events/suggested — « Ce que les screencasters suggèrent »: the SHARED suggestion
  // list, same shape and same liveness filter as the catalogue.
  app.get('/api/events/suggested', advertiserGuard, async (_request, reply) => {
    const now = new Date();
    const rows = await db
      .select()
      .from(events)
      .where(and(eq(events.source, 'suggested'), eq(events.annule, false), gte(events.endsAt, now)))
      .orderBy(asc(events.kickoffAt));
    return reply.status(200).send({ events: rows.map((r) => eventView(r, now)) });
  });

  // POST /api/events/suggest — {team_a, team_b, date, kickoff_time}, ALL required (a 400 names
  // the offending field). The event is named « A – B », ends kickoff + 2 h, source 'suggested'.
  // An EXACT duplicate (both teams, either order, case-insensitive + the same kickoff DATE) is
  // refused with a pointer to the shared list.
  app.post('/api/events/suggest', advertiserGuard, async (request, reply) => {
    const userId = request.user?.id;
    if (!userId) return sendUnauthenticated(reply);
    const parsed = suggestBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) return invalidField(reply, 'body', 'corps de requête invalide');
    const teamA = parsed.data.team_a?.trim() ?? '';
    const teamB = parsed.data.team_b?.trim() ?? '';
    const date = parsed.data.date?.trim() ?? '';
    const kickoffTime = parsed.data.kickoff_time?.trim() ?? '';
    if (teamA === '') return invalidField(reply, 'team_a', "L'équipe A est obligatoire.");
    if (teamB === '') return invalidField(reply, 'team_b', "L'équipe B est obligatoire.");
    if (date === '') return invalidField(reply, 'date', 'La date du match est obligatoire.');
    if (kickoffTime === '')
      return invalidField(reply, 'kickoff_time', "L'horaire du match est obligatoire.");
    if (!DATE_RE.test(date) || Number.isNaN(new Date(`${date}T00:00:00Z`).getTime()))
      return invalidField(reply, 'date', 'La date doit être au format AAAA-MM-JJ.');
    if (!TIME_RE.test(kickoffTime))
      return invalidField(reply, 'kickoff_time', "L'horaire doit être au format HH:MM.");

    const kickoffAt = new Date(`${date}T${kickoffTime}:00+01:00`);
    const endsAt = new Date(kickoffAt.getTime() + SUGGESTED_MATCH_DURATION_HOURS * 60 * 60 * 1000);

    // Duplicate gate (amended at ratification): the same-day non-annulé rows of BOTH sources are
    // matched against « A – B » AND « B – A » case-insensitively (the same fixture is the same
    // match whichever way the suggester typed it). An OFFICIAL twin refuses with its own message —
    // accepting it would mint TWO entities for ONE real-world match, an EV3/EV4 integrity trap
    // (R4's one-screenhost-one-match rule could never see they are the same). The day bounds are
    // Tunis midnights as instants.
    const dayStart = new Date(`${date}T00:00:00+01:00`);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    const sameDay = await db
      .select({ name: events.name, source: events.source })
      .from(events)
      .where(
        and(
          eq(events.annule, false),
          gte(events.kickoffAt, dayStart),
          lt(events.kickoffAt, dayEnd),
        ),
      );
    const candidates = new Set([
      `${teamA} – ${teamB}`.toLowerCase(),
      `${teamB} – ${teamA}`.toLowerCase(),
    ]);
    const twins = sameDay.filter((r) => candidates.has(r.name.toLowerCase()));
    if (twins.some((r) => r.source === 'official')) {
      return reply.status(409).send({
        error: 'CONFLICT',
        message: 'Ce match existe déjà dans le catalogue officiel.',
        statusCode: 409,
        requestId: request.id,
      });
    }
    if (twins.length > 0) {
      return reply.status(409).send({
        error: 'CONFLICT',
        message:
          'Ce match a déjà été suggéré pour cette date — retrouvez-le dans « Ce que les screencasters suggèrent ».',
        statusCode: 409,
        requestId: request.id,
      });
    }

    const [created] = await db
      .insert(events)
      .values({
        name: `${teamA} – ${teamB}`,
        type: 'sport',
        kickoffAt,
        endsAt,
        source: 'suggested',
        suggestedBy: userId,
      })
      .returning();
    if (!created) {
      return reply
        .status(500)
        .send({ error: 'INTERNAL', message: "La suggestion n'a pas pu être enregistrée." });
    }
    return reply.status(201).send(eventView(created, new Date()));
  });

  // POST /api/events/:id/positionner — EV3: create the POSITIONING draft. A positioning IS a
  // campaign row (campaign_type='event' + event_id): name = the match, start/end = the diffusion
  // window's Tunis dates SNAPSHOTTED here (the window itself stays derived at read — these dates
  // exist so the CF-S1/C1/S2 machinery works unmodified). From here the row rides the ENTIRE
  // classic draft machinery: PATCH steps, zones (CF-Z1), creative link, cart, lifecycle.
  app.post('/api/events/:id/positionner', advertiserGuard, async (request, reply) => {
    const parsed = idParamSchema.safeParse(request.params);
    if (!parsed.success) return invalidField(reply, 'id', 'must be a uuid');
    const userId = request.user?.id;
    if (!userId) return sendUnauthenticated(reply);
    const [row] = await db.select().from(events).where(eq(events.id, parsed.data.id)).limit(1);
    if (!row)
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Événement introuvable.' });
    if (row.annule) {
      return reply.status(409).send({
        error: 'EVENT_ANNULE',
        message: 'Cet événement est annulé.',
        statusCode: 409,
        requestId: request.id,
      });
    }
    if (statutEvenement(new Date(), row.kickoffAt, row.endsAt) === 'termine') {
      return reply.status(409).send({
        error: 'EVENT_TERMINE',
        message: 'Cet événement est terminé — le positionnement n’est plus possible.',
        statusCode: 409,
        requestId: request.id,
      });
    }
    const fenetre = fenetreDiffusion(row.kickoffAt, row.endsAt);
    const [created] = await db
      .insert(campaigns)
      .values({
        advertiserId: userId,
        name: row.name,
        campaignType: 'event',
        status: 'draft',
        startDate: tunisDateOf(fenetre.windowStart),
        endDate: tunisDateOf(fenetre.windowEnd),
        eventId: row.id,
      })
      .returning();
    if (!created) {
      return reply
        .status(500)
        .send({ error: 'INTERNAL', message: "Le positionnement n'a pas pu être créé." });
    }
    return reply.status(201).send({
      id: created.id,
      event_id: row.id,
      name: created.name,
      campaign_type: created.campaignType,
      status: created.status,
      start_date: created.startDate,
      end_date: created.endDate,
    });
  });

  // GET /api/events/:id/cmax — EV2: the event budget ceiling (the campaign-cmax response idiom).
  // The event engine prices WITHOUT the attention coefficient; the shared 100 TND floor rides
  // along so the EV3 slider needs no second read.
  app.get('/api/events/:id/cmax', advertiserGuard, async (request, reply) => {
    const parsed = idParamSchema.safeParse(request.params);
    if (!parsed.success) return invalidField(reply, 'id', 'must be a uuid');
    const [row] = await db.select().from(events).where(eq(events.id, parsed.data.id)).limit(1);
    if (!row)
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Événement introuvable.' });
    if (row.annule) {
      return reply.status(409).send({
        error: 'EVENT_ANNULE',
        message: 'Cet événement est annulé.',
        statusCode: 409,
        requestId: request.id,
      });
    }
    // CPM-1 — this prices the MATCH, not a positioning (none exists yet for this caller): the
    // live config is what a positioning created now would capture. An existing positioning's
    // ceiling is GET /api/campaigns/:id/cmax, priced at its own CPM.
    const cfg = await getDispatchConfig();
    const result = await computeEventCmax(
      { id: row.id, kickoffAt: row.kickoffAt, endsAt: row.endsAt },
      cfg.eventCpmTnd,
    );
    return reply.status(200).send({
      c_max_evt_tnd: result.cMaxEvtTnd,
      i_max: result.iMax,
      eligible_count: result.eligibleCount,
      min_budget_tnd: MIN_CAMPAIGN_BUDGET_TND,
    });
  });

  // GET /api/events/:id/image-url — presign the affiche on demand (shared read: any advertiser).
  app.get('/api/events/:id/image-url', advertiserGuard, async (request, reply) => {
    const parsed = idParamSchema.safeParse(request.params);
    if (!parsed.success) return invalidField(reply, 'id', 'must be a uuid');
    const [row] = await db
      .select({ imageKey: events.imageKey })
      .from(events)
      .where(eq(events.id, parsed.data.id))
      .limit(1);
    if (!row)
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Événement introuvable.' });
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
