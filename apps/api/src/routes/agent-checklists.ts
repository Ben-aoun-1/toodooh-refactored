import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { env } from '../env.js';
import {
  ALREADY_DECIDED,
  createChecklist,
  decideChecklist,
  deleteDraft,
  hubChecklist,
  hubChecklists,
  myChecklist,
  myChecklists,
  pushChecklistSubmitted,
  saveChecklist,
  sendChecklist,
} from '../lib/agent-checklists.js';
import { requireAuth, requireRole } from '../middleware/require-auth.js';
import { requireSyncKey } from '../middleware/require-sync-key.js';

import { agentCgeGate } from './agent-account.js';

// Agent Screenhost spec VF §11 « Checklist » and Hub spec « Checklists ».
//   /api/agent/checklists*    — the Screenhost agent's own fiches (drafts, sending);
//   /api/internal/checklists* — the Hub's window, guarded by the sync key: the manager reads and
//                               decides there, the admin reads the decided ones. Drafts never
//                               leave the platform.

const agentGuard = { preHandler: [requireAuth, requireRole('screenhost_agent'), agentCgeGate] };
const idParam = z.object({ id: z.uuid() });
const NOT_FOUND = { error: 'NOT_FOUND', message: 'Fiche introuvable.' };
const NOT_A_DRAFT = {
  error: 'NOT_A_DRAFT',
  message: 'Cette fiche a déjà été envoyée au manager : elle ne peut plus être modifiée.',
};

export const agentChecklistRoutes: FastifyPluginAsync<{ syncKey?: string }> = async (app, opts) => {
  app.get('/api/agent/checklists', agentGuard, async (request, reply) =>
    reply.status(200).send({ checklists: await myChecklists(request.user?.id ?? '') }),
  );

  // POST /api/agent/checklists — « Nouvelle fiche »: an empty draft, listed at once.
  app.post('/api/agent/checklists', agentGuard, async (request, reply) =>
    reply.status(201).send(await createChecklist(request.user?.id ?? '')),
  );

  app.get('/api/agent/checklists/:id', agentGuard, async (request, reply) => {
    const params = idParam.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: 'INVALID_INPUT', message: 'id' });
    const row = await myChecklist(request.user?.id ?? '', params.data.id);
    return row ? reply.status(200).send(row) : reply.status(404).send(NOT_FOUND);
  });

  // PUT /api/agent/checklists/:id { answers } — the autosave of a draft.
  app.put('/api/agent/checklists/:id', agentGuard, async (request, reply) => {
    const params = idParam.safeParse(request.params);
    const body = z.object({ answers: z.record(z.string(), z.unknown()) }).safeParse(request.body);
    if (!params.success || !body.success) {
      return reply.status(400).send({ error: 'INVALID_INPUT', message: 'Validation failed' });
    }
    const r = await saveChecklist(request.user?.id ?? '', params.data.id, body.data.answers);
    if (r.ok) return reply.status(200).send({ ok: true });
    return r.error === 'NOT_FOUND'
      ? reply.status(404).send(NOT_FOUND)
      : reply.status(409).send(NOT_A_DRAFT);
  });

  app.delete('/api/agent/checklists/:id', agentGuard, async (request, reply) => {
    const params = idParam.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: 'INVALID_INPUT', message: 'id' });
    return (await deleteDraft(request.user?.id ?? '', params.data.id))
      ? reply.status(200).send({ ok: true })
      : reply.status(404).send(NOT_FOUND);
  });

  // POST /api/agent/checklists/:id/send — « Envoyer au manager ».
  app.post('/api/agent/checklists/:id/send', agentGuard, async (request, reply) => {
    const params = idParam.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: 'INVALID_INPUT', message: 'id' });
    const r = await sendChecklist(request.user?.id ?? '', params.data.id);
    if (!r.ok) {
      if (r.error === 'INCOMPLETE') {
        return reply.status(409).send({
          error: 'INCOMPLETE',
          message: 'Il manque une réponse dans la fiche.',
          question: r.question,
        });
      }
      return r.error === 'NOT_FOUND'
        ? reply.status(404).send(NOT_FOUND)
        : reply.status(409).send(NOT_A_DRAFT);
    }
    if (!(await pushChecklistSubmitted(r.checklist))) {
      request.log.warn({ checklistId: r.checklist.id }, 'hub checklist notice not delivered');
    }
    return reply.status(200).send({ ok: true, result: r.checklist.result });
  });

  // ── the Hub's window ────────────────────────────────────────────────────────────────────
  const hubGuard = { onRequest: [requireSyncKey(opts.syncKey ?? env.WEDOOH_SYNC_KEY)] };

  app.get('/api/internal/checklists', hubGuard, async (request, reply) => {
    const q = z
      .object({ scope: z.enum(['all', 'decided']).default('all') })
      .safeParse(request.query);
    if (!q.success) return reply.status(400).send({ error: 'INVALID_INPUT', message: 'scope' });
    return reply.status(200).send({ checklists: await hubChecklists(q.data.scope) });
  });

  app.get('/api/internal/checklists/:id', hubGuard, async (request, reply) => {
    const params = idParam.safeParse(request.params);
    if (!params.success) return reply.status(404).send(NOT_FOUND);
    const row = await hubChecklist(params.data.id);
    return row ? reply.status(200).send({ checklist: row }) : reply.status(404).send(NOT_FOUND);
  });

  app.post('/api/internal/checklists/:id/decision', hubGuard, async (request, reply) => {
    const params = idParam.safeParse(request.params);
    if (!params.success) return reply.status(404).send(NOT_FOUND);
    const body = z
      .object({
        decision: z.enum(['validated', 'refused']),
        comment: z.string().trim().max(1000).optional(),
        manager: z.object({
          hub_user_id: z.number().int(),
          name: z.string().trim().min(1).max(200),
        }),
      })
      .safeParse(request.body ?? {});
    if (!body.success) {
      return reply.status(400).send({ error: 'INVALID_INPUT', message: 'Validation failed' });
    }
    const r = await decideChecklist(
      params.data.id,
      body.data.decision,
      body.data.comment || null,
      body.data.manager,
    );
    if (r.ok) {
      request.log.info(
        {
          checklistId: params.data.id,
          decision: body.data.decision,
          hubUserId: body.data.manager.hub_user_id,
        },
        'checklist decided by the hub manager',
      );
      return reply.status(200).send({ checklist: r.checklist });
    }
    return r.error === 'NOT_FOUND'
      ? reply.status(404).send(NOT_FOUND)
      : reply.status(409).send({ error: 'ALREADY_DECIDED', message: ALREADY_DECIDED });
  });
};
