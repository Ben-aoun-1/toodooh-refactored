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
  type DispatchAcceptation,
  proofOfPlay,
  screenhostAffluence,
  screenhostMonthlyStats,
  screenhosts,
  users,
} from '../db/schema.js';
import { buildEligibilityPatch } from '../lib/eligibility-patch.js';
import { renderMonthlyReportPdf } from '../lib/report.js';
import { pushApprovedOwnerLocations } from '../lib/wedooh-sync.js';
import { decryptWifiPassword, encryptWifiPassword } from '../lib/wifi-crypto.js';
import { requireActiveAccount, requireAdmin, requireAuth } from '../middleware/require-auth.js';

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
  app.get('/api/screenhosts/mine', ownerGuard, async (request, reply) => {
    const userId = request.user?.id;
    if (!userId) {
      return reply
        .status(401)
        .send({ error: 'UNAUTHENTICATED', message: 'Authentication required.' });
    }
    const rows = await db
      .select(wifiSelection)
      .from(screenhosts)
      .where(eq(screenhosts.ownerId, userId))
      .orderBy(asc(screenhosts.name));
    return reply.status(200).send(rows.map(wifiView));
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

  // GET /api/screenhosts/:id/monthly-report?month=YYYY-MM — owner-scoped branded PDF of the hub's
  // ACTUAL monthly stats for that venue/month (renders on-the-fly, never stored — like the facture).
  // Same owner-scoping as the affluence read: a foreign/missing id is a 404; a month with no stored
  // stats is also a 404 (nothing to render yet). Auto-at-month-end notification is DEFERRED — the
  // report is downloadable as soon as the hub's stats arrive.
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

    // Owner scoping in the WHERE (foreign id → 404); join the owner for the report's branded names.
    const [owned] = await db
      .select({
        venueName: screenhosts.name,
        contactName: users.contactName,
        businessName: users.businessName,
      })
      .from(screenhosts)
      .innerJoin(users, eq(screenhosts.ownerId, users.id))
      .where(and(eq(screenhosts.id, parsedParams.data.id), eq(screenhosts.ownerId, userId)))
      .limit(1);
    if (!owned) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'No such screenhost.' });
    }

    const [stats] = await db
      .select()
      .from(screenhostMonthlyStats)
      .where(
        and(
          eq(screenhostMonthlyStats.screenhostId, parsedParams.data.id),
          eq(screenhostMonthlyStats.month, parsedQuery.data.month),
        ),
      )
      .limit(1);
    if (!stats) {
      return reply
        .status(404)
        .send({ error: 'NOT_FOUND', message: 'No stats for that month yet.' });
    }

    const pdf = await renderMonthlyReportPdf({
      ownerName: owned.businessName ?? owned.contactName,
      venueName: owned.venueName,
      month: stats.month,
      totalAudience: stats.totalAudience,
      daily: stats.daily,
      peakDayOfWeek: stats.peakDayOfWeek,
      peakHour: stats.peakHour,
    });
    return reply
      .status(200)
      .header('content-type', 'application/pdf')
      .header('content-disposition', `inline; filename="rapport-${stats.month}.pdf"`)
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
        startDate: campaigns.startDate,
        endDate: campaigns.endDate,
        screenhostId: screenhosts.id,
        screenhostName: screenhosts.name,
        iiPotentiel: campaignDispatchAllocation.iiPotentiel,
        rI: campaignDispatchAllocation.rI,
        revenuPrevisionnel: campaignDispatchAllocation.revenuPrevisionnel,
        createdAt: campaignDispatchAllocation.createdAt,
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
          eq(campaignDispatchAllocation.statutAcceptation, 'EN_ATTENTE'),
        ),
      )
      .orderBy(desc(campaignDispatchAllocation.createdAt));

    return reply.status(200).send(
      rows.map((r) => ({
        id: r.id,
        campaign_id: r.campaignId,
        campaign_name: r.campaignName,
        start_date: r.startDate,
        end_date: r.endDate,
        screenhost_id: r.screenhostId,
        screenhost_name: r.screenhostName,
        ii_potentiel: r.iiPotentiel,
        r_i: r.rI,
        revenu_previsionnel: Number(r.revenuPrevisionnel),
        created_at: r.createdAt.toISOString(),
      })),
    );
  });

  // Shared accept/reject body: owner-scoped status write. The WHERE subselect (the caller's own
  // screenhosts) makes a foreign allocation id indistinguishable from a missing one (404).
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

    const [updated] = await db
      .update(campaignDispatchAllocation)
      .set({ statutAcceptation: statut })
      .where(
        and(
          eq(campaignDispatchAllocation.id, parsedParams.data.id),
          inArray(
            campaignDispatchAllocation.screenhostId,
            db
              .select({ id: screenhosts.id })
              .from(screenhosts)
              .where(eq(screenhosts.ownerId, userId)),
          ),
        ),
      )
      .returning({
        id: campaignDispatchAllocation.id,
        statutAcceptation: campaignDispatchAllocation.statutAcceptation,
      });
    if (!updated) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'No such allocation.' });
    }
    return reply
      .status(200)
      .send({ id: updated.id, statut_acceptation: updated.statutAcceptation });
  };

  // POST /api/screenhosts/allocations/:id/accept — owner accepts (→ ACCEPTE); the campaign may air.
  app.post('/api/screenhosts/allocations/:id/accept', ownerGuard, (request, reply) =>
    decideAllocation(request, reply, 'ACCEPTE'),
  );

  // POST /api/screenhosts/allocations/:id/reject — owner rejects (→ REFUSE); it stays off-air.
  app.post('/api/screenhosts/allocations/:id/reject', ownerGuard, (request, reply) =>
    decideAllocation(request, reply, 'REFUSE'),
  );

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
