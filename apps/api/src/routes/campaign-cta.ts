import { and, count, eq } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';

import { db } from '../db/client.js';
import { campaigns, ctaScans, users } from '../db/schema.js';
import { env } from '../env.js';
import { kickCtaBurns } from '../lib/spot-cta-job.js';
import {
  CTA_DEFAULT_LABEL,
  type CtaStatus,
  ctaScanUrl,
  newCtaCode,
  parseCtaLabel,
  parseCtaUrl,
} from '../lib/spot-cta.js';
import { requireAdvertiser } from '../middleware/require-advertiser.js';
import { requireAuth } from '../middleware/require-auth.js';
import { storage } from '../storage/s3-storage.js';

// QR-CTA1 (lib/spot-cta.ts holds the rules) — the screencaster's call to action on a campaign:
//   GET    /api/campaigns/:id/cta   its link, message, the copy's status and the scan count;
//   PUT    /api/campaigns/:id/cta   set the link (+ message) → a new QR copy is made in the background;
//   DELETE /api/campaigns/:id/cta   remove it (the campaign airs the plain spot again);
// Editable only while the campaign is a draft (or refused), like every other campaign field, and
// only on classic campaigns (an event positioning airs in the event's pods, untouched here).

const idParamSchema = z.object({ id: z.uuid() });
const putSchema = z.object({
  url: z.string().max(4000),
  label: z.string().max(200).nullable().optional(),
});

const invalid = (reply: FastifyReply, field: string, reason: string) =>
  reply.status(400).send({
    error: 'INVALID_INPUT',
    message: 'Validation échouée',
    fields: [{ field, reason }],
  });

/**
 * May this account use calls to action? QR-ALL (Mejri 21/10 point 4, operator ruling A): EVERY
 * screencaster may — the quiet per-account test is over (users.cta_enabled is no longer read).
 */
export const ctaAllowedFor = async (userId: string): Promise<boolean> => {
  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
  return row !== undefined;
};

const loadOwned = async (campaignId: string, userId: string) => {
  const [row] = await db
    .select({
      id: campaigns.id,
      status: campaigns.status,
      eventId: campaigns.eventId,
      creativeId: campaigns.creativeId,
      ctaUrl: campaigns.ctaUrl,
      ctaLabel: campaigns.ctaLabel,
      ctaCode: campaigns.ctaCode,
      ctaStatus: campaigns.ctaStatus,
      ctaStorageKey: campaigns.ctaStorageKey,
      ctaSourceCreativeId: campaigns.ctaSourceCreativeId,
    })
    .from(campaigns)
    .where(and(eq(campaigns.id, campaignId), eq(campaigns.advertiserId, userId)))
    .limit(1);
  return row;
};

type OwnedCampaign = NonNullable<Awaited<ReturnType<typeof loadOwned>>>;

/** The wire shape. `status` is the copy's state for the campaign's CURRENT spot. */
const ctaView = async (c: OwnedCampaign, enabled: boolean) => {
  let status: CtaStatus | null = null;
  if (c.ctaUrl !== null) {
    const fresh = c.ctaSourceCreativeId !== null && c.ctaSourceCreativeId === c.creativeId;
    status =
      fresh && (c.ctaStatus === 'ready' || c.ctaStatus === 'failed') ? c.ctaStatus : 'pending';
  }
  let previewUrl: string | null = null;
  if (status === 'ready' && c.ctaStorageKey) {
    const signed = await storage.getPresignedUrl({ key: c.ctaStorageKey, expiresInSeconds: 600 });
    previewUrl = 'url' in signed ? signed.url : null;
  }
  const [scans] = await db
    .select({ n: count() })
    .from(ctaScans)
    .where(eq(ctaScans.campaignId, c.id));
  return {
    enabled,
    url: c.ctaUrl,
    label: c.ctaLabel,
    default_label: CTA_DEFAULT_LABEL,
    status,
    scan_url:
      c.ctaUrl !== null && c.ctaCode ? ctaScanUrl(env.CTA_PUBLIC_BASE_URL, c.ctaCode) : null,
    preview_url: previewUrl,
    scans: scans?.n ?? 0,
  };
};

const editable = (c: OwnedCampaign) => c.status === 'draft' || c.status === 'rejected';

export const campaignCtaRoutes: FastifyPluginAsync = async (app) => {
  const advertiserGuard = { preHandler: [requireAuth, requireAdvertiser] };

  app.get('/api/campaigns/:id/cta', advertiserGuard, async (request, reply) => {
    const params = idParamSchema.safeParse(request.params);
    if (!params.success) return invalid(reply, 'id', 'must be a uuid');
    const userId = request.user?.id ?? '';
    const campaign = await loadOwned(params.data.id, userId);
    if (!campaign)
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Campagne introuvable.' });
    return reply.status(200).send(await ctaView(campaign, await ctaAllowedFor(userId)));
  });

  app.put('/api/campaigns/:id/cta', advertiserGuard, async (request, reply) => {
    const params = idParamSchema.safeParse(request.params);
    if (!params.success) return invalid(reply, 'id', 'must be a uuid');
    const body = putSchema.safeParse(request.body ?? {});
    if (!body.success) return invalid(reply, 'url', 'required');
    const userId = request.user?.id ?? '';
    if (!(await ctaAllowedFor(userId))) {
      return reply
        .status(403)
        .send({ error: 'CTA_NOT_ENABLED', message: 'Fonction non disponible.' });
    }
    const campaign = await loadOwned(params.data.id, userId);
    if (!campaign)
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Campagne introuvable.' });
    if (campaign.eventId !== null) {
      return reply.status(400).send({
        error: 'CTA_EVENT_UNSUPPORTED',
        message: 'Le QR code n’est pas encore proposé sur les événements.',
      });
    }
    if (!editable(campaign)) {
      return reply.status(409).send({
        error: 'CONFLICT',
        message: 'Seule une campagne en brouillon ou rejetée peut être modifiée.',
      });
    }
    const url = parseCtaUrl(body.data.url);
    if (!url.ok) return invalid(reply, 'url', url.error);
    const label = parseCtaLabel(body.data.label);
    if (!label.ok) return invalid(reply, 'label', label.error);
    const unchanged =
      campaign.ctaUrl === url.value &&
      campaign.ctaLabel === label.value &&
      campaign.ctaStatus !== 'failed';
    if (!unchanged) {
      await db
        .update(campaigns)
        .set({
          ctaUrl: url.value,
          ctaLabel: label.value,
          ctaCode: campaign.ctaCode ?? newCtaCode(),
          ctaStatus: 'pending',
          ctaError: null,
        })
        .where(eq(campaigns.id, campaign.id));
      kickCtaBurns(request.log);
    }
    const fresh = await loadOwned(campaign.id, userId);
    return reply.status(200).send(await ctaView(fresh ?? campaign, true));
  });

  app.delete('/api/campaigns/:id/cta', advertiserGuard, async (request, reply) => {
    const params = idParamSchema.safeParse(request.params);
    if (!params.success) return invalid(reply, 'id', 'must be a uuid');
    const userId = request.user?.id ?? '';
    const campaign = await loadOwned(params.data.id, userId);
    if (!campaign)
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Campagne introuvable.' });
    if (!editable(campaign)) {
      return reply.status(409).send({
        error: 'CONFLICT',
        message: 'Seule une campagne en brouillon ou rejetée peut être modifiée.',
      });
    }
    await db
      .update(campaigns)
      .set({
        ctaUrl: null,
        ctaLabel: null,
        ctaStatus: null,
        ctaStorageKey: null,
        ctaSourceCreativeId: null,
        ctaError: null,
      })
      .where(eq(campaigns.id, campaign.id));
    if (campaign.ctaStorageKey) await storage.delete({ key: campaign.ctaStorageKey });
    const fresh = await loadOwned(campaign.id, userId);
    return reply.status(200).send(await ctaView(fresh ?? campaign, await ctaAllowedFor(userId)));
  });
};
