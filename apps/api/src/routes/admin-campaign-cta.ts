import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { db } from '../db/client.js';
import { campaigns } from '../db/schema.js';
import { kickCtaBurns } from '../lib/spot-cta-job.js';
import { CTA_POSITIONS, ctaPositionOf } from '../lib/spot-cta-layout.js';
import { ctaPositionEditable } from '../lib/spot-cta.js';
import { requireAdmin, requireAuth } from '../middleware/require-auth.js';
import { storage } from '../storage/s3-storage.js';

// Mariem 04/11 (Foot point 1, ruling 2A) — the admin moves the spot's QR card at the validation,
// the logo's place varying from spot to spot:
//   GET /api/admin/campaigns/:id/cta           the card: link, words, corner, copy state + preview;
//   PUT /api/admin/campaigns/:id/cta-position  {position} → the copy is made again in that corner.
// Only while the campaign has never been on air (lib/spot-cta.ts ctaPositionEditable): a TV never
// fetches a new file under a campaign it already has. The playout gate holds the campaign until
// the new copy is ready, as for any copy.

const idParamSchema = z.object({ id: z.uuid() });
const positionSchema = z.object({ position: z.enum(CTA_POSITIONS) });

const load = async (id: string) => {
  const [row] = await db
    .select({
      id: campaigns.id,
      status: campaigns.status,
      creativeId: campaigns.creativeId,
      ctaUrl: campaigns.ctaUrl,
      ctaLabel: campaigns.ctaLabel,
      ctaStatus: campaigns.ctaStatus,
      ctaStorageKey: campaigns.ctaStorageKey,
      ctaSourceCreativeId: campaigns.ctaSourceCreativeId,
      ctaPosition: campaigns.ctaPosition,
    })
    .from(campaigns)
    .where(eq(campaigns.id, id))
    .limit(1);
  return row;
};

type Loaded = NonNullable<Awaited<ReturnType<typeof load>>>;

const view = async (c: Loaded) => {
  const fresh = c.ctaSourceCreativeId !== null && c.ctaSourceCreativeId === c.creativeId;
  const status =
    c.ctaUrl === null
      ? null
      : fresh && (c.ctaStatus === 'ready' || c.ctaStatus === 'failed')
        ? c.ctaStatus
        : 'pending';
  let previewUrl: string | null = null;
  if (status === 'ready' && c.ctaStorageKey) {
    const signed = await storage.getPresignedUrl({ key: c.ctaStorageKey, expiresInSeconds: 600 });
    previewUrl = 'url' in signed ? signed.url : null;
  }
  return {
    url: c.ctaUrl,
    label: c.ctaLabel,
    position: ctaPositionOf(c.ctaPosition),
    status,
    preview_url: previewUrl,
    position_editable: c.ctaUrl !== null && ctaPositionEditable(c.status),
  };
};

export const adminCampaignCtaRoutes: FastifyPluginAsync = async (app) => {
  const adminGuard = { preHandler: [requireAuth, requireAdmin] };

  app.get('/api/admin/campaigns/:id/cta', adminGuard, async (request, reply) => {
    const params = idParamSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: 'INVALID_INPUT', message: 'Validation échouée' });
    }
    const campaign = await load(params.data.id);
    if (!campaign) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Campagne introuvable.' });
    }
    return reply.status(200).send(await view(campaign));
  });

  app.put('/api/admin/campaigns/:id/cta-position', adminGuard, async (request, reply) => {
    const params = idParamSchema.safeParse(request.params);
    const body = positionSchema.safeParse(request.body ?? {});
    if (!params.success || !body.success) {
      return reply.status(400).send({ error: 'INVALID_INPUT', message: 'Validation échouée' });
    }
    const campaign = await load(params.data.id);
    if (!campaign) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Campagne introuvable.' });
    }
    if (campaign.ctaUrl === null) {
      return reply
        .status(409)
        .send({ error: 'CTA_NONE', message: 'Cette campagne n’a pas de QR code.' });
    }
    if (!ctaPositionEditable(campaign.status)) {
      return reply.status(409).send({
        error: 'CTA_POSITION_LOCKED',
        message: 'La campagne est déjà diffusée : son QR code ne peut plus être déplacé.',
      });
    }
    if (ctaPositionOf(campaign.ctaPosition) !== body.data.position) {
      await db
        .update(campaigns)
        .set({ ctaPosition: body.data.position, ctaStatus: 'pending', ctaError: null })
        .where(eq(campaigns.id, campaign.id));
      kickCtaBurns(request.log);
    }
    const fresh = await load(campaign.id);
    return reply.status(200).send(await view(fresh ?? campaign));
  });
};
