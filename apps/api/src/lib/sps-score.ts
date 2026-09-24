import { and, eq, gte, inArray, lt } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';

import { db } from '../db/client.js';
import { proofOfPlay, screenhosts, screenhostUnavailability } from '../db/schema.js';

import { getDispatchConfig } from './dispatch/config.js';
import { broadcastableHours } from './dispatch/eligibility.js';
import { isElapsed, tunisNowSlot } from './dispatch/redispatch.js';
import { proofSlotKey } from './reconcile/delivered-slots.js';
import { slotKey } from './reconcile/valuation.js';
import {
  ACCEPTATION_WINDOW_DAYS,
  ACTIVITE_WINDOW_DAYS,
  DAY_MS,
  RESPECT_WINDOW_DAYS,
  type SpsObservations,
  loadAcceptedAllocations,
  loadAttested,
  loadDecided,
  tunisDateOf,
  tunisWeekStart,
} from './sps-observations.js';
import { SCREEN_SECONDS_PER_HOUR } from './vf-constants.js';

// E4 — the SPS score engine (Mejri 2026-07-27, Kais-validated): 40 % taux d'acceptation des
// campagnes + 30 % respect des événements acceptés + 20 % activité de l'écran + 10 % taux de
// remplissage, weights admin-editable (Σ = 100). The flat-50 stub retires: a daily job writes
// every active venue's computed score into screenhosts.sps (the value dispatch ordering already
// sorts by), and an owner's accept/reject recomputes that venue in-request.
//
// PURE DERIVATIONS from existing data — no new tracking tables:
//  - acceptation:     ACCEPTE ÷ decided allocations, trailing 90 d. The allocation carries no
//                     decided_at — the window anchors on the allocation's created_at (decisions
//                     follow dispatch closely; as-found, reported at CF-9). No decisions → 100.
//  - respect:         attested-true ÷ attested event_attestations, trailing 90 d (EV5). NO
//                     attestation in the window → 100 BY RULE (absent = respected: an
//                     uninspected venue is never sanctioned).
//  - activité:        proven ÷ scheduled elapsed créneaux (FIX A delivery semantics: ≥1
//                     VIDEO_ENDED proof received in the créneau's Tunis hour), trailing 30 d,
//                     ACCEPTE allocations only. Nothing scheduled → 100.
//  - remplissage:     engaged broadcast seconds (Σ créneau reps × the plan's S) ÷ the venue's
//                     available SCREEN seconds (CAP-F1: 3600 × broadcastable hours × the week's NON-DECLARED
//                     days — an honest E2 declaration never dents the score; ratification
//                     amendment), current Tunis week. Zero engagement → 0.
//
// The windows, the loaders and the evidence counts (SpsObservations) live in sps-observations.ts.

/**
 * The respect variable's EMPTY-SET value: a venue with NO attestation in the window scores 100.
 * EV5 turned the variable real (attested-true ÷ attested); this stayed the ruled default because
 * "no inspection" must never read as a sanction.
 */
export const EVENT_RESPECT_DEFAULT = 100;

const round2 = (n: number): number => Math.round(n * 100) / 100;

export interface SpsVariables {
  acceptation: number;
  respect_evenements: number;
  activite: number;
  remplissage: number;
}

export interface SpsResult {
  sps: number;
  variables: SpsVariables;
  /** MEJ-14b — the evidence behind `variables`; see spsComputable. */
  observations: SpsObservations;
}

/**
 * MEJ-14b (Mejri, ruled through the operator 2026-09-01) — is this score worth SHOWING?
 *
 * Three of the four variables answer 100 to an empty set, each for a good reason: no decisions is
 * not a refusal, no inspection is not a breach (EVENT_RESPECT_DEFAULT), nothing scheduled is not a
 * failure to broadcast. Only remplissage falls to 0. So a venue that has never been connected
 * scores 100·40 % + 100·30 % + 100·20 % + 0·10 % = **90/100** and outranks venues live for months
 * — a number built entirely out of defaults, with nothing measured underneath it.
 *
 * A score is computable once ANY ONE variable rests on a real observation. If none does, the
 * surfaces show « À venir » rather than a number: never 0 either, which would read as a verdict.
 *
 * DISPLAY ONLY — deliberately. This does not change the score, the stored `screenhosts.sps`, or
 * dispatch ordering: that venue's 90 still outranks in dispatch, and whether it SHOULD is a
 * separate open question (SPS-DISPATCH1), not ruled here.
 */
export const spsComputable = (o: SpsObservations): boolean =>
  o.decided > 0 || o.attested > 0 || o.scheduledElapsed > 0 || o.engagedSeconds > 0;

/** The weighted total, clamped to [0, 100] (weights are validated Σ = 100 at the edit path). */
export const weightedSps = (
  variables: SpsVariables,
  weights: {
    spsWeightAcceptation: number;
    spsWeightRespectEvenements: number;
    spsWeightActivite: number;
    spsWeightRemplissage: number;
  },
): number => {
  const total =
    (weights.spsWeightAcceptation * variables.acceptation +
      weights.spsWeightRespectEvenements * variables.respect_evenements +
      weights.spsWeightActivite * variables.activite +
      weights.spsWeightRemplissage * variables.remplissage) /
    100;
  return round2(Math.min(100, Math.max(0, total)));
};

/**
 * SPS-DISPATCH1 — the NEUTRAL ordering position for a venue whose score is not computable.
 *
 * The midpoint of the 0–100 range, and deliberately not 0 or 100: « we do not know yet » is not a
 * claim in either direction. Ranking an unscored venue LAST would be a deadlock — a brand-new
 * screen can only earn a score by receiving campaigns, and it can only receive campaigns by
 * ranking, so last place would make onboarding structurally impossible. Ranking it FIRST would pay
 * for the absence of a record.
 *
 * (50 is also where the retired flat-50 stub sat, before E4 made the score real. That is not a
 * coincidence: 50 was always the value that asserted nothing.)
 */
export const SPS_NEUTRAL = 50;

/** Compute the venue's SPS breakdown at `now` (live — nothing is written). */
export const computeSps = async (screenhostId: string, now = new Date()): Promise<SpsResult> => {
  const cfg = await getDispatchConfig();

  // ── acceptation: decided allocations (campaign + event) in the trailing 90 d ──
  const decidedSince = new Date(now.getTime() - ACCEPTATION_WINDOW_DAYS * DAY_MS);
  const allDecided = await loadDecided(screenhostId, { since: decidedSince });
  const accepted = allDecided.filter((d) => d.statut === 'ACCEPTE').length;
  const acceptation = allDecided.length === 0 ? 100 : round2((accepted / allDecided.length) * 100);

  // ── the venue's ACCEPTE allocations + their plans (activité + remplissage) ──
  const allocations = await loadAcceptedAllocations(screenhostId);

  // ── activité: proven ÷ scheduled elapsed créneaux, trailing 30 d ───────────
  const nowSlot = tunisNowSlot(now);
  const activiteSinceDate = tunisDateOf(new Date(now.getTime() - ACTIVITE_WINDOW_DAYS * DAY_MS));
  const campaignIds = [...new Set(allocations.map((a) => a.campaignId))];
  const proofRows = campaignIds.length
    ? await db
        .select({
          campaignId: proofOfPlay.campaignId,
          receivedAt: proofOfPlay.receivedAt,
        })
        .from(proofOfPlay)
        .where(
          and(
            eq(proofOfPlay.screenhostId, screenhostId),
            eq(proofOfPlay.eventType, 'VIDEO_ENDED'),
            inArray(proofOfPlay.campaignId, campaignIds),
            gte(
              proofOfPlay.receivedAt,
              new Date(now.getTime() - (ACTIVITE_WINDOW_DAYS + 1) * DAY_MS),
            ),
          ),
        )
    : [];
  const provenKeys = new Set(proofRows.map((p) => `${p.campaignId}:${proofSlotKey(p.receivedAt)}`));
  let scheduled = 0;
  let proven = 0;
  for (const a of allocations) {
    for (const c of a.creneaux) {
      if (c.date < activiteSinceDate) continue;
      if (!isElapsed(c, nowSlot)) continue;
      scheduled += 1;
      if (provenKeys.has(`${a.campaignId}:${slotKey(c.date, c.hour)}`)) proven += 1;
    }
  }
  const activite = scheduled === 0 ? 100 : round2((proven / scheduled) * 100);

  // ── remplissage: engaged seconds ÷ the SCREEN's available seconds, current Tunis week ──
  // CAP-F1 (ruled F3 A, 2026-09-24): F caps each campaign; the screen hour is 3600 s, shared by
  // every campaign, so the fill of the screen is measured against 3600 × open hours × days.
  const weekStart = tunisWeekStart(now);
  // Pure CALENDAR arithmetic in UTC space — a +01:00 anchor sliced through toISOString would
  // land a day early and silently drop Sunday from the week.
  const weekEnd = new Date(new Date(`${weekStart}T00:00:00Z`).getTime() + 7 * DAY_MS)
    .toISOString()
    .slice(0, 10);
  const [venue] = await db
    .select({ openingHour: screenhosts.openingHour, closingHour: screenhosts.closingHour })
    .from(screenhosts)
    .where(eq(screenhosts.id, screenhostId))
    .limit(1);
  const bHours = broadcastableHours(venue?.openingHour ?? null, venue?.closingHour ?? null);
  // Ratification amendment: E2-declared days leave BOTH sides of the ratio — dispatch schedules
  // nothing on them (the numerator is already empty there), so counting them in the denominator
  // would turn honest declaration into a hidden SPS penalty. UNIQUE(screenhost, day) makes the
  // row count the declared-day count.
  const declaredRows = await db
    .select({ day: screenhostUnavailability.day })
    .from(screenhostUnavailability)
    .where(
      and(
        eq(screenhostUnavailability.screenhostId, screenhostId),
        gte(screenhostUnavailability.day, weekStart),
        lt(screenhostUnavailability.day, weekEnd),
      ),
    );
  const availableDays = 7 - declaredRows.length;
  const availableSeconds = SCREEN_SECONDS_PER_HOUR * bHours.length * availableDays;
  let engagedSeconds = 0;
  for (const a of allocations) {
    for (const c of a.creneaux) {
      if (c.date < weekStart || c.date >= weekEnd) continue;
      engagedSeconds += c.reps * a.sSpotSeconds;
    }
  }
  const remplissage =
    availableSeconds === 0 || engagedSeconds === 0
      ? 0
      : round2(Math.min(100, (engagedSeconds / availableSeconds) * 100));

  // ── respect des événements: attested-true ÷ attested, trailing 90 d ────────
  // EV5 — the variable turns REAL. The DEFAULT RULE stands: no attestation at all → 100 (an
  // uninspected venue is never sanctioned — EVENT_RESPECT_DEFAULT is now the empty-set value
  // instead of a constant). A respecte=false attestation is the only thing that can lower it.
  const attestedSince = new Date(now.getTime() - RESPECT_WINDOW_DAYS * DAY_MS);
  const attested = await loadAttested(screenhostId, { since: attestedSince });
  const respected = attested.filter((a) => a.respecte).length;
  const respect_evenements =
    attested.length === 0 ? EVENT_RESPECT_DEFAULT : round2((respected / attested.length) * 100);

  const variables: SpsVariables = {
    acceptation,
    respect_evenements,
    activite,
    remplissage,
  };
  // MEJ-14b — the evidence, alongside the score. The score itself is UNCHANGED: dispatch and the
  // stored snapshot keep reading exactly what they read before.
  const observations: SpsObservations = {
    decided: allDecided.length,
    attested: attested.length,
    scheduledElapsed: scheduled,
    engagedSeconds,
  };
  return { sps: weightedSps(variables, cfg), variables, observations };
};

/** Compute + persist one venue's score (the on-decision hook; failures are the caller's warn). */
export const recomputeVenueSps = async (
  screenhostId: string,
  now = new Date(),
): Promise<number> => {
  const { sps } = await computeSps(screenhostId, now);
  await db
    .update(screenhosts)
    .set({ sps: String(sps) })
    .where(eq(screenhosts.id, screenhostId));
  return sps;
};

/** The daily sweep: every ACTIVE venue's score recomputed + written; ONE summary log line. */
export const runSpsRecomputeTick = async (log: FastifyBaseLogger): Promise<number> => {
  const started = Date.now();
  const venues = await db
    .select({ id: screenhosts.id })
    .from(screenhosts)
    .where(eq(screenhosts.isActive, true));
  let updated = 0;
  for (const v of venues) {
    try {
      await recomputeVenueSps(v.id);
      updated += 1;
    } catch (err) {
      log.warn({ err, screenhostId: v.id }, 'SPS recompute failed for venue');
    }
  }
  log.info({ venues: venues.length, updated, ms: Date.now() - started }, 'SPS daily sweep done');
  return updated;
};

/** Boot run + daily unref'd interval (the house job idiom — no cron dependency). */
export function startSpsRecomputeJob(log: FastifyBaseLogger): void {
  void runSpsRecomputeTick(log).catch((err: unknown) => log.warn({ err }, 'SPS boot sweep failed'));
  const timer = setInterval(
    () => {
      void runSpsRecomputeTick(log).catch((err: unknown) =>
        log.warn({ err }, 'SPS daily sweep failed'),
      );
    },
    24 * 60 * 60 * 1000,
  );
  timer.unref();
}
