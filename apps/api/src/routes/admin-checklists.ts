import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import {
  adminChecklist,
  adminChecklists,
  checklistOfScreenhost,
  linkChecklist,
} from '../lib/checklist-links.js';
import { requireAuth, requireRole } from '../middleware/require-auth.js';

// Mariem 15/11/2026 — the Admin links an agent's qualification fiche to the Screenhost it became
// (lib/checklist-links.ts). Staff only:
//
//   GET  /api/admin/checklists                     every sent fiche, with its Host if linked
//   GET  /api/admin/checklists/:id                 one fiche in full
//   POST /api/admin/checklists/:id/link            { screenhost_id: uuid | null }
//   GET  /api/admin/screenhosts/:id/checklist      the Fiche Host recap
const staffGuard = { preHandler: [requireAuth, requireRole('admin', 'superadmin')] };
const idParam = z.object({ id: z.uuid() });
const NOT_FOUND = { error: 'NOT_FOUND', message: 'Fiche introuvable.' };
const LINK_ERRORS = {
  NOT_FOUND: { status: 404, body: NOT_FOUND },
  SCREENHOST_NOT_FOUND: {
    status: 404,
    body: { error: 'SCREENHOST_NOT_FOUND', message: 'Screenhost introuvable.' },
  },
  SCREENHOST_TAKEN: {
    status: 409,
    body: {
      error: 'SCREENHOST_TAKEN',
      message: 'Ce Screenhost est déjà relié à une autre fiche.',
    },
  },
} as const;

export const adminChecklistRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/admin/checklists', staffGuard, async (_request, reply) =>
    reply.status(200).send({ checklists: await adminChecklists() }),
  );

  app.get('/api/admin/checklists/:id', staffGuard, async (request, reply) => {
    const params = idParam.safeParse(request.params);
    if (!params.success) return reply.status(404).send(NOT_FOUND);
    const fiche = await adminChecklist(params.data.id);
    return fiche ? reply.status(200).send(fiche) : reply.status(404).send(NOT_FOUND);
  });

  app.post('/api/admin/checklists/:id/link', staffGuard, async (request, reply) => {
    const params = idParam.safeParse(request.params);
    const body = z.object({ screenhost_id: z.uuid().nullable() }).safeParse(request.body ?? {});
    if (!params.success || !body.success) {
      return reply.status(400).send({ error: 'INVALID_INPUT', message: 'Validation failed' });
    }
    const r = await linkChecklist(params.data.id, body.data.screenhost_id);
    if (!r.ok) {
      const e = LINK_ERRORS[r.error];
      return reply.status(e.status).send(e.body);
    }
    request.log.info(
      { checklistId: params.data.id, screenhostId: body.data.screenhost_id },
      'admin linked a checklist to a screenhost',
    );
    return reply.status(200).send({ ok: true });
  });

  app.get('/api/admin/screenhosts/:id/checklist', staffGuard, async (request, reply) => {
    const params = idParam.safeParse(request.params);
    if (!params.success) return reply.status(404).send(NOT_FOUND);
    return reply.status(200).send({ checklist: await checklistOfScreenhost(params.data.id) });
  });
};
