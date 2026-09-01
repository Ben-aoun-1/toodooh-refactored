import { hashPassword } from 'better-auth/crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { db } from '../db/client.js';
import {
  accounts,
  agents,
  businessSectors,
  governorates,
  type NewScreenhostAffluence,
  screenhostAffluence,
  screenhostAffluenceHourly,
  screenhostMonthlyStats,
  screenhosts,
  screens,
  users,
} from '../db/schema.js';
import { env } from '../env.js';
import { generateUniqueAgentCode } from '../lib/agent-code.js';
import { CALENDAR_DAY_MSG, ISO_DATE_RE, isCalendarDate } from '../lib/calendar-date.js';
import { buildEligibilityPatch, type EligibilityPatchInput } from '../lib/eligibility-patch.js';
import { collapseHalvesSql, hourOfSlot, slotsOfHour } from '../lib/half-hour-slots.js';
import { mergeMonthlyAudience } from '../lib/monthly-audience.js';
import { decryptWifiPassword } from '../lib/wifi-crypto.js';
import { requireSyncKey } from '../middleware/require-sync-key.js';

// S-T1 — the toodooh side of the toodooh↔wedooh sync. Service-authenticated, NOT a user surface:
// every route is guarded by requireSyncKey(env.WEDOOH_SYNC_KEY) (wedooh presents a Bearer key).
// Three edges (all consumed by wedooh's already-deployed S-W1 client, so the shapes are LOCKED):
//   B1  GET  /api/internal/locations?email=  — pull/reconcile an owner's locations (carries WiFi).
//   C1  POST /api/internal/affluence         — ingest pushed audience-estimate slots.
//   C1h POST /api/internal/affluence-hourly  — ingest MEASURED (date, hour) cells (AUD-HOURLY1-A).
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

// MEJ-13-B — THE RECEIVER RULE, both endpoints, one shape (contract stated 2026-09-01):
//   1. `slot` present            → store that slot verbatim.
//   2. `slot` absent, `hour` set → store BOTH halves with the SAME value (a cell is a LEVEL —
//                                  people present — so half an hour of it is not half the people;
//                                  never v/2).
//   3. both present              → `slot` wins, `hour` ignored. No error, no reconciliation: the
//                                  sender is mid-roll and that is expected, not a fault.
//   4. neither                   → 400, the cell is unusable.
// Rule 2 is what lets the two boxes deploy in EITHER ORDER: an old-shape push produces exactly
// what today's push produces, expanded, so the money path cannot move on unchanged input.
const HALF_HOUR_CELL_MSG = 'each cell needs hour or slot';

const affluenceBodySchema = z.object({
  slots: z
    .array(
      z
        .object({
          location_id: z.uuid(),
          day_of_week: z.number().int().min(1).max(7),
          hour: z.number().int().min(0).max(23).optional(),
          slot: z.number().int().min(0).max(47).optional(),
          estimated_impressions: z.number().int().min(0),
          // AFF1 provenance (HUB-AFF1 sends it on every slot). Optional so a pre-AFF1 hub stays
          // compatible: absent → NULL (unknown), never a default guess. Invalid → 400 like any field.
          source: z.enum(['measured', 'backup']).optional(),
        })
        .refine((c) => c.slot !== undefined || c.hour !== undefined, HALF_HOUR_CELL_MSG),
    )
    .max(336 * 64), // batch ceiling — a full week is 336 half-hour slots/location
});

// AUD-HOURLY1-A — the MEASURED hourly series. `date`/`hour` are AFRICA/TUNIS clock values and are
// stored VERBATIM (see the column comments on screenhost_affluence_hourly): a producer bucketing in
// UTC is fixed AT THE PRODUCER, never compensated here. The wire is nested per place — the shape is
// FIXED with the hub session, so it is not "harmonised" with the flat siblings.
//
const affluenceHourlyBodySchema = z.object({
  places: z
    .array(
      z.object({
        toodooh_screenhost_id: z.uuid(),
        cells: z
          .array(
            z
              .object({
                date: z
                  .string()
                  .regex(ISO_DATE_RE, 'date must be YYYY-MM-DD')
                  .refine(isCalendarDate, CALENDAR_DAY_MSG),
                hour: z.number().int().min(0).max(23).optional(),
                slot: z.number().int().min(0).max(47).optional(),
                value: z.number().int().min(0),
              })
              .refine((c) => c.slot !== undefined || c.hour !== undefined, HALF_HOUR_CELL_MSG),
          )
          .max(48 * 400), // a venue's whole backfill window, half-hour by half-hour
      }),
    )
    .max(200),
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
  // MEJ-13-B — the grid this feeds is HOUR-keyed (7×24) and lib/monthly-audience.ts SUMS a
  // weekday's row into screenhost_monthly_stats. The table is half-hour rows, so collapse in SQL:
  // round(avg(halves)) is the ruled hour value, and it returns the old number exactly whenever the
  // two halves are equal — which is every cell an hour-shaped push writes.
  const slots = await db
    .select({
      screenhostId: screenhostAffluence.screenhostId,
      dayOfWeek: screenhostAffluence.dayOfWeek,
      hour: screenhostAffluence.hour,
      estimatedImpressions: collapseHalvesSql(screenhostAffluence.estimatedImpressions),
    })
    .from(screenhostAffluence)
    .where(inArray(screenhostAffluence.screenhostId, venueIds))
    .groupBy(
      screenhostAffluence.screenhostId,
      screenhostAffluence.dayOfWeek,
      screenhostAffluence.hour,
    );
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

    // MEJ-13-B — expand each wire cell onto the slots it addresses (rules 1 and 2), then dedupe
    // inside the batch. Two writes are needed:
    //  • EXPLICIT beats EXPANDED for the same slot. Rule 3 says slot wins over hour within one
    //    cell; a mid-roll sender that emits both shapes in one batch is the same situation across
    //    cells, so an hour-expansion must never overwrite a slot the sender stated outright.
    //    (Judgment call in a gap the contract does not cover — flagged in the PR.)
    //  • Among equal precedence, LAST wins, matching the endpoint's latest-value-wins semantics.
    const byCell = new Map<string, { explicit: boolean; row: NewScreenhostAffluence }>();
    for (const cell of slots) {
      if (!knownIds.has(cell.location_id)) continue;
      const explicit = cell.slot !== undefined;
      const targets = explicit ? [cell.slot as number] : slotsOfHour(cell.hour as number);
      for (const slot of targets) {
        const key = `${cell.location_id}|${cell.day_of_week}|${slot}`;
        if (byCell.get(key)?.explicit === true && !explicit) continue;
        byCell.set(key, {
          explicit,
          row: {
            screenhostId: cell.location_id,
            dayOfWeek: cell.day_of_week,
            hour: hourOfSlot(slot), // DERIVED from slot — never the wire's hour (rule 3)
            slot,
            estimatedImpressions: cell.estimated_impressions,
            source: cell.source ?? null,
          },
        });
      }
    }
    const rows = [...byCell.values()].map((entry) => entry.row);
    // `upserted` is a RECEIPT TO THE SENDER about what IT sent, so it stays wire cells: how many
    // rows we chose to write is our storage detail, and a receipt that doubles across a deploy
    // boundary invites someone to open an incident. The row count rides along as its own field.
    // Distinct wire cells accepted — a sender that repeats one cell is not credited twice, which
    // is the receipt semantics these endpoints have always had.
    const acceptedCells = new Set(
      slots
        .filter((cell) => knownIds.has(cell.location_id))
        .map(
          (cell) =>
            `${cell.location_id}|${cell.day_of_week}|${cell.slot !== undefined ? `s${cell.slot}` : `h${cell.hour}`}`,
        ),
    ).size;

    if (rows.length > 0) {
      const CHUNK = 500;
      await db.transaction(async (tx) => {
        for (let i = 0; i < rows.length; i += CHUNK) {
          await tx
            .insert(screenhostAffluence)
            .values(rows.slice(i, i + CHUNK))
            .onConflictDoUpdate({
              target: [
                screenhostAffluence.screenhostId,
                screenhostAffluence.dayOfWeek,
                screenhostAffluence.slot,
              ],
              set: {
                estimatedImpressions: sql`excluded.estimated_impressions`,
                source: sql`excluded.source`,
                updatedAt: new Date(),
              },
            });
        }
      });
    }

    return reply.status(200).send({
      upserted: acceptedCells,
      slot_rows: rows.length,
      unknown_locations: unknownLocations,
    });
  });

  // ── C1h: POST /api/internal/affluence-hourly (AUD-HOURLY1-A) ────────────────
  // The MEASURED per-(date, hour) audience the dow×hour grid could never carry. STORAGE ONLY in
  // this slice: nothing reads the table yet (periodAudience, S01, S02 and the PDF are untouched),
  // so it deploys INERT, before the hub starts pushing.
  //
  // Same non-strict posture as its siblings: an unknown screenhost id is SKIPPED and reported,
  // never fatal — a hub holding a place toodooh does not (yet) know must not lose the whole batch.
  // Latest-value-wins on (screenhost, date, hour).
  app.post('/api/internal/affluence-hourly', guard, async (request, reply) => {
    const parsed = affluenceHourlyBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        statusCode: 400,
        requestId: request.id,
        fields: parsed.error.issues.map((i) => ({ field: i.path.join('.'), reason: i.message })),
      });
    }
    const { places } = parsed.data;
    if (places.length === 0) {
      return reply.status(200).send({ upserted: 0, unknown_locations: [] });
    }

    const requestedIds = [...new Set(places.map((p) => p.toodooh_screenhost_id))];
    const known = await db
      .select({ id: screenhosts.id })
      .from(screenhosts)
      .where(inArray(screenhosts.id, requestedIds));
    const knownIds = new Set(known.map((k) => k.id));
    const unknownLocations = requestedIds.filter((id) => !knownIds.has(id));

    // DEDUPE INSIDE THE BATCH FIRST — last cell wins. A multi-row upsert whose own values collide
    // on the conflict target fails outright ("cannot affect row a second time"), so a hub that
    // repeats a cell within one push would otherwise 500 instead of being tolerated.
    // MEJ-13-B — same expansion and same precedence as the sibling endpoint (see there).
    const byCell = new Map<
      string,
      { explicit: boolean; row: typeof screenhostAffluenceHourly.$inferInsert }
    >();
    for (const place of places) {
      if (!knownIds.has(place.toodooh_screenhost_id)) continue;
      for (const cell of place.cells) {
        const explicit = cell.slot !== undefined;
        const targets = explicit ? [cell.slot as number] : slotsOfHour(cell.hour as number);
        for (const slot of targets) {
          const key = `${place.toodooh_screenhost_id}|${cell.date}|${slot}`;
          if (byCell.get(key)?.explicit === true && !explicit) continue;
          byCell.set(key, {
            explicit,
            row: {
              screenhostId: place.toodooh_screenhost_id,
              date: cell.date, // VERBATIM — Tunis clock, never shifted here
              hour: hourOfSlot(slot), // DERIVED from slot (rule 3)
              slot,
              value: cell.value,
            },
          });
        }
      }
    }
    const rows = [...byCell.values()].map((entry) => entry.row);
    // Wire cells, not rows — the same receipt rule as the sibling endpoint above.
    const acceptedCells = new Set(
      places
        .filter((place) => knownIds.has(place.toodooh_screenhost_id))
        .flatMap((place) =>
          place.cells.map(
            (cell) =>
              `${place.toodooh_screenhost_id}|${cell.date}|${cell.slot !== undefined ? `s${cell.slot}` : `h${cell.hour}`}`,
          ),
        ),
    ).size;

    if (rows.length > 0) {
      const CHUNK = 500;
      await db.transaction(async (tx) => {
        for (let i = 0; i < rows.length; i += CHUNK) {
          await tx
            .insert(screenhostAffluenceHourly)
            .values(rows.slice(i, i + CHUNK))
            .onConflictDoUpdate({
              target: [
                screenhostAffluenceHourly.screenhostId,
                screenhostAffluenceHourly.date,
                screenhostAffluenceHourly.slot,
              ],
              set: {
                value: sql`excluded.value`,
                receivedAt: new Date(),
              },
            });
        }
      });
    }

    return reply.status(200).send({
      upserted: acceptedCells,
      slot_rows: rows.length,
      unknown_locations: unknownLocations,
    });
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
