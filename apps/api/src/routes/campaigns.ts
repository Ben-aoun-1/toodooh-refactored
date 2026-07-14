import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { db } from '../db/client.js';
import {
  businessSectors,
  campaignReconciliation,
  campaignTargeting,
  campaignZones,
  campaigns,
  creatives,
  zones,
} from '../db/schema.js';
import {
  type StartDateViolation,
  premiereDateDisponible,
  startDateViolation,
} from '../lib/campaign-dates.js';
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
const startDateRejection = (violation: StartDateViolation) => ({
  error: 'INVALID_START_DATE',
  reason: violation,
  message: 'The start date must be at least two working days ahead.',
  first_available_start_date: premiereDateDisponible(),
});

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
  message: 'One or more zone_ids do not reference an active zone.',
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
const campaignSelection = {
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
  createdAt: campaigns.createdAt,
  updatedAt: campaigns.updatedAt,
};

type CampaignRow = Pick<
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
  | 'createdAt'
  | 'updatedAt'
>;

// content_validation_status is the DERIVED content gate (bifurcated approval): the validation_status
// of the linked creative, or null when no creative is linked. It is NEVER a stored campaign column —
// reads LEFT JOIN creatives to compute it. CRUD writes never link a creative (creative_id is set in
// a later lane), so a created/edited/submitted campaign always derives null here.
const campaignView = (
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
  message: 'Validation failed',
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
        message: 'Validation failed',
        fields: parsed.error.issues.map((i) => ({ field: i.path.join('.'), reason: i.message })),
      });
    }
    const userId = request.user?.id;
    if (!userId) {
      return reply
        .status(401)
        .send({ error: 'UNAUTHENTICATED', message: 'Authentication required.' });
    }
    if (parsed.data.start_date) {
      const violation = startDateViolation(parsed.data.start_date);
      if (violation) return reply.status(400).send(startDateRejection(violation));
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
        .send({ error: 'UNAUTHENTICATED', message: 'Authentication required.' });
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

    return reply.status(200).send(
      rows.map((r) => ({
        ...campaignView(r, r.contentValidationStatus),
        zones: zoneMap.get(r.id) ?? [],
        // delivered impressions + net spend come from the 1:1 reconciliation row — null until reconciled.
        delivered_impressions: r.deliveredImp ?? null,
        spend_tnd: r.spendTnd == null ? null : Number(r.spendTnd),
        reconciled_at: r.reconciledAt ?? null,
        targeting: targetingByCampaign.get(r.id) ?? [],
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
        .send({ error: 'UNAUTHENTICATED', message: 'Authentication required.' });
    }
    const [row] = await db
      .select({ ...campaignSelection, contentValidationStatus: creatives.validationStatus })
      .from(campaigns)
      .leftJoin(creatives, eq(campaigns.creativeId, creatives.id))
      .where(and(eq(campaigns.id, parsedParams.data.id), eq(campaigns.advertiserId, userId)))
      .limit(1);
    if (!row) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'No such campaign.' });
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
        message: 'Validation failed',
        fields: parsed.error.issues.map((i) => ({ field: i.path.join('.'), reason: i.message })),
      });
    }
    const userId = request.user?.id;
    if (!userId) {
      return reply
        .status(401)
        .send({ error: 'UNAUTHENTICATED', message: 'Authentication required.' });
    }
    // CF-Q2 — an explicit null still clears the date; only a SET start date meets the floor.
    if (parsed.data.start_date) {
      const violation = startDateViolation(parsed.data.start_date);
      if (violation) return reply.status(400).send(startDateRejection(violation));
    }
    // CF-Z1 — zone_ids: absent = untouched; [] = clear; ids must reference active zones.
    if (parsed.data.zone_ids !== undefined && parsed.data.zone_ids.length > 0) {
      const unknown = await invalidZoneIds(parsed.data.zone_ids);
      if (unknown.length > 0) return reply.status(400).send(invalidZoneRejection(unknown));
    }
    // Owner-scope in the WHERE: a foreign id is indistinguishable from a missing one.
    const [existing] = await db
      .select({ id: campaigns.id, status: campaigns.status })
      .from(campaigns)
      .where(and(eq(campaigns.id, parsedParams.data.id), eq(campaigns.advertiserId, userId)))
      .limit(1);
    if (!existing) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'No such campaign.' });
    }
    // CF-S1 — a Non validé campaign is RECOVERABLE: editable like a draft (resubmit clears the
    // rejection audit below in /submit).
    if (existing.status !== 'draft' && existing.status !== 'rejected') {
      return reply.status(409).send({
        error: 'CONFLICT',
        message: 'Only a draft or rejected campaign can be edited.',
        statusCode: 409,
      });
    }
    // Linking a creative: it must EXIST and belong to the SAME advertiser — owner-scoped 404 (a
    // foreign or nonexistent creative is indistinguishable from missing). null unlinks (no lookup).
    if (parsed.data.creative_id != null) {
      const [creative] = await db
        .select({ id: creatives.id })
        .from(creatives)
        .where(and(eq(creatives.id, parsed.data.creative_id), eq(creatives.advertiserId, userId)))
        .limit(1);
      if (!creative) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: 'No such creative.' });
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

  // POST /api/campaigns/:id/submit — owner-scoped draft→pending (stamps submitted_at).
  app.post('/api/campaigns/:id/submit', advertiserGuard, async (request, reply) => {
    const parsedParams = idParamSchema.safeParse(request.params);
    if (!parsedParams.success) return reply.status(400).send(invalidId);
    const userId = request.user?.id;
    if (!userId) {
      return reply
        .status(401)
        .send({ error: 'UNAUTHENTICATED', message: 'Authentication required.' });
    }
    const [existing] = await db
      .select({
        id: campaigns.id,
        status: campaigns.status,
        startDate: campaigns.startDate,
        endDate: campaigns.endDate,
      })
      .from(campaigns)
      .where(and(eq(campaigns.id, parsedParams.data.id), eq(campaigns.advertiserId, userId)))
      .limit(1);
    if (!existing) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'No such campaign.' });
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
    const violation = startDateViolation(existing.startDate);
    if (violation) return reply.status(400).send(startDateRejection(violation));
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

  // DELETE /api/campaigns/:id — owner-scoped, draft-only (409 once submitted). 204 on success.
  app.delete('/api/campaigns/:id', advertiserGuard, async (request, reply) => {
    const parsedParams = idParamSchema.safeParse(request.params);
    if (!parsedParams.success) return reply.status(400).send(invalidId);
    const userId = request.user?.id;
    if (!userId) {
      return reply
        .status(401)
        .send({ error: 'UNAUTHENTICATED', message: 'Authentication required.' });
    }
    const [existing] = await db
      .select({ id: campaigns.id, status: campaigns.status })
      .from(campaigns)
      .where(and(eq(campaigns.id, parsedParams.data.id), eq(campaigns.advertiserId, userId)))
      .limit(1);
    if (!existing) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'No such campaign.' });
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
