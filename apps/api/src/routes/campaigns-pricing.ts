import type { FastifyPluginAsync } from 'fastify';

import { premiereDateDisponible } from '../lib/campaign-dates.js';
import { getDispatchConfig } from '../lib/dispatch/config.js';
import { screencasterCpmRates } from '../lib/screencaster-cpm.js';
import { requireAuth } from '../middleware/require-auth.js';

// Advertiser-readable pricing config — the CPM the campaign wizard's Validation step uses to price a
// budget→impressions estimate (⌊budget·1000/cpm⌋) before the draft exists. For an advertiser it is
// their OWN CPM (CPM-3 below) — an admin change to it is reflected here with no lag; for any other
// role it is the global default the ADMIN surface edits (routes/admin-dispatch-config.ts), via
// getDispatchConfig, so a config-less DB falls back to the V1 defaults.
// The CPMs are commercial-but-not-secret DISPLAY inputs (they price the advertiser's own estimate),
// so any authenticated user may read them; requireAuth 401s an anonymous caller. Read-only: the
// editable knobs stay admin-only. No schema change, no new table — a thin read over the same service.
// CPM-3 — for an advertiser these are THEIR OWN rates (users.cpm_*_tnd), the ones a campaign they
// create now captures; other roles get the global default of new screencasters. An existing
// campaign carries its own copy (the campaign projection's standard_cpm_tnd / event_cpm_tnd).
export const campaignsPricingRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/api/campaigns/pricing-config',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const cfg = await getDispatchConfig();
      // CPM-3 — an advertiser's estimate is priced at THEIR OWN CPM (the one a campaign they
      // create now captures); any other role sees the global default of new screencasters.
      const own = request.user ? await screencasterCpmRates(request.user.id) : null;
      return reply.status(200).send({
        standard_cpm_tnd: own?.standardCpmTnd ?? cfg.standardCpmTnd,
        event_cpm_tnd: own?.eventCpmTnd ?? cfg.eventCpmTnd,
        // CF-Q2 (spec §1.4) — the working-day start floor, computed server-side in ONE place
        // (lib/campaign-dates) so the wizard consumes it instead of hardcoding the rule.
        first_available_start_date: premiereDateDisponible(new Date(), cfg.campaignLeadWorkingDays),
      });
    },
  );
};
