import type { FastifyPluginAsync } from 'fastify';

import { premiereDateDisponible } from '../lib/campaign-dates.js';
import { getDispatchConfig } from '../lib/dispatch/config.js';
import { requireAuth } from '../middleware/require-auth.js';

// Advertiser-readable pricing config — the CPM the campaign wizard's Validation step uses to price a
// budget→impressions estimate (⌊budget·1000/cpm⌋). It projects the SAME resolved dispatch_config
// singleton the ADMIN surface edits (routes/admin-dispatch-config.ts), via getDispatchConfig — so a
// config-less DB falls back to the V1 defaults and an admin re-price is reflected here with no lag.
// The CPMs are commercial-but-not-secret DISPLAY inputs (they price the advertiser's own estimate),
// so any authenticated user may read them; requireAuth 401s an anonymous caller. Read-only: the
// editable knobs stay admin-only. No schema change, no new table — a thin read over the same service.
export const campaignsPricingRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/api/campaigns/pricing-config',
    { preHandler: [requireAuth] },
    async (_request, reply) => {
      const cfg = await getDispatchConfig();
      return reply.status(200).send({
        standard_cpm_tnd: cfg.standardCpmTnd,
        event_cpm_tnd: cfg.eventCpmTnd,
        // CF-Q2 (spec §1.4) — the J+2-working-days start floor, computed server-side in ONE
        // place (lib/campaign-dates) so the wizard consumes it instead of hardcoding the rule.
        first_available_start_date: premiereDateDisponible(),
      });
    },
  );
};
