import { hashPassword } from 'better-auth/crypto';
import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { db } from '../db/client.js';
import {
  accounts,
  agents,
  businessSectors,
  governorates,
  screenhostAffluence,
  screenhostMonthlyStats,
  screenhosts,
  screens,
  users,
} from '../db/schema.js';
import { env } from '../env.js';
import { generateUniqueAgentCode } from '../lib/agent-code.js';
import { buildEligibilityPatch, type EligibilityPatchInput } from '../lib/eligibility-patch.js';
import { mergeMonthlyAudience } from '../lib/monthly-audience.js';
import { decryptWifiPassword } from '../lib/wifi-crypto.js';
import { requireSyncKey } from '../middleware/require-sync-key.js';

// S-T1 — the toodooh side of the toodooh↔wedooh sync. Service-authenticated, NOT a user surface:
// every route is guarded by requireSyncKey(env.WEDOOH_SYNC_KEY) (wedooh presents a Bearer key).
// Three edges (all consumed by wedooh's already-deployed S-W1 client, so the shapes are LOCKED):
//   B1  GET  /api/internal/locations?email=  — pull/reconcile an owner's locations (carries WiFi).
//   C1  POST /api/internal/affluence         — ingest pushed audience-estimate slots.
//   A   POST /api/internal/agents            — provision a screenhost_agent + its referral code.
// numeric→string: Drizzle maps Postgres numeric to a JS string, so lat/lng are Number()-ed to honor
// the contract's `number | null`. NaN guards keep a malformed value as null rather than NaN.

const num = (value: string | null): number | null => {
  if (value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

// Per-row WiFi decrypt: NEVER let one corrupt/legacy envelope sink the whole response. A throw
// (bad version / GCM auth failure) degrades that single field to null. Plaintext is never logged.
const decryptWifi = (encrypted: string | null): string | null => {
  if (!encrypted) return null;
  try {
    return decryptWifiPassword(encrypted);
  } catch {
    return null;
  }
};

const affluenceBodySchema = z.object({
  slots: z
    .array(
      z.object({
        location_id: z.uuid(),
        day_of_week: z.number().int().min(1).max(7),
        hour: z.number().int().min(0).max(23),
        estimated_impressions: z.number().int().min(0),
        // AFF1 provenance (HUB-AFF1 sends it on every slot). Optional so a pre-AFF1 hub stays
        // compatible: absent → NULL (unknown), never a default guess. Invalid → 400 like any field.
        source: z.enum(['measured', 'backup']).optional(),
      }),
    )
    .max(168 * 64), // generous batch ceiling (a full week is 168 slots/location)
});

// C2: monthly-stats batch — the ACTUAL monthly audience the hub pushes (operator ruling), upserted
// latest-value-wins on (screenhost, month). Mirrors the affluence batch shape + tolerance.
/** A zero-filled 7×24 Monday-first grid — the shape lib/monthly-audience.ts reads. */
const emptyGrid = (): number[][] =>
  Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));

/** The venues' typical-week grids, one query for the whole batch (day_of_week 1=Mon → row 0). */
const loadAffluenceGrids = async (venueIds: string[]): Promise<Map<string, number[][]>> => {
  const grids = new Map<string, number[][]>();
  if (venueIds.length === 0) return grids;
  const slots = await db
    .select({
      screenhostId: screenhostAffluence.screenhostId,
      dayOfWeek: screenhostAffluence.dayOfWeek,
      hour: screenhostAffluence.hour,
      estimatedImpressions: screenhostAffluence.estimatedImpressions,
    })
    .from(screenhostAffluence)
    .where(inArray(screenhostAffluence.screenhostId, venueIds));
  for (const slot of slots) {
    let grid = grids.get(slot.screenhostId);
    if (!grid) {
      grid = emptyGrid();
      grids.set(slot.screenhostId, grid);
    }
    const row = grid[slot.dayOfWeek - 1];
    if (row && slot.hour >= 0 && slot.hour <= 23) row[slot.hour] = slot.estimatedImpressions;
  }
  return grids;
};

const monthlyStatsBodySchema = z.object({
  stats: z
    .array(
      z.object({
        location_id: z.uuid(),
        month: z.string().regex(/^\d{4}-\d{2}$/, 'month must be YYYY-MM'),
        total_audience: z.number().int().min(0),
        daily: z.array(
          z.object({
            date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
            audience: z.number().int().min(0),
          }),
        ),
        peak_day_of_week: z.number().int().min(1).max(7),
        peak_hour: z.number().int().min(0).max(23),
      }),
    )
    .max(64 * 12), // generous ceiling (64 locations × 12 months)
});

// C3: screenhost-eligibility batch — the hub (wedooh) OWNS the venue class (catégorie × csp_level)
// per place, so it pushes each place's dispatch eligibility here. Mirrors the affluence batch shape
// + tolerance: flat {items}, keyed by location_id (= the screenhost id), unknown locations SKIPPED
// + reported, latest-value-wins UPDATE of the screenhosts row. Two extra tolerances vs affluence:
//   - `business_sector` is the toodooh owner-sector NAME (the hub holds catégorie NAMES, never
//     toodooh's UUIDs — name is the only shared key); resolved here → business_sectors.id
//     (audience='owner'). An unresolvable name leaves that row's sector UNCHANGED and is reported in
//     `unknown_sectors` (never fails the batch). business_sector_id is NOT a wire field for this reason.
//   - opening_hour/closing_hour/broadcast_capacity are OPTIONAL: the hub does not hold them today, so
//     it OMITS them; the partial mapping then leaves any admin-set hours/capacity UNTOUCHED. They are
//     accepted here so the contract is forward-compatible if the hub ever sources them.
//   - `ratios` (Lane D) is the assigned class's demographic split, OPTIONAL per item: absent → the
//     six columns untouched; explicit null → all six cleared; object present → ALL SIX required (a
//     partial ratio object is a 400), each 0–100. Sum-to-100 stays HUB-side (the catalog validates
//     at class creation) — the receiver checks ranges only. Handled ROUTE-LOCALLY by ruling: the
//     shared buildEligibilityPatch is NOT extended (the admin PATCH must never gain a ratios
//     surface; ratios come only from the hub catalog).
const ratioPct = z.number().min(0).max(100);
const eligibilityRatiosSchema = z.object({
  gender_male_pct: ratioPct,
  gender_female_pct: ratioPct,
  age_17_30_pct: ratioPct,
  age_31_45_pct: ratioPct,
  age_46_60_pct: ratioPct,
  age_60_plus_pct: ratioPct,
});
const eligibilityBodySchema = z.object({
  items: z
    .array(
      z.object({
        location_id: z.uuid(),
        business_sector: z.string().min(1).nullable().optional(),
        class: z.enum(['populaire', 'moyen', 'premium']).nullable().optional(),
        opening_hour: z.number().int().min(0).max(23).nullable().optional(),
        closing_hour: z.number().int().min(0).max(23).nullable().optional(),
        broadcast_capacity: z.number().int().positive().nullable().optional(),
        ratios: eligibilityRatiosSchema.nullable().optional(),
      }),
    )
    .max(64 * 4), // generous ceiling — one eligibility row per screenhost (small fleet)
});

// Privileged-account password floor mirrors admin-accounts (min 12). OPTIONAL: omitted → no
// credential row (the agent is wedooh-managed and has no toodooh login until one is set).
const agentBodySchema = z.object({
  email: z.email(),
  contact_name: z.string().min(1).max(100),
  password: z.string().min(12).optional(),
});

// `syncKey` defaults to env.WEDOOH_SYNC_KEY in production (index.ts registers with no options);
// tests pass it explicitly so they never depend on the eagerly-parsed env singleton.
export const internalRoutes: FastifyPluginAsync<{ syncKey?: string }> = async (app, opts) => {
  const guard = { preHandler: [requireSyncKey(opts.syncKey ?? env.WEDOOH_SYNC_KEY)] };

  // ── B1: GET /api/internal/locations?email= ──────────────────────────────────
  // Owner + their screenhost locations (WiFi password DECRYPTED — this is the privileged transfer
  // surface). 404 USER_NOT_FOUND when the email is unknown (users.email is unique → exact lookup).
  app.get('/api/internal/locations', guard, async (request, reply) => {
    const email = String((request.query as { email?: string }).email ?? '')
      .trim()
      .toLowerCase();
    if (!email) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Query parameter "email" is required.',
        statusCode: 400,
        requestId: request.id,
      });
    }

    const [owner] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (!owner) {
      return reply.status(404).send({
        error: 'USER_NOT_FOUND',
        message: 'No user with this email.',
        statusCode: 404,
        requestId: request.id,
      });
    }

    const rows = await db
      .select({ s: screenhosts, governorateName: governorates.name })
      .from(screenhosts)
      .leftJoin(governorates, eq(screenhosts.governorateId, governorates.id))
      .where(eq(screenhosts.ownerId, owner.id));

    const locationIds = rows.map((r) => r.s.id);
    const screenRows = locationIds.length
      ? await db.select().from(screens).where(inArray(screens.screenhostId, locationIds))
      : [];
    const screensByHost = new Map<string, typeof screenRows>();
    for (const sc of screenRows) {
      const list = screensByHost.get(sc.screenhostId) ?? [];
      list.push(sc);
      screensByHost.set(sc.screenhostId, list);
    }

    return reply.status(200).send({
      owner: {
        id: owner.id,
        email: owner.email,
        contact_name: owner.contactName,
        business_name: owner.businessName,
        contact_phone: owner.contactPhone,
        phone: owner.phone,
        role: owner.role,
        status: owner.status,
      },
      locations: rows.map(({ s, governorateName }) => ({
        id: s.id,
        name: s.name,
        latitude: num(s.latitude),
        longitude: num(s.longitude),
        address: s.address,
        city: s.city,
        postal_code: s.postalCode,
        zone: s.zone,
        governorate: governorateName,
        screen_count: s.screenCount,
        wifi_ssid: s.wifiSsid,
        wifi_password: decryptWifi(s.wifiPasswordEncrypted),
        is_active: s.isActive,
        export_status: s.exportStatus,
        exported_at: s.exportedAt,
        screens: (screensByHost.get(s.id) ?? []).map((sc) => ({
          id: sc.id,
          name: sc.name,
          is_active: sc.isActive,
          paired_at: sc.pairedAt,
          last_seen_at: sc.lastSeenAt,
        })),
      })),
    });
  });

  // ── C1: POST /api/internal/affluence ────────────────────────────────────────
  // MEJ-5 (diagnosis, 2026-08-31) — TIMEZONE CONTRACT: `day_of_week` / `hour` are the venue's OWN
  // clock, i.e. AFRICA/TUNIS weekday and hour. Every consumer reads them that way — the owner
  // heatmap labels them « 13h », and L-disp compares them against screenhosts.opening_hour /
  // closing_hour, which are local. toodooh stores what the hub sends VERBATIM and never shifts it:
  // a correction applied here would double-correct the day the producer is fixed, and would make
  // toodooh disagree with the hub's own venue page, which renders the same grid.
  //
  // KNOWN VIOLATION, upstream and NOT fixed here: the hub buckets in UTC
  // (toodooh-dashboard/src/database/queries.js `placeHeatmap` — `strftime('%w'|'%H', r.timestamp)`
  // with no 'localtime' modifier, over `readings.timestamp DEFAULT (datetime('now'))`, which
  // SQLite writes in UTC). Tunisia is UTC+1 year-round, so every cell currently lands one hour
  // early, and a reading between 00:00 and 01:00 Tunis lands on the previous weekday. The fix is
  // one modifier in that query plus a re-push; it is banked because the grid also feeds
  // money-adjacent engine paths (C_max, event pricing) and needs the operator's word.
  //
  // Flat batch of {location_id, day_of_week, hour, estimated_impressions, source?}. Latest-value-wins
  // upsert on (screenhost, day, hour) — the value AND its provenance (a provenance-less re-push
  // resets source to NULL: unknown, never stale). Unknown location_ids are SKIPPED and reported
  // (never fail the batch).
  app.post('/api/internal/affluence', guard, async (request, reply) => {
    const parsed = affluenceBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        statusCode: 400,
        requestId: request.id,
        fields: parsed.error.issues.map((i) => ({ field: i.path.join('.'), reason: i.message })),
      });
    }
    const { slots } = parsed.data;
    if (slots.length === 0) {
      return reply.status(200).send({ upserted: 0, unknown_locations: [] });
    }

    const requestedIds = [...new Set(slots.map((s) => s.location_id))];
    const known = await db
      .select({ id: screenhosts.id })
      .from(screenhosts)
      .where(inArray(screenhosts.id, requestedIds));
    const knownIds = new Set(known.map((k) => k.id));
    const unknownLocations = requestedIds.filter((id) => !knownIds.has(id));

    const toUpsert = slots.filter((s) => knownIds.has(s.location_id));
    let upserted = 0;
    if (toUpsert.length > 0) {
      await db.transaction(async (tx) => {
        for (const slot of toUpsert) {
          await tx
            .insert(screenhostAffluence)
            .values({
              screenhostId: slot.location_id,
              dayOfWeek: slot.day_of_week,
              hour: slot.hour,
              estimatedImpressions: slot.estimated_impressions,
              source: slot.source ?? null,
            })
            .onConflictDoUpdate({
              target: [
                screenhostAffluence.screenhostId,
                screenhostAffluence.dayOfWeek,
                screenhostAffluence.hour,
              ],
              set: {
                estimatedImpressions: slot.estimated_impressions,
                source: slot.source ?? null,
                updatedAt: new Date(),
              },
            });
          upserted += 1;
        }
      });
    }

    return reply.status(200).send({ upserted, unknown_locations: unknownLocations });
  });

  // ── C2: POST /api/internal/monthly-stats ────────────────────────────────────
  // Flat batch of {location_id, month, total_audience, daily[], peak_day_of_week, peak_hour}. Latest-
  // value-wins upsert on (screenhost, month). Unknown location_ids are SKIPPED and reported (never
  // fail the batch) — same tolerance as the affluence ingest.
  //
  // PERF-QA2 — the audience aggregates consume the MERGED source (lib/monthly-audience.ts): a day
  // the hub measured is kept, a day it did not is estimated from that venue's affluence grid.
  // ONE occupancy source for the whole owner page family — « Personnes touchées » (Σ these
  // months) can no longer read 0 while « Votre audience » (the same grid) reads thousands, and a
  // real measurement automatically displaces the estimate on the NEXT push, because the merge
  // always runs against the hub's fresh payload and never against what we stored.
  //
  // SURGICAL: the row is stored EXACTLY as sent — the hub's own total included — unless an
  // estimate actually CONTRIBUTES (a venue with no grid, or a fully measured month, is verbatim).
  // This path fills measurement holes; it does not re-derive the hub's arithmetic (the banked
  // DATA1 summarize-mismatch is a separate lane).
  app.post('/api/internal/monthly-stats', guard, async (request, reply) => {
    const parsed = monthlyStatsBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        statusCode: 400,
        requestId: request.id,
        fields: parsed.error.issues.map((i) => ({ field: i.path.join('.'), reason: i.message })),
      });
    }
    const { stats } = parsed.data;
    if (stats.length === 0) {
      return reply.status(200).send({ upserted: 0, unknown_locations: [] });
    }

    const requestedIds = [...new Set(stats.map((s) => s.location_id))];
    const known = await db
      .select({ id: screenhosts.id })
      .from(screenhosts)
      .where(inArray(screenhosts.id, requestedIds));
    const knownIds = new Set(known.map((k) => k.id));
    const unknownLocations = requestedIds.filter((id) => !knownIds.has(id));

    const toUpsert = stats.filter((s) => knownIds.has(s.location_id));
    let upserted = 0;
    if (toUpsert.length > 0) {
      const grids = await loadAffluenceGrids([...new Set(toUpsert.map((s) => s.location_id))]);
      const todayIso = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Tunis' }).format(
        new Date(),
      );
      await db.transaction(async (tx) => {
        for (const stat of toUpsert) {
          const merged = mergeMonthlyAudience({
            month: stat.month,
            measured: stat.daily,
            grid: grids.get(stat.location_id) ?? emptyGrid(),
            todayIso,
          });
          // Substitute ONLY when an estimate actually CONTRIBUTES something. A fully measured
          // month, and a venue with no grid at all, are stored EXACTLY as the hub sent them —
          // total included. This path fills measurement holes; it never re-derives the hub's own
          // arithmetic (the banked DATA1 summarize-mismatch stays observable, out of scope here).
          const substituted = merged.daily.some((d) => d.source === 'estimated' && d.audience > 0);
          const daily = substituted ? merged.daily : stat.daily;
          const totalAudience = substituted ? merged.totalAudience : stat.total_audience;
          await tx
            .insert(screenhostMonthlyStats)
            .values({
              screenhostId: stat.location_id,
              month: stat.month,
              totalAudience,
              daily,
              peakDayOfWeek: stat.peak_day_of_week,
              peakHour: stat.peak_hour,
            })
            .onConflictDoUpdate({
              target: [screenhostMonthlyStats.screenhostId, screenhostMonthlyStats.month],
              set: {
                totalAudience,
                daily,
                peakDayOfWeek: stat.peak_day_of_week,
                peakHour: stat.peak_hour,
                updatedAt: new Date(),
              },
            });
          upserted += 1;
        }
      });
    }

    return reply.status(200).send({ upserted, unknown_locations: unknownLocations });
  });

  // ── C3: POST /api/internal/screenhost-eligibility ───────────────────────────
  // Flat batch of {location_id, business_sector?, class?, opening_hour?, closing_hour?,
  // broadcast_capacity?, ratios?}. Latest-value-wins UPDATE of the screenhosts row (the SAME columns
  // the admin eligibility PATCH writes, via the shared buildEligibilityPatch — except `ratios`,
  // which is hub-only and merged route-locally). Unknown location_ids are SKIPPED + reported; an
  // unresolvable business_sector NAME leaves that row's sector untouched + is reported in
  // unknown_sectors — neither fails the batch (same tolerance as the affluence ingest).
  app.post('/api/internal/screenhost-eligibility', guard, async (request, reply) => {
    const parsed = eligibilityBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        statusCode: 400,
        requestId: request.id,
        fields: parsed.error.issues.map((i) => ({ field: i.path.join('.'), reason: i.message })),
      });
    }
    const { items } = parsed.data;
    if (items.length === 0) {
      return reply.status(200).send({ upserted: 0, unknown_locations: [], unknown_sectors: [] });
    }

    const requestedIds = [...new Set(items.map((i) => i.location_id))];
    const known = await db
      .select({ id: screenhosts.id })
      .from(screenhosts)
      .where(inArray(screenhosts.id, requestedIds));
    const knownIds = new Set(known.map((k) => k.id));
    const unknownLocations = requestedIds.filter((id) => !knownIds.has(id));

    const toUpsert = items.filter((i) => knownIds.has(i.location_id));

    // Resolve the distinct owner-sector NAMES the batch references → ids (audience='owner', the same
    // source the admin PATCH validates against). Unresolvable names are reported, never written.
    const sectorNames = [
      ...new Set(
        toUpsert.flatMap((i) => (typeof i.business_sector === 'string' ? [i.business_sector] : [])),
      ),
    ];
    const sectorRows = sectorNames.length
      ? await db
          .select({ id: businessSectors.id, name: businessSectors.name })
          .from(businessSectors)
          .where(
            and(inArray(businessSectors.name, sectorNames), eq(businessSectors.audience, 'owner')),
          )
      : [];
    const sectorIdByName = new Map(sectorRows.map((r) => [r.name, r.id]));
    const unknownSectors = sectorNames.filter((n) => !sectorIdByName.has(n));

    let upserted = 0;
    if (toUpsert.length > 0) {
      await db.transaction(async (tx) => {
        for (const item of toUpsert) {
          const patchInput: EligibilityPatchInput = {};
          if (item.business_sector === null) {
            patchInput.business_sector_id = null; // explicit clear
          } else if (typeof item.business_sector === 'string') {
            const resolved = sectorIdByName.get(item.business_sector);
            // Unresolvable name → leave the sector UNCHANGED (omit the key); reported separately.
            if (resolved !== undefined) patchInput.business_sector_id = resolved;
          }
          if (item.class !== undefined) patchInput.class = item.class;
          if (item.opening_hour !== undefined) patchInput.opening_hour = item.opening_hour;
          if (item.closing_hour !== undefined) patchInput.closing_hour = item.closing_hour;
          if (item.broadcast_capacity !== undefined)
            patchInput.broadcast_capacity = item.broadcast_capacity;

          const patch = buildEligibilityPatch(patchInput);
          // Lane D ratios — merged ROUTE-LOCALLY, never via the shared patch (the admin PATCH has
          // no ratios surface). Absent key → untouched; explicit null → all six cleared. Drizzle
          // numeric takes a string on write (the lat/lng convention), hence toString().
          if (item.ratios !== undefined) {
            const r = item.ratios;
            patch.genderMalePct = r === null ? null : r.gender_male_pct.toString();
            patch.genderFemalePct = r === null ? null : r.gender_female_pct.toString();
            patch.age17To30Pct = r === null ? null : r.age_17_30_pct.toString();
            patch.age31To45Pct = r === null ? null : r.age_31_45_pct.toString();
            patch.age46To60Pct = r === null ? null : r.age_46_60_pct.toString();
            patch.age60PlusPct = r === null ? null : r.age_60_plus_pct.toString();
          }
          if (Object.keys(patch).length === 0) continue; // nothing to write for this row
          await tx.update(screenhosts).set(patch).where(eq(screenhosts.id, item.location_id));
          upserted += 1;
        }
      });
    }

    return reply.status(200).send({
      upserted,
      unknown_locations: unknownLocations,
      unknown_sectors: unknownSectors,
    });
  });

  // ── Edge A: POST /api/internal/agents ───────────────────────────────────────
  // Provision a screenhost_agent (verified + approved) + its issued referral code. Reuses the
  // admin-accounts transaction (users + optional credential account + agents row, atomic). Replay-
  // safe: an existing screenhost_agent email returns its {user_id, code} (200); an email already
  // taken by ANY OTHER role is a 409 EMAIL_TAKEN.
  app.post('/api/internal/agents', guard, async (request, reply) => {
    const parsed = agentBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        statusCode: 400,
        requestId: request.id,
        fields: parsed.error.issues.map((i) => ({ field: i.path.join('.'), reason: i.message })),
      });
    }
    const { contact_name, password } = parsed.data;
    const email = parsed.data.email.toLowerCase();

    const [existing] = await db
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    if (existing) {
      if (existing.role === 'screenhost_agent') {
        const [agent] = await db
          .select({ code: agents.code })
          .from(agents)
          .where(eq(agents.userId, existing.id))
          .limit(1);
        return reply.status(200).send({ user_id: existing.id, code: agent?.code ?? null });
      }
      return reply.status(409).send({
        error: 'EMAIL_TAKEN',
        message: 'An account with this email already exists.',
        statusCode: 409,
        requestId: request.id,
        fields: [{ field: 'email', reason: 'already registered' }],
      });
    }

    const created = await db.transaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({
          email,
          contactName: contact_name,
          emailVerified: true,
          role: 'screenhost_agent',
          status: 'approved',
        })
        .returning({ id: users.id });
      if (!user) throw new Error('internal agent insert returned no row');
      if (password) {
        await tx.insert(accounts).values({
          accountId: user.id,
          providerId: 'credential',
          userId: user.id,
          password: await hashPassword(password),
        });
      }
      // Edge A always provisions a screenhost_agent (role set above) → 'SH'-prefixed code.
      const code = await generateUniqueAgentCode('SH', async (candidate) => {
        const [hit] = await tx
          .select({ code: agents.code })
          .from(agents)
          .where(eq(agents.code, candidate))
          .limit(1);
        return hit !== undefined;
      });
      await tx.insert(agents).values({ userId: user.id, code });
      return { userId: user.id, code };
    });

    return reply.status(201).send({ user_id: created.userId, code: created.code });
  });
};
