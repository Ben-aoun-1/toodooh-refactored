import rateLimit from '@fastify/rate-limit';
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { db } from '../db/client.js';
import { campaigns, ctaScans } from '../db/schema.js';
import { clientIp } from '../lib/client-ip.js';
import { isCtaCode } from '../lib/spot-cta.js';

// QR-CTA1 — GET /q/:code: where a spot's QR code leads. Counts the scan, then sends the viewer on
// to the screencaster's link. Public by design (anyone in the venue scans it). A scan is counted
// only while the campaign is on air or over (a screencaster testing their own draft's QR does not
// inflate the figure), and nothing about the viewer is stored — only the instant. Rate-limited per
// visitor so one phone cannot pump the count; an unknown code lands on the home page.
// nginx routes /q/ to the api (infra/nginx/toodooh.conf).

const MAX_PER_MINUTE = 20;
const COUNTED_STATUSES = new Set(['active', 'completed']);

export const ctaRedirectRoutes: FastifyPluginAsync = async (app) => {
  await app.register(rateLimit, {
    max: MAX_PER_MINUTE,
    timeWindow: '1 minute',
    keyGenerator: clientIp,
    errorResponseBuilder: () => ({
      statusCode: 429,
      error: 'RATE_LIMITED',
      message: 'Trop de requêtes. Réessayez dans une minute.',
    }),
  });

  app.get<{ Params: { code: string } }>('/q/:code', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const code = request.params.code;
    if (!isCtaCode(code)) return reply.redirect('/', 302);
    const [campaign] = await db
      .select({ id: campaigns.id, status: campaigns.status, ctaUrl: campaigns.ctaUrl })
      .from(campaigns)
      .where(eq(campaigns.ctaCode, code))
      .limit(1);
    if (!campaign?.ctaUrl) return reply.redirect('/', 302);
    if (COUNTED_STATUSES.has(campaign.status)) {
      await db.insert(ctaScans).values({ campaignId: campaign.id });
    }
    return reply.redirect(campaign.ctaUrl, 302);
  });
};
