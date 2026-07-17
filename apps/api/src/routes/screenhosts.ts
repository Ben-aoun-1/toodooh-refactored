import { and, asc, count, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { db } from '../db/client.js';
import {
  businessSectors,
  campaignDispatchAllocation,
  campaignDispatchPlan,
  campaignReconciliation,
  campaignScreenhostPayout,
  campaigns,
  campaignTargeting,
  campaignZones,
  creatives,
  type DispatchAcceptation,
  proofOfPlay,
  screenhostAffluence,
  screenhostMonthlyReports,
  screenhostMonthlyStats,
  screenhosts,
  users,
  zones,
} from '../db/schema.js';
import { runRefusalCascade } from '../lib/dispatch/cascade.js';
import { buildEligibilityPatch } from '../lib/eligibility-patch.js';
import { assembleReportData } from '../lib/report/assemble.js';
import { pistesForReportCached } from '../lib/report/recommendations.js';
import { renderPdf } from '../lib/report/render.js';
import { renderReportHtml } from '../lib/report/template.js';
import { pushApprovedOwnerLocations } from '../lib/wedooh-sync.js';
import { decryptWifiPassword, encryptWifiPassword } from '../lib/wifi-crypto.js';
import { requireActiveAccount, requireAdmin, requireAuth } from '../middleware/require-auth.js';
import { storage } from '../storage/s3-storage.js';

// Owner- and admin-facing WiFi maintenance for screenhosts. A venue's WiFi can change after
// signup (Kais 2026-06), so SSID + password are editable here by the owner (their own
// screenhosts) and by an admin (any screenhost). The password stays write-only on the LIST + EDIT
// responses (GET /mine, PATCH /:id/wifi): those expose only `wifi_password_set`, never the secret.
// The ONE exception is the explicit per-screenhost reveal (GET /:id/wifi/reveal, owner-scoped; admin
// mirror at /api/admin/screenhosts/:id/wifi/reveal), which decrypts and returns the plaintext on
// demand for the venue's own owner (R1, Kais QA) — and for admins. The plaintext and the key are
// NEVER logged or echoed. Every successful edit re-pushes the owner's approved screenhosts to wedooh
// (S-T1 Edge B2) so the hub's stored credentials stay current.
const idParamSchema = z.object({ id: z.uuid() });

// Drizzle numeric → JS string; Number() NaN-guarded (the internal.ts lat/lng convention) so the
// owner reads put real numbers on the wire.
const num = (value: string | null): number | null => {
  if (value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

// SSID: set when provided (min 1; use null to clear). Password: a non-empty string is the new
// secret; '' or omitted means "leave unchanged" (the form is write-only — blank ≠ clear);
// explicit null clears it. At least one field required (empty PATCH → 400), mirroring profile.ts.
const wifiPatchSchema = z
  .object({
    wifi_ssid: z.string().min(1).max(64).nullable().optional(),
    wifi_password: z.string().max(128).nullable().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: 'At least one field is required' });

type WifiPatchInput = z.infer<typeof wifiPatchSchema>;

// Shared projection — the password (cipher OR plain) never appears in a selection that reaches
// the wire; only its presence is reported.
const wifiSelection = {
  id: screenhosts.id,
  name: screenhosts.name,
  wifiSsid: screenhosts.wifiSsid,
  wifiPasswordEncrypted: screenhosts.wifiPasswordEncrypted,
};

interface WifiRow {
  id: string;
  name: string;
  wifiSsid: string | null;
  wifiPasswordEncrypted: string | null;
}

// Owner/admin-safe projection. wifi_password_set lets the UI render "a password is on file"
// without ever transmitting it.
const wifiView = (
  row: WifiRow,
): { id: string; name: string; wifi_ssid: string | null; wifi_password_set: boolean } => ({
  id: row.id,
  name: row.name,
  wifi_ssid: row.wifiSsid,
  wifi_password_set: row.wifiPasswordEncrypted !== null,
});

// Explicit-reveal projection — decrypts the stored secret on demand (null when none is set). Used
// ONLY by the per-screenhost reveal endpoints, never by the list/edit views, so the redaction
// elsewhere is preserved. The plaintext is returned but never logged.
const revealView = (row: {
  wifiPasswordEncrypted: string | null;
}): { wifi_password: string | null } => ({
  wifi_password:
    row.wifiPasswordEncrypted === null ? null : decryptWifiPassword(row.wifiPasswordEncrypted),
});

// Wire body → drizzle columns, applying the write-only password rules above.
const buildWifiPatch = (data: WifiPatchInput): Partial<typeof screenhosts.$inferInsert> => {
  const patch: Partial<typeof screenhosts.$inferInsert> = {};
  if (data.wifi_ssid !== undefined) patch.wifiSsid = data.wifi_ssid;
  if (data.wifi_password === null) {
    patch.wifiPasswordEncrypted = null;
  } else if (typeof data.wifi_password === 'string' && data.wifi_password.length > 0) {
    patch.wifiPasswordEncrypted = encryptWifiPassword(data.wifi_password);
  }
  return patch;
};

// Apply the patch when it carries an actual column change; report whether anything was written
// (so a no-op edit, e.g. blank password only, does not trigger a pointless re-push).
const applyWifiPatch = async (
  existing: WifiRow,
  data: WifiPatchInput,
): Promise<{ changed: boolean; row: WifiRow }> => {
  const patch = buildWifiPatch(data);
  if (Object.keys(patch).length === 0) return { changed: false, row: existing };
  const [updated] = await db
    .update(screenhosts)
    .set(patch)
    .where(eq(screenhosts.id, existing.id))
    .returning(wifiSelection);
  return { changed: true, row: updated ?? existing };
};

// ── L-inv eligibility (admin population of the per-venue dispatch inputs) ─────────────────────────
// SPS is intentionally NOT settable here — it carries a neutral default and its computation is
// deferred to L-playout. Admin sets category/class/horaires/capacity; null clears a field.
const eligibilitySelection = {
  businessSectorId: screenhosts.businessSectorId,
  class: screenhosts.class,
  openingHour: screenhosts.openingHour,
  closingHour: screenhosts.closingHour,
  broadcastCapacity: screenhosts.broadcastCapacity,
  sps: screenhosts.sps,
};

type EligibilityRow = Pick<
  typeof screenhosts.$inferSelect,
  'businessSectorId' | 'class' | 'openingHour' | 'closingHour' | 'broadcastCapacity' | 'sps'
>;

// Wire shape is snake_case. sps is exposed as a number (drizzle returns numeric as a string).
const eligibilityView = (row: EligibilityRow) => ({
  business_sector_id: row.businessSectorId,
  class: row.class,
  opening_hour: row.openingHour,
  closing_hour: row.closingHour,
  broadcast_capacity: row.broadcastCapacity,
  sps: Number(row.sps),
});

const eligibilityPatchSchema = z
  .object({
    business_sector_id: z.uuid().nullable(),
    class: z.enum(['populaire', 'moyen', 'premium']).nullable(),
    opening_hour: z.number().int().min(0).max(23).nullable(),
    closing_hour: z.number().int().min(0).max(23).nullable(),
    broadcast_capacity: z.number().int().positive().nullable(),
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0, { message: 'At least one field is required' });

// The wire→column mapping lives in lib/eligibility-patch.ts (shared with the wedooh ingest).

const adminGuard = { preHandler: [requireAuth, requireAdmin] };
// The owner app surface (GET /mine, PATCH /:id/wifi) is status-gated (N3): a rejected/banned owner
// is 403'd server-side, closing the FE-only enforcement gap. pending/approved pass (pending = the
// in-review carve-out). The admin route keeps adminGuard. Recovery routes live on other routers.
const ownerGuard = { preHandler: [requireAuth, requireActiveAccount] };

export const screenhostsRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/screenhosts/mine — the caller's screenhosts, password-redacted.
  // H2 — the venue's opening hours ride along so the owner settings' « Horaires d'ouverture »
  // editor reads its current state from the same list the WiFi editor already uses.
  app.get('/api/screenhosts/mine', ownerGuard, async (request, reply) => {
    const userId = request.user?.id;
    if (!userId) {
      return reply
        .status(401)
        .send({ error: 'UNAUTHENTICATED', message: 'Authentication required.' });
    }
    const rows = await db
      .select({
        ...wifiSelection,
        openingHour: screenhosts.openingHour,
        closingHour: screenhosts.closingHour,
      })
      .from(screenhosts)
      .where(eq(screenhosts.ownerId, userId))
      .orderBy(asc(screenhosts.name));
    return reply.status(200).send(
      rows.map((row) => ({
        ...wifiView(row),
        opening_hour: row.openingHour,
        closing_hour: row.closingHour,
      })),
    );
  });

  // GET /api/screenhosts/earnings — the caller's per-(campaign × screenhost) payouts + grand total.
  // First OWNER-FACING reader of campaign_screenhost_payout (L-redisp writes one row per screenhost
  // at admin reconciliation; earnings_tnd = delivered_imp × cpm/1000, the diffused part only). Static
  // route — cannot collide with the deeper /:id/* param routes. Owner-scoping lives in the WHERE
  // (screenhosts.owner_id = userId) on the INNER JOIN to screenhosts — exactly like the WiFi routes —
  // so a foreign venue's payout can never bleed in. earnings_tnd is numeric(14,4) → drizzle returns a
  // STRING; Number() each BEFORE summing (a naïve reduce over strings would concatenate, corrupting
  // the total). Empty array + 0 total is the honest empty state (nothing reconciled yet).
  app.get('/api/screenhosts/earnings', ownerGuard, async (request, reply) => {
    const userId = request.user?.id;
    if (!userId) {
      return reply
        .status(401)
        .send({ error: 'UNAUTHENTICATED', message: 'Authentication required.' });
    }

    const rows = await db
      .select({
        campaignId: campaignScreenhostPayout.campaignId,
        campaignName: campaigns.name,
        screenhostId: campaignScreenhostPayout.screenhostId,
        screenhostName: screenhosts.name,
        expectedImp: campaignScreenhostPayout.expectedImp,
        deliveredImp: campaignScreenhostPayout.deliveredImp,
        earningsTnd: campaignScreenhostPayout.earningsTnd, // numeric → string
        reconciledAt: campaignReconciliation.reconciledAt,
        campaignStart: campaigns.startDate,
        campaignEnd: campaigns.endDate,
        campaignType: campaigns.campaignType,
        campaignStatus: campaigns.status,
      })
      .from(campaignScreenhostPayout)
      .innerJoin(screenhosts, eq(screenhosts.id, campaignScreenhostPayout.screenhostId))
      .innerJoin(campaigns, eq(campaigns.id, campaignScreenhostPayout.campaignId))
      .innerJoin(
        campaignReconciliation,
        eq(campaignReconciliation.id, campaignScreenhostPayout.reconciliationId),
      )
      .where(eq(screenhosts.ownerId, userId)) // OWNER SCOPE — only this owner's screenhosts
      .orderBy(desc(campaignReconciliation.reconciledAt));

    // Lane F extends the line ADDITIVELY (campaign_start/_end/_type/_status) — OwnerRevenue and
    // OwnerDashboard consume this route, so the pre-existing keys are contract-frozen.
    return reply.status(200).send({
      total_tnd: rows.reduce((s, r) => s + Number(r.earningsTnd), 0),
      lines: rows.map((r) => ({
        campaign_id: r.campaignId,
        campaign_name: r.campaignName,
        screenhost_id: r.screenhostId,
        screenhost_name: r.screenhostName,
        expected_imp: r.expectedImp,
        delivered_imp: r.deliveredImp,
        earnings_tnd: Number(r.earningsTnd),
        reconciled_at: r.reconciledAt,
        campaign_start: r.campaignStart,
        campaign_end: r.campaignEnd,
        campaign_type: r.campaignType,
        campaign_status: r.campaignStatus,
      })),
    });
  });

  // PATCH /api/screenhosts/:id/wifi — owner-scoped edit + approved-owner re-push.
  app.patch('/api/screenhosts/:id/wifi', ownerGuard, async (request, reply) => {
    const parsedParams = idParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: [{ field: 'id', reason: 'must be a uuid' }],
      });
    }
    const parsed = wifiPatchSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: parsed.error.issues.map((i) => ({ field: i.path.join('.'), reason: i.message })),
      });
    }
    const userId = request.user?.id;
    if (!userId) {
      return reply
        .status(401)
        .send({ error: 'UNAUTHENTICATED', message: 'Authentication required.' });
    }

    // Owner scoping in the WHERE: a foreign screenhost id is indistinguishable from a missing one.
    const [existing] = await db
      .select(wifiSelection)
      .from(screenhosts)
      .where(and(eq(screenhosts.id, parsedParams.data.id), eq(screenhosts.ownerId, userId)))
      .limit(1);
    if (!existing) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'No such screenhost.' });
    }

    const result = await applyWifiPatch(existing, parsed.data);

    // Re-push ONLY for an approved owner: an unapproved owner's location must not reach wedooh
    // before admin approval (the hub invariant). Fire-and-forget — a wedooh outage must NEVER
    // fail this PATCH (export_status flips to 'failed'; the boot/interval sweep retries).
    if (result.changed && request.user?.status === 'approved') {
      void pushApprovedOwnerLocations(userId, request.log).catch((err: unknown) => {
        request.log.warn({ err }, 'wedooh WiFi re-push (owner edit) failed to start');
      });
    }
    return reply.status(200).send(wifiView(result.row));
  });

  // ── H2 — owner opening-hours editor ────────────────────────────────────────────────────────────
  // PATCH /api/screenhosts/:id/hours — the OWNER edits their venue's single-window hours
  // post-signup. Same columns as every other writer (signup, admin eligibility PATCH, C3 ingest —
  // all untouched); STRICTER pair semantics than the admin's partial patch: BOTH ints 0–23 with
  // open < close, or BOTH null (clears — the venue returns to the no-hours state: 14h report
  // fallback, full heatmap hachure, dispatch-ineligible). Owner-scoping in the UPDATE's WHERE —
  // a foreign or missing id is an indistinguishable 404.
  // TIMING SEMANTICS: an hours change affects FUTURE dispatch eligibility, heatmap hachure and
  // report divisors immediately — but NEVER rewrites already-frozen plans/créneaux (dispatch froze
  // them at approval; pinned by test).
  const hoursPatchSchema = z
    .object({
      opening_hour: z.number().int().min(0).max(23).nullable(),
      closing_hour: z.number().int().min(0).max(23).nullable(),
    })
    .refine((b) => (b.opening_hour === null) === (b.closing_hour === null), {
      message: 'opening_hour and closing_hour must be set together or both null',
    })
    .refine(
      (b) => b.opening_hour === null || b.closing_hour === null || b.opening_hour < b.closing_hour,
      { message: 'opening_hour must be strictly before closing_hour' },
    );

  app.patch('/api/screenhosts/:id/hours', ownerGuard, async (request, reply) => {
    const parsedParams = idParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: [{ field: 'id', reason: 'must be a uuid' }],
      });
    }
    const parsed = hoursPatchSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: parsed.error.issues.map((i) => ({
          field: i.path.join('.') || 'hours',
          reason: i.message,
        })),
      });
    }
    const userId = request.user?.id;
    if (!userId) {
      return reply
        .status(401)
        .send({ error: 'UNAUTHENTICATED', message: 'Authentication required.' });
    }
    const [updated] = await db
      .update(screenhosts)
      .set({
        openingHour: parsed.data.opening_hour,
        closingHour: parsed.data.closing_hour,
      })
      .where(and(eq(screenhosts.id, parsedParams.data.id), eq(screenhosts.ownerId, userId)))
      .returning({
        id: screenhosts.id,
        name: screenhosts.name,
        openingHour: screenhosts.openingHour,
        closingHour: screenhosts.closingHour,
      });
    if (!updated) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'No such screenhost.' });
    }
    return reply.status(200).send({
      id: updated.id,
      name: updated.name,
      opening_hour: updated.openingHour,
      closing_hour: updated.closingHour,
    });
  });

  // GET /api/screenhosts/:id/wifi/reveal — owner-scoped, explicit on-demand reveal of the CURRENT
  // WiFi password (R1, Kais QA). Same guard + owner-scoping as the PATCH: a foreign/missing id → 404,
  // indistinguishable. Decrypts and returns { wifi_password } (null when none set). The LIST stays
  // redacted; only this per-screenhost reveal returns plaintext, and it is never logged or echoed.
  app.get('/api/screenhosts/:id/wifi/reveal', ownerGuard, async (request, reply) => {
    const parsedParams = idParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: [{ field: 'id', reason: 'must be a uuid' }],
      });
    }
    const userId = request.user?.id;
    if (!userId) {
      return reply
        .status(401)
        .send({ error: 'UNAUTHENTICATED', message: 'Authentication required.' });
    }

    // Owner scoping in the WHERE: a foreign screenhost id is indistinguishable from a missing one.
    const [existing] = await db
      .select({ wifiPasswordEncrypted: screenhosts.wifiPasswordEncrypted })
      .from(screenhosts)
      .where(and(eq(screenhosts.id, parsedParams.data.id), eq(screenhosts.ownerId, userId)))
      .limit(1);
    if (!existing) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'No such screenhost.' });
    }

    return reply.status(200).send(revealView(existing));
  });

  // GET /api/screenhosts/:id/affluence — owner-scoped read of the venue's audience pattern: the
  // "typical week" weekday × hour grid of estimated audience the hub pushes via POST
  // /api/internal/affluence (this is the first READER of screenhost_affluence — the ingest is
  // unchanged). Same owner-scoping as the WiFi routes: a foreign/missing id is a 404. Returns a
  // zero-filled 7×24 grid (grid[0]=Monday … grid[6]=Sunday; hour index 0–23, matching wedooh's
  // 1=Mon…7=Sun / 0–23 slots) + has_data, so the dashboard can show an empty state. Summaries
  // (peak day/hour, daily average, weekly total) are derived client-side from the grid.
  app.get('/api/screenhosts/:id/affluence', ownerGuard, async (request, reply) => {
    const parsedParams = idParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: [{ field: 'id', reason: 'must be a uuid' }],
      });
    }
    const userId = request.user?.id;
    if (!userId) {
      return reply
        .status(401)
        .send({ error: 'UNAUTHENTICATED', message: 'Authentication required.' });
    }

    // Owner scoping in the WHERE: a foreign screenhost id is indistinguishable from a missing one.
    const [owned] = await db
      .select({ id: screenhosts.id })
      .from(screenhosts)
      .where(and(eq(screenhosts.id, parsedParams.data.id), eq(screenhosts.ownerId, userId)))
      .limit(1);
    if (!owned) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'No such screenhost.' });
    }

    const slots = await db
      .select({
        dayOfWeek: screenhostAffluence.dayOfWeek,
        hour: screenhostAffluence.hour,
        estimatedImpressions: screenhostAffluence.estimatedImpressions,
      })
      .from(screenhostAffluence)
      .where(eq(screenhostAffluence.screenhostId, owned.id));

    // Zero-filled 7×24 grid (Monday-first); day_of_week 1=Mon…7=Sun → row 0…6.
    const grid: number[][] = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
    for (const slot of slots) {
      const row = grid[slot.dayOfWeek - 1];
      if (row && slot.hour >= 0 && slot.hour <= 23) row[slot.hour] = slot.estimatedImpressions;
    }

    return reply.status(200).send({ grid, has_data: slots.length > 0 });
  });

  // GET /api/screenhosts/:id/profile — owner-scoped venue identity card (Lane F, the performances
  // page): sector NAME + class + operating hours + SPS + the hub-synced demographic ratios. Same
  // owner-scoping as the WiFi/affluence reads (foreign/missing id → 404). Drizzle numeric → string,
  // so every numeric is Number()-ed (NaN-guarded). `ratios` is null unless ALL six columns are set —
  // a partial object never reaches the wire (the C3 ingest writes all-or-null, but a drifted row
  // must not leak a partial shape).
  app.get('/api/screenhosts/:id/profile', ownerGuard, async (request, reply) => {
    const parsedParams = idParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: [{ field: 'id', reason: 'must be a uuid' }],
      });
    }
    const userId = request.user?.id;
    if (!userId) {
      return reply
        .status(401)
        .send({ error: 'UNAUTHENTICATED', message: 'Authentication required.' });
    }

    // Owner scoping in the WHERE: a foreign screenhost id is indistinguishable from a missing one.
    const [row] = await db
      .select({
        name: screenhosts.name,
        sectorName: businessSectors.name,
        class: screenhosts.class,
        openingHour: screenhosts.openingHour,
        closingHour: screenhosts.closingHour,
        sps: screenhosts.sps,
        genderMalePct: screenhosts.genderMalePct,
        genderFemalePct: screenhosts.genderFemalePct,
        age17To30Pct: screenhosts.age17To30Pct,
        age31To45Pct: screenhosts.age31To45Pct,
        age46To60Pct: screenhosts.age46To60Pct,
        age60PlusPct: screenhosts.age60PlusPct,
      })
      .from(screenhosts)
      .leftJoin(businessSectors, eq(screenhosts.businessSectorId, businessSectors.id))
      .where(and(eq(screenhosts.id, parsedParams.data.id), eq(screenhosts.ownerId, userId)))
      .limit(1);
    if (!row) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'No such screenhost.' });
    }

    const ratioValues = {
      gender_male_pct: num(row.genderMalePct),
      gender_female_pct: num(row.genderFemalePct),
      age_17_30_pct: num(row.age17To30Pct),
      age_31_45_pct: num(row.age31To45Pct),
      age_46_60_pct: num(row.age46To60Pct),
      age_60_plus_pct: num(row.age60PlusPct),
    };
    const ratios = Object.values(ratioValues).every((v) => v !== null) ? ratioValues : null;

    return reply.status(200).send({
      name: row.name,
      business_sector: row.sectorName,
      class: row.class,
      opening_hour: row.openingHour,
      closing_hour: row.closingHour,
      sps: num(row.sps),
      ratios,
    });
  });

  // GET /api/screenhosts/:id/monthly-stats — the JSON read of the hub's ACTUAL monthly audience
  // (screenhost_monthly_stats; the C2 ingest is the only writer — until now its sole reader was the
  // per-month PDF below). Month desc, so the FE's "latest month" is months[0]. Owner-scoped like the
  // affluence read.
  app.get('/api/screenhosts/:id/monthly-stats', ownerGuard, async (request, reply) => {
    const parsedParams = idParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: [{ field: 'id', reason: 'must be a uuid' }],
      });
    }
    const userId = request.user?.id;
    if (!userId) {
      return reply
        .status(401)
        .send({ error: 'UNAUTHENTICATED', message: 'Authentication required.' });
    }

    // Owner scoping in the WHERE: a foreign screenhost id is indistinguishable from a missing one.
    const [owned] = await db
      .select({ id: screenhosts.id })
      .from(screenhosts)
      .where(and(eq(screenhosts.id, parsedParams.data.id), eq(screenhosts.ownerId, userId)))
      .limit(1);
    if (!owned) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'No such screenhost.' });
    }

    const rows = await db
      .select({
        month: screenhostMonthlyStats.month,
        totalAudience: screenhostMonthlyStats.totalAudience,
        daily: screenhostMonthlyStats.daily,
        peakDayOfWeek: screenhostMonthlyStats.peakDayOfWeek,
        peakHour: screenhostMonthlyStats.peakHour,
      })
      .from(screenhostMonthlyStats)
      .where(eq(screenhostMonthlyStats.screenhostId, owned.id))
      .orderBy(desc(screenhostMonthlyStats.month)); // 'YYYY-MM' sorts correctly as text

    return reply.status(200).send({
      months: rows.map((r) => ({
        month: r.month,
        total_audience: r.totalAudience,
        daily: r.daily,
        peak_day_of_week: r.peakDayOfWeek,
        peak_hour: r.peakHour,
      })),
    });
  });

  // GET /api/screenhosts/:id/impressions-daily?from=YYYY-MM-DD&to=YYYY-MM-DD — the venue's real
  // DELIVERED pressure per day: COUNT of proof_of_play VIDEO_ENDED rows bucketed by received_at in
  // Africa/Tunis (the reconcile convention), aggregated IN SQL — proof_of_play can be large, so rows
  // never reach JS. Days with zero proofs are simply absent. The range is bounded (≤ 400 days) to
  // keep the scan sane. Owner-scoped like the affluence read.
  app.get('/api/screenhosts/:id/impressions-daily', ownerGuard, async (request, reply) => {
    const parsedParams = idParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: [{ field: 'id', reason: 'must be a uuid' }],
      });
    }
    const parsedQuery = z
      .object({
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .safeParse(request.query);
    if (!parsedQuery.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: parsedQuery.error.issues.map((i) => ({
          field: i.path.join('.'),
          reason: i.message,
        })),
      });
    }
    const { from, to } = parsedQuery.data;
    // ISO dates parse as UTC midnight — span in whole days. Rejects reversed ranges and
    // regex-passing non-dates ('2026-13-45' → NaN) alike.
    const spanDays = (Date.parse(to) - Date.parse(from)) / 86_400_000;
    if (!Number.isFinite(spanDays) || spanDays < 0 || spanDays > 400) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: [{ field: 'to', reason: 'from ≤ to and the range must not exceed 400 days' }],
      });
    }
    const userId = request.user?.id;
    if (!userId) {
      return reply
        .status(401)
        .send({ error: 'UNAUTHENTICATED', message: 'Authentication required.' });
    }

    // Owner scoping in the WHERE: a foreign screenhost id is indistinguishable from a missing one.
    const [owned] = await db
      .select({ id: screenhosts.id })
      .from(screenhosts)
      .where(and(eq(screenhosts.id, parsedParams.data.id), eq(screenhosts.ownerId, userId)))
      .limit(1);
    if (!owned) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'No such screenhost.' });
    }

    const tunisDay = sql<string>`to_char(${proofOfPlay.receivedAt} at time zone 'Africa/Tunis', 'YYYY-MM-DD')`;
    const rows = await db
      .select({ date: tunisDay, impressions: count() })
      .from(proofOfPlay)
      .where(
        and(
          eq(proofOfPlay.screenhostId, owned.id),
          eq(proofOfPlay.eventType, 'VIDEO_ENDED'),
          gte(tunisDay, from),
          lte(tunisDay, to),
        ),
      )
      .groupBy(tunisDay)
      .orderBy(tunisDay);

    return reply.status(200).send({
      days: rows.map((r) => ({ date: r.date, impressions: r.impressions })),
    });
  });

  // GET /api/screenhosts/:id/monthly-report?month=YYYY-MM — owner-scoped download of the STORED
  // monthly report artifact (R1: the month-end job renders + stores one MinIO PDF per venue/month;
  // this route no longer renders anything). Same owner-scoping as the affluence read (foreign/
  // missing id → 404). A month whose artifact has not been generated yet → 404
  // REPORT_NOT_GENERATED (a distinct code so the FE can keep its friendly notice). The body is
  // served THROUGH the api (owner-auth) rather than presigned — reports stay on a private prefix.
  app.get('/api/screenhosts/:id/monthly-report', ownerGuard, async (request, reply) => {
    const parsedParams = idParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: [{ field: 'id', reason: 'must be a uuid' }],
      });
    }
    const parsedQuery = z
      .object({ month: z.string().regex(/^\d{4}-\d{2}$/) })
      .safeParse(request.query);
    if (!parsedQuery.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: [{ field: 'month', reason: 'must be YYYY-MM' }],
      });
    }
    const userId = request.user?.id;
    if (!userId) {
      return reply
        .status(401)
        .send({ error: 'UNAUTHENTICATED', message: 'Authentication required.' });
    }

    // Owner scoping in the WHERE: a foreign screenhost id is indistinguishable from a missing one.
    const [owned] = await db
      .select({ id: screenhosts.id })
      .from(screenhosts)
      .where(and(eq(screenhosts.id, parsedParams.data.id), eq(screenhosts.ownerId, userId)))
      .limit(1);
    if (!owned) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'No such screenhost.' });
    }

    const [report] = await db
      .select({ storageKey: screenhostMonthlyReports.storageKey })
      .from(screenhostMonthlyReports)
      .where(
        and(
          eq(screenhostMonthlyReports.screenhostId, owned.id),
          eq(screenhostMonthlyReports.month, parsedQuery.data.month),
        ),
      )
      .limit(1);
    if (!report) {
      return reply.status(404).send({
        error: 'REPORT_NOT_GENERATED',
        message: 'No stored report for that month yet.',
      });
    }

    const object = await storage.download({ key: report.storageKey });
    if ('error' in object) {
      return reply.status(503).send({
        error: 'REPORT_STORAGE_UNAVAILABLE',
        message: 'The stored report could not be fetched. Please retry.',
      });
    }
    return reply
      .status(200)
      .header('content-type', object.contentType ?? 'application/pdf')
      .header('content-disposition', `inline; filename="rapport-${parsedQuery.data.month}.pdf"`)
      .send(object.body);
  });

  // GET /api/screenhosts/:id/report?from=YYYY-MM-DD&to=YYYY-MM-DD — owner-scoped ON-DEMAND period
  // report (R1): assembles the SAME data the performances page reads over [from, to], renders the
  // HTML template through chromium and streams the PDF. EPHEMERAL — never stored. Range bounded
  // like impressions-daily (≤ 400 days). A chromium failure is an explicit 503 (the rest of the
  // api keeps serving; the renderer relaunches on the next call).
  app.get('/api/screenhosts/:id/report', ownerGuard, async (request, reply) => {
    const parsedParams = idParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: [{ field: 'id', reason: 'must be a uuid' }],
      });
    }
    const parsedQuery = z
      .object({
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .safeParse(request.query);
    if (!parsedQuery.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: parsedQuery.error.issues.map((i) => ({
          field: i.path.join('.'),
          reason: i.message,
        })),
      });
    }
    const { from, to } = parsedQuery.data;
    const spanDays = (Date.parse(to) - Date.parse(from)) / 86_400_000;
    if (!Number.isFinite(spanDays) || spanDays < 0 || spanDays > 400) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: [{ field: 'to', reason: 'from ≤ to and the range must not exceed 400 days' }],
      });
    }
    const userId = request.user?.id;
    if (!userId) {
      return reply
        .status(401)
        .send({ error: 'UNAUTHENTICATED', message: 'Authentication required.' });
    }

    // Owner scoping in the WHERE: a foreign screenhost id is indistinguishable from a missing one.
    const [owned] = await db
      .select({ id: screenhosts.id })
      .from(screenhosts)
      .where(and(eq(screenhosts.id, parsedParams.data.id), eq(screenhosts.ownerId, userId)))
      .limit(1);
    if (!owned) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'No such screenhost.' });
    }

    const data = await assembleReportData(owned.id, { from, to });
    if (!data) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'No such screenhost.' });
    }

    // R2 — cache-wrapped AI pistes (per venue × period, 24h); null → the generic pistes. The
    // generator can never fail the render (hard fallback contract + belt-and-braces catch).
    const aiPistes = await pistesForReportCached(owned.id, data).catch(() => null);

    let pdf: Buffer;
    try {
      pdf = await renderPdf(renderReportHtml(data, { aiPistes }));
    } catch (err) {
      request.log.error({ err }, 'period report render failed');
      return reply.status(503).send({
        error: 'REPORT_RENDER_FAILED',
        message: 'Report rendering is temporarily unavailable. Please retry.',
      });
    }
    return reply
      .status(200)
      .header('content-type', 'application/pdf')
      .header('content-disposition', `inline; filename="rapport-${from}_${to}.pdf"`)
      .send(pdf);
  });

  // PATCH /api/admin/screenhosts/:id/wifi — admin edit of ANY screenhost + re-push for its
  // approved owner. Same write-only password rules; goes through the toodooh API (NOT the
  // legacy Supabase admin-screens surface).
  app.patch('/api/admin/screenhosts/:id/wifi', adminGuard, async (request, reply) => {
    const parsedParams = idParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: [{ field: 'id', reason: 'must be a uuid' }],
      });
    }
    const parsed = wifiPatchSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: parsed.error.issues.map((i) => ({ field: i.path.join('.'), reason: i.message })),
      });
    }

    const [existing] = await db
      .select({ ...wifiSelection, ownerId: screenhosts.ownerId, ownerStatus: users.status })
      .from(screenhosts)
      .leftJoin(users, eq(screenhosts.ownerId, users.id))
      .where(eq(screenhosts.id, parsedParams.data.id))
      .limit(1);
    if (!existing) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'No such screenhost.' });
    }

    const result = await applyWifiPatch(existing, parsed.data);

    if (result.changed && existing.ownerId && existing.ownerStatus === 'approved') {
      void pushApprovedOwnerLocations(existing.ownerId, request.log).catch((err: unknown) => {
        request.log.warn({ err }, 'wedooh WiFi re-push (admin edit) failed to start');
      });
    }
    return reply.status(200).send(wifiView(result.row));
  });

  // GET /api/admin/screenhosts/:id/wifi/reveal — admin reveal of ANY screenhost's current WiFi
  // password (mirrors the owner reveal; adminGuard, no owner scoping). Same { wifi_password | null }
  // shape; the plaintext is never logged or echoed.
  app.get('/api/admin/screenhosts/:id/wifi/reveal', adminGuard, async (request, reply) => {
    const parsedParams = idParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: [{ field: 'id', reason: 'must be a uuid' }],
      });
    }

    const [existing] = await db
      .select({ wifiPasswordEncrypted: screenhosts.wifiPasswordEncrypted })
      .from(screenhosts)
      .where(eq(screenhosts.id, parsedParams.data.id))
      .limit(1);
    if (!existing) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'No such screenhost.' });
    }

    return reply.status(200).send(revealView(existing));
  });

  // GET /api/admin/screenhosts/:id/eligibility — admin reads the venue's L-disp eligibility inputs
  // (category/class/horaires/capacity + the SPS baseline). 404 on a missing screenhost.
  app.get('/api/admin/screenhosts/:id/eligibility', adminGuard, async (request, reply) => {
    const parsedParams = idParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: [{ field: 'id', reason: 'must be a uuid' }],
      });
    }
    const [row] = await db
      .select(eligibilitySelection)
      .from(screenhosts)
      .where(eq(screenhosts.id, parsedParams.data.id))
      .limit(1);
    if (!row) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'No such screenhost.' });
    }
    return reply.status(200).send(eligibilityView(row));
  });

  // PATCH /api/admin/screenhosts/:id/eligibility — admin sets category/class/horaires/capacity
  // (null clears a field). A non-null category must be a real OWNER business sector (the same source
  // L-target matches against). SPS is not settable (defaulted; computation deferred).
  app.patch('/api/admin/screenhosts/:id/eligibility', adminGuard, async (request, reply) => {
    const parsedParams = idParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: [{ field: 'id', reason: 'must be a uuid' }],
      });
    }
    const parsed = eligibilityPatchSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: parsed.error.issues.map((i) => ({ field: i.path.join('.'), reason: i.message })),
      });
    }

    const [existing] = await db
      .select({ id: screenhosts.id })
      .from(screenhosts)
      .where(eq(screenhosts.id, parsedParams.data.id))
      .limit(1);
    if (!existing) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'No such screenhost.' });
    }

    if (parsed.data.business_sector_id != null) {
      const [sector] = await db
        .select({ id: businessSectors.id })
        .from(businessSectors)
        .where(
          and(
            eq(businessSectors.id, parsed.data.business_sector_id),
            eq(businessSectors.audience, 'owner'),
          ),
        )
        .limit(1);
      if (!sector) {
        return reply.status(400).send({
          error: 'INVALID_INPUT',
          message: 'Validation failed',
          fields: [{ field: 'business_sector_id', reason: 'must be a valid venue category' }],
        });
      }
    }

    const [updated] = await db
      .update(screenhosts)
      .set(buildEligibilityPatch(parsed.data))
      .where(eq(screenhosts.id, existing.id))
      .returning(eligibilitySelection);
    return reply.status(200).send(eligibilityView(updated as EligibilityRow));
  });

  // ── dispatch allocation accept/reject (owner-scoped) ───────────────────────────────────────────
  // After a campaign is dispatched, each allocation lands EN_ATTENTE (the new default): it does NOT
  // air until the screenhost OWNER accepts it (the playout airability gate requires ACCEPTE, so
  // EN_ATTENTE/REFUSE simply never air). These routes let the owner of the allocation's screenhost
  // accept (→ ACCEPTE) or reject (→ REFUSE) it. Owner-scoping is enforced IN the UPDATE's WHERE via
  // a subselect of the caller's screenhosts, so a cross-owner allocation id can never be written —
  // a foreign/missing id is an indistinguishable 404. The list read mirrors the same scoping.

  // GET /api/screenhosts/allocations — the owner's EN_ATTENTE allocations awaiting their decision,
  // joined to campaign (name/window) + screenhost (name) for the accept/reject surface. Newest first.
  // CF-O1 (spec §2.2) — the owner decides on the FULL proposal, so each row also carries
  // campaign_type, the targeting category NAMES (classes are engine-internal, never owner-facing),
  // the zone NAMES ([] = whole network on that criterion, CF-Z1), and the linked creative's
  // {kind, duration_seconds} meta (null when the campaign has no creative). The media itself is
  // presigned on demand via GET /allocations/:id/creative-url, never embedded here (short-TTL urls
  // would go stale sitting in an open list).
  app.get('/api/screenhosts/allocations', ownerGuard, async (request, reply) => {
    const userId = request.user?.id;
    if (!userId) {
      return reply
        .status(401)
        .send({ error: 'UNAUTHENTICATED', message: 'Authentication required.' });
    }
    const rows = await db
      .select({
        id: campaignDispatchAllocation.id,
        campaignId: campaigns.id,
        campaignName: campaigns.name,
        campaignType: campaigns.campaignType,
        startDate: campaigns.startDate,
        endDate: campaigns.endDate,
        screenhostId: screenhosts.id,
        screenhostName: screenhosts.name,
        iiPotentiel: campaignDispatchAllocation.iiPotentiel,
        rI: campaignDispatchAllocation.rI,
        revenuPrevisionnel: campaignDispatchAllocation.revenuPrevisionnel,
        createdAt: campaignDispatchAllocation.createdAt,
        creativeKind: creatives.creativeType,
        creativeDuration: creatives.durationSeconds,
      })
      .from(campaignDispatchAllocation)
      .innerJoin(screenhosts, eq(campaignDispatchAllocation.screenhostId, screenhosts.id))
      .innerJoin(
        campaignDispatchPlan,
        eq(campaignDispatchAllocation.planId, campaignDispatchPlan.id),
      )
      .innerJoin(campaigns, eq(campaignDispatchPlan.campaignId, campaigns.id))
      .leftJoin(creatives, eq(campaigns.creativeId, creatives.id))
      .where(
        and(
          eq(screenhosts.ownerId, userId),
          eq(campaignDispatchAllocation.statutAcceptation, 'EN_ATTENTE'),
        ),
      )
      .orderBy(desc(campaignDispatchAllocation.createdAt));

    // Category/zone names are 1:many — ONE batched query each over the already-owner-scoped
    // campaign ids, grouped in JS (the campaigns.ts no-N+1 idiom). Categories collapse to NAMES:
    // a NULL category_id line means « toutes les catégories », so any such line (or no targeting
    // at all) yields [] — same "empty = whole network" convention the zones already use.
    const campaignIds = [...new Set(rows.map((r) => r.campaignId))];
    const categoriesByCampaign = new Map<string, string[]>();
    const allCategoriesCampaigns = new Set<string>();
    const zonesByCampaign = new Map<string, string[]>();
    if (campaignIds.length > 0) {
      const targetingLines = await db
        .select({
          campaignId: campaignTargeting.campaignId,
          categoryName: businessSectors.name,
        })
        .from(campaignTargeting)
        .leftJoin(businessSectors, eq(campaignTargeting.categoryId, businessSectors.id))
        .where(inArray(campaignTargeting.campaignId, campaignIds))
        .orderBy(asc(businessSectors.name));
      for (const line of targetingLines) {
        if (line.categoryName === null) {
          allCategoriesCampaigns.add(line.campaignId);
          continue;
        }
        const list = categoriesByCampaign.get(line.campaignId) ?? [];
        if (!list.includes(line.categoryName)) list.push(line.categoryName);
        categoriesByCampaign.set(line.campaignId, list);
      }
      const zoneRows = await db
        .select({ campaignId: campaignZones.campaignId, name: zones.name })
        .from(campaignZones)
        .innerJoin(zones, eq(campaignZones.zoneId, zones.id))
        .where(inArray(campaignZones.campaignId, campaignIds))
        .orderBy(asc(zones.name));
      for (const row of zoneRows) {
        const list = zonesByCampaign.get(row.campaignId) ?? [];
        list.push(row.name);
        zonesByCampaign.set(row.campaignId, list);
      }
    }

    return reply.status(200).send(
      rows.map((r) => ({
        id: r.id,
        campaign_id: r.campaignId,
        campaign_name: r.campaignName,
        campaign_type: r.campaignType,
        start_date: r.startDate,
        end_date: r.endDate,
        screenhost_id: r.screenhostId,
        screenhost_name: r.screenhostName,
        ii_potentiel: r.iiPotentiel,
        r_i: r.rI,
        revenu_previsionnel: Number(r.revenuPrevisionnel),
        created_at: r.createdAt.toISOString(),
        categories: allCategoriesCampaigns.has(r.campaignId)
          ? []
          : (categoriesByCampaign.get(r.campaignId) ?? []),
        zones: zonesByCampaign.get(r.campaignId) ?? [],
        creative:
          r.creativeKind === null
            ? null
            : { kind: r.creativeKind, duration_seconds: r.creativeDuration },
      })),
    );
  });

  // Shared accept/reject body: owner-scoped status write. The WHERE subselect (the caller's own
  // screenhosts) makes a foreign allocation id indistinguishable from a missing one (404).
  // E3 (US-2.8) — a REFUSE on a PRE-DIFFUSION campaign (pending/upcoming) re-places the refused
  // share via the cascade, IN THE SAME TRANSACTION as the status write: if the cascade fails, the
  // refusal rolls back too (all-or-nothing — the owner retries, the share is never silently
  // stranded half-placed). The row is locked FOR UPDATE so two concurrent decisions on the same
  // allocation serialize (no double cascade). Refusal is DEFINITIVE (« cette action est
  // définitive ») — once REFUSE, re-refusing is an idempotent 200, any other flip is a 409: the
  // cascade may already have re-placed the share, so un-refusing would double-book it.
  const decideAllocation = async (
    request: FastifyRequest,
    reply: FastifyReply,
    statut: DispatchAcceptation,
  ) => {
    const parsedParams = idParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: [{ field: 'id', reason: 'must be a uuid' }],
      });
    }
    const userId = request.user?.id;
    if (!userId) {
      return reply
        .status(401)
        .send({ error: 'UNAUTHENTICATED', message: 'Authentication required.' });
    }

    const outcome = await db.transaction(async (tx) => {
      const [row] = await tx
        .select({
          allocation: campaignDispatchAllocation,
          plan: campaignDispatchPlan,
          campaignId: campaigns.id,
          campaignName: campaigns.name,
          campaignStatus: campaigns.status,
          campaignStart: campaigns.startDate,
          campaignEnd: campaigns.endDate,
        })
        .from(campaignDispatchAllocation)
        .innerJoin(
          campaignDispatchPlan,
          eq(campaignDispatchAllocation.planId, campaignDispatchPlan.id),
        )
        .innerJoin(campaigns, eq(campaignDispatchPlan.campaignId, campaigns.id))
        .where(
          and(
            eq(campaignDispatchAllocation.id, parsedParams.data.id),
            inArray(
              campaignDispatchAllocation.screenhostId,
              tx
                .select({ id: screenhosts.id })
                .from(screenhosts)
                .where(eq(screenhosts.ownerId, userId)),
            ),
          ),
        )
        .limit(1)
        .for('update', { of: campaignDispatchAllocation });
      if (!row) return { kind: 'not_found' as const };

      const current = row.allocation.statutAcceptation;
      // Idempotent re-decide (incl. re-REFUSE: no second cascade).
      if (current === statut) return { kind: 'ok' as const, id: row.allocation.id, statut };
      // Refusal is final — the cascade may already have re-placed this share.
      if (current === 'REFUSE') return { kind: 'refused_final' as const };

      await tx
        .update(campaignDispatchAllocation)
        .set({ statutAcceptation: statut })
        .where(eq(campaignDispatchAllocation.id, row.allocation.id));

      // Cascade only PRE-DIFFUSION (pending/upcoming). A refusal while the campaign is ACTIVE
      // stays non-cascading — mid-flight re-placement is E6's (redispatch) job.
      if (
        statut === 'REFUSE' &&
        (row.campaignStatus === 'pending' || row.campaignStatus === 'upcoming') &&
        row.campaignStart !== null &&
        row.campaignEnd !== null
      ) {
        await runRefusalCascade(tx, {
          plan: row.plan,
          campaign: {
            id: row.campaignId,
            name: row.campaignName,
            startDate: row.campaignStart,
            endDate: row.campaignEnd,
          },
          refused: {
            id: row.allocation.id,
            screenhostId: row.allocation.screenhostId,
            iiPotentiel: row.allocation.iiPotentiel,
          },
        });
      }
      return { kind: 'ok' as const, id: row.allocation.id, statut };
    });

    if (outcome.kind === 'not_found') {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'No such allocation.' });
    }
    if (outcome.kind === 'refused_final') {
      return reply.status(409).send({
        error: 'CONFLICT',
        message: 'Allocation déjà refusée — le refus est définitif.',
        statusCode: 409,
      });
    }
    return reply.status(200).send({ id: outcome.id, statut_acceptation: outcome.statut });
  };

  // POST /api/screenhosts/allocations/:id/accept — owner accepts (→ ACCEPTE); the campaign may air.
  app.post('/api/screenhosts/allocations/:id/accept', ownerGuard, (request, reply) =>
    decideAllocation(request, reply, 'ACCEPTE'),
  );

  // POST /api/screenhosts/allocations/:id/reject — owner rejects (→ REFUSE); it stays off-air.
  app.post('/api/screenhosts/allocations/:id/reject', ownerGuard, (request, reply) =>
    decideAllocation(request, reply, 'REFUSE'),
  );

  // GET /api/screenhosts/allocations/:id/creative-url — presign the proposed campaign's creative so
  // the OWNER can view the actual spot before deciding (CF-O1, spec §2.2). Mirrors the admin/
  // advertiser presign mechanics (admin-creatives.ts /:id/url) with the allocation-list's owner
  // scoping IN the WHERE: the caller must own the allocation's screenhost, so a foreign or missing
  // allocation — or one whose campaign has no linked creative (inner join) — is an
  // indistinguishable 404. Short TTL: the url is fetched on expand and consumed immediately; 5
  // minutes outlives any plausible view without leaving long-lived media links around.
  app.get('/api/screenhosts/allocations/:id/creative-url', ownerGuard, async (request, reply) => {
    const parsed = idParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: [{ field: 'id', reason: 'must be a uuid' }],
      });
    }
    const userId = request.user?.id;
    if (!userId) {
      return reply
        .status(401)
        .send({ error: 'UNAUTHENTICATED', message: 'Authentication required.' });
    }
    const [row] = await db
      .select({ storageKey: creatives.storageKey })
      .from(campaignDispatchAllocation)
      .innerJoin(screenhosts, eq(campaignDispatchAllocation.screenhostId, screenhosts.id))
      .innerJoin(
        campaignDispatchPlan,
        eq(campaignDispatchAllocation.planId, campaignDispatchPlan.id),
      )
      .innerJoin(campaigns, eq(campaignDispatchPlan.campaignId, campaigns.id))
      .innerJoin(creatives, eq(campaigns.creativeId, creatives.id))
      .where(
        and(eq(campaignDispatchAllocation.id, parsed.data.id), eq(screenhosts.ownerId, userId)),
      )
      .limit(1);
    if (!row) return reply.status(404).send({ error: 'NOT_FOUND', message: 'No such creative.' });
    const result = await storage.getPresignedUrl({ key: row.storageKey, expiresInSeconds: 300 });
    if ('error' in result) {
      return reply.status(502).send({
        error: 'STORAGE_ERROR',
        message: 'Could not generate a creative URL. Please retry.',
      });
    }
    return reply.status(200).send({ url: result.url });
  });

  // ── dispatch calendar (owner-scoped, ACCEPTE only) ─────────────────────────────────────────────
  // GET /api/screenhosts/calendar — the owner's ACCEPTE allocations (the ones that actually air),
  // joined to campaign (name/window) + screenhost (name), each carrying its frozen créneaux so the
  // owner surface can render an agenda/month calendar of accepted campaigns across their dates.
  // Owner scoping is IN the WHERE (screenhosts.ownerId = caller) alongside statut = ACCEPTE, so a
  // foreign owner's allocations are never returned, and EN_ATTENTE/REFUSE are excluded (only accepted
  // allocations air — the playout gate requires ACCEPTE). Each créneau is projected to
  // {date, hour, impressions} (reps is an engine internal the calendar doesn't need), mirroring the
  // reconcile read's créneau projection. Ordered by campaign window then created_at for a stable,
  // chronological list; the FE regroups by créneau date.
  app.get('/api/screenhosts/calendar', ownerGuard, async (request, reply) => {
    const userId = request.user?.id;
    if (!userId) {
      return reply
        .status(401)
        .send({ error: 'UNAUTHENTICATED', message: 'Authentication required.' });
    }
    const rows = await db
      .select({
        id: campaignDispatchAllocation.id,
        campaignId: campaigns.id,
        campaignName: campaigns.name,
        startDate: campaigns.startDate,
        endDate: campaigns.endDate,
        screenhostId: screenhosts.id,
        screenhostName: screenhosts.name,
        creneaux: campaignDispatchAllocation.creneaux,
      })
      .from(campaignDispatchAllocation)
      .innerJoin(screenhosts, eq(campaignDispatchAllocation.screenhostId, screenhosts.id))
      .innerJoin(
        campaignDispatchPlan,
        eq(campaignDispatchAllocation.planId, campaignDispatchPlan.id),
      )
      .innerJoin(campaigns, eq(campaignDispatchPlan.campaignId, campaigns.id))
      .where(
        and(
          eq(screenhosts.ownerId, userId),
          eq(campaignDispatchAllocation.statutAcceptation, 'ACCEPTE'),
        ),
      )
      .orderBy(asc(campaigns.startDate), asc(campaignDispatchAllocation.createdAt));

    return reply.status(200).send(
      rows.map((r) => ({
        id: r.id,
        campaign_id: r.campaignId,
        campaign_name: r.campaignName,
        start_date: r.startDate,
        end_date: r.endDate,
        screenhost_id: r.screenhostId,
        screenhost_name: r.screenhostName,
        creneaux: r.creneaux.map((c) => ({
          date: c.date,
          hour: c.hour,
          impressions: c.impressions,
        })),
      })),
    );
  });
};
