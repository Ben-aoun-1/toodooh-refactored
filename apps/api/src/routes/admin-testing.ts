import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { buildTestingReport, listTestingScreenhosts } from '../lib/admin-testing-report.js';
import { isCalendarDate } from '../lib/calendar-date.js';
import { requireAdmin, requireAuth } from '../middleware/require-auth.js';

// ADM-OBS1 slice A — the admin « Tests » page (operator, 2026-09-11/12; Mejri 08/09 « j'ai besoin de
// l'ensemble des informations historiques … pour tester le pricing »).
//
// ONE read-only endpoint that exposes, per screenhost and for ANY période, every variable the
// engines compute — by CALLING THE ENGINES, never by re-deriving: the same `periodAudience` the
// owner page and the PDF use, the same `computeSps` dispatch reads, the same `computeAmax` event
// pricing reads, the same resolved dispatch config. If a number here disagrees with a product
// surface, the product surface is wrong, not this page. Adds only what the surfaces do not show:
// min and median (over days AND over cells), the SPS evidence and weights side by side, the
// pricing inputs, and the raw cells. Nothing is written.
//
// Slice B (2026-09-12, money-lost rule ruled the same day): the per-hour FOUR-STATE status and the
// per-campaign delivered / disrupted / redispatched / money-lost view — pure derivations in
// lib/admin-testing-status.ts over the engine's own rows (allocations, proofs, redispatch rounds).

const ISO_DAY = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isCalendarDate, 'must be a real YYYY-MM-DD calendar day');

const reportQuerySchema = z
  .object({ from: ISO_DAY, to: ISO_DAY })
  .refine((q) => q.from <= q.to, { message: 'from must be on or before to' });

const idParamSchema = z.object({ id: z.uuid() });

export const adminTestingRoutes: FastifyPluginAsync = async (app) => {
  const adminGuard = { preHandler: [requireAuth, requireAdmin] };

  // The picker: every screenhost, lightest possible row.
  app.get('/api/admin/testing/screenhosts', adminGuard, async (_request, reply) =>
    reply.status(200).send(await listTestingScreenhosts()),
  );

  app.get('/api/admin/testing/screenhosts/:id', adminGuard, async (request, reply) => {
    const params = idParamSchema.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: 'Invalid screenhost id' });
    const query = reportQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.status(400).send({ error: 'Invalid période', details: query.error.issues });
    }
    const { id } = params.data;
    const { from, to } = query.data;

    const report = await buildTestingReport({ id, from, to, now: new Date() });
    if (!report) return reply.status(404).send({ error: 'Screenhost not found' });
    return reply.status(200).send(report);
  });
};
