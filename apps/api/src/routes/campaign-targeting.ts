import { and, asc, eq, inArray } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';

import { db } from '../db/client.js';
import {
  businessSectors,
  campaignTargeting,
  campaignZones,
  campaigns,
  screenhosts,
} from '../db/schema.js';
import { ownerApprovedSql } from '../lib/approved-owner.js';
import {
  broadcastableHours,
  screenhostMatchesTargeting,
  screenhostMatchesZones,
} from '../lib/dispatch/eligibility.js';
import { loadUnavailableDays } from '../lib/dispatch/pool.js';
import { availableWindowDays, buildWindowDays } from '../lib/dispatch/window.js';
import { venueHasAffluenceSql } from '../lib/venue-has-affluence.js';
import { requireAdvertiser } from '../middleware/require-advertiser.js';
import { requireAuth } from '../middleware/require-auth.js';

// Campaign targeting (L-target) — the screencaster's audience lines, built CATEGORY × CLASS. Owner-
// scoped to the campaign's advertiser (a foreign/missing campaign is a 404, never a leak); the write
// is draft-only (409 once submitted), mirroring the campaign CRUD. NULL on either axis = "toutes"
// (ALL); the NULL/NULL line = target the whole network. Lines are deduped (a repeated category×class
// is a 409) and categories are validated against the OWNER business sectors (audience='owner').
// The write is a REPLACE-SET: PUT the full list, it atomically replaces the campaign's lines.

const idParamSchema = z.object({ id: z.uuid() });

const lineSchema = z.object({
  category_id: z.uuid().nullable(),
  class: z.enum(['populaire', 'moyen', 'premium']).nullable(),
});
const putSchema = z.object({ lines: z.array(lineSchema).max(100) });
type Line = z.infer<typeof lineSchema>;

const invalidId = {
  error: 'INVALID_INPUT',
  message: 'Validation failed',
  fields: [{ field: 'id', reason: 'must be a uuid' }],
};

const sendUnauthenticated = (reply: FastifyReply) =>
  reply.status(401).send({ error: 'UNAUTHENTICATED', message: 'Authentication required.' });

// A line's identity for dedup — category_id|class with a sentinel for NULL (ALL) so two ALL lines
// collide (matches the DB's NULLS NOT DISTINCT unique).
const lineKey = (l: Line): string => `${l.category_id ?? '∅'}::${l.class ?? '∅'}`;

// Read the campaign's lines joined to category names, insertion order. Shape is the wire contract for
// both GET and the PUT echo.
const readLines = async (campaignId: string) => {
  const rows = await db
    .select({
      category_id: campaignTargeting.categoryId,
      category_name: businessSectors.name,
      class: campaignTargeting.class,
    })
    .from(campaignTargeting)
    .leftJoin(businessSectors, eq(campaignTargeting.categoryId, businessSectors.id))
    .where(eq(campaignTargeting.campaignId, campaignId))
    .orderBy(asc(campaignTargeting.createdAt), asc(campaignTargeting.id));
  return rows;
};

export const campaignTargetingRoutes: FastifyPluginAsync = async (app) => {
  const advertiserGuard = { preHandler: [requireAuth, requireAdvertiser] };

  // Owner-scoped campaign lookup (id + status + window); null when foreign/missing (→ caller
  // sends 404).
  const findOwnedCampaign = async (campaignId: string, advertiserId: string) => {
    const [row] = await db
      .select({
        id: campaigns.id,
        status: campaigns.status,
        startDate: campaigns.startDate,
        endDate: campaigns.endDate,
      })
      .from(campaigns)
      .where(and(eq(campaigns.id, campaignId), eq(campaigns.advertiserId, advertiserId)))
      .limit(1);
    return row;
  };

  // GET /api/campaigns/:id/targeting — owner-scoped read (any status).
  app.get('/api/campaigns/:id/targeting', advertiserGuard, async (request, reply) => {
    const parsedParams = idParamSchema.safeParse(request.params);
    if (!parsedParams.success) return reply.status(400).send(invalidId);
    const userId = request.user?.id;
    if (!userId) return sendUnauthenticated(reply);

    const campaign = await findOwnedCampaign(parsedParams.data.id, userId);
    if (!campaign) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'No such campaign.' });
    }
    return reply.status(200).send({ lines: await readLines(campaign.id) });
  });

  // GET /api/campaigns/:id/coverage — the ACTIVE, coordinate-bearing screenhosts the campaign
  // would land on, for the advertiser's coverage-map preview. Owner-scoped to the campaign (a
  // foreign/missing id is a 404, never a leak — an advertiser cannot enumerate the network through
  // someone else's draft). Matching reuses the dispatch eligibility primitives
  // (screenhostMatchesTargeting / screenhostMatchesZones) so the preview mirrors L-disp exactly.
  // MAP-2 (Mejri 08/09 point 3, 2026-09-12): the coverage IS the dispatch-eligible set — active ∩
  // horaires set ∩ capacity set ∩ targeting ∩ zones, the same gates as assemblePool — so the map
  // and its caption count « the hosts that count for the campaign ». Coordinates are a
  // PLOTTABILITY attribute, not an eligibility one: `screenhosts` carries the plottable subset,
  // `covered_count` the whole set, `without_coordinates` the unplottable remainder (said out loud
  // on the badge). Before this the map plotted active ∩ located ∩ matches, hours and capacity
  // ignored, and the caption counted the dots. CF-U2 (VF US-2.1) — NO targeting lines = the WHOLE NETWORK (the
  // engine treats empty targeting as no criterion, not as nothing). The zone clause (CF-Z1)
  // applies on EVERY path — the engine's eligibility does, so a targeted+zoned campaign's map
  // must not show venues dispatch will exclude. Coordinates are numeric in the DB → coerced to
  // numbers for the map.
  // MAP-4 (Mejri/operator 2026-09-16) — three more gates, all counted (covered_count and
  // without_coordinates move with them):
  //   • APPROVED OWNER (ELIG-2) — the venue's owner exists and is validated; ownerless, pending,
  //     rejected and banned owners are out, exactly as they are out of the pool
  //     (lib/approved-owner.ts, the one predicate).
  //   • AVAILABLE IN THE WINDOW — at least ONE day of [start_date, end_date] (inclusive, Tunis
  //     calendar dates) that the owner has not declared unavailable. One free day is enough. The
  //     days are the pool's own (buildWindowDays → loadUnavailableDays → availableWindowDays), so
  //     the map and dispatch agree on it. A campaign without both dates yet (an early draft) skips
  //     this gate: there is no window to test, and hiding the whole network would say « nothing
  //     reachable » when the truth is « not asked yet ».
  //   • AT LEAST ONE AFFLUENCE VALUE — one manual grid cell > 0 still in effect, or one live
  //     measured value > 0 (lib/venue-has-affluence.ts). Zero or NULL everywhere = no audience =
  //     no dot.
  // The response shape (screenhosts / covered_count / without_coordinates) is unchanged.
  app.get('/api/campaigns/:id/coverage', advertiserGuard, async (request, reply) => {
    const parsedParams = idParamSchema.safeParse(request.params);
    if (!parsedParams.success) return reply.status(400).send(invalidId);
    const userId = request.user?.id;
    if (!userId) return sendUnauthenticated(reply);

    const campaign = await findOwnedCampaign(parsedParams.data.id, userId);
    if (!campaign) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'No such campaign.' });
    }

    const lines = await db
      .select({ categoryId: campaignTargeting.categoryId, class: campaignTargeting.class })
      .from(campaignTargeting)
      .where(eq(campaignTargeting.campaignId, campaign.id));

    // Pull the active venues of approved owners that carry an affluence value (MAP-4 — the two
    // shared SQL predicates), then apply the pool's gates + matchers in memory (the matchers are
    // the shared dispatch primitives).
    const venues = await db
      .select({
        id: screenhosts.id,
        name: screenhosts.name,
        latitude: screenhosts.latitude,
        longitude: screenhosts.longitude,
        businessSectorId: screenhosts.businessSectorId,
        class: screenhosts.class,
        zoneId: screenhosts.zoneId,
        openingHour: screenhosts.openingHour,
        closingHour: screenhosts.closingHour,
        broadcastCapacity: screenhosts.broadcastCapacity,
        // CF-SK1 rider — the venue's sector NAME so the map popup can chip the real category
        // (CF-U4 shipped a truthful « Établissement couvert » placeholder pending this field).
        sectorName: businessSectors.name,
      })
      .from(screenhosts)
      .leftJoin(businessSectors, eq(screenhosts.businessSectorId, businessSectors.id))
      .where(and(eq(screenhosts.isActive, true), ownerApprovedSql(), venueHasAffluenceSql()));

    const zoneRows = await db
      .select({ zoneId: campaignZones.zoneId })
      .from(campaignZones)
      .where(eq(campaignZones.campaignId, campaign.id));
    const zoneIds = zoneRows.map((z) => z.zoneId);

    // The zone clause gates every path; the matcher owns the empty-set semantics (E5.1 —
    // zero lines = whole network), so the preview provably mirrors dispatch with no local guard.
    const matched = venues
      .filter(
        (v) =>
          v.broadcastCapacity !== null &&
          broadcastableHours(v.openingHour, v.closingHour).length > 0,
      )
      .filter((v) => screenhostMatchesZones(v.zoneId, zoneIds))
      .filter((v) =>
        screenhostMatchesTargeting({ businessSectorId: v.businessSectorId, class: v.class }, lines),
      );

    // MAP-4 — available on at least one window day (skipped while the draft has no window).
    const { startDate, endDate } = campaign;
    let eligible = matched;
    if (startDate !== null && endDate !== null) {
      const windowDays = buildWindowDays(startDate, endDate);
      const unavailable = await loadUnavailableDays(
        db,
        matched.map((v) => v.id),
        startDate,
        endDate,
      );
      eligible = matched.filter(
        (v) => availableWindowDays(windowDays, unavailable.get(v.id)).length > 0,
      );
    }

    const plottable = eligible.filter((v) => v.latitude !== null && v.longitude !== null);
    const matching = plottable.map((v) => ({
      id: v.id,
      name: v.name,
      latitude: Number(v.latitude),
      longitude: Number(v.longitude),
      sector_name: v.sectorName,
    }));

    return reply.status(200).send({
      screenhosts: matching,
      covered_count: eligible.length,
      without_coordinates: eligible.length - plottable.length,
    });
  });

  // PUT /api/campaigns/:id/targeting — replace-set the campaign's targeting lines (draft-only).
  app.put('/api/campaigns/:id/targeting', advertiserGuard, async (request, reply) => {
    const parsedParams = idParamSchema.safeParse(request.params);
    if (!parsedParams.success) return reply.status(400).send(invalidId);
    const parsed = putSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: parsed.error.issues.map((i) => ({ field: i.path.join('.'), reason: i.message })),
      });
    }
    const userId = request.user?.id;
    if (!userId) return sendUnauthenticated(reply);

    const campaign = await findOwnedCampaign(parsedParams.data.id, userId);
    if (!campaign) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'No such campaign.' });
    }
    if (campaign.status !== 'draft') {
      return reply.status(409).send({
        error: 'CONFLICT',
        message: 'Only a draft campaign can be retargeted.',
        statusCode: 409,
      });
    }

    const { lines } = parsed.data;

    // Dedup: a category×class line may appear at most once (ALL counts as a value).
    const seen = new Set<string>();
    for (const line of lines) {
      const key = lineKey(line);
      if (seen.has(key)) {
        return reply.status(409).send({
          error: 'CONFLICT',
          message: 'Cette combinaison est déjà ciblée.',
          statusCode: 409,
        });
      }
      seen.add(key);
    }

    // "Tout le réseau" (NULL/NULL) is exhaustive — it cannot be combined with specific lines.
    const hasAllAll = lines.some((l) => l.category_id === null && l.class === null);
    if (hasAllAll && lines.length > 1) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: [{ field: 'lines', reason: '“tout le réseau” must be the only line' }],
      });
    }

    // Validate categories: every non-null category_id must be a real OWNER business sector.
    const categoryIds = [
      ...new Set(lines.map((l) => l.category_id).filter((c): c is string => c !== null)),
    ];
    if (categoryIds.length > 0) {
      const valid = await db
        .select({ id: businessSectors.id })
        .from(businessSectors)
        .where(
          and(inArray(businessSectors.id, categoryIds), eq(businessSectors.audience, 'owner')),
        );
      if (valid.length !== categoryIds.length) {
        return reply.status(400).send({
          error: 'INVALID_INPUT',
          message: 'Validation failed',
          fields: [{ field: 'category_id', reason: 'must be a valid venue category' }],
        });
      }
    }

    // Replace-set atomically: clear the campaign's lines, insert the new set.
    await db.transaction(async (tx) => {
      await tx.delete(campaignTargeting).where(eq(campaignTargeting.campaignId, campaign.id));
      if (lines.length > 0) {
        await tx.insert(campaignTargeting).values(
          lines.map((l) => ({
            campaignId: campaign.id,
            categoryId: l.category_id,
            class: l.class,
          })),
        );
      }
    });

    return reply.status(200).send({ lines: await readLines(campaign.id) });
  });
};
