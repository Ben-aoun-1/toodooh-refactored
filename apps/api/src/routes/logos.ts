import multipart from '@fastify/multipart';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { db } from '../db/client.js';
import {
  agentAffiliations,
  agentCommissionLines,
  campaigns,
  screenhosts,
  users,
} from '../db/schema.js';
import {
  LOGO_FILE_MESSAGES,
  LOGO_MAX_BYTES,
  type LogoSubject,
  type LogoUploaderRole,
  decideLogo,
  logosFor,
  pendingLogos,
  submitLogo,
} from '../lib/logos.js';
import { requireAuth, requireRole } from '../middleware/require-auth.js';

import { agentCgeGate } from './agent-account.js';

// Mariem 12/11/2026 (Agent Screenhost spec VF §6, Agent Screencaster spec VF §5) — logos.
//   agent  — reads the logos his pages show, sends a logo for one of his affiliates (pending);
//   admin  — the queue of pending logos (validate / refuse), and add or replace any logo;
//   owner / Screencaster — sets his own logo (validated at once).

const agentGuard = {
  preHandler: [requireAuth, requireRole('screenhost_agent', 'screencast_agent'), agentCgeGate],
};
const staffGuard = { preHandler: [requireAuth, requireRole('admin', 'superadmin')] };
const ownerGuard = { preHandler: [requireAuth, requireRole('individual_owner', 'fleet_owner')] };
const advertiserGuard = { preHandler: [requireAuth, requireRole('advertiser')] };

const idParam = z.object({ id: z.uuid() });
const LIVE = ['en_attente_activation', 'en_cours'] as const;

/** The venues (Screenhost agent) or accounts (Screencaster agent) of an agent's live affiliations. */
const agentSubjects = async (agentUserId: string, role: string): Promise<LogoSubject[]> => {
  const sh = role === 'screenhost_agent';
  const rows = await db
    .select({ venue: agentAffiliations.screenhostId, user: agentAffiliations.referredUserId })
    .from(agentAffiliations)
    .where(
      and(
        eq(agentAffiliations.agentUserId, agentUserId),
        inArray(agentAffiliations.status, [...LIVE, 'terminee']),
        sh
          ? sql`${agentAffiliations.screenhostId} is not null`
          : isNull(agentAffiliations.screenhostId),
      ),
    );
  return rows.map((r) =>
    sh ? { kind: 'screenhost', id: r.venue ?? '' } : { kind: 'advertiser', id: r.user },
  );
};

/** The file of a single-file multipart request, or the reply already sent. */
const readFile = async (request: FastifyRequest, reply: FastifyReply): Promise<Buffer | null> => {
  const data = await request.file();
  if (!data) {
    await reply.status(400).send({ error: 'INVALID_INPUT', message: 'Fichier requis.' });
    return null;
  }
  try {
    return await data.toBuffer();
  } catch {
    await reply
      .status(413)
      .send({ error: 'PAYLOAD_TOO_LARGE', message: 'Logo trop lourd (5 Mo maximum).' });
    return null;
  }
};

const store = async (
  request: FastifyRequest,
  reply: FastifyReply,
  subject: LogoSubject,
  role: LogoUploaderRole,
) => {
  const userId = request.user?.id ?? '';
  const body = await readFile(request, reply);
  if (!body) return reply;
  const r = await submitLogo(subject, body, { userId, role });
  if (!r.ok) {
    return r.error === 'STORAGE_ERROR'
      ? reply.status(502).send({ error: r.error, message: 'Enregistrement impossible. Réessayez.' })
      : reply.status(400).send({ error: r.error, message: LOGO_FILE_MESSAGES[r.error] });
  }
  const view = (await logosFor([subject], userId)).get(subject.id);
  return reply.status(201).send(view ?? { url: null, status: r.logo.status });
};

export const logoRoutes: FastifyPluginAsync = async (app) => {
  await app.register(multipart, { limits: { fileSize: LOGO_MAX_BYTES, files: 1, fields: 0 } });

  // GET /api/agent/logos — { subjects: by venue / account id, campaigns: the advertiser's logo
  // of each of the agent's campaigns }. A pending logo is only ever the agent's own.
  app.get('/api/agent/logos', agentGuard, async (request, reply) => {
    const agentId = request.user?.id ?? '';
    const subjects = await agentSubjects(agentId, request.user?.role ?? '');
    const lines = await db
      .selectDistinct({ id: campaigns.id, advertiserId: campaigns.advertiserId })
      .from(agentCommissionLines)
      .innerJoin(campaigns, eq(campaigns.id, agentCommissionLines.campaignId))
      .where(eq(agentCommissionLines.agentUserId, agentId));
    const advertisers: LogoSubject[] = [...new Set(lines.map((l) => l.advertiserId))].map((id) => ({
      kind: 'advertiser',
      id,
    }));
    const found = await logosFor([...subjects, ...advertisers], agentId);
    const own = new Set(subjects.map((s) => s.id));
    return reply.status(200).send({
      subjects: Object.fromEntries([...found].filter(([id]) => own.has(id))),
      campaigns: Object.fromEntries(
        lines.flatMap((l) => {
          const logo = found.get(l.advertiserId);
          return logo ? [[l.id, logo]] : [];
        }),
      ),
    });
  });

  // POST /api/agent/logos/:id — a logo for one of the agent's affiliates: pending validation.
  app.post('/api/agent/logos/:id', agentGuard, async (request, reply) => {
    const params = idParam.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: 'INVALID_INPUT', message: 'id' });
    const role = request.user?.role ?? '';
    const live = (await agentSubjects(request.user?.id ?? '', role)).find(
      (s) => s.id === params.data.id,
    );
    if (!live) {
      return reply
        .status(404)
        .send({ error: 'NOT_FOUND', message: 'Ce contact ne fait pas partie de vos affiliés.' });
    }
    return store(request, reply, live, 'agent');
  });

  // ── admin ───────────────────────────────────────────────────────────────────────────────
  app.get('/api/admin/logos', staffGuard, async (_request, reply) =>
    reply.status(200).send({ pending: await pendingLogos() }),
  );

  const decide = (accept: boolean) => async (request: FastifyRequest, reply: FastifyReply) => {
    const params = idParam.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: 'INVALID_INPUT', message: 'id' });
    const body = z
      .object({ reason: z.string().trim().max(500).nullable().optional() })
      .safeParse(request.body ?? {});
    if (!body.success) return reply.status(400).send({ error: 'INVALID_INPUT', message: 'reason' });
    const r = await decideLogo(
      params.data.id,
      request.user?.id ?? '',
      accept,
      body.data.reason?.trim() || null,
    );
    if (!r.ok) {
      return r.error === 'NOT_FOUND'
        ? reply.status(404).send({ error: r.error, message: 'Logo introuvable.' })
        : reply.status(409).send({ error: r.error, message: 'Ce logo a déjà été traité.' });
    }
    return reply.status(200).send({ ok: true, status: r.logo.status });
  };
  app.post('/api/admin/logos/:id/validate', staffGuard, decide(true));
  app.post('/api/admin/logos/:id/refuse', staffGuard, decide(false));

  // GET /api/admin/logos/screenhost/:id | advertiser/:id — the subject's validated logo.
  // POST — add or replace it (validated at once; a pending one is superseded).
  for (const kind of ['screenhost', 'advertiser'] as const) {
    const exists = async (id: string) =>
      kind === 'screenhost'
        ? (await db.select({ id: screenhosts.id }).from(screenhosts).where(eq(screenhosts.id, id)))
            .length > 0
        : (
            await db
              .select({ id: users.id })
              .from(users)
              .where(and(eq(users.id, id), eq(users.role, 'advertiser')))
          ).length > 0;
    app.get(`/api/admin/logos/${kind}/:id`, staffGuard, async (request, reply) => {
      const params = idParam.safeParse(request.params);
      if (!params.success) return reply.status(400).send({ error: 'INVALID_INPUT', message: 'id' });
      const logo = (await logosFor([{ kind, id: params.data.id }], null)).get(params.data.id);
      return reply.status(200).send({ logo: logo ?? null });
    });
    app.post(`/api/admin/logos/${kind}/:id`, staffGuard, async (request, reply) => {
      const params = idParam.safeParse(request.params);
      if (!params.success) return reply.status(400).send({ error: 'INVALID_INPUT', message: 'id' });
      if (!(await exists(params.data.id))) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: 'Compte introuvable.' });
      }
      return store(request, reply, { kind, id: params.data.id }, 'admin');
    });
  }

  // ── the Screenhost's and the Screencaster's own logo ────────────────────────────────────
  app.post('/api/screenhosts/:id/logo', ownerGuard, async (request, reply) => {
    const params = idParam.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: 'INVALID_INPUT', message: 'id' });
    const [venue] = await db
      .select({ id: screenhosts.id })
      .from(screenhosts)
      .where(
        and(eq(screenhosts.id, params.data.id), eq(screenhosts.ownerId, request.user?.id ?? '')),
      )
      .limit(1);
    if (!venue) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Établissement introuvable.' });
    }
    return store(request, reply, { kind: 'screenhost', id: venue.id }, 'owner');
  });
  app.get('/api/screenhosts/:id/logo', ownerGuard, async (request, reply) => {
    const params = idParam.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: 'INVALID_INPUT', message: 'id' });
    const [venue] = await db
      .select({ id: screenhosts.id })
      .from(screenhosts)
      .where(
        and(eq(screenhosts.id, params.data.id), eq(screenhosts.ownerId, request.user?.id ?? '')),
      )
      .limit(1);
    if (!venue) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Établissement introuvable.' });
    }
    const logo = (await logosFor([{ kind: 'screenhost', id: venue.id }], null)).get(venue.id);
    return reply.status(200).send({ logo: logo ?? null });
  });
  app.post('/api/profile/logo', advertiserGuard, async (request, reply) =>
    store(request, reply, { kind: 'advertiser', id: request.user?.id ?? '' }, 'owner'),
  );
  app.get('/api/profile/logo', advertiserGuard, async (request, reply) => {
    const id = request.user?.id ?? '';
    const logo = (await logosFor([{ kind: 'advertiser', id }], null)).get(id);
    return reply.status(200).send({ logo: logo ?? null });
  });
};
