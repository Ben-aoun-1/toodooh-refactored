import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';

import { db } from '../db/client.js';
import { users } from '../db/schema.js';
import {
  type AnalysisSections,
  type CampaignNature,
  type ClosedCampaign,
  type LiveCampaign,
  type ShareRow,
  buildAnalysis,
  closedInPeriod,
  footprintSeries,
  loadClosedCampaigns,
  loadLiveCampaigns,
  loadVenueImpressionLines,
  loadZoneCatalogue,
} from '../lib/advertiser-performances.js';
import { campaignReportFilename, renderCampaignReportPdf } from '../lib/campaign-report-pdf.js';
import { requireAdvertiser } from '../middleware/require-advertiser.js';
import { requireAuth } from '../middleware/require-auth.js';

// SC-P — « Mes performances » (Screencaster) reads. Session-scoped: every read starts from the
// connected advertiser's campaigns (RG-PERF-01) — a foreign campaign id is indistinguishable from
// a missing one (404). The figures come from lib/advertiser-performances (ONE home); this file
// only shapes the wire (snake_case, the house idiom). Nothing here selects a CPM, an SPS, an
// attention index or a split key (RG-PERF-31).

const invalidField = (reply: FastifyReply, field: string, reason: string) =>
  reply
    .status(400)
    .send({ error: 'INVALID_INPUT', message: 'Validation failed', fields: [{ field, reason }] });

const sendUnauthenticated = (reply: FastifyReply) =>
  reply.status(401).send({ error: 'UNAUTHENTICATED', message: 'Authentification requise.' });

const isoDate = z.iso.date();

const analysisQuerySchema = z.object({
  campaign_id: z.uuid().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  nature: z.enum(['all', 'normal', 'event']).default('all'),
});

const idParamSchema = z.object({ id: z.uuid() });

const campaignView = (c: ClosedCampaign) => ({
  id: c.id,
  name: c.name,
  nature: c.nature,
  start_date: c.startDate,
  end_date: c.endDate,
  closed_at: c.closedAt.toISOString(),
  closed_on: c.closedOn,
  budget_ht: c.budgetHt,
  budget_ttc: c.budgetTtc,
  impressions: c.impressions,
  hours: c.hours,
  plays: c.plays,
  venues: c.venues,
});

const shareView = (r: ShareRow) => ({ key: r.key, label: r.label, value: r.value, pct: r.pct });

const liveView = (c: LiveCampaign) => ({
  id: c.id,
  name: c.name,
  nature: c.nature,
  launched_on: c.launchedOn,
  audience: c.audience,
  plays: c.plays,
  venues: c.venues,
});

const sectionsView = (s: AnalysisSections) => ({
  campaigns: s.campaigns.map((c) => ({
    ...campaignView(c),
    categories: c.categories,
    csp_shares: c.cspShares.map(shareView),
  })),
  overview: {
    campaign_count: s.overview.campaignCount,
    impressions: s.overview.impressions,
    hours: s.overview.hours,
    plays: s.overview.plays,
    venues: s.overview.venues,
    budget_ht: s.overview.budgetHt,
    budget_ttc: s.overview.budgetTtc,
  },
  categories: s.categories.map(shareView),
  csp: s.csp.map(shareView),
  audience:
    s.audience === null
      ? null
      : {
          profiled_impressions: s.audience.profiledImpressions,
          unprofiled_impressions: s.audience.unprofiledImpressions,
          unprofiled_venues: s.audience.unprofiledVenues,
          sex: s.audience.sex.map(shareView),
          age: s.audience.age.map(shareView),
        },
  zones: s.zones.map((z) => ({ ...shareView(z), zone_id: z.zoneId })),
});

const matchesNature = (c: ClosedCampaign, nature: 'all' | CampaignNature): boolean =>
  nature === 'all' || c.nature === nature;

export const advertiserPerformancesRoutes: FastifyPluginAsync = async (app) => {
  const advertiserGuard = { preHandler: [requireAuth, requireAdvertiser] };

  // GET /api/advertiser/performances/campaigns — epics 3/4: every CLOSED campaign, newest
  // clôture first, with its settled figures (in-flight ones live in /live only).
  app.get('/api/advertiser/performances/campaigns', advertiserGuard, async (request, reply) => {
    const userId = request.user?.id;
    if (!userId) return sendUnauthenticated(reply);
    const closed = await loadClosedCampaigns(userId);
    return reply.status(200).send({ campaigns: closed.map(campaignView) });
  });

  // GET /api/advertiser/performances/live — epic 1: campaigns en diffusion + live counters.
  app.get('/api/advertiser/performances/live', advertiserGuard, async (request, reply) => {
    const userId = request.user?.id;
    if (!userId) return sendUnauthenticated(reply);
    const live = await loadLiveCampaigns(userId);
    return reply.status(200).send({ campaigns: live.map(liveView) });
  });

  // GET /api/advertiser/performances/footprint — epic 5: cumulative series over the clôtures.
  app.get('/api/advertiser/performances/footprint', advertiserGuard, async (request, reply) => {
    const userId = request.user?.id;
    if (!userId) return sendUnauthenticated(reply);
    const points = footprintSeries(await loadClosedCampaigns(userId));
    const last = points[points.length - 1];
    return reply.status(200).send({
      points: points.map((p) => ({
        closed_on: p.closedOn,
        campaign_id: p.campaignId,
        name: p.name,
        impressions: p.impressions,
        hours: p.hours,
        impressions_cumulative: p.impressionsCumulative,
        hours_cumulative: p.hoursCumulative,
      })),
      totals: {
        impressions: last?.impressionsCumulative ?? 0,
        hours: last?.hoursCumulative ?? 0,
      },
    });
  });

  // GET /api/advertiser/performances/analysis — epics 6/7: sections 01–04 for ONE campaign
  // (?campaign_id=) or the SUM over the closed campaigns whose clôture date falls in [from, to]
  // (both optional — none = depuis le début), restricted by ?nature= in Period mode only.
  app.get('/api/advertiser/performances/analysis', advertiserGuard, async (request, reply) => {
    const userId = request.user?.id;
    if (!userId) return sendUnauthenticated(reply);
    const parsed = analysisQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return invalidField(reply, String(issue?.path[0] ?? 'query'), issue?.message ?? 'invalid');
    }
    const q = parsed.data;
    if (q.from && q.to && q.from > q.to) return invalidField(reply, 'to', 'must be >= from');

    const closed = await loadClosedCampaigns(userId);
    let scoped: ClosedCampaign[];
    if (q.campaign_id) {
      const one = closed.find((c) => c.id === q.campaign_id);
      if (!one) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: 'No such campaign.' });
      }
      scoped = [one];
    } else {
      scoped = closed.filter(
        (c) =>
          closedInPeriod(c.closedOn, q.from ?? null, q.to ?? null) && matchesNature(c, q.nature),
      );
    }
    const [lines, catalogue] = await Promise.all([
      loadVenueImpressionLines(scoped.map((c) => c.id)),
      loadZoneCatalogue(),
    ]);
    const sections = buildAnalysis(scoped, lines, catalogue);
    return reply.status(200).send({
      mode: q.campaign_id ? 'campaign' : 'period',
      period: q.campaign_id ? null : { from: q.from ?? null, to: q.to ?? null },
      nature: q.campaign_id ? scoped[0]?.nature : q.nature,
      ...sectionsView(sections),
    });
  });

  // GET /api/advertiser/performances/campaigns/:id/report.pdf — Q4 (working hypothesis): the
  // per-campaign rapport de clôture, sections 01–04, rendered on the fly (pdfkit).
  app.get(
    '/api/advertiser/performances/campaigns/:id/report.pdf',
    advertiserGuard,
    async (request, reply) => {
      const userId = request.user?.id;
      if (!userId) return sendUnauthenticated(reply);
      const parsed = idParamSchema.safeParse(request.params);
      if (!parsed.success) return invalidField(reply, 'id', 'must be a uuid');
      const closed = await loadClosedCampaigns(userId);
      const campaign = closed.find((c) => c.id === parsed.data.id);
      if (!campaign) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: 'No such campaign.' });
      }
      const [lines, catalogue, [advertiser]] = await Promise.all([
        loadVenueImpressionLines([campaign.id]),
        loadZoneCatalogue(),
        db
          .select({ businessName: users.businessName, contactName: users.contactName })
          .from(users)
          .where(eq(users.id, userId))
          .limit(1),
      ]);
      const sections = buildAnalysis([campaign], lines, catalogue);
      const pdf = await renderCampaignReportPdf({
        campaign,
        sections,
        advertiserName: advertiser?.businessName ?? advertiser?.contactName ?? '',
        generatedAt: new Date(),
      });
      return reply
        .status(200)
        .header('content-type', 'application/pdf')
        .header('content-disposition', `attachment; filename="${campaignReportFilename(campaign)}"`)
        .send(pdf);
    },
  );
};
