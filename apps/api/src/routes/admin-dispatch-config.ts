import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { db } from '../db/client.js';
import { dispatchConfig } from '../db/schema.js';
import { type ResolvedDispatchConfig, getDispatchConfig } from '../lib/dispatch/config.js';
import { DISPATCH_CONFIG_DEFAULTS } from '../lib/dispatch/thresholds.js';
import { requireAdmin, requireAuth } from '../middleware/require-auth.js';

// Admin dispatch-config surface — the CPM the activation derivation prices a campaign at (operator
// ruling: 15 TND/1000 standard, 30 events). The singleton dispatch_config row holds the calibratable
// thresholds; this exposes the two ADMIN-EDITABLE CPM knobs (standard_cpm_tnd / event_cpm_tnd) so an
// operator can re-price without a migration. The other thresholds are read-only here (seeded/POC).
// Every route is [requireAuth, requireAdmin]; a non-admin 403s. PATCH is partial (either CPM, or both)
// and upserts the singleton so a config-less DB self-heals to the V1 defaults before applying the edit.

// Wire-exact snake_case projection of the resolved config (numbers, never numeric strings).
const configView = (cfg: ResolvedDispatchConfig) => ({
  seuil_diffusable: cfg.seuilDiffusable,
  g_mois: cfg.gMois,
  jours_actifs: cfg.joursActifs,
  r_min_efficace: cfg.rMinEfficace,
  f_max_seconds: cfg.fMaxSeconds,
  standard_cpm_tnd: cfg.standardCpmTnd,
  event_cpm_tnd: cfg.eventCpmTnd,
});

// At least one CPM must be supplied; each must be a finite, strictly-positive TND/1000 rate (a
// non-positive CPM would make I_cible = ⌊budget·1000/cpm⌋ blow up / go negative at activation).
const patchBodySchema = z
  .object({
    standard_cpm_tnd: z.number().positive().finite().optional(),
    event_cpm_tnd: z.number().positive().finite().optional(),
  })
  .refine((b) => b.standard_cpm_tnd !== undefined || b.event_cpm_tnd !== undefined, {
    message: 'at least one of standard_cpm_tnd / event_cpm_tnd is required',
  });

export const adminDispatchConfigRoutes: FastifyPluginAsync = async (app) => {
  const adminGuard = { preHandler: [requireAuth, requireAdmin] };

  // GET /api/admin/dispatch-config — the resolved singleton config (falls back to V1 defaults when
  // no row exists, mirroring getDispatchConfig — dispatch never reads a hole).
  app.get('/api/admin/dispatch-config', adminGuard, async (_request, reply) => {
    return reply.status(200).send(configView(await getDispatchConfig()));
  });

  // PATCH /api/admin/dispatch-config { standard_cpm_tnd?, event_cpm_tnd? } — edit either/both CPMs.
  app.patch('/api/admin/dispatch-config', adminGuard, async (request, reply) => {
    const parsed = patchBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: parsed.error.issues.map((i) => ({ field: i.path.join('.'), reason: i.message })),
      });
    }
    // numeric columns take strings; only set the keys the admin actually sent.
    const patch: { standardCpmTnd?: string; eventCpmTnd?: string } = {};
    if (parsed.data.standard_cpm_tnd !== undefined)
      patch.standardCpmTnd = String(parsed.data.standard_cpm_tnd);
    if (parsed.data.event_cpm_tnd !== undefined)
      patch.eventCpmTnd = String(parsed.data.event_cpm_tnd);

    const [existing] = await db.select({ id: dispatchConfig.id }).from(dispatchConfig).limit(1);
    if (existing) {
      await db.update(dispatchConfig).set(patch).where(eq(dispatchConfig.id, existing.id));
    } else {
      // Defensive: migration 0026 seeds the singleton, but a config-less DB self-heals to defaults.
      await db.insert(dispatchConfig).values({
        seuilDiffusable: DISPATCH_CONFIG_DEFAULTS.seuilDiffusable,
        gMois: String(DISPATCH_CONFIG_DEFAULTS.gMois),
        joursActifs: DISPATCH_CONFIG_DEFAULTS.joursActifs,
        rMinEfficace: DISPATCH_CONFIG_DEFAULTS.rMinEfficace,
        fMaxSeconds: DISPATCH_CONFIG_DEFAULTS.fMaxSeconds,
        standardCpmTnd: patch.standardCpmTnd ?? String(DISPATCH_CONFIG_DEFAULTS.standardCpmTnd),
        eventCpmTnd: patch.eventCpmTnd ?? String(DISPATCH_CONFIG_DEFAULTS.eventCpmTnd),
      });
    }
    return reply.status(200).send(configView(await getDispatchConfig()));
  });
};
