import { and, asc, count, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { db } from '../db/client.js';
import {
  affluenceSource,
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
  eventAllocations,
  events,
  proofOfPlay,
  screenhostAffluence,
  screenhostMonthlyReports,
  screenhostMonthlyStats,
  screenhosts,
  screens,
  users,
  zones,
  screenhostUnavailability,
} from '../db/schema.js';
import { decideAllocation } from '../lib/allocation-decision.js';
import { CALENDAR_DAY_MSG, ISO_DATE_RE, isCalendarDate } from '../lib/calendar-date.js';
import { tunisDateOf } from '../lib/campaign-dates.js';
import { runRefusalCascade } from '../lib/dispatch/cascade.js';
import { getDispatchConfig } from '../lib/dispatch/config.js';
import { REDISPATCH_HEARTBEAT_TOLERANCE_MS } from '../lib/dispatch/redispatch.js';
import { buildEligibilityPatch } from '../lib/eligibility-patch.js';
import { createEngineTrace, type EngineTrace } from '../lib/engine-journal/trace.js';
import { decideEventAllocation } from '../lib/event-allocation-decision.js';
import { SLOTS_PER_DAY, inEffectSql } from '../lib/half-hour-slots.js';
import { displayImpressionsSettled } from '../lib/impressions-display.js';
import { measuredDays, measuredTotal } from '../lib/monthly-audience.js';
import { ownerSensorStatuses } from '../lib/owner-sensors.js';
import { loadPeriodAudienceInput } from '../lib/period-audience-source.js';
import { periodAudience, weekGridFromCells } from '../lib/period-audience.js';
import { pushPlaylistToVenue } from '../lib/playout/push.js';
import { assembleReportData } from '../lib/report/assemble.js';
import { buildPistes } from '../lib/report/pistes.js';
import { pistesForReportCached } from '../lib/report/recommendations.js';
import { renderPdf } from '../lib/report/render.js';
import { renderReportHtml } from '../lib/report/template.js';
import { venueSlug } from '../lib/slug.js';
import { computeSps, recomputeVenueSps, spsComputable } from '../lib/sps-score.js';
import { pushApprovedOwnerLocations } from '../lib/wedooh-sync.js';
import { decryptWifiPassword, encryptWifiPassword } from '../lib/wifi-crypto.js';
import { requireActiveAccount, requireAdmin, requireAuth } from '../middleware/require-auth.js';
import { storage } from '../storage/s3-storage.js';

// HOURS-X1 — the one wording every hours writer uses for the zero-width pair.
const HOURS_DIFFER_MESSAGE =
  'opening_hour and closing_hour must differ (closing before opening = closes the next day)';

/** AFF1 — a slot's provenance as the hub reports it (see schema affluenceSource). */
type AffluenceSource = (typeof affluenceSource.enumValues)[number];

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

/**
 * CF-O1 / CAMP-E1 — the owner-facing proposal criteria of a set of campaigns, batched: ONE query
 * for the targeting category NAMES and ONE for the zone NAMES over already-owner-scoped campaign
 * ids, grouped in JS (the campaigns.ts no-N+1 idiom). Categories collapse to NAMES: a NULL
 * category_id line means « toutes les catégories », so any such line (or no targeting at all)
 * yields [] — the same "empty = whole network" convention the zones use (CF-Z1). Classes are
 * engine-internal and never leave this helper. Shared by GET /allocations and GET /campaigns.
 */
const loadCampaignCriteriaNames = async (
  campaignIds: readonly string[],
): Promise<{ categoriesOf: (id: string) => string[]; zonesOf: (id: string) => string[] }> => {
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
      .where(inArray(campaignTargeting.campaignId, [...campaignIds]))
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
      .where(inArray(campaignZones.campaignId, [...campaignIds]))
      .orderBy(asc(zones.name));
    for (const row of zoneRows) {
      const list = zonesByCampaign.get(row.campaignId) ?? [];
      list.push(row.name);
      zonesByCampaign.set(row.campaignId, list);
    }
  }
  return {
    categoriesOf: (id) =>
      allCategoriesCampaigns.has(id) ? [] : (categoriesByCampaign.get(id) ?? []),
    zonesOf: (id) => zonesByCampaign.get(id) ?? [],
  };
};

/**
 * CAMP-E1 — the owner's ONE decision over a campaign, derived from their allocations' statuses:
 * unanimous → that status; any disagreement (e.g. accepted on one venue, refused on another) →
 * MIXTE. A campaign never reaches this with zero allocations (the list is built FROM them).
 */
export const deriveOwnerDecision = (
  statuts: readonly DispatchAcceptation[],
): DispatchAcceptation | 'MIXTE' => {
  const first = statuts[0];
  if (first === undefined) return 'EN_ATTENTE';
  return statuts.every((s) => s === first) ? first : 'MIXTE';
};

export const screenhostsRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/screenhosts/mine — the caller's venues, password-redacted: WiFi, hours, declaration.
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
        screenCount: screenhosts.screenCount,
        roomCount: screenhosts.roomCount,
      })
      .from(screenhosts)
      .where(eq(screenhosts.ownerId, userId))
      .orderBy(asc(screenhosts.name));
    return reply.status(200).send(
      rows.map((row) => ({
        ...wifiView(row),
        opening_hour: row.openingHour,
        closing_hour: row.closingHour,
        screen_count: row.screenCount,
        room_count: row.roomCount,
      })),
    );
  });

  // CF-D1 — GET /api/screenhosts/screens: the caller's DEVICES across all their venues, with REAL
  // liveness. `connected` uses THE ONE liveness truth (E6's REDISPATCH_HEARTBEAT_TOLERANCE_MS —
  // last_seen_at refreshes on pairing, every HEARTBEAT and every proof): within the tolerance →
  // connected; older or never-seen → not. Owner-scoped via the JOIN's WHERE (the WiFi-routes
  // idiom); static route, so it cannot collide with the deeper /:id/* param routes. NO secrets in
  // the payload — pairing codes/tokens never leave the device flow.
  // CAL-2 — the affluence sensor's state per venue (the « ÉTAT DE MON DISPOSITIF » card), read
  // from the measured cells the hub sends; see lib/owner-sensors.ts for why per venue and why not
  // received_at.
  app.get('/api/screenhosts/sensors', ownerGuard, async (request, reply) => {
    const userId = request.user?.id;
    if (!userId) {
      return reply
        .status(401)
        .send({ error: 'UNAUTHENTICATED', message: 'Authentication required.' });
    }
    return reply.status(200).send(await ownerSensorStatuses(userId, new Date()));
  });

  app.get('/api/screenhosts/screens', ownerGuard, async (request, reply) => {
    const userId = request.user?.id;
    if (!userId) {
      return reply
        .status(401)
        .send({ error: 'UNAUTHENTICATED', message: 'Authentication required.' });
    }
    const rows = await db
      .select({
        id: screens.id,
        name: screens.name,
        venueId: screenhosts.id,
        venueName: screenhosts.name,
        lastSeenAt: screens.lastSeenAt,
        pairedAt: screens.pairedAt,
        createdAt: screens.createdAt,
      })
      .from(screens)
      .innerJoin(screenhosts, eq(screens.screenhostId, screenhosts.id))
      .where(eq(screenhosts.ownerId, userId))
      .orderBy(asc(screenhosts.name), asc(screens.name));
    const now = Date.now();
    return reply.status(200).send(
      rows.map((row) => ({
        id: row.id,
        name: row.name,
        venue_id: row.venueId,
        venue_name: row.venueName,
        last_seen_at: row.lastSeenAt,
        connected:
          row.lastSeenAt !== null &&
          now - row.lastSeenAt.getTime() <= REDISPATCH_HEARTBEAT_TOLERANCE_MS,
        paired_at: row.pairedAt,
        created_at: row.createdAt,
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
    // NET-IMP1 — display_imp (additive): « affichées = prédites − perdues », the ONE display
    // home (lib/impressions-display). Settled rows converge to delivered by reconcile's own
    // identity; the web renders THIS field, never a raw count.
    return reply.status(200).send({
      total_tnd: rows.reduce((s, r) => s + Number(r.earningsTnd), 0),
      lines: rows.map((r) => ({
        campaign_id: r.campaignId,
        campaign_name: r.campaignName,
        screenhost_id: r.screenhostId,
        screenhost_name: r.screenhostName,
        expected_imp: r.expectedImp,
        delivered_imp: r.deliveredImp,
        display_imp: displayImpressionsSettled({
          expectedImp: r.expectedImp,
          deliveredImp: r.deliveredImp,
        }),
        earnings_tnd: Number(r.earningsTnd),
        reconciled_at: r.reconciledAt,
        campaign_start: r.campaignStart,
        campaign_end: r.campaignEnd,
        campaign_type: r.campaignType,
        campaign_status: r.campaignStatus,
      })),
    });
  });

  // GET /api/screenhosts/playout-summary — PERF-QA1 R11: the owner Dashboard's « Durée totale de
  // diffusion » tile. ALL-TIME cumulative Σ played_duration_ms across the caller's venues (ruled
  // consistent with the cumulative Revenus tile). Static route like /earnings; owner-scoping in
  // the JOIN's WHERE. VIDEO_ENDED only — started events carry no duration. sum() over integers
  // comes back as a STRING (bigint) → Number() before the wire.
  app.get('/api/screenhosts/playout-summary', ownerGuard, async (request, reply) => {
    const userId = request.user?.id;
    if (!userId) {
      return reply
        .status(401)
        .send({ error: 'UNAUTHENTICATED', message: 'Authentication required.' });
    }
    const [row] = await db
      .select({
        totalPlayedMs: sql<string>`coalesce(sum(${proofOfPlay.playedDurationMs}), 0)`,
      })
      .from(proofOfPlay)
      .innerJoin(screenhosts, eq(proofOfPlay.screenhostId, screenhosts.id))
      .where(and(eq(screenhosts.ownerId, userId), eq(proofOfPlay.eventType, 'VIDEO_ENDED')));
    return reply.status(200).send({ total_played_ms: Number(row?.totalPlayedMs ?? 0) });
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
  // ── E2 (VF jours_dispo_i) — owner-declared per-day unavailability ─────────
  // VENUE-level only. The engine reads this at pool assembly: capacity, créneaux and C_max all
  // shrink together; a venue unavailable across the whole window drops from the pool. FROZEN
  // plans are never rewritten by a later declaration (ruling 2 — the H2 hours precedent above:
  // timing semantics live at the POOL, not on persisted plans).

  // GET /api/screenhosts/:id/unavailability?from&to — the declared days in [from, to] (both
  // required, ISO dates). Owner-scoped: a foreign or missing id is an indistinguishable 404.
  const unavailabilityRangeSchema = z.object({ from: z.iso.date(), to: z.iso.date() });
  app.get('/api/screenhosts/:id/unavailability', ownerGuard, async (request, reply) => {
    const parsedParams = idParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: [{ field: 'id', reason: 'must be a uuid' }],
      });
    }
    const parsedQuery = unavailabilityRangeSchema.safeParse(request.query);
    if (!parsedQuery.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: parsedQuery.error.issues.map((i) => ({
          field: i.path.join('.') || 'range',
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
    const [owned] = await db
      .select({ id: screenhosts.id })
      .from(screenhosts)
      .where(and(eq(screenhosts.id, parsedParams.data.id), eq(screenhosts.ownerId, userId)))
      .limit(1);
    if (!owned) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'No such screenhost.' });
    }
    const rows = await db
      .select({ day: screenhostUnavailability.day })
      .from(screenhostUnavailability)
      .where(
        and(
          eq(screenhostUnavailability.screenhostId, owned.id),
          gte(screenhostUnavailability.day, parsedQuery.data.from),
          lte(screenhostUnavailability.day, parsedQuery.data.to),
        ),
      )
      .orderBy(asc(screenhostUnavailability.day));
    return reply.status(200).send({ days: rows.map((r) => r.day) });
  });

  // PUT /api/screenhosts/:id/unavailability {day, unavailable} — declare or undeclare ONE day.
  // FUTURE-only (Tunis calendar): today and the past are history — frozen créneaux there are the
  // E6 detector's business, not the owner's eraser. Idempotent both directions (re-declare = the
  // UNIQUE no-op; un-declare an available day = delete 0 rows, still 200).
  //
  // CAL-1 (Mejri 11/09 point 6, operator ruling 2026-09-12: « it gets redispatched ») — REVERSES
  // ruling 2 for declarations: a declared day that carries ACCEPTE/EN_ATTENTE créneaux of a live
  // campaign now MOVES that day's share. In ONE transaction: the day row → the colliding allocations
  // (plan locked FOR UPDATE, like E6) → each loses the day's créneaux and the day's facturable value
  // (⌊Σ impressions × T⌋) → the value is re-placed: pre-diffusion (pending/upcoming) through the E3
  // cascade at once (partial mode, the source venue excluded, allocation kept), mid-flight (active)
  // into the plan's reliquat_stocke so E6's next round re-places it future-only. Any failure rolls
  // the declaration back — a share is never left half-moved. Undeclaring moves nothing back.
  const unavailabilityPutSchema = z.object({
    day: z.iso.date(),
    unavailable: z.boolean(),
  });
  interface RedispatchedShare {
    campaign_id: string;
    campaign_name: string;
    mode: 'cascade' | 'reliquat';
    slots_moved: number;
    v_fact: number;
    absorbed: number;
    residual: number;
  }
  app.put('/api/screenhosts/:id/unavailability', ownerGuard, async (request, reply) => {
    const parsedParams = idParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: [{ field: 'id', reason: 'must be a uuid' }],
      });
    }
    const parsed = unavailabilityPutSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: parsed.error.issues.map((i) => ({
          field: i.path.join('.') || 'body',
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
    if (parsed.data.day <= tunisDateOf(new Date())) {
      return reply.status(400).send({
        error: 'PAST_OR_TODAY',
        message: 'Only future days can be declared or undeclared.',
        day: parsed.data.day,
      });
    }
    const [owned] = await db
      .select({ id: screenhosts.id })
      .from(screenhosts)
      .where(and(eq(screenhosts.id, parsedParams.data.id), eq(screenhosts.ownerId, userId)))
      .limit(1);
    if (!owned) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'No such screenhost.' });
    }
    const day = parsed.data.day;
    if (!parsed.data.unavailable) {
      await db
        .delete(screenhostUnavailability)
        .where(
          and(
            eq(screenhostUnavailability.screenhostId, owned.id),
            eq(screenhostUnavailability.day, day),
          ),
        );
      return reply
        .status(200)
        .send({ screenhost_id: owned.id, day, unavailable: false, redispatched: [] });
    }

    // LOG1 — one cascade trace per re-placed campaign, flushed after the tx on both outcomes.
    const traces: EngineTrace[] = [];
    const redispatched = await db
      .transaction(async (tx) => {
        // The day row FIRST, so the cascade's pool assembly already excludes this venue/day.
        await tx
          .insert(screenhostUnavailability)
          .values({ screenhostId: owned.id, day })
          .onConflictDoNothing();

        // The colliding shares: this venue's live allocations whose campaign window covers the day
        // and whose frozen créneaux touch it. Plans locked FOR UPDATE — E6 rounds and cascades
        // serialize on the plan row (redispatch.ts idiom).
        const rows = await tx
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
              eq(campaignDispatchAllocation.screenhostId, owned.id),
              inArray(campaignDispatchAllocation.statutAcceptation, ['ACCEPTE', 'EN_ATTENTE']),
              inArray(campaigns.status, ['pending', 'upcoming', 'active']),
              lte(campaigns.startDate, day),
              gte(campaigns.endDate, day),
            ),
          )
          .for('update', { of: campaignDispatchPlan });

        const moved: RedispatchedShare[] = [];
        for (const row of rows) {
          const removed = row.allocation.creneaux.filter((c) => c.date === day);
          if (removed.length === 0) continue;
          const kept = row.allocation.creneaux.filter((c) => c.date !== day);
          const t = Number(row.plan.tTierCoef);
          const cpm = Number(row.plan.cpm);
          const vFact = Math.min(
            row.allocation.iiPotentiel,
            Math.floor(removed.reduce((sum, c) => sum + c.impressions, 0) * t),
          );
          const iiPotentiel = row.allocation.iiPotentiel - vFact;
          await tx
            .update(campaignDispatchAllocation)
            .set({
              creneaux: kept,
              iiPotentiel,
              revenuPrevisionnel: String((iiPotentiel * cpm) / 1000),
            })
            .where(eq(campaignDispatchAllocation.id, row.allocation.id));

          if (vFact === 0) {
            moved.push({
              campaign_id: row.campaignId,
              campaign_name: row.campaignName,
              mode: 'cascade',
              slots_moved: removed.length,
              v_fact: 0,
              absorbed: 0,
              residual: 0,
            });
            continue;
          }
          if (
            (row.campaignStatus === 'pending' || row.campaignStatus === 'upcoming') &&
            row.campaignStart !== null &&
            row.campaignEnd !== null
          ) {
            const trace = createEngineTrace('cascade', row.campaignId);
            traces.push(trace);
            const outcome = await runRefusalCascade(
              tx,
              {
                plan: row.plan,
                campaign: {
                  id: row.campaignId,
                  name: row.campaignName,
                  startDate: row.campaignStart,
                  endDate: row.campaignEnd,
                },
                refused: {
                  id: row.allocation.id,
                  screenhostId: owned.id,
                  iiPotentiel: vFact,
                },
                partial: true,
              },
              trace,
            );
            moved.push({
              campaign_id: row.campaignId,
              campaign_name: row.campaignName,
              mode: 'cascade',
              slots_moved: removed.length,
              v_fact: vFact,
              absorbed: outcome.absorbed,
              residual: vFact - outcome.absorbed,
            });
          } else {
            // Mid-flight: E6 owns re-placement (future-only, hourly). The day's value joins the
            // stored reliquat, which the next round validates on the TOTAL and places.
            await tx
              .update(campaignDispatchPlan)
              .set({ reliquatStocke: sql`${campaignDispatchPlan.reliquatStocke} + ${vFact}` })
              .where(eq(campaignDispatchPlan.id, row.plan.id));
            moved.push({
              campaign_id: row.campaignId,
              campaign_name: row.campaignName,
              mode: 'reliquat',
              slots_moved: removed.length,
              v_fact: vFact,
              absorbed: 0,
              residual: vFact,
            });
          }
        }
        return moved;
      })
      .catch(async (err: unknown) => {
        await Promise.all(traces.map((tr) => tr.finish('rolled_back', { reason: 'ERROR' })));
        throw err;
      });
    await Promise.all(traces.map((tr) => tr.finish('committed', {})));

    // E4 — a moved share changes this venue's engagement; recompute its SPS, failure-tolerated.
    if (redispatched.length > 0) {
      try {
        await recomputeVenueSps(owned.id);
      } catch (err) {
        request.log.warn({ err, screenhostId: owned.id }, 'SPS on-declaration recompute failed');
      }
    }
    return reply
      .status(200)
      .send({ screenhost_id: owned.id, day, unavailable: true, redispatched });
  });

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
    // HOURS-X1: closing ≤ opening = « closes the next day »; only an equal pair is refused.
    .refine(
      (b) =>
        b.opening_hour === null || b.closing_hour === null || b.opening_hour !== b.closing_hour,
      { message: HOURS_DIFFER_MESSAGE },
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
    // LEARN-1 T1 — the hub learns only inside a venue's hours: re-push the location so it holds the
    // new window. The WiFi-edit idiom: approved owners only (an unapproved owner's location reaches
    // the hub at approval, carrying its hours), fire-and-forget — a hub outage stamps
    // export_status='failed' and the 10-min sweep retries; it NEVER fails this PATCH.
    if (request.user?.status === 'approved') {
      void pushApprovedOwnerLocations(userId, request.log).catch((err: unknown) => {
        request.log.warn({ err }, 'wedooh hours re-push (owner edit) failed to start');
      });
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
  // 7×48 grid (grid[0]=Monday … grid[6]=Sunday; SLOT index 0–47 since slice C; 1=Mon…7=Sun /
  // 0–23 slots) + has_data, so the dashboard can show an empty state. HOUR-AVG2 (operator 17/09):
  // a slot with no cell is NULL, never 0 — the client folds an hour as the mean of the halves it
  // HAS, so « no reading » must stay distinguishable from a measured 0. Summaries
  // (peak day/hour, daily average, weekly total) are derived client-side from the grid.
  // AFF1: `sources` mirrors the grid's shape with each slot's provenance ('measured' | 'backup' |
  // null = no row or unknown provenance) and `counts` tallies provenance ONLY — a measured 0 is a
  // measurement, a NULL-source row is neither. The client labels; this route never interprets.
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

    // AUD-HOURLY1-C — optional ?from&to. WITH a range, S02 is GENUINELY période-scoped: the grid
    // is the période's own (date, hour) cells aggregated into weekday × hour, through the same
    // merge S01 runs. PERF-R2's weekday MASK over the hub's rolling typical week is superseded —
    // a weekday the période does not contain simply has no cell to aggregate.
    // WITHOUT a range the rolling typical week is served unchanged: that is « Votre audience » on
    // the owner dashboard, which this lane leaves alone.
    // Both params or neither: a one-sided range is a validation error, not a guess.
    const parsedQuery = z
      .object({
        from: z.string().regex(ISO_DATE_RE).refine(isCalendarDate, CALENDAR_DAY_MSG).optional(),
        to: z.string().regex(ISO_DATE_RE).refine(isCalendarDate, CALENDAR_DAY_MSG).optional(),
      })
      .refine((q) => (q.from === undefined) === (q.to === undefined), {
        message: 'from and to come together',
        path: ['to'],
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
    const periodRange =
      parsedQuery.data.from !== undefined && parsedQuery.data.to !== undefined
        ? { from: parsedQuery.data.from, to: parsedQuery.data.to }
        : null;

    // Slice C — 7×48 grid (Monday-first), columns indexed by SLOT (0–47); day_of_week
    // 1=Mon…7=Sun → row 0…6. HOUR-AVG2 — null-filled: a slot is set only where a cell exists.
    // `sources` is the same shape, null-filled. `counts`
    // tallies provenance only, now per SLOT — which is also why the MEJ-13-B hour-collapse is gone
    // from this read: the wire is slot-shaped, so nothing here needs to pretend it is hourly.
    const grid: (number | null)[][] = Array.from({ length: 7 }, () =>
      Array.from({ length: SLOTS_PER_DAY }, (): number | null => null),
    );
    const sources: (AffluenceSource | null)[][] = Array.from({ length: 7 }, () =>
      Array.from({ length: SLOTS_PER_DAY }, () => null),
    );
    const counts = { measured: 0, backup: 0 };
    let filled = 0;

    if (periodRange === null) {
      // ── the hub's rolling typical week, as served since AFF1 (« Votre audience ») ──
      // MEJ-13-B — this read is HOUR-keyed and its `counts` / `filled` are RAW ROW COUNTS, so
      // half-hour rows would double the provenance tallies from 168 to 336 on deploy alone, with
      // every half still equal. Collapsing to the hour in SQL keeps the wire's numbers where they
      // were. Provenance of a collapsed hour: the shared source when BOTH halves carry the same
      // one, else NULL (unknown) — claiming « measured » for an hour that is half backup would
      // overstate it. (PEAK-MAX1 retired the « mixte » kind this line once anticipated: a cell now
      // shows ONE reading and carries that reading's provenance, so nothing blends any more.)
      const slots = await db
        .select({
          dayOfWeek: screenhostAffluence.dayOfWeek,
          slot: screenhostAffluence.slot,
          estimatedImpressions: screenhostAffluence.estimatedImpressions,
          source: screenhostAffluence.source,
        })
        .from(screenhostAffluence)
        // LEARN-1 / OFF-1 — a withdrawn or suspended key is ABSENT here, as it is for every
        // money-path reader: the hub's full-grid write sends in_effect:false for every key the
        // learned rule does not produce, and that must never read as « Estimation 0 ».
        .where(
          and(
            eq(screenhostAffluence.screenhostId, owned.id),
            inEffectSql(screenhostAffluence.inEffect),
          ),
        );
      for (const cell of slots) {
        const row = grid[cell.dayOfWeek - 1];
        const sourceRow = sources[cell.dayOfWeek - 1];
        if (row && sourceRow && cell.slot >= 0 && cell.slot < SLOTS_PER_DAY) {
          row[cell.slot] = cell.estimatedImpressions;
          sourceRow[cell.slot] = cell.source;
          if (cell.source) counts[cell.source] += 1;
        }
      }
      filled = slots.length;
    } else {
      // ── the période's OWN cells, merged per (date, hour) then folded into a weekday × hour
      //    grid: the same helper, the same numbers as S01 and the PDF. ──
      const merged = periodAudience(
        await loadPeriodAudienceInput({
          venueId: owned.id,
          range: periodRange,
          todayIso: tunisDateOf(new Date()),
        }),
      );
      const week = weekGridFromCells(merged.cells);
      for (let row = 0; row < 7; row += 1) {
        for (let slot = 0; slot < SLOTS_PER_DAY; slot += 1) {
          const cell = week[row]![slot]!;
          if (cell.value === null || cell.source === null) continue;
          grid[row]![slot] = cell.value;
          sources[row]![slot] = cell.source;
          counts[cell.source] += 1;
          filled += 1;
        }
      }
    }

    return reply.status(200).send({ grid, has_data: filled > 0, sources, counts });
  });

  // GET /api/screenhosts/:id/audience?from&to — the merged période audience, ONE api-side rule
  // (lib/period-audience.ts) reused by the page AND the PDF twin. AUD-HOURLY1-C: the merge is now
  // per (date, hour) — a day the sensor covered only partly falls back to the admin's grid for the
  // hours it did not, which is what « rien ne s'est passé » was about. Per-day provenance still
  // rides on the wire; `estimated_pct` is now the share of DATA POINTS (see PeriodAudience).
  // The span guard is generous (the scan is monthly-stats + hourly rows, not proof_of_play) so
  // « Depuis le début » (2020-01-01) fits.
  app.get('/api/screenhosts/:id/audience', ownerGuard, async (request, reply) => {
    const parsedParams = idParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: [{ field: 'id', reason: 'must be a uuid' }],
      });
    }
    // AUD-HOURLY1-C — these bounds now reach Postgres as a DATE range (the hourly cells), so an
    // impossible-but-well-shaped day like 2026-02-30 would 500 instead of 400. Refined, like the
    // ingest's own `date` field (slice A's banked rider, same class).
    const parsedQuery = z
      .object({
        from: z.string().regex(ISO_DATE_RE).refine(isCalendarDate, CALENDAR_DAY_MSG),
        to: z.string().regex(ISO_DATE_RE).refine(isCalendarDate, CALENDAR_DAY_MSG),
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
    if (!Number.isFinite(spanDays) || spanDays < 0) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: [{ field: 'to', reason: 'from must be ≤ to' }],
      });
    }
    if (spanDays > 3700) {
      return reply.status(400).send({
        error: 'RANGE_TOO_WIDE',
        message: 'The range must not exceed 3700 days.',
      });
    }
    const userId = request.user?.id;
    if (!userId) {
      return reply
        .status(401)
        .send({ error: 'UNAUTHENTICATED', message: 'Authentication required.' });
    }

    // Owner scoping in the WHERE: a foreign screenhost id is indistinguishable from a missing one.
    // MEJ-R1 — created_at rides along: it is the venue's ONBOARDING day, the first day the backup
    // grid may stand in for (see lib/period-audience.ts).
    const [owned] = await db
      .select({ id: screenhosts.id, createdAt: screenhosts.createdAt })
      .from(screenhosts)
      .where(and(eq(screenhosts.id, parsedParams.data.id), eq(screenhosts.ownerId, userId)))
      .limit(1);
    if (!owned) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'No such screenhost.' });
    }

    const merged = periodAudience(
      await loadPeriodAudienceInput({
        venueId: owned.id,
        range: { from, to },
        todayIso: tunisDateOf(new Date()),
        // MEJ-7b — the floor comes from the loader now (max of creation and the first measured
        // reading). THIS surface is « Votre progression depuis le début », the one that showed
        // 26/08 for a venue whose sensor was attached on 31/08.
      }),
    );
    return reply.status(200).send({
      // MEJ-R2 — `has_measured` rides along so the page applies the SAME peak eligibility as the
      // PDF twin (snake_case, like every other key on this wire).
      days: merged.days.map((d) => ({
        date: d.date,
        audience: d.audience,
        source: d.source,
        has_measured: d.hasMeasured,
      })),
      total_audience: merged.total,
      measured_days: merged.measuredDays,
      estimated_days: merged.estimatedDays,
      estimated_pct: merged.estimatedPct,
    });
  });

  // GET /api/screenhosts/:id/profile — owner-scoped venue identity card (Lane F, the performances
  // page): sector NAME + class + operating hours + SPS + the hub-synced demographic ratios. Same
  // owner-scoping as the WiFi/affluence reads (foreign/missing id → 404). Drizzle numeric → string,
  // so every numeric is Number()-ed (NaN-guarded). `ratios` is null unless ALL FIVE ratio columns
  // are set — a partial object never reaches the wire (the C3 ingest writes all-or-null, but a
  // drifted row must not leak a partial shape).
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
        age46PlusPct: screenhosts.age46PlusPct,
      })
      .from(screenhosts)
      .leftJoin(businessSectors, eq(screenhosts.businessSectorId, businessSectors.id))
      .where(and(eq(screenhosts.id, parsedParams.data.id), eq(screenhosts.ownerId, userId)))
      .limit(1);
    if (!row) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'No such screenhost.' });
    }

    // CLS-AGE1 — THREE bands, and the every-non-null gate now spans exactly those three. It used
    // to include the two retired columns, so a class pushed in the new shape would have failed the
    // gate and starved S04 on the page — « en attente » forever, indistinguishable from a class
    // the hub had never sent.
    const ratioValues = {
      gender_male_pct: num(row.genderMalePct),
      gender_female_pct: num(row.genderFemalePct),
      age_17_30_pct: num(row.age17To30Pct),
      age_31_45_pct: num(row.age31To45Pct),
      age_46_plus_pct: num(row.age46PlusPct),
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

    // AMENDMENT 2026-08-20 (US-P.0, « Donnée mesurée (capteur) ») — the owner reads MEASURED days
    // only: an estimated day never feeds « Personnes touchées », Ai, la moyenne ou le Pic. The
    // stored row keeps both kinds (provenance-stamped enrichment); the WIRE carries the measure.
    // A fully unmeasured month therefore serves 0 days and a 0 total — which the spec rules is
    // NOT an incoherence beside non-zero impressions: two independent sensors, each stating its
    // source on the page.
    return reply.status(200).send({
      months: rows.map((r) => ({
        month: r.month,
        total_audience: measuredTotal(r.daily),
        daily: measuredDays(r.daily),
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

  // GET /api/screenhosts/:id/reports — PERF-QA1 R1: the owner-scoped LISTING over
  // screenhost_monthly_reports. The generated-reports table is the ONLY month authority on owner
  // surfaces: card = newest row, Historique = the rest, and « Généré le » is the row's REAL
  // generated_at (the web never re-derives it from the month key again). 'YYYY-MM' sorts
  // correctly as text.
  app.get('/api/screenhosts/:id/reports', ownerGuard, async (request, reply) => {
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
        month: screenhostMonthlyReports.month,
        generatedAt: screenhostMonthlyReports.generatedAt,
      })
      .from(screenhostMonthlyReports)
      .where(eq(screenhostMonthlyReports.screenhostId, owned.id))
      .orderBy(desc(screenhostMonthlyReports.month));
    return reply.status(200).send({
      reports: rows.map((r) => ({ month: r.month, generated_at: r.generatedAt })),
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
      .select({ id: screenhosts.id, name: screenhosts.name })
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
      .header(
        'content-disposition',
        // PERF-QA1 R3 — the filename carries the venue so a downloads folder stays legible.
        `inline; filename="rapport-${venueSlug(owned.name)}-${parsedQuery.data.month}.pdf"`,
      )
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
    if (!Number.isFinite(spanDays) || spanDays < 0) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: [{ field: 'to', reason: 'from must be ≤ to' }],
      });
    }
    // PERF-QA1 R4 — the too-wide class gets its OWN code (vs render 503 / storage 503): the web
    // maps each failure class to distinct copy instead of one generic « Échec » toast. This is
    // the confirmed Mejri repro: « Depuis le début » resolved from 2020-01-01 → a guaranteed
    // 400 the old client rendered as the generic failure.
    if (spanDays > 400) {
      return reply.status(400).send({
        error: 'RANGE_TOO_WIDE',
        message: 'The range must not exceed 400 days.',
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
      .select({ id: screenhosts.id, name: screenhosts.name })
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
      .header(
        'content-disposition',
        // PERF-QA1 R3 — the venue rides the period filename too (same rule as the monthly PDF).
        `inline; filename="rapport-${venueSlug(owned.name)}-${from}_${to}.pdf"`,
      )
      .send(pdf);
  });

  // GET /api/screenhosts/:id/pistes?from&to — PERF-QA1 R5: the page MIRRORS the PDF's S07
  // through the SAME generator + cache the period report uses, so the screen and the document can
  // never disagree. PERF-QA2: the three bodies come from lib/report/pistes.ts over the SAME
  // assembled data the PDF renders (événements + SPS), so « same engine » is now structural
  // rather than a pair of shared constants. Piste 02 is the cached AI body when available, the
  // generic body otherwise — a pistes failure NEVER fails the response. NO new AI contract.
  app.get('/api/screenhosts/:id/pistes', ownerGuard, async (request, reply) => {
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
    if (!Number.isFinite(spanDays) || spanDays < 0) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: [{ field: 'to', reason: 'from must be ≤ to' }],
      });
    }
    if (spanDays > 400) {
      return reply.status(400).send({
        error: 'RANGE_TOO_WIDE',
        message: 'The range must not exceed 400 days.',
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
    const aiBody = await pistesForReportCached(owned.id, data).catch(() => null);
    return reply.status(200).send({
      pistes: buildPistes({ events: data.upcomingEvents, sps: data.sps, aiBody }),
    });
  });

  // GET /api/screenhosts/:id/sps — PERF-QA1 R6: the OWNER's SPS read, mirroring the admin
  // breakdown's shape (score + the four variables, each with its CONFIG weight — the web renders
  // weights from this wire and never hardcodes them again). Computed LIVE like the admin read and
  // the PDF's S08. A compute hiccup degrades to nulls so the page keeps its « À venir » wait-state
  // (assemble.ts's null-block semantics) — owners never see invented numbers.
  app.get('/api/screenhosts/:id/sps', ownerGuard, async (request, reply) => {
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

    try {
      const cfg = await getDispatchConfig();
      const { sps, variables, observations } = await computeSps(owned.id);
      // MEJ-14b — a score built ENTIRELY out of empty-set defaults is not a score. A venue with no
      // history on any contributing variable scores 90/100 (three variables answer 100 to an empty
      // set; only remplissage falls to 0), which outranked venues live for months. Degrade to the
      // wire's existing null semantics so the page shows « À venir » — the same nulls the compute
      // hiccup already produced, so no new state and no new copy.
      if (!spsComputable(observations)) {
        return reply
          .status(200)
          .send({ as_of: tunisDateOf(new Date()), sps: null, variables: null });
      }
      // PERF-R1 — a live score is genuinely not période-able: the page labels it « au <date> »
      // instead of silently ignoring the filter, and this is that date (Tunis).
      return reply.status(200).send({
        as_of: tunisDateOf(new Date()),
        sps,
        variables: {
          acceptation: { value: variables.acceptation, weight: cfg.spsWeightAcceptation },
          respect_evenements: {
            value: variables.respect_evenements,
            weight: cfg.spsWeightRespectEvenements,
          },
          activite: { value: variables.activite, weight: cfg.spsWeightActivite },
          remplissage: { value: variables.remplissage, weight: cfg.spsWeightRemplissage },
        },
      });
    } catch (err) {
      request.log.warn({ err, screenhostId: owned.id }, 'owner sps compute failed');
      return reply.status(200).send({ as_of: tunisDateOf(new Date()), sps: null, variables: null });
    }
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

  // GET /api/admin/screenhosts/:id/sps — E4: the venue's SPS breakdown, computed LIVE (each
  // variable, its weight, the weighted total) — the operator's insight surface beside the
  // eligibility view. The stored screenhosts.sps is the daily job's snapshot; this read shows
  // where the next write will land.
  app.get('/api/admin/screenhosts/:id/sps', adminGuard, async (request, reply) => {
    const parsedParams = idParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: [{ field: 'id', reason: 'must be a uuid' }],
      });
    }
    const [row] = await db
      .select({ id: screenhosts.id, sps: screenhosts.sps })
      .from(screenhosts)
      .where(eq(screenhosts.id, parsedParams.data.id))
      .limit(1);
    if (!row) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'No such screenhost.' });
    }
    const cfg = await getDispatchConfig();
    const { sps, variables } = await computeSps(parsedParams.data.id);
    return reply.status(200).send({
      sps,
      stored_sps: Number(row.sps),
      variables: {
        acceptation: { value: variables.acceptation, weight: cfg.spsWeightAcceptation },
        respect_evenements: {
          value: variables.respect_evenements,
          weight: cfg.spsWeightRespectEvenements,
        },
        activite: { value: variables.activite, weight: cfg.spsWeightActivite },
        remplissage: { value: variables.remplissage, weight: cfg.spsWeightRemplissage },
      },
    });
  });

  // GET /api/admin/screenhosts/:id/devices — CF-HF4: the venue's screens with REAL liveness for
  // the admin surface (the SAME truth as the owner read: last_seen_at within E6's heartbeat
  // tolerance → connected). The legacy ScreenManagement "En ligne" indicator reads the Supabase-era
  // hub tables — this is the live wire the eligibility card renders instead.
  app.get('/api/admin/screenhosts/:id/devices', adminGuard, async (request, reply) => {
    const parsedParams = idParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: [{ field: 'id', reason: 'must be a uuid' }],
      });
    }
    const rows = await db
      .select({
        id: screens.id,
        name: screens.name,
        lastSeenAt: screens.lastSeenAt,
        pairedAt: screens.pairedAt,
      })
      .from(screens)
      .where(eq(screens.screenhostId, parsedParams.data.id))
      .orderBy(asc(screens.name));
    const now = Date.now();
    return reply.status(200).send(
      rows.map((row) => ({
        id: row.id,
        name: row.name,
        last_seen_at: row.lastSeenAt,
        connected:
          row.lastSeenAt !== null &&
          now - row.lastSeenAt.getTime() <= REDISPATCH_HEARTBEAT_TOLERANCE_MS,
        paired_at: row.pairedAt,
      })),
    );
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
      .select({
        id: screenhosts.id,
        openingHour: screenhosts.openingHour,
        closingHour: screenhosts.closingHour,
        // LEARN-1 T1 — who to re-push for, and whether the hub may know this venue yet.
        ownerId: screenhosts.ownerId,
        ownerStatus: users.status,
      })
      .from(screenhosts)
      .leftJoin(users, eq(screenhosts.ownerId, users.id))
      .where(eq(screenhosts.id, parsedParams.data.id))
      .limit(1);
    if (!existing) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'No such screenhost.' });
    }

    // E7 (EL1 rider) — the hour-pair refines the owner /hours PATCH already enforces, applied to
    // the RESULTING state (stored ⊕ patch) because this PATCH is partial: a one-sided patch whose
    // result is a coherent window stays legal (the admin editor sends dirty fields only), while
    // any result that is half-set or inverted is refused — closing the raw-API hole where a venue
    // could hold incoherent hours the pool silently skips.
    const effectiveOpening =
      parsed.data.opening_hour !== undefined ? parsed.data.opening_hour : existing.openingHour;
    const effectiveClosing =
      parsed.data.closing_hour !== undefined ? parsed.data.closing_hour : existing.closingHour;
    if ((effectiveOpening === null) !== (effectiveClosing === null)) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: [
          {
            field: 'closing_hour',
            reason: 'opening_hour and closing_hour must be set together or both null',
          },
        ],
      });
    }
    // HOURS-X1: an inverted pair is an overnight window; only an EQUAL pair is refused.
    if (
      effectiveOpening !== null &&
      effectiveClosing !== null &&
      effectiveOpening === effectiveClosing
    ) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: [{ field: 'closing_hour', reason: HOURS_DIFFER_MESSAGE }],
      });
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
    // LEARN-1 T1 — an hours CHANGE re-pushes the location (the admin WiFi-edit idiom: approved owner
    // only, fire-and-forget, the sweep retries). A patch that leaves the window as it was is silent.
    const hoursChanged =
      effectiveOpening !== existing.openingHour || effectiveClosing !== existing.closingHour;
    if (hoursChanged && existing.ownerId && existing.ownerStatus === 'approved') {
      void pushApprovedOwnerLocations(existing.ownerId, request.log).catch((err: unknown) => {
        request.log.warn({ err }, 'wedooh hours re-push (admin eligibility edit) failed to start');
      });
    }
    return reply.status(200).send(eligibilityView(updated as EligibilityRow));
  });

  // ── dispatch allocation accept/reject (owner-scoped) ───────────────────────────────────────────
  // After a campaign is dispatched, each allocation lands EN_ATTENTE (the new default): it does NOT
  // air until the screenhost OWNER accepts it (the playout airability gate requires ACCEPTE, so
  // EN_ATTENTE/REFUSE simply never air). These routes let the owner of the allocation's screenhost
  // accept (→ ACCEPTE) or reject (→ REFUSE) it. Owner-scoping is enforced IN the UPDATE's WHERE via
  // a subselect of the caller's screenhosts, so a cross-owner allocation id can never be written —
  // a foreign/missing id is an indistinguishable 404. The list read mirrors the same scoping.

  // B-ACC1 — the campaign statuses whose EN_ATTENTE proposals are still worth a decision.
  const DECIDABLE_CAMPAIGN_STATUSES = ['pending', 'upcoming', 'active'] as const;

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
          // B-ACC1 (Mejri/Kais QA) — a proposal is DECIDABLE only while its campaign can still
          // air: status in the live set AND not yet past its end date (Tunis calendar day). An
          // EN_ATTENTE row on an expired, completed or rejected campaign stayed listed forever, so
          // « Campagnes à valider » offered acceptances nobody could honour. The row itself is left
          // as is (no state change here): it simply leaves the decision queue.
          inArray(campaigns.status, DECIDABLE_CAMPAIGN_STATUSES),
          gte(campaigns.endDate, tunisDateOf(new Date())),
        ),
      )
      .orderBy(desc(campaignDispatchAllocation.createdAt));

    // Category/zone names are 1:many — batched over the owner-scoped campaign ids (no N+1).
    const criteria = await loadCampaignCriteriaNames([...new Set(rows.map((r) => r.campaignId))]);

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
        categories: criteria.categoriesOf(r.campaignId),
        zones: criteria.zonesOf(r.campaignId),
        creative:
          r.creativeKind === null
            ? null
            : { kind: r.creativeKind, duration_seconds: r.creativeDuration },
      })),
    );
  });

  // CAMP-E1 / SUPA-1 — GET /api/screenhosts/campaigns: the owner's « Mes campagnes » read, on the
  // api. Every campaign with at least one dispatch allocation on one of the caller's venues, ANY
  // statut_acceptation (the /allocations list above is the EN_ATTENTE decision queue; this is the
  // whole history), grouped PER CAMPAIGN with the owner's allocation rows nested, their totals
  // summed, and the owner's decision derived over them (EN_ATTENTE | ACCEPTE | REFUSE | MIXTE).
  // Owner scoping is IN the WHERE (screenhosts.ownerId = caller) so a foreign venue's allocation
  // never contributes — not even to a campaign the owner also carries elsewhere. Newest campaign
  // first; venues alphabetical within a campaign. Replaces the page's retired Supabase composite
  // (locations/campaign_owner_approvals/business_profiles), which threw in production and left
  // every owner with an error toast instead of an empty state.
  app.get('/api/screenhosts/campaigns', ownerGuard, async (request, reply) => {
    const userId = request.user?.id;
    if (!userId) {
      return reply
        .status(401)
        .send({ error: 'UNAUTHENTICATED', message: 'Authentication required.' });
    }
    const rows = await db
      .select({
        allocationId: campaignDispatchAllocation.id,
        statut: campaignDispatchAllocation.statutAcceptation,
        iiPotentiel: campaignDispatchAllocation.iiPotentiel,
        rI: campaignDispatchAllocation.rI,
        revenuPrevisionnel: campaignDispatchAllocation.revenuPrevisionnel,
        screenhostId: screenhosts.id,
        screenhostName: screenhosts.name,
        campaignId: campaigns.id,
        campaignName: campaigns.name,
        campaignType: campaigns.campaignType,
        campaignStatus: campaigns.status,
        startDate: campaigns.startDate,
        endDate: campaigns.endDate,
        campaignCreatedAt: campaigns.createdAt,
        advertiserBusinessName: users.businessName,
        advertiserContactName: users.contactName,
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
      .innerJoin(users, eq(campaigns.advertiserId, users.id))
      .leftJoin(creatives, eq(campaigns.creativeId, creatives.id))
      .where(eq(screenhosts.ownerId, userId))
      .orderBy(desc(campaigns.createdAt), desc(campaigns.id), asc(screenhosts.name));

    // Group per campaign, first-seen order (= newest campaign first, per the ORDER BY).
    type OwnerAllocationRow = {
      id: string;
      screenhost_id: string;
      screenhost_name: string;
      statut_acceptation: DispatchAcceptation;
      ii_potentiel: number;
      r_i: number;
      revenu_previsionnel: number;
    };
    type Grouped = {
      head: (typeof rows)[number];
      allocations: OwnerAllocationRow[];
    };
    const byCampaign = new Map<string, Grouped>();
    for (const r of rows) {
      const group = byCampaign.get(r.campaignId) ?? { head: r, allocations: [] };
      group.allocations.push({
        id: r.allocationId,
        screenhost_id: r.screenhostId,
        screenhost_name: r.screenhostName,
        statut_acceptation: r.statut,
        ii_potentiel: r.iiPotentiel,
        r_i: r.rI,
        revenu_previsionnel: Number(r.revenuPrevisionnel),
      });
      byCampaign.set(r.campaignId, group);
    }
    const criteria = await loadCampaignCriteriaNames([...byCampaign.keys()]);

    return reply.status(200).send(
      [...byCampaign.values()].map(({ head, allocations }) => ({
        id: head.campaignId,
        name: head.campaignName,
        campaign_type: head.campaignType,
        status: head.campaignStatus,
        start_date: head.startDate,
        end_date: head.endDate,
        advertiser_name: head.advertiserBusinessName ?? head.advertiserContactName,
        categories: criteria.categoriesOf(head.campaignId),
        zones: criteria.zonesOf(head.campaignId),
        creative:
          head.creativeKind === null
            ? null
            : { kind: head.creativeKind, duration_seconds: head.creativeDuration },
        allocations,
        totals: {
          ii_potentiel: allocations.reduce((sum, a) => sum + a.ii_potentiel, 0),
          // Sum in the numeric's 4-decimal grain, then round: no float drift on the wire.
          revenu_previsionnel:
            Math.round(allocations.reduce((sum, a) => sum + a.revenu_previsionnel * 10000, 0)) /
            10000,
        },
        owner_decision: deriveOwnerDecision(allocations.map((a) => a.statut_acceptation)),
        created_at: head.campaignCreatedAt.toISOString(),
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
  // The decision itself lives in lib/allocation-decision.ts (ONE home, shared with the
  // simulator's owner emulator); this wrapper owns the HTTP mapping and the two post-commit
  // side effects (SPS recompute, playlist re-push).
  const decideAllocationRoute = async (
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

    const outcome = await decideAllocation({
      allocationId: parsedParams.data.id,
      ownerId: userId,
      statut,
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
    if (outcome.changed) {
      try {
        await recomputeVenueSps(outcome.screenhostId);
      } catch (err) {
        request.log.warn(
          { err, screenhostId: outcome.screenhostId },
          'SPS on-decision recompute failed',
        );
      }
    }
    // CF-HF4 — an ACCEPTE flip makes content airable NOW: re-push the venue's playlist to its
    // connected screens (no reconnect wait). Failure-warn: a dead socket never breaks the flip.
    if (outcome.changed && statut === 'ACCEPTE') {
      try {
        await pushPlaylistToVenue(outcome.screenhostId, request.log);
      } catch (err) {
        request.log.warn(
          { err, screenhostId: outcome.screenhostId },
          'playlist re-push on accept failed',
        );
      }
    }
    return reply.status(200).send({ id: outcome.id, statut_acceptation: outcome.statut });
  };

  // POST /api/screenhosts/allocations/:id/accept — owner accepts (→ ACCEPTE); the campaign may air.
  app.post('/api/screenhosts/allocations/:id/accept', ownerGuard, (request, reply) =>
    decideAllocationRoute(request, reply, 'ACCEPTE'),
  );

  // POST /api/screenhosts/allocations/:id/reject — owner rejects (→ REFUSE); it stays off-air.
  app.post('/api/screenhosts/allocations/:id/reject', ownerGuard, (request, reply) =>
    decideAllocationRoute(request, reply, 'REFUSE'),
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

  // ── EV4: event-allocation proposals (owner-scoped, SIBLING of the campaign section — the
  // campaign endpoints above are byte-untouched, their suite pins them) ─────────────────────────
  // A positioning's placement lands EN_ATTENTE per venue; the owner decides §11.1. NOTHING here
  // touches the playout path: an ACCEPTE event allocation does NOT re-push any playlist and never
  // reaches activeAllocationsForScreenhost — airing is EV5's (the phasing pin).

  // GET /api/screenhosts/event-allocations — the owner's EN_ATTENTE event proposals: the match
  // (name/kickoff/ends — the window derives client-side from the kickoff contract line), the
  // placed blocs, montant, and the spot meta (photos included — events accept images).
  app.get('/api/screenhosts/event-allocations', ownerGuard, async (request, reply) => {
    const userId = request.user?.id;
    if (!userId) {
      return reply
        .status(401)
        .send({ error: 'UNAUTHENTICATED', message: 'Authentication required.' });
    }
    const rows = await db
      .select({
        id: eventAllocations.id,
        campaignId: campaigns.id,
        matchName: campaigns.name,
        screenhostId: screenhosts.id,
        screenhostName: screenhosts.name,
        blocs: eventAllocations.blocs,
        impressionsTotal: eventAllocations.impressionsTotal,
        montantTnd: eventAllocations.montantTnd,
        createdAt: eventAllocations.createdAt,
        kickoffAt: events.kickoffAt,
        endsAt: events.endsAt,
        creativeKind: creatives.creativeType,
        creativeDuration: creatives.durationSeconds,
      })
      .from(eventAllocations)
      .innerJoin(screenhosts, eq(eventAllocations.screenhostId, screenhosts.id))
      .innerJoin(campaigns, eq(eventAllocations.campaignId, campaigns.id))
      .innerJoin(events, eq(campaigns.eventId, events.id))
      .leftJoin(creatives, eq(campaigns.creativeId, creatives.id))
      .where(and(eq(screenhosts.ownerId, userId), eq(eventAllocations.statut, 'EN_ATTENTE')))
      .orderBy(desc(eventAllocations.createdAt));
    return reply.status(200).send(
      rows.map((r) => ({
        id: r.id,
        campaign_id: r.campaignId,
        match_name: r.matchName,
        kickoff_at: r.kickoffAt.toISOString(),
        ends_at: r.endsAt.toISOString(),
        screenhost_id: r.screenhostId,
        screenhost_name: r.screenhostName,
        blocs: r.blocs,
        blocs_count: Array.isArray(r.blocs) ? r.blocs.length : 0,
        impressions_total: r.impressionsTotal,
        montant_tnd: Number(r.montantTnd),
        creative: r.creativeKind
          ? { kind: r.creativeKind, duration_seconds: r.creativeDuration }
          : null,
        created_at: r.createdAt,
      })),
    );
  });

  // GET /api/screenhosts/event-allocations/:id/creative-url — the owner previews the actual spot
  // (video OR image) before deciding; the campaign presign's mechanics, event-side.
  app.get(
    '/api/screenhosts/event-allocations/:id/creative-url',
    ownerGuard,
    async (request, reply) => {
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
        .from(eventAllocations)
        .innerJoin(screenhosts, eq(eventAllocations.screenhostId, screenhosts.id))
        .innerJoin(campaigns, eq(eventAllocations.campaignId, campaigns.id))
        .innerJoin(creatives, eq(campaigns.creativeId, creatives.id))
        .where(and(eq(eventAllocations.id, parsed.data.id), eq(screenhosts.ownerId, userId)))
        .limit(1);
      if (!row) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: 'No such allocation.' });
      }
      const presigned = await storage.getPresignedUrl({
        key: row.storageKey,
        expiresInSeconds: 300,
      });
      if ('error' in presigned) {
        return reply
          .status(502)
          .send({ error: 'STORAGE_ERROR', message: 'Le média n’a pas pu être présigné.' });
      }
      return reply.status(200).send({ url: presigned.url });
    },
  );

  // §11.1 — the accept reminder (returned to the UI, spoken on every accept).
  const EVENT_ACCEPT_REMINDER =
    'Merci de maintenir vos écrans actifs pendant la fenêtre de diffusion.';

  // The decision itself lives in lib/event-allocation-decision.ts (ONE home, shared with the
  // simulator's owner emulator); this wrapper owns the HTTP mapping.
  const decideEventAllocationRoute = async (
    request: FastifyRequest,
    reply: FastifyReply,
    statut: 'ACCEPTE' | 'REFUSE',
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

    const outcome = await decideEventAllocation({
      allocationId: parsedParams.data.id,
      ownerId: userId,
      statut,
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
    return reply.status(200).send({
      id: outcome.id,
      statut,
      ...(statut === 'ACCEPTE' ? { reminder: EVENT_ACCEPT_REMINDER } : {}),
    });
  };

  app.post('/api/screenhosts/event-allocations/:id/accept', ownerGuard, (request, reply) =>
    decideEventAllocationRoute(request, reply, 'ACCEPTE'),
  );
  // POST /api/screenhosts/event-allocations/:id/refuse — REFUSE (final) + release + cascade.
  app.post('/api/screenhosts/event-allocations/:id/refuse', ownerGuard, (request, reply) =>
    decideEventAllocationRoute(request, reply, 'REFUSE'),
  );
};
