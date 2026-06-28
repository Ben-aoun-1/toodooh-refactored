import { and, desc, eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { db } from '../db/client.js';
import { campaigns, creatives } from '../db/schema.js';
import { requireAdvertiser } from '../middleware/require-advertiser.js';
import { requireAuth } from '../middleware/require-auth.js';

// Advertiser campaign draft lifecycle (C1) — greenfield on the toodooh API (the existing 6-step
// NewCampaign wizard is Supabase-backed). Every read/write is owner-scoped to the authenticated
// advertiser via advertiser_id: a foreign id is indistinguishable from a missing one (404, never a
// leak). Edits and deletes are draft-only (409 once submitted); submit is the single draft→pending
// transition. Targeting/video/map/owner-approval/pricing land in later lanes.

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

// Advertiser-facing projection — the validated_* approval-audit columns are intentionally omitted.
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
    return reply.status(201).send(campaignView(created as CampaignRow));
  });

  // GET /api/campaigns/mine — the caller's own campaigns, newest first.
  app.get('/api/campaigns/mine', advertiserGuard, async (request, reply) => {
    const userId = request.user?.id;
    if (!userId) {
      return reply
        .status(401)
        .send({ error: 'UNAUTHENTICATED', message: 'Authentication required.' });
    }
    const rows = await db
      .select({ ...campaignSelection, contentValidationStatus: creatives.validationStatus })
      .from(campaigns)
      .leftJoin(creatives, eq(campaigns.creativeId, creatives.id))
      .where(eq(campaigns.advertiserId, userId))
      .orderBy(desc(campaigns.createdAt));
    return reply.status(200).send(rows.map((r) => campaignView(r, r.contentValidationStatus)));
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
    return reply.status(200).send(campaignView(row, row.contentValidationStatus));
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
    // Owner-scope in the WHERE: a foreign id is indistinguishable from a missing one.
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
        message: 'Only a draft campaign can be edited.',
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
    const [updated] = await db
      .update(campaigns)
      .set(buildUpdatePatch(parsed.data))
      .where(and(eq(campaigns.id, existing.id), eq(campaigns.advertiserId, userId)))
      .returning(campaignSelection);
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
        message: 'Only a draft campaign can be submitted.',
        statusCode: 409,
      });
    }
    const [updated] = await db
      .update(campaigns)
      .set({ status: 'pending', submittedAt: new Date() })
      .where(and(eq(campaigns.id, existing.id), eq(campaigns.advertiserId, userId)))
      .returning(campaignSelection);
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
