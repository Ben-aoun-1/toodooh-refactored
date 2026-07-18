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
  t_10s: cfg.t10s,
  t_20s: cfg.t20s,
  t_30s: cfg.t30s,
  campaign_lead_working_days: cfg.campaignLeadWorkingDays,
});

// At least one knob must be supplied. CPMs: finite, strictly-positive TND/1000 rates (a
// non-positive CPM would make I_cible = ⌊budget·1000/cpm⌋ blow up / go negative at activation).
// E1 — the attention T buckets: each in (0, 1] (an attention index is a discount, never a boost;
// 0 would zero every capacity AND divide-by-zero the back-conversion). The t_10s ≤ t_20s ≤ t_30s
// ORDERING is validated against the MERGED result (current config + patch) in the handler —
// a partial patch can't be judged on its own keys.
const tField = z.number().gt(0).max(1).optional();
const patchBodySchema = z
  .object({
    standard_cpm_tnd: z.number().positive().finite().optional(),
    event_cpm_tnd: z.number().positive().finite().optional(),
    t_10s: tField,
    t_20s: tField,
    t_30s: tField,
    // CF-D1 — the campaign start-date lead (working days). 0 is legal (floor = today, field-test
    // calibration only); 30 caps runaway values. Integer: the lead counts whole jours ouvrés.
    campaign_lead_working_days: z.number().int().min(0).max(30).optional(),
  })
  .refine((b) => Object.values(b).some((v) => v !== undefined), {
    message: 'at least one editable field is required',
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
    // E1 — the T ordering (t_10s ≤ t_20s ≤ t_30s) must hold on the EFFECTIVE config: merge the
    // patch over the current values and reject nonsense orderings before writing anything.
    const current = await getDispatchConfig();
    const effective = {
      t10s: parsed.data.t_10s ?? current.t10s,
      t20s: parsed.data.t_20s ?? current.t20s,
      t30s: parsed.data.t_30s ?? current.t30s,
    };
    if (!(effective.t10s <= effective.t20s && effective.t20s <= effective.t30s)) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: [
          {
            field: 't_10s',
            reason: `the attention indices must satisfy t_10s ≤ t_20s ≤ t_30s (effective: ${effective.t10s}/${effective.t20s}/${effective.t30s})`,
          },
        ],
      });
    }

    // numeric columns take strings; only set the keys the admin actually sent.
    const patch: {
      standardCpmTnd?: string;
      eventCpmTnd?: string;
      t10s?: string;
      t20s?: string;
      t30s?: string;
      campaignLeadWorkingDays?: number;
    } = {};
    if (parsed.data.standard_cpm_tnd !== undefined)
      patch.standardCpmTnd = String(parsed.data.standard_cpm_tnd);
    if (parsed.data.event_cpm_tnd !== undefined)
      patch.eventCpmTnd = String(parsed.data.event_cpm_tnd);
    if (parsed.data.t_10s !== undefined) patch.t10s = String(parsed.data.t_10s);
    if (parsed.data.t_20s !== undefined) patch.t20s = String(parsed.data.t_20s);
    if (parsed.data.t_30s !== undefined) patch.t30s = String(parsed.data.t_30s);
    if (parsed.data.campaign_lead_working_days !== undefined)
      patch.campaignLeadWorkingDays = parsed.data.campaign_lead_working_days;

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
        t10s: patch.t10s ?? String(DISPATCH_CONFIG_DEFAULTS.t10s),
        t20s: patch.t20s ?? String(DISPATCH_CONFIG_DEFAULTS.t20s),
        t30s: patch.t30s ?? String(DISPATCH_CONFIG_DEFAULTS.t30s),
        campaignLeadWorkingDays:
          patch.campaignLeadWorkingDays ?? DISPATCH_CONFIG_DEFAULTS.campaignLeadWorkingDays,
      });
    }
    return reply.status(200).send(configView(await getDispatchConfig()));
  });
};
