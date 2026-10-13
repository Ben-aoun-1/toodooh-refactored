import { subDays } from 'date-fns';
import { and, asc, desc, eq, gte } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';

import { db } from '../db/client.js';
import {
  agentAffiliations,
  agentAttentionEvents,
  agentAttentionThresholds,
  agentShFollowupSnapshots,
} from '../db/schema.js';
import {
  ATTENTION_FR,
  type AttentionSignal,
  loadThresholds,
  snapshotOn,
  venueMetrics,
} from '../lib/agent-sh-followup.js';
import { shAgentAffiliates, shAgentCampaigns } from '../lib/agent-sh-portfolio.js';
import { tunisDateOf } from '../lib/campaign-dates.js';
import { requireAuth, requireRole } from '../middleware/require-auth.js';

import { agentCgeGate } from './agent-account.js';

// AGT-7 (Agent Screenhost spec v1.0 §6) — « Suivi de mes Screenhosts » (the panel and the venue
// sheet) for the Screenhost agent, and the hub's attention thresholds + attention history.
// The score's weights and formula never leave the server; the rates are the engine's.

const shGuard = {
  preHandler: [requireAuth, requireRole('screenhost_agent'), agentCgeGate],
};
const staffGuard = { preHandler: [requireAuth, requireRole('admin', 'superadmin')] };
const idParam = z.object({ id: z.uuid() });
const thresholdsSchema = z
  .object({
    refus_pct: z.number().min(0).max(100),
    sans_reponse_count: z.number().int().min(1).max(100),
    activite_pct: z.number().min(0).max(100),
    evenement_count: z.number().int().min(1).max(100),
    inactivite_days: z.number().int().min(1).max(365),
    baisse_score_points: z.number().min(0).max(100),
  })
  .partial()
  .refine((d) => Object.keys(d).length > 0, 'Empty body');

const invalid = (reply: FastifyReply, issues: z.core.$ZodIssue[]) =>
  reply.status(400).send({
    error: 'INVALID_INPUT',
    message: 'Validation failed',
    fields: issues.map((i) => ({ field: i.path.join('.'), reason: i.message })),
  });

const num = (v: string | null | undefined) => (v === null || v === undefined ? null : Number(v));
const labels = (signals: string[]) =>
  signals.map((s) => ({ key: s, label: ATTENTION_FR[s as AttentionSignal] ?? s }));

const trendOf = (now: number | null, before: number | null): 'up' | 'down' | 'flat' | null =>
  now === null || before === null ? null : now > before ? 'up' : now < before ? 'down' : 'flat';

export const agentFollowupRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/agent/followup — one row per venue pending activation or affiliated: attention
  // points first, then by increasing score.
  app.get('/api/agent/followup', shGuard, async (request, reply) => {
    const id = request.user?.id ?? '';
    const now = new Date();
    const today = tunisDateOf(now);
    const monthAgo = tunisDateOf(subDays(now, 30));
    const affs = (await shAgentAffiliates(id, [], now)).filter(
      (a) => a.status === 'en_attente_activation' || a.status === 'en_cours',
    );
    const rows = await Promise.all(
      affs.map(async (a) => {
        const snap = await snapshotOn(a.screenhost_id, today);
        const before = await snapshotOn(a.screenhost_id, monthAgo);
        const sps = num(snap?.sps);
        return {
          screenhost_id: a.screenhost_id,
          name: a.name,
          status: a.status,
          sps,
          trend: trendOf(sps, before && before.day !== snap?.day ? num(before.sps) : null),
          refused: snap?.offersRefused ?? 0,
          no_answer: snap?.offersNoAnswer ?? 0,
          missed: (snap?.missedOffline ?? 0) + (snap?.missedEvent ?? 0),
          attention: labels(snap?.signals ?? []),
          computed_at: snap?.computedAt.toISOString() ?? null,
        };
      }),
    );
    rows.sort(
      (x, y) =>
        y.attention.length - x.attention.length ||
        (x.sps ?? Number.POSITIVE_INFINITY) - (y.sps ?? Number.POSITIVE_INFINITY),
    );
    return reply.status(200).send({ rows });
  });

  // GET /api/agent/followup/:id — the venue sheet: identity + affiliation, engagement (score,
  // 90-day curve, rates, 30-day counters) and the 30-day history. An ended affiliation keeps its
  // revenue and impressions; its engagement is no longer shown.
  app.get('/api/agent/followup/:id', shGuard, async (request, reply) => {
    const params = idParam.safeParse(request.params);
    if (!params.success) return invalid(reply, params.error.issues);
    const agentId = request.user?.id ?? '';
    const now = new Date();
    const view = await shAgentCampaigns(agentId, now);
    const venue = (await shAgentAffiliates(agentId, view, now)).find(
      (a) => a.screenhost_id === params.data.id,
    );
    if (!venue) return reply.status(404).send({ error: 'NOT_FOUND', message: 'Not in portfolio.' });
    const live = venue.status === 'en_attente_activation' || venue.status === 'en_cours';
    if (!live) return reply.status(200).send({ venue, engagement: null, history: null });

    const snap = await snapshotOn(venue.screenhost_id, tunisDateOf(now));
    const curve = await db
      .select({ day: agentShFollowupSnapshots.day, sps: agentShFollowupSnapshots.sps })
      .from(agentShFollowupSnapshots)
      .where(
        and(
          eq(agentShFollowupSnapshots.screenhostId, venue.screenhost_id),
          gte(agentShFollowupSnapshots.day, tunisDateOf(subDays(now, 90))),
        ),
      )
      .orderBy(asc(agentShFollowupSnapshots.day));
    const metrics = await venueMetrics(venue.screenhost_id, now);
    return reply.status(200).send({
      venue,
      engagement: {
        sps: num(snap?.sps),
        curve: curve.map((c) => ({ day: c.day, sps: num(c.sps) })),
        rates:
          snap?.acceptation != null
            ? {
                acceptation: num(snap.acceptation),
                respect_evenements: num(snap.respectEvenements),
                activite: num(snap.activite),
                remplissage: num(snap.remplissage),
              }
            : null,
        offers: {
          received: snap?.offersReceived ?? 0,
          accepted: snap?.offersAccepted ?? 0,
          refused: snap?.offersRefused ?? 0,
          no_answer: snap?.offersNoAnswer ?? 0,
        },
        missed: { ecran: snap?.missedOffline ?? 0, evenement: snap?.missedEvent ?? 0 },
        unavailable_days: snap?.unavailableDays ?? 0,
        last_diffusion_at: snap?.lastDiffusionAt?.toISOString() ?? null,
        attention: labels(snap?.signals ?? []),
        computed_at: snap?.computedAt.toISOString() ?? null,
      },
      history: { missed: metrics.missed, unaccepted: metrics.unaccepted },
    });
  });

  // ── hub ────────────────────────────────────────────────────────────────────────────────

  app.get('/api/admin/agent-attention-thresholds', staffGuard, async (_request, reply) => {
    const t = await loadThresholds();
    return reply.status(200).send({
      refus_pct: t.refusPct,
      sans_reponse_count: t.sansReponseCount,
      activite_pct: t.activitePct,
      evenement_count: t.evenementCount,
      inactivite_days: t.inactiviteDays,
      baisse_score_points: t.baisseScorePoints,
    });
  });

  app.put('/api/admin/agent-attention-thresholds', staffGuard, async (request, reply) => {
    const body = thresholdsSchema.safeParse(request.body ?? {});
    if (!body.success) return invalid(reply, body.error.issues);
    const b = body.data;
    await db
      .update(agentAttentionThresholds)
      .set({
        ...(b.refus_pct !== undefined ? { refusPct: String(b.refus_pct) } : {}),
        ...(b.sans_reponse_count !== undefined ? { sansReponseCount: b.sans_reponse_count } : {}),
        ...(b.activite_pct !== undefined ? { activitePct: String(b.activite_pct) } : {}),
        ...(b.evenement_count !== undefined ? { evenementCount: b.evenement_count } : {}),
        ...(b.inactivite_days !== undefined ? { inactiviteDays: b.inactivite_days } : {}),
        ...(b.baisse_score_points !== undefined
          ? { baisseScorePoints: String(b.baisse_score_points) }
          : {}),
        updatedAt: new Date(),
        updatedBy: request.user?.id ?? null,
      })
      .where(eq(agentAttentionThresholds.id, 1));
    return reply.status(200).send({ ok: true });
  });

  // GET /api/admin/agent-affiliations/:id/attention — the venue's attention points, appeared and
  // cleared, newest first (spec §6: « historisées et visibles par l'admin »).
  app.get('/api/admin/agent-affiliations/:id/attention', staffGuard, async (request, reply) => {
    const params = idParam.safeParse(request.params);
    if (!params.success) return invalid(reply, params.error.issues);
    const [aff] = await db
      .select({ screenhostId: agentAffiliations.screenhostId })
      .from(agentAffiliations)
      .where(eq(agentAffiliations.id, params.data.id))
      .limit(1);
    if (!aff?.screenhostId) return reply.status(200).send({ events: [] });
    const rows = await db
      .select()
      .from(agentAttentionEvents)
      .where(eq(agentAttentionEvents.screenhostId, aff.screenhostId))
      .orderBy(desc(agentAttentionEvents.appearedAt));
    return reply.status(200).send({
      events: rows.map((e) => ({
        id: e.id,
        signal: e.signal,
        label: ATTENTION_FR[e.signal as AttentionSignal] ?? e.signal,
        appeared_at: e.appearedAt.toISOString(),
        cleared_at: e.clearedAt?.toISOString() ?? null,
      })),
    });
  });
};
