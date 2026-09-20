import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { listScreencasterCpm, updateScreencasterCpm } from '../lib/screencaster-cpm.js';
import { requireAdmin, requireAuth } from '../middleware/require-auth.js';

// CPM-3 (operator rulings 2026-09-18) — the admin « CPM par screencaster » surface. GET lists
// every screencaster with its CPMs; PATCH changes one or many at once (either rate or both). The
// rule — drafts follow, every other campaign keeps its price — lives in lib/screencaster-cpm.ts.

// A CPM is a strictly-positive TND / 1000 rate (0 would blow up I_cible = ⌊budget·1000/cpm⌋);
// numeric(10,3) holds up to 9 999 999.999 — the cap keeps a typo from overflowing it. At most 3
// decimals: money precision is the millime, and toFixed(3) downstream would otherwise round a
// 4th-decimal typo silently instead of rejecting it.
const cpmField = z
  .number()
  .positive()
  .finite()
  .max(1_000_000)
  .refine((n) => Number(n.toFixed(3)) === n, 'au plus 3 décimales');
const patchSchema = z
  .object({
    user_ids: z.array(z.uuid()).min(1).max(500),
    standard_cpm_tnd: cpmField.optional(),
    event_cpm_tnd: cpmField.optional(),
  })
  .refine((b) => b.standard_cpm_tnd !== undefined || b.event_cpm_tnd !== undefined, {
    message: 'at least one CPM is required',
    path: ['standard_cpm_tnd'],
  });

export const adminScreencasterCpmRoutes: FastifyPluginAsync = async (app) => {
  const adminGuard = { preHandler: [requireAuth, requireAdmin] };

  app.get('/api/admin/screencasters/cpm', adminGuard, async (_request, reply) =>
    reply.status(200).send({ screencasters: await listScreencasterCpm() }),
  );

  app.patch('/api/admin/screencasters/cpm', adminGuard, async (request, reply) => {
    const parsed = patchSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: parsed.error.issues.map((i) => ({ field: i.path.join('.'), reason: i.message })),
      });
    }
    const adminId = request.user?.id;
    if (!adminId) {
      return reply
        .status(401)
        .send({ error: 'UNAUTHENTICATED', message: 'Authentification requise.' });
    }
    const result = await updateScreencasterCpm({
      userIds: parsed.data.user_ids,
      ...(parsed.data.standard_cpm_tnd !== undefined
        ? { standardCpmTnd: parsed.data.standard_cpm_tnd }
        : {}),
      ...(parsed.data.event_cpm_tnd !== undefined
        ? { eventCpmTnd: parsed.data.event_cpm_tnd }
        : {}),
      changedBy: adminId,
    });
    if (!result.ok) {
      return reply.status(400).send({
        error: 'NOT_ADVERTISER',
        message: 'Seuls les screencasters (annonceurs) ont un CPM.',
        user_ids: result.ids,
      });
    }
    return reply
      .status(200)
      .send({ updated: result.updated, drafts_repriced: result.draftsRepriced });
  });
};
