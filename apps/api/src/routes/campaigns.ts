import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { db } from '../db/client.js';
import {
  businessSectors,
  campaignDispatchAllocation,
  campaignDispatchPlan,
  campaignReconciliation,
  campaignTargeting,
  campaignZones,
  campaigns,
  creatives,
  eventAllocations,
  events,
  screenhosts,
  zones,
} from '../db/schema.js';
import { MIN_CAMPAIGN_BUDGET_TND } from '../lib/campaign-budget.js';
import { computeCampaignCmax } from '../lib/campaign-cmax.js';
import {
  type StartDateViolation,
  premiereDateDisponible,
  startDateViolation,
} from '../lib/campaign-dates.js';
import { getDispatchConfig } from '../lib/dispatch/config.js';
import { measureEventDelivery } from '../lib/event-playout/settlement.js';
import { computeEventCmax } from '../lib/event-pricing/pricing.js';
import { validateEventSpot } from '../lib/event-pricing/spot.js';
import { requireAdvertiser } from '../middleware/require-advertiser.js';
import { requireAuth } from '../middleware/require-auth.js';

// Advertiser campaign draft lifecycle (C1) — greenfield on the toodooh API (the existing 6-step
// NewCampaign wizard is Supabase-backed). Every read/write is owner-scoped to the authenticated
// advertiser via advertiser_id: a foreign id is indistinguishable from a missing one (404, never a
// leak). Edits and deletes are draft-only (409 once submitted); submit is the single draft→pending
// transition. Targeting/video/map/owner-approval/pricing land in later lanes.

// CF-Q2 (spec §1.4) — the start-date floor lives in ONE place (lib/campaign-dates: a J+2
// WORKING-DAY LEAD; per ruling #10 any start day is legal, week-ends included). Enforced on
// create, PATCH and submit (a stale draft must not slip through at submit time). Admin
// activation is untouched (parked).
// CF-D1 — the lead is calibratable (dispatch_config.campaign_lead_working_days, default 2); the
// rejection payload reflects the lead that actually gated the request.
const startDateRejection = (violation: StartDateViolation, leadWorkingDays: number) => ({
  error: 'INVALID_START_DATE',
  reason: violation,
  message: `La date de début doit être au moins ${leadWorkingDays} jour(s) ouvré(s) plus tard.`,
  first_available_start_date: premiereDateDisponible(new Date(), leadWorkingDays),
});

/** The configured campaign start-date lead (working days). */
const campaignLead = async (): Promise<number> =>
  (await getDispatchConfig()).campaignLeadWorkingDays;

// CF-Z1 — zone_ids must all reference ACTIVE zones; anything else is a 400 INVALID_ZONE.
async function invalidZoneIds(zoneIds: readonly string[]): Promise<string[]> {
  if (zoneIds.length === 0) return [];
  const active = await db
    .select({ id: zones.id })
    .from(zones)
    .where(and(inArray(zones.id, [...zoneIds]), eq(zones.active, true)));
  const known = new Set(active.map((z) => z.id));
  return zoneIds.filter((id) => !known.has(id));
}

const invalidZoneRejection = (unknown: readonly string[]) => ({
  error: 'INVALID_ZONE',
  message: 'Une ou plusieurs zones sélectionnées ne sont pas actives.',
  unknown_zone_ids: [...unknown],
});

/** Replace-set the campaign's zones (mirrors the targeting PUT semantics). */
async function replaceCampaignZones(campaignId: string, zoneIds: readonly string[]): Promise<void> {
  await db.delete(campaignZones).where(eq(campaignZones.campaignId, campaignId));
  if (zoneIds.length > 0) {
    await db
      .insert(campaignZones)
      .values([...new Set(zoneIds)].map((zoneId) => ({ campaignId, zoneId })));
  }
}

/** Batched zones-per-campaign fetch for the advertiser projections (mirrors targeting, no N+1). */
async function zonesByCampaign(
  ids: readonly string[],
): Promise<Map<string, { zone_id: string; name: string }[]>> {
  const map = new Map<string, { zone_id: string; name: string }[]>();
  if (ids.length === 0) return map;
  const rows = await db
    .select({
      campaignId: campaignZones.campaignId,
      zone_id: campaignZones.zoneId,
      name: zones.name,
    })
    .from(campaignZones)
    .innerJoin(zones, eq(campaignZones.zoneId, zones.id))
    .where(inArray(campaignZones.campaignId, [...ids]))
    .orderBy(asc(zones.name));
  for (const row of rows) {
    const list = map.get(row.campaignId) ?? [];
    list.push({ zone_id: row.zone_id, name: row.name });
    map.set(row.campaignId, list);
  }
  return map;
}

const idParamSchema = z.object({ id: z.uuid() });

// Wire shape is snake_case (apps/web-facing). start/end are ISO calendar dates (YYYY-MM-DD),
// nullable in a draft; an explicit null clears them on edit. The validated_* approval-audit trio is
// internal to the later owner/admin lane and never surfaced here (always null in C1).
const createSchema = z.object({
  name: z.string().min(1).max(200),
  campaign_type: z.string().min(1).max(100),
  start_date: z.iso.date().nullable().optional(),
  end_date: z.iso.date().nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  // Interim manual cart: an INDICATIVE budget (TND), not the engine inputs. The admin derives
  // i_cible/cpm/s/t at activation. Nullable; the cart PATCHes it before submit.
  requested_budget: z.number().positive().max(100_000_000).nullable().optional(),
  // CF-Z1 — the campaign's targeted zones (replace-set, validated against ACTIVE zones). Absent =
  // untouched; [] = clear (whole network on the zone criterion, VF US-2.1).
  zone_ids: z.array(z.uuid()).max(50).optional(),
});

// Edit accepts any subset of the create fields plus creative_id (link/unlink the campaign's creative
// — PATCH-only, NOT a create field); an empty body is a 400 (mirrors profile/screenhosts). A non-null
// creative_id must reference a creative owned by the same advertiser (validated in the handler); an
// explicit null unlinks (gate back to null).
const updateSchema = createSchema
  .partial()
  .extend({ creative_id: z.uuid().nullable().optional() })
  .refine((b) => Object.keys(b).length > 0, { message: 'At least one field is required' });
type UpdateInput = z.infer<typeof updateSchema>;

// Advertiser-facing projection — the validated_* approval-audit columns are intentionally
// omitted. reject_reason/rejected_at ARE exposed (CF-Q1): the admin stores a mandatory reason on
// reject, and the advertiser must be able to learn why their campaign was refused.
export const campaignSelection = {
  id: campaigns.id,
  name: campaigns.name,
  campaignType: campaigns.campaignType,
  status: campaigns.status,
  startDate: campaigns.startDate,
  endDate: campaigns.endDate,
  description: campaigns.description,
  requestedBudget: campaigns.requestedBudget,
  submittedAt: campaigns.submittedAt,
  rejectedAt: campaigns.rejectedAt,
  rejectReason: campaigns.rejectReason,
  // CF-S1 — the linked creative rides the projection so Reprendre can rehydrate past Création.
  creativeId: campaigns.creativeId,
  eventId: campaigns.eventId,
  createdAt: campaigns.createdAt,
  updatedAt: campaigns.updatedAt,
};

export type CampaignRow = Pick<
  typeof campaigns.$inferSelect,
  | 'id'
  | 'name'
  | 'campaignType'
  | 'status'
  | 'startDate'
  | 'endDate'
  | 'description'
  | 'requestedBudget'
  | 'submittedAt'
  | 'rejectedAt'
  | 'rejectReason'
  | 'creativeId'
  | 'eventId'
  | 'createdAt'
  | 'updatedAt'
>;

// content_validation_status is the DERIVED content gate (bifurcated approval): the validation_status
// of the linked creative, or null when no creative is linked. It is NEVER a stored campaign column —
// reads LEFT JOIN creatives to compute it. CRUD writes never link a creative (creative_id is set in
// a later lane), so a created/edited/submitted campaign always derives null here.
export const campaignView = (
  row: CampaignRow,
  contentValidationStatus: string | null = null,
): {
  id: string;
  name: string;
  campaign_type: string;
  status: string;
  start_date: string | null;
  end_date: string | null;
  description: string | null;
  requested_budget: number | null;
  content_validation_status: string | null;
  submitted_at: Date | null;
  rejected_at: Date | null;
  reject_reason: string | null;
  creative_id: string | null;
  /** EV3 — the positioned match (campaign_type='event' rows); null for classic campaigns. */
  event_id: string | null;
  created_at: Date;
  updated_at: Date;
} => ({
  id: row.id,
  name: row.name,
  campaign_type: row.campaignType,
  status: row.status,
  start_date: row.startDate,
  end_date: row.endDate,
  description: row.description,
  requested_budget: row.requestedBudget === null ? null : Number(row.requestedBudget),
  content_validation_status: contentValidationStatus,
  submitted_at: row.submittedAt,
  rejected_at: row.rejectedAt,
  reject_reason: row.rejectReason,
  creative_id: row.creativeId,
  event_id: row.eventId,
  created_at: row.createdAt,
  updated_at: row.updatedAt,
});

// Map provided wire fields → drizzle columns; an absent key leaves the column untouched, an explicit
// null clears a nullable date/description.
const buildUpdatePatch = (data: UpdateInput): Partial<typeof campaigns.$inferInsert> => {
  const patch: Partial<typeof campaigns.$inferInsert> = {};
  if (data.name !== undefined) patch.name = data.name;
  if (data.campaign_type !== undefined) patch.campaignType = data.campaign_type;
  if (data.start_date !== undefined) patch.startDate = data.start_date;
  if (data.end_date !== undefined) patch.endDate = data.end_date;
  if (data.description !== undefined) patch.description = data.description;
  // numeric column → string|null; the cart PATCHes the indicative budget before submit.
  if (data.requested_budget !== undefined)
    patch.requestedBudget = data.requested_budget === null ? null : String(data.requested_budget);
  // null clears the link (gate back to null); a uuid links (existence/ownership checked in the handler).
  if (data.creative_id !== undefined) patch.creativeId = data.creative_id;
  return patch;
};

const invalidId = {
  error: 'INVALID_INPUT',
  message: 'Validation échouée',
  fields: [{ field: 'id', reason: 'must be a uuid' }],
};

export const campaignsRoutes: FastifyPluginAsync = async (app) => {
  const advertiserGuard = { preHandler: [requireAuth, requireAdvertiser] };

  // POST /api/campaigns — create a draft owned by the caller.
  app.post('/api/campaigns', advertiserGuard, async (request, reply) => {
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation échouée',
        fields: parsed.error.issues.map((i) => ({ field: i.path.join('.'), reason: i.message })),
      });
    }
    const userId = request.user?.id;
    if (!userId) {
      return reply
        .status(401)
        .send({ error: 'UNAUTHENTICATED', message: 'Authentification requise.' });
    }
    if (parsed.data.start_date) {
      const lead = await campaignLead();
      const violation = startDateViolation(parsed.data.start_date, new Date(), lead);
      if (violation) return reply.status(400).send(startDateRejection(violation, lead));
    }
    if (parsed.data.zone_ids?.length) {
      const unknown = await invalidZoneIds(parsed.data.zone_ids);
      if (unknown.length > 0) return reply.status(400).send(invalidZoneRejection(unknown));
    }
    const [created] = await db
      .insert(campaigns)
      .values({
        advertiserId: userId,
        name: parsed.data.name,
        campaignType: parsed.data.campaign_type,
        status: 'draft',
        startDate: parsed.data.start_date ?? null,
        endDate: parsed.data.end_date ?? null,
        description: parsed.data.description ?? null,
        requestedBudget:
          parsed.data.requested_budget === undefined || parsed.data.requested_budget === null
            ? null
            : String(parsed.data.requested_budget),
      })
      .returning(campaignSelection);
    if (parsed.data.zone_ids?.length && created) {
      await replaceCampaignZones((created as CampaignRow).id, parsed.data.zone_ids);
    }
    return reply.status(201).send(campaignView(created as CampaignRow));
  });

  // GET /api/campaigns/mine — the caller's own campaigns, newest first. Each item is the advertiser
  // projection PLUS reconciled performance: delivered impressions + the caller's NET SPEND debit
  // (campaign_reconciliation, 1:1 by unique campaign_id → cannot multiply rows; null until reconciled),
  // and the campaign's targeting lines (1:many → batched SEPARATELY, never joined into the main SELECT
  // or it would multiply campaign rows and corrupt the 1:1 spend mapping). Every read is owner-scoped:
  // the WHERE pins advertiser_id=caller, reconciliation rides that scope via the LEFT JOIN, and the
  // targeting batch is restricted to the already-owner-filtered ids — no cross-advertiser path.
  app.get('/api/campaigns/mine', advertiserGuard, async (request, reply) => {
    const userId = request.user?.id;
    if (!userId) {
      return reply
        .status(401)
        .send({ error: 'UNAUTHENTICATED', message: 'Authentification requise.' });
    }
    const rows = await db
      .select({
        ...campaignSelection,
        contentValidationStatus: creatives.validationStatus,
        deliveredImp: campaignReconciliation.deliveredImp,
        spendTnd: campaignReconciliation.spendTnd,
        reconciledAt: campaignReconciliation.reconciledAt,
      })
      .from(campaigns)
      .leftJoin(creatives, eq(campaigns.creativeId, creatives.id))
      .leftJoin(campaignReconciliation, eq(campaignReconciliation.campaignId, campaigns.id))
      .where(eq(campaigns.advertiserId, userId))
      .orderBy(desc(campaigns.createdAt));

    // Targeting is 1:many — fetch ALL lines for the owner-scoped ids in ONE batched query (no N+1),
    // grouped by campaign in JS. inArray over ids that are already advertiser-filtered = no leak.
    const ids = rows.map((r) => r.id);
    const targetingByCampaign = new Map<
      string,
      { category_id: string | null; category_name: string | null; class: string | null }[]
    >();
    if (ids.length > 0) {
      const lines = await db
        .select({
          campaignId: campaignTargeting.campaignId,
          category_id: campaignTargeting.categoryId,
          category_name: businessSectors.name,
          class: campaignTargeting.class,
        })
        .from(campaignTargeting)
        .leftJoin(businessSectors, eq(campaignTargeting.categoryId, businessSectors.id))
        .where(inArray(campaignTargeting.campaignId, ids))
        .orderBy(asc(campaignTargeting.createdAt), asc(campaignTargeting.id));
      for (const line of lines) {
        const list = targetingByCampaign.get(line.campaignId) ?? [];
        list.push({
          category_id: line.category_id,
          category_name: line.category_name,
          class: line.class,
        });
        targetingByCampaign.set(line.campaignId, list);
      }
    }

    const zoneMap = await zonesByCampaign(ids);

    // CF-HF3 (Mejri item 3) — « Impressions prévues »: the FROZEN plan's placed facturable
    // (Σ allocations.ii_potentiel over the campaign's unique plan), null when no plan exists yet
    // (the web falls back to the budget-derived estimate). A pure READ of the plan — the display
    // rule never recomputes engine numbers.
    const plannedByCampaign = new Map<string, number>();
    if (ids.length > 0) {
      const planned = await db
        .select({
          campaignId: campaignDispatchPlan.campaignId,
          placedFact: sql<string>`coalesce(sum(${campaignDispatchAllocation.iiPotentiel}), 0)`,
        })
        .from(campaignDispatchPlan)
        .innerJoin(
          campaignDispatchAllocation,
          eq(campaignDispatchAllocation.planId, campaignDispatchPlan.id),
        )
        .where(inArray(campaignDispatchPlan.campaignId, ids))
        .groupBy(campaignDispatchPlan.campaignId);
      for (const p of planned) plannedByCampaign.set(p.campaignId, Number(p.placedFact));
    }

    return reply.status(200).send(
      rows.map((r) => ({
        ...campaignView(r, r.contentValidationStatus),
        zones: zoneMap.get(r.id) ?? [],
        // delivered impressions + net spend come from the 1:1 reconciliation row — null until reconciled.
        delivered_impressions: r.deliveredImp ?? null,
        spend_tnd: r.spendTnd == null ? null : Number(r.spendTnd),
        reconciled_at: r.reconciledAt ?? null,
        targeting: targetingByCampaign.get(r.id) ?? [],
        planned_impressions: plannedByCampaign.get(r.id) ?? null,
      })),
    );
  });

  // GET /api/campaigns/:id — owner-scoped read (404 on a foreign or missing id).
  app.get('/api/campaigns/:id', advertiserGuard, async (request, reply) => {
    const parsedParams = idParamSchema.safeParse(request.params);
    if (!parsedParams.success) return reply.status(400).send(invalidId);
    const userId = request.user?.id;
    if (!userId) {
      return reply
        .status(401)
        .send({ error: 'UNAUTHENTICATED', message: 'Authentification requise.' });
    }
    const [row] = await db
      .select({ ...campaignSelection, contentValidationStatus: creatives.validationStatus })
      .from(campaigns)
      .leftJoin(creatives, eq(campaigns.creativeId, creatives.id))
      .where(and(eq(campaigns.id, parsedParams.data.id), eq(campaigns.advertiserId, userId)))
      .limit(1);
    if (!row) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Campagne introuvable.' });
    }
    const zoneMap = await zonesByCampaign([row.id]);
    return reply.status(200).send({
      ...campaignView(row, row.contentValidationStatus),
      zones: zoneMap.get(row.id) ?? [],
    });
  });

  // PATCH /api/campaigns/:id — owner-scoped edit, draft-only (409 once submitted).
  app.patch('/api/campaigns/:id', advertiserGuard, async (request, reply) => {
    const parsedParams = idParamSchema.safeParse(request.params);
    if (!parsedParams.success) return reply.status(400).send(invalidId);
    const parsed = updateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation échouée',
        fields: parsed.error.issues.map((i) => ({ field: i.path.join('.'), reason: i.message })),
      });
    }
    const userId = request.user?.id;
    if (!userId) {
      return reply
        .status(401)
        .send({ error: 'UNAUTHENTICATED', message: 'Authentification requise.' });
    }
    // CF-Q2 — an explicit null still clears the date; only a SET start date meets the floor.
    if (parsed.data.start_date) {
      const lead = await campaignLead();
      const violation = startDateViolation(parsed.data.start_date, new Date(), lead);
      if (violation) return reply.status(400).send(startDateRejection(violation, lead));
    }
    // CF-Z1 — zone_ids: absent = untouched; [] = clear; ids must reference active zones.
    if (parsed.data.zone_ids !== undefined && parsed.data.zone_ids.length > 0) {
      const unknown = await invalidZoneIds(parsed.data.zone_ids);
      if (unknown.length > 0) return reply.status(400).send(invalidZoneRejection(unknown));
    }
    // Owner-scope in the WHERE: a foreign id is indistinguishable from a missing one.
    const [existing] = await db
      .select({ id: campaigns.id, status: campaigns.status, eventId: campaigns.eventId })
      .from(campaigns)
      .where(and(eq(campaigns.id, parsedParams.data.id), eq(campaigns.advertiserId, userId)))
      .limit(1);
    if (!existing) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Campagne introuvable.' });
    }
    // CF-S1 — a Non validé campaign is RECOVERABLE: editable like a draft (resubmit clears the
    // rejection audit below in /submit).
    if (existing.status !== 'draft' && existing.status !== 'rejected') {
      return reply.status(409).send({
        error: 'CONFLICT',
        message: 'Seule une campagne en brouillon ou rejetée peut être modifiée.',
        statusCode: 409,
      });
    }
    // EV3 — the snapshot invariant: a positioning's dates are the diffusion window captured at
    // creation and its type is its identity — neither is PATCHable (budget, creative link, zones
    // and description are). The window itself always derives at read from the event.
    if (
      existing.eventId !== null &&
      (parsed.data.start_date !== undefined ||
        parsed.data.end_date !== undefined ||
        parsed.data.campaign_type !== undefined)
    ) {
      return reply.status(400).send({
        error: 'EVENT_FIELDS_LOCKED',
        message: 'Les dates d’un positionnement suivent la fenêtre de diffusion du match.',
      });
    }
    // Linking a creative: it must EXIST and belong to the SAME advertiser — owner-scoped 404 (a
    // foreign or nonexistent creative is indistinguishable from missing). null unlinks (no lookup).
    if (parsed.data.creative_id != null) {
      const [creative] = await db
        .select({
          id: creatives.id,
          creativeType: creatives.creativeType,
          durationSeconds: creatives.durationSeconds,
        })
        .from(creatives)
        .where(and(eq(creatives.id, parsed.data.creative_id), eq(creatives.advertiserId, userId)))
        .limit(1);
      if (!creative) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: 'Créative introuvable.' });
      }
      // EV3 — an event positioning's spot must fit the 15-second antenne grid (EV2's seam,
      // wired here): a longer VIDEO can never air in a bloc, so the ATTACH refuses — whether
      // the spot came fresh from upload or from the bibliothèque (CF-SK1 hash-inherit included:
      // inheritance moves the validation verdict, never the length).
      if (existing.eventId !== null) {
        const verdict = validateEventSpot(creative);
        if (!verdict.ok) {
          return reply.status(400).send({ error: 'EVENT_SPOT_TOO_LONG', message: verdict.reason });
        }
      }
    }
    // CF-Z1 — a zone-only PATCH has an empty columns patch: skip the UPDATE (drizzle rejects an
    // empty set()) and re-read the row; otherwise update as before. Zones replace-set after.
    const columnsPatch = buildUpdatePatch(parsed.data);
    let updated: CampaignRow | undefined;
    if (Object.keys(columnsPatch).length > 0) {
      const [row] = await db
        .update(campaigns)
        .set(columnsPatch)
        .where(and(eq(campaigns.id, existing.id), eq(campaigns.advertiserId, userId)))
        .returning(campaignSelection);
      updated = row as CampaignRow;
    } else {
      const [row] = await db
        .select(campaignSelection)
        .from(campaigns)
        .where(and(eq(campaigns.id, existing.id), eq(campaigns.advertiserId, userId)))
        .limit(1);
      updated = row as CampaignRow;
    }
    if (parsed.data.zone_ids !== undefined) {
      await replaceCampaignZones(existing.id, parsed.data.zone_ids);
    }
    return reply.status(200).send(campaignView(updated as CampaignRow));
  });

  // GET /api/campaigns/:id/cmax — E5 (VF US-1.3): the live C_max ceiling for the Validation-step
  // budget cursor. Owner-scoped (foreign ≡ missing 404). Requires dates + a linked creative with a
  // duration (the spot length S prices the pool) — else 409 CMAX_REQUIRES naming what's missing.
  // NO caching beyond the request: the cursor must reflect live occupancy (the FE layer handles
  // staleness with a short staleTime).
  app.get('/api/campaigns/:id/cmax', advertiserGuard, async (request, reply) => {
    const parsedParams = idParamSchema.safeParse(request.params);
    if (!parsedParams.success) return reply.status(400).send(invalidId);
    const userId = request.user?.id;
    if (!userId) {
      return reply
        .status(401)
        .send({ error: 'UNAUTHENTICATED', message: 'Authentification requise.' });
    }
    const [row] = await db
      .select({
        id: campaigns.id,
        startDate: campaigns.startDate,
        endDate: campaigns.endDate,
        campaignType: campaigns.campaignType,
        eventId: campaigns.eventId,
        creativeId: campaigns.creativeId,
        creativeDurationSeconds: creatives.durationSeconds,
      })
      .from(campaigns)
      .leftJoin(creatives, eq(campaigns.creativeId, creatives.id))
      .where(and(eq(campaigns.id, parsedParams.data.id), eq(campaigns.advertiserId, userId)))
      .limit(1);
    if (!row) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Campagne introuvable.' });
    }
    // EV3 — a POSITIONING (an event-BOUND row: event_id set — the binding is the discriminator;
    // a legacy 'event'-TYPED row without a binding stays fully classic) prices via EV2's event
    // engine (CPM_evt over the A_max blocs): no dates/creative prerequisite (the window is the
    // event's, there is no T coefficient) and the classic C_max is NEVER consulted (it throws on
    // bound rows — the engine boundary). Same wire shape so the budget slider reads one contract.
    if (row.eventId !== null) {
      const [ev] = await db.select().from(events).where(eq(events.id, row.eventId)).limit(1);
      if (!ev || ev.annule) {
        return reply
          .status(409)
          .send({ error: 'EVENT_ANNULE', message: 'Cet événement est annulé.' });
      }
      const evCmax = await computeEventCmax(
        { id: ev.id, kickoffAt: ev.kickoffAt, endsAt: ev.endsAt },
        (await getDispatchConfig()).eventCpmTnd,
      );
      return reply.status(200).send({
        c_max_tnd: evCmax.cMaxEvtTnd,
        i_max_facturable: evCmax.iMax,
        eligible_count: evCmax.eligibleCount,
        targeted_count: evCmax.eligibleCount,
      });
    }
    const missing: string[] = [];
    if (!row.startDate || !row.endDate) missing.push('dates');
    // The spot length S: only a linked creative with a positive duration can price the pool.
    const spotSeconds =
      row.creativeId !== null &&
      row.creativeDurationSeconds !== null &&
      row.creativeDurationSeconds > 0
        ? row.creativeDurationSeconds
        : null;
    if (spotSeconds === null) missing.push('creative');
    if (!row.startDate || !row.endDate || spotSeconds === null) {
      return reply.status(409).send({
        error: 'CMAX_REQUIRES',
        message: 'C_max needs the campaign dates and a linked creative with a duration.',
        missing,
      });
    }
    const cmax = await computeCampaignCmax(
      {
        id: row.id,
        startDate: row.startDate,
        endDate: row.endDate,
        campaignType: row.campaignType,
        eventId: row.eventId,
      },
      spotSeconds,
    );
    return reply.status(200).send({
      c_max_tnd: cmax.cMaxTnd,
      i_max_facturable: cmax.iMaxFacturable,
      eligible_count: cmax.eligibleCount,
      // CF-HF4 — the saturated/empty split for the wizard's zero-state message.
      targeted_count: cmax.targetedCount,
    });
  });

  // GET /api/campaigns/:id/event-allocations — EV4: the positioning's placement summary once
  // dispatched (N établissements, impressions prévues, per-venue lines). Owner-scoped like every
  // campaign read; an unbound or undispatched row simply returns zero lines.
  app.get('/api/campaigns/:id/event-allocations', advertiserGuard, async (request, reply) => {
    const parsedParams = idParamSchema.safeParse(request.params);
    if (!parsedParams.success) return reply.status(400).send(invalidId);
    const userId = request.user?.id;
    if (!userId) {
      return reply
        .status(401)
        .send({ error: 'UNAUTHENTICATED', message: 'Authentification requise.' });
    }
    const [own] = await db
      .select({ id: campaigns.id, eventId: campaigns.eventId })
      .from(campaigns)
      .where(and(eq(campaigns.id, parsedParams.data.id), eq(campaigns.advertiserId, userId)))
      .limit(1);
    if (!own) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Campagne introuvable.' });
    }
    const rows = await db
      .select({
        id: eventAllocations.id,
        screenhostId: eventAllocations.screenhostId,
        screenhostName: screenhosts.name,
        blocs: eventAllocations.blocs,
        impressionsTotal: eventAllocations.impressionsTotal,
        montantTnd: eventAllocations.montantTnd,
        statut: eventAllocations.statut,
      })
      .from(eventAllocations)
      .innerJoin(screenhosts, eq(eventAllocations.screenhostId, screenhosts.id))
      .where(eq(eventAllocations.campaignId, parsedParams.data.id))
      .orderBy(desc(eventAllocations.createdAt));

    // EV5 — once the positioning has SETTLED, the same read carries the summary: per-venue
    // livré/manqué + the refund. The per-venue lines are DERIVED (measureEventDelivery — the
    // settlement's own function), never stored: this lane writes no venue money rows (EV6).
    const [settled] = await db
      .select({
        refundTnd: campaignReconciliation.refundTnd,
        spendTnd: campaignReconciliation.spendTnd,
        settledAt: campaignReconciliation.reconciledAt,
      })
      .from(campaignReconciliation)
      .where(eq(campaignReconciliation.campaignId, parsedParams.data.id))
      .limit(1);
    const eventId = own.eventId;
    const measured = settled && eventId ? await measureEventDelivery(own.id, eventId) : null;

    return reply.status(200).send({
      count: rows.length,
      impressions_total: rows.reduce((sum, r) => sum + r.impressionsTotal, 0),
      montant_total_tnd:
        Math.round(rows.reduce((sum, r) => sum + Number(r.montantTnd) * 1000, 0)) / 1000,
      allocations: rows.map((r) => {
        const line = measured?.venues.find((v) => v.screenhostId === r.screenhostId) ?? null;
        return {
          id: r.id,
          screenhost_name: r.screenhostName,
          blocs_count: Array.isArray(r.blocs) ? r.blocs.length : 0,
          impressions_total: r.impressionsTotal,
          montant_tnd: Number(r.montantTnd),
          statut: r.statut,
          // Null until the settlement runs (a live positioning shows no verdict).
          blocs_delivered: line?.blocsDelivered ?? null,
          delivered_tnd: line?.deliveredTnd ?? null,
          refund_tnd: line?.refundTnd ?? null,
          attestation_negated: line?.attestationNegated ?? null,
        };
      }),
      settlement:
        settled === undefined
          ? null
          : {
              settled_at: settled.settledAt,
              delivered_tnd: Number(settled.spendTnd),
              refund_tnd: Number(settled.refundTnd),
            },
    });
  });

  // POST /api/campaigns/:id/submit — owner-scoped draft→pending (stamps submitted_at).
  app.post('/api/campaigns/:id/submit', advertiserGuard, async (request, reply) => {
    const parsedParams = idParamSchema.safeParse(request.params);
    if (!parsedParams.success) return reply.status(400).send(invalidId);
    const userId = request.user?.id;
    if (!userId) {
      return reply
        .status(401)
        .send({ error: 'UNAUTHENTICATED', message: 'Authentification requise.' });
    }
    const [existing] = await db
      .select({
        id: campaigns.id,
        status: campaigns.status,
        startDate: campaigns.startDate,
        endDate: campaigns.endDate,
        requestedBudget: campaigns.requestedBudget,
        campaignType: campaigns.campaignType,
        eventId: campaigns.eventId,
        creativeId: campaigns.creativeId,
        creativeDurationSeconds: creatives.durationSeconds,
      })
      .from(campaigns)
      .leftJoin(creatives, eq(campaigns.creativeId, creatives.id))
      .where(and(eq(campaigns.id, parsedParams.data.id), eq(campaigns.advertiserId, userId)))
      .limit(1);
    if (!existing) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Campagne introuvable.' });
    }
    if (existing.status !== 'draft' && existing.status !== 'rejected') {
      return reply.status(409).send({
        error: 'CONFLICT',
        message: 'Only a draft or rejected campaign can be submitted.',
        statusCode: 409,
      });
    }
    // CF-S1 hardening — a submit now requires BOTH dates (the wizard always sends them; a
    // date-less pending row would dead-end at activation).
    if (!existing.startDate || !existing.endDate) {
      return reply.status(400).send({
        error: 'MISSING_DATES',
        message: 'A campaign needs a start and end date before submission.',
      });
    }
    // CF-Q2 — re-check the floor at submit time: a draft saved days ago may now be too soon.
    // EV3 — positionings (event-BOUND rows) skip the floor (the dates are the snapshotted
    // diffusion window; the kickoff is the truth) — the lifecycle's past-kickoff deletion is the
    // too-late guard. Legacy 'event'-TYPED rows without a binding stay fully classic.
    const isEventRow = existing.eventId !== null;
    if (!isEventRow) {
      const lead = await campaignLead();
      const violation = startDateViolation(existing.startDate, new Date(), lead);
      if (violation) return reply.status(400).send(startDateRejection(violation, lead));
    }
    // CF-U1 — the budget-null contract: requested_budget stays NULL until the advertiser sets it
    // at Validation, so the positive-budget requirement the wizard gated CLIENT-side now holds
    // server-side too (activation derives i_cible from the budget — a budget-less pending row
    // would dead-end there, exactly like a date-less one).
    if (existing.requestedBudget === null || Number(existing.requestedBudget) <= 0) {
      return reply.status(400).send({
        error: 'MISSING_BUDGET',
        message: 'A campaign needs a positive requested budget before submission.',
      });
    }
    // CF-U3 (Mejri) — the budget floor: below 100 TND is refused BEFORE the ceiling gate (a
    // sub-floor ask is never deliverable business, whatever the inventory says).
    if (Number(existing.requestedBudget) < MIN_CAMPAIGN_BUDGET_TND) {
      return reply.status(400).send({
        error: 'BUDGET_BELOW_MINIMUM',
        message: `A campaign budget must be at least ${MIN_CAMPAIGN_BUDGET_TND} TND.`,
        minimum_tnd: MIN_CAMPAIGN_BUDGET_TND,
      });
    }
    // E5 (VF US-1.4) — C_max revalidation at submit: the budget must be deliverable against LIVE
    // occupancy ("si l'annonceur tente de fixer C_cible > C_max → refus"). == C_max passes; only
    // strictly-over is refused, carrying the ceiling so the advertiser adjusts. Skipped when no
    // creative duration exists to price the pool (the wizard guarantees one; an API-level submit
    // without it dead-ends at activation's 422 anyway). Post-submit shrinkage is dispatch's
    // problem BY DESIGN — occupancy taken after this click surfaces at activation as TOO_THIN
    // (clôture, renvoi curseur) or a genuine PARTIAL.
    // EV3 — the ceiling forks: event rows price via EV2's engine (the classic C_max throws on
    // them — the engine boundary); the event ceiling needs no creative duration (no T coef).
    if (isEventRow) {
      const [ev] = existing.eventId
        ? await db.select().from(events).where(eq(events.id, existing.eventId)).limit(1)
        : [];
      if (!ev || ev.annule) {
        return reply
          .status(409)
          .send({ error: 'EVENT_ANNULE', message: 'Cet événement est annulé.' });
      }
      const evCmax = await computeEventCmax(
        { id: ev.id, kickoffAt: ev.kickoffAt, endsAt: ev.endsAt },
        (await getDispatchConfig()).eventCpmTnd,
      );
      if (Number(existing.requestedBudget) > evCmax.cMaxEvtTnd) {
        return reply.status(400).send({
          error: 'BUDGET_EXCEEDS_CMAX',
          message: 'The requested budget exceeds the available inventory for this targeting.',
          c_max_tnd: evCmax.cMaxEvtTnd,
        });
      }
    } else if (
      existing.creativeId !== null &&
      existing.creativeDurationSeconds !== null &&
      existing.creativeDurationSeconds > 0
    ) {
      const cmax = await computeCampaignCmax(
        {
          id: existing.id,
          startDate: existing.startDate,
          endDate: existing.endDate,
          campaignType: existing.campaignType,
          eventId: existing.eventId,
        },
        existing.creativeDurationSeconds,
      );
      if (Number(existing.requestedBudget) > cmax.cMaxTnd) {
        return reply.status(400).send({
          error: 'BUDGET_EXCEEDS_CMAX',
          message: 'The requested budget exceeds the available inventory for this targeting.',
          c_max_tnd: cmax.cMaxTnd,
        });
      }
    }
    // CF-S1 — a resubmitted Non validé sheds its rejection audit with the status.
    const [updated] = await db
      .update(campaigns)
      .set({ status: 'pending', submittedAt: new Date(), rejectedAt: null, rejectReason: null })
      .where(
        and(
          eq(campaigns.id, existing.id),
          eq(campaigns.advertiserId, userId),
          inArray(campaigns.status, ['draft', 'rejected']),
        ),
      )
      .returning(campaignSelection);
    if (!updated) {
      return reply.status(409).send({
        error: 'CONFLICT',
        message: 'Only a draft or rejected campaign can be submitted.',
        statusCode: 409,
      });
    }
    return reply.status(200).send(campaignView(updated as CampaignRow));
  });

  // POST /api/campaigns/:id/replay — « Rejouer » (spec §3.3): clone a COMPLETED campaign into an
  // identical NEW draft so the advertiser only has to pick a new période. Copied: name,
  // campaign_type, creative_id, requested_budget, description, and the targeting/zone rows
  // (DUPLICATED, never shared — the clone owns fresh rows). NEVER copied: dates (NULL — the whole
  // point is a new period, and the old ones are in the past anyway), status (draft), submitted_at,
  // the rejection/activation audit, draft_reminder_sent_at. The clone + its line copies commit in
  // ONE transaction (no half-cloned draft on a mid-flight failure). Returns the full advertiser
  // projection (campaignView + zones + targeting, content gate derived) — the wizard rehydrates
  // from it directly.
  app.post('/api/campaigns/:id/replay', advertiserGuard, async (request, reply) => {
    const parsedParams = idParamSchema.safeParse(request.params);
    if (!parsedParams.success) return reply.status(400).send(invalidId);
    const userId = request.user?.id;
    if (!userId) {
      return reply
        .status(401)
        .send({ error: 'UNAUTHENTICATED', message: 'Authentification requise.' });
    }
    // Owner-scope in the WHERE: a foreign id is indistinguishable from a missing one.
    const [source] = await db
      .select()
      .from(campaigns)
      .where(and(eq(campaigns.id, parsedParams.data.id), eq(campaigns.advertiserId, userId)))
      .limit(1);
    if (!source) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Campagne introuvable.' });
    }
    // Rejouer is a Passée-only affordance (spec §3.3) — a draft is resumable, a rejected one is
    // recoverable, a live one is running; none of them is REPLAYABLE.
    if (source.status !== 'completed') {
      return reply.status(409).send({
        error: 'REPLAY_SOURCE_NOT_COMPLETED',
        message: 'Only a completed campaign can be replayed.',
        statusCode: 409,
      });
    }

    const clone = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(campaigns)
        .values({
          advertiserId: userId,
          name: source.name,
          campaignType: source.campaignType,
          status: 'draft',
          description: source.description,
          creativeId: source.creativeId,
          requestedBudget: source.requestedBudget,
        })
        .returning(campaignSelection);
      if (!created) throw new Error('replay clone insert returned no row');
      const cloneId = (created as CampaignRow).id;
      const lines = await tx
        .select({ categoryId: campaignTargeting.categoryId, class: campaignTargeting.class })
        .from(campaignTargeting)
        .where(eq(campaignTargeting.campaignId, source.id));
      if (lines.length > 0) {
        await tx
          .insert(campaignTargeting)
          .values(lines.map((l) => ({ campaignId: cloneId, ...l })));
      }
      const zoneRows = await tx
        .select({ zoneId: campaignZones.zoneId })
        .from(campaignZones)
        .where(eq(campaignZones.campaignId, source.id));
      if (zoneRows.length > 0) {
        await tx
          .insert(campaignZones)
          .values(zoneRows.map((z) => ({ campaignId: cloneId, zoneId: z.zoneId })));
      }
      return created as CampaignRow;
    });

    // The content gate is DERIVED from the (shared) linked creative — same rule as every read.
    let contentValidationStatus: string | null = null;
    if (clone.creativeId) {
      const [creative] = await db
        .select({ validationStatus: creatives.validationStatus })
        .from(creatives)
        .where(eq(creatives.id, clone.creativeId))
        .limit(1);
      contentValidationStatus = creative?.validationStatus ?? null;
    }
    const zoneMap = await zonesByCampaign([clone.id]);
    const targetingLines = await db
      .select({
        category_id: campaignTargeting.categoryId,
        category_name: businessSectors.name,
        class: campaignTargeting.class,
      })
      .from(campaignTargeting)
      .leftJoin(businessSectors, eq(campaignTargeting.categoryId, businessSectors.id))
      .where(eq(campaignTargeting.campaignId, clone.id))
      .orderBy(asc(campaignTargeting.createdAt), asc(campaignTargeting.id));

    return reply.status(201).send({
      ...campaignView(clone, contentValidationStatus),
      zones: zoneMap.get(clone.id) ?? [],
      targeting: targetingLines,
    });
  });

  // DELETE /api/campaigns/:id — owner-scoped, draft-only (409 once submitted). 204 on success.
  app.delete('/api/campaigns/:id', advertiserGuard, async (request, reply) => {
    const parsedParams = idParamSchema.safeParse(request.params);
    if (!parsedParams.success) return reply.status(400).send(invalidId);
    const userId = request.user?.id;
    if (!userId) {
      return reply
        .status(401)
        .send({ error: 'UNAUTHENTICATED', message: 'Authentification requise.' });
    }
    const [existing] = await db
      .select({ id: campaigns.id, status: campaigns.status })
      .from(campaigns)
      .where(and(eq(campaigns.id, parsedParams.data.id), eq(campaigns.advertiserId, userId)))
      .limit(1);
    if (!existing) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Campagne introuvable.' });
    }
    if (existing.status !== 'draft') {
      return reply.status(409).send({
        error: 'CONFLICT',
        message: 'Only a draft campaign can be deleted.',
        statusCode: 409,
      });
    }
    await db
      .delete(campaigns)
      .where(and(eq(campaigns.id, existing.id), eq(campaigns.advertiserId, userId)));
    return reply.status(204).send();
  });
};
