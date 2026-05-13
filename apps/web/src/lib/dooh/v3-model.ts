/**
 * TOODOOH DOOH pricing — v3.0 model (pure functions).
 *
 * This module is the project's pricing IP. Every function here is pure: deterministic output
 * from inputs, no I/O, no module-level side effects, no Date.now()/Math.random(). It is written
 * to move to `apps/api/` verbatim when Phase 1 starts.
 *
 * Behavioral reference: `docs/handoff/Toodooh_Simulateur_Pricing_v3.html` (the simulator's
 * <script> section). See `./README.md` for the function↔simulator mapping, the model vocabulary,
 * the documented assumptions, and the demo-screenhost test fixtures.
 *
 * This module is currently UNWIRED — nothing in the app imports it. Wiring it into the
 * wizard/cart/screenhost flows (and the schema it needs) is Phase 1 work; see
 * `docs/handoff/v3-data-requirements.md`.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Config — every value here is a parameter, never hardcoded in a formula.
// Defaults from `docs/handoff/pricing-model-v3.md`.
// ─────────────────────────────────────────────────────────────────────────────

export type DoohConfigV3 = {
  /** CPM — cost per 1000 impressions, TND. */
  cpmTnd: number;
  /** CPM_evt = cpmTnd × this. */
  cpmEventCoefficient: number;
  /** F — caps spot repetition to one every F seconds (the frequency ceiling on repeats/hour is F/s). */
  frequencyCapSecondsPerHour: number;
  /** Credibility ceilings on impressions/hour by spot length. */
  credibilityThresholds: {
    /** Spots ≤ this many seconds use `shortValue`. */
    shortMaxSeconds: number;
    shortValue: number;
    /** Spots ≤ this many seconds (and > shortMaxSeconds) use `mediumValue`. */
    mediumMaxSeconds: number;
    mediumValue: number;
    /** Spots > mediumMaxSeconds use `longValue`. */
    longValue: number;
  };
  /** SPS criterion weights — must sum to 1. */
  spsWeights: {
    txAccept: number; // w1
    txRespectEvt: number; // w2
    txActivite: number; // w3
    qualiteCapteur: number; // w4
    anciennete: number; // w5
    txRemplissage: number; // w6
  };
  /** SPS → colour band cutoffs (0..100): ≥ greenMinScore → 'green'; ≥ yellowMinScore → 'yellow'; else 'red'. */
  spsColorBands: { greenMinScore: number; yellowMinScore: number };
  /** Revenue split — must sum to 1. */
  revenueSplit: { screenhost: number; toodooh: number; agentSh: number; agentSc: number };
  /** Event window padding, hours, applied on EACH side of the match (window = padding + duration + padding). */
  eventWindowPaddingHours: number;
};

export const DEFAULT_DOOH_CONFIG_V3: DoohConfigV3 = {
  cpmTnd: 15,
  cpmEventCoefficient: 2, // CPM_evt = 30
  frequencyCapSecondsPerHour: 300,
  credibilityThresholds: {
    shortMaxSeconds: 10,
    shortValue: 0.5,
    mediumMaxSeconds: 20,
    mediumValue: 0.65,
    longValue: 0.8,
  },
  spsWeights: {
    txAccept: 0.25,
    txRespectEvt: 0.3,
    txActivite: 0.2,
    qualiteCapteur: 0.1,
    anciennete: 0.05,
    txRemplissage: 0.1,
  },
  spsColorBands: { greenMinScore: 75, yellowMinScore: 50 },
  revenueSplit: { screenhost: 0.5, toodooh: 0.44, agentSh: 0.03, agentSc: 0.03 },
  eventWindowPaddingHours: 1,
};

// ─────────────────────────────────────────────────────────────────────────────
// Spot length and repetition rate
// ─────────────────────────────────────────────────────────────────────────────

export const MIN_SPOT_SECONDS = 1;
export const MAX_SPOT_SECONDS = 30;

/** Simulator `clampS()`: spot length is constrained to [1, 30] seconds. */
export function clampSpotSeconds(seconds: number): number {
  if (!Number.isFinite(seconds)) return MIN_SPOT_SECONDS;
  return Math.min(MAX_SPOT_SECONDS, Math.max(MIN_SPOT_SECONDS, seconds));
}

/** Simulator `getT(s)`: credibility ceiling for a spot of `seconds`. */
export function credibilityThreshold(seconds: number, config: DoohConfigV3): number {
  const s = clampSpotSeconds(seconds);
  const t = config.credibilityThresholds;
  if (s <= t.shortMaxSeconds) return t.shortValue;
  if (s <= t.mediumMaxSeconds) return t.mediumValue;
  return t.longValue;
}

export type RepetitionRate = {
  /** R — billable spot repetitions per hour. */
  rate: number;
  /** Which ceiling is binding. */
  limitedBy: 'frequency' | 'credibility';
};

/**
 * Simulator `getR(s) = min((3600/s)·T(s), F/s)`.
 * `R_T = (3600/s)·T` is the credibility ceiling; `R_F = F/s` is the frequency ceiling.
 */
export function repetitionRate(seconds: number, config: DoohConfigV3): RepetitionRate {
  const s = clampSpotSeconds(seconds);
  const rCredibility = (3600 / s) * credibilityThreshold(s, config);
  const rFrequency = config.frequencyCapSecondsPerHour / s;
  if (rFrequency <= rCredibility) return { rate: rFrequency, limitedBy: 'frequency' };
  return { rate: rCredibility, limitedBy: 'credibility' };
}

// ─────────────────────────────────────────────────────────────────────────────
// Screenhost performance score (SPS)
// ─────────────────────────────────────────────────────────────────────────────

export type ScreenhostCriteria = {
  acceptanceRate: number; // txAccept,  0..1
  eventRespectRate: number; // txRespectEvt
  activityRate: number; // txActivite
  sensorQuality: number; // qualiteCapteur
  seniority: number; // anciennete
  fillRate: number; // txRemplissage
};

/** Simulator `calcSPS(sh)`: weighted sum of the six criteria, scaled to 0..100. */
export function screenhostPerformanceScore(c: ScreenhostCriteria, config: DoohConfigV3): number {
  const w = config.spsWeights;
  return (
    (w.txAccept * c.acceptanceRate +
      w.txRespectEvt * c.eventRespectRate +
      w.txActivite * c.activityRate +
      w.qualiteCapteur * c.sensorQuality +
      w.anciennete * c.seniority +
      w.txRemplissage * c.fillRate) *
    100
  );
}

export type SpsColorBand = 'green' | 'yellow' | 'red';

/** Simulator `spsColor(sps)`: ≥ greenMinScore → 'green'; ≥ yellowMinScore → 'yellow'; else 'red'. */
export function spsColorBand(sps: number, config: DoohConfigV3): SpsColorBand {
  if (sps >= config.spsColorBands.greenMinScore) return 'green';
  if (sps >= config.spsColorBands.yellowMinScore) return 'yellow';
  return 'red';
}

// ─────────────────────────────────────────────────────────────────────────────
// Screenhost input for campaign math (used by computeStandardCampaign / computeEventCampaign — 4b.2/4b.3)
// ─────────────────────────────────────────────────────────────────────────────

export type ScreenhostInput = ScreenhostCriteria & {
  id: string;
  name?: string;
  /** Ei — operating hours per day. */
  operatingHoursPerDay: number;
  /** Ai — regular affluence (people/hour). */
  affluencePerHour: number;
  /** A_max — historical maximum affluence (people/hour); used for event impressions only. */
  historicalMaxAffluence: number;
  /** Oi — already-sold spot slots over the campaign period. */
  soldSlotsInPeriod: number;
  /** Refused this campaign → 0 revenue, excluded from I_max (cascade). */
  refused: boolean;
  /** eligibleEvt — participates in events. */
  eventEligible: boolean;
};

/** A screenhost dropped from a campaign (refused, or — for events — not event-eligible): 0 revenue. */
export type ExcludedScreenhost = { id: string; name?: string; sps: number };

// ─────────────────────────────────────────────────────────────────────────────
// Standard campaign — simulator `recalcNormale()`
// ─────────────────────────────────────────────────────────────────────────────

export type StandardScreenhostAllocation = {
  id: string;
  name?: string;
  sps: number;
  /** 1-based rank by SPS descending (cascade priority order). */
  rank: number;
  /** Hi = max(0, Ei·N − Oi − evtSlots). */
  netAvailabilityHours: number;
  /** Ii = Ai·Hi·R. */
  impressions: number;
  /** Ii / I_max (0 when I_max = 0). */
  impressionShare: number;
};

export type StandardCampaignResult = {
  /** R — repetitions per hour for this content length. */
  repetitionRate: number;
  /** Accepting screenhosts, sorted by SPS descending. */
  accepting: readonly StandardScreenhostAllocation[];
  /** Refused screenhosts (0 revenue, excluded from I_max). */
  refused: readonly ExcludedScreenhost[];
  /** I_max = Σ Ii over accepting screenhosts. */
  maxImpressions: number;
  /** C_max = CPM·I_max/1000. */
  maxBudgetTnd: number;
};

/**
 * Simulator `recalcNormale()`: per-screenhost net availability, impressions, the I_max / C_max
 * envelope, and the SPS-ranked accepting list with refused screenhosts cascaded out.
 *
 * `eventSlotsBlockedHours` is the Hi formula's `evtSlots` term — 0 for a standard campaign run on
 * its own; pass the window of a co-selected event to model the simulator's evtSlots blackout.
 */
export function computeStandardCampaign(
  screenhosts: readonly ScreenhostInput[],
  contentSeconds: number,
  daysCount: number,
  config: DoohConfigV3,
  eventSlotsBlockedHours = 0,
): StandardCampaignResult {
  const R = repetitionRate(contentSeconds, config).rate;
  const N = Math.max(0, daysCount);
  const evtSlots = Math.max(0, eventSlotsBlockedHours);

  const refused: ExcludedScreenhost[] = screenhosts
    .filter((s) => s.refused)
    .map((s) => ({ id: s.id, name: s.name, sps: screenhostPerformanceScore(s, config) }));

  const acceptingRaw = screenhosts
    .filter((s) => !s.refused)
    .map((s) => {
      const sps = screenhostPerformanceScore(s, config);
      const Hi = Math.max(0, s.operatingHoursPerDay * N - s.soldSlotsInPeriod - evtSlots);
      const Ii = Math.max(0, s.affluencePerHour) * Hi * R;
      return { id: s.id, name: s.name, sps, netAvailabilityHours: Hi, impressions: Ii };
    })
    .sort((a, b) => b.sps - a.sps || a.id.localeCompare(b.id));

  const maxImpressions = acceptingRaw.reduce((acc, s) => acc + s.impressions, 0);
  const accepting: StandardScreenhostAllocation[] = acceptingRaw.map((s, i) => ({
    ...s,
    rank: i + 1,
    impressionShare: maxImpressions > 0 ? s.impressions / maxImpressions : 0,
  }));

  return {
    repetitionRate: R,
    accepting,
    refused,
    maxImpressions,
    maxBudgetTnd: (config.cpmTnd * maxImpressions) / 1000,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Revenue split — 50/44/3/3 — simulator `rep-amounts-*`
// ─────────────────────────────────────────────────────────────────────────────

export type RevenueSplit = {
  /** Amount, TND, going to the screenhost pool (then distributed by impression share). */
  screenhost: number;
  toodooh: number;
  agentSh: number;
  agentSc: number;
};

/** Split an amount across the four parties using `config.revenueSplit`. Negative amounts → 0. */
export function splitRevenue(amountTnd: number, config: DoohConfigV3): RevenueSplit {
  const a = Math.max(0, amountTnd);
  const r = config.revenueSplit;
  return {
    screenhost: a * r.screenhost,
    toodooh: a * r.toodooh,
    agentSh: a * r.agentSh,
    agentSc: a * r.agentSc,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Budget application — simulator slider + per-screenhost revenue
// ─────────────────────────────────────────────────────────────────────────────

export type BudgetAllocation = {
  /** C_cible — requested budget clamped to [0, C_max]. */
  targetBudgetTnd: number;
  /** I_cible = C_cible·1000/CPM (the CPM is the standard CPM here, CPM_evt for `applyEventBudget`). */
  purchasedImpressions: number;
  /** taux_fill = C_cible / C_max (0 when C_max = 0). */
  fillRate: number;
  /** Split of C_cible. */
  split: RevenueSplit;
  /** Per accepting screenhost: revenue (= screenhost pool × share) and `share` (= impression share). */
  perScreenhost: readonly { id: string; name?: string; revenueTnd: number; share: number }[];
};

function allocateBudget(
  cpmTnd: number,
  maxBudgetTnd: number,
  accepting: readonly { id: string; name?: string; impressionShare: number }[],
  requestedBudgetTnd: number,
  config: DoohConfigV3,
): BudgetAllocation {
  const cCible = Math.min(Math.max(0, requestedBudgetTnd), maxBudgetTnd);
  const split = splitRevenue(cCible, config);
  return {
    targetBudgetTnd: cCible,
    purchasedImpressions: cpmTnd > 0 ? (cCible * 1000) / cpmTnd : 0,
    fillRate: maxBudgetTnd > 0 ? cCible / maxBudgetTnd : 0,
    split,
    perScreenhost: accepting.map((s) => ({
      id: s.id,
      name: s.name,
      share: s.impressionShare,
      revenueTnd: split.screenhost * s.impressionShare,
    })),
  };
}

/** Given a standard-campaign result and a requested budget, clamp to C_max and distribute. */
export function applyBudget(
  result: StandardCampaignResult,
  targetBudgetTnd: number,
  config: DoohConfigV3,
): BudgetAllocation {
  return allocateBudget(
    config.cpmTnd,
    result.maxBudgetTnd,
    result.accepting,
    targetBudgetTnd,
    config,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Event campaign — simulator `recalcEvenement()`
// ─────────────────────────────────────────────────────────────────────────────

export type EventScreenhostAllocation = {
  id: string;
  name?: string;
  sps: number;
  /** 1-based rank by SPS descending. */
  rank: number;
  /** Hi_evt — event window in hours (same for all). */
  windowHours: number;
  /** Ii_evt = A_max·Hi_evt·R (uses historicalMaxAffluence, not regular affluence). */
  impressions: number;
  /** Ii_evt / I_evt_max (0 when I_evt_max = 0). */
  impressionShare: number;
};

export type EventCampaignResult = {
  /** R — repetitions per hour for this content length. */
  repetitionRate: number;
  /** Hi_evt = paddingBefore + duration + paddingAfter (padding = config.eventWindowPaddingHours, each side). */
  windowHours: number;
  /** CPM_evt = CPM × config.cpmEventCoefficient. */
  eventCpmTnd: number;
  /** Eligible (eventEligible && !refused) screenhosts, sorted by SPS descending. */
  accepting: readonly EventScreenhostAllocation[];
  /** Refused screenhosts (0 revenue). */
  refused: readonly ExcludedScreenhost[];
  /** Not event-eligible screenhosts (0 revenue; distinct from refused). */
  ineligible: readonly ExcludedScreenhost[];
  /** I_evt_max = Σ Ii_evt over accepting screenhosts. */
  maxImpressions: number;
  /** C_evt_max = CPM_evt·I_evt_max/1000. */
  maxBudgetTnd: number;
};

/**
 * Simulator `recalcEvenement()`: event window = padding + duration + padding; only
 * `eventEligible && !refused` screenhosts participate; impressions use A_max (not regular
 * affluence); priced at CPM × `config.cpmEventCoefficient`.
 */
export function computeEventCampaign(
  screenhosts: readonly ScreenhostInput[],
  contentSeconds: number,
  eventDurationHours: number,
  config: DoohConfigV3,
): EventCampaignResult {
  const R = repetitionRate(contentSeconds, config).rate;
  const windowHours =
    config.eventWindowPaddingHours +
    Math.max(0, eventDurationHours) +
    config.eventWindowPaddingHours;
  const eventCpmTnd = config.cpmTnd * config.cpmEventCoefficient;

  const refused: ExcludedScreenhost[] = screenhosts
    .filter((s) => s.refused)
    .map((s) => ({ id: s.id, name: s.name, sps: screenhostPerformanceScore(s, config) }));
  const ineligible: ExcludedScreenhost[] = screenhosts
    .filter((s) => !s.refused && !s.eventEligible)
    .map((s) => ({ id: s.id, name: s.name, sps: screenhostPerformanceScore(s, config) }));

  const acceptingRaw = screenhosts
    .filter((s) => !s.refused && s.eventEligible)
    .map((s) => {
      const sps = screenhostPerformanceScore(s, config);
      const Ii = Math.max(0, s.historicalMaxAffluence) * windowHours * R;
      return { id: s.id, name: s.name, sps, windowHours, impressions: Ii };
    })
    .sort((a, b) => b.sps - a.sps || a.id.localeCompare(b.id));

  const maxImpressions = acceptingRaw.reduce((acc, s) => acc + s.impressions, 0);
  const accepting: EventScreenhostAllocation[] = acceptingRaw.map((s, i) => ({
    ...s,
    rank: i + 1,
    impressionShare: maxImpressions > 0 ? s.impressions / maxImpressions : 0,
  }));

  return {
    repetitionRate: R,
    windowHours,
    eventCpmTnd,
    accepting,
    refused,
    ineligible,
    maxImpressions,
    maxBudgetTnd: (eventCpmTnd * maxImpressions) / 1000,
  };
}

/** Given an event-campaign result and a requested budget, clamp to C_evt_max and distribute. */
export function applyEventBudget(
  result: EventCampaignResult,
  targetBudgetTnd: number,
  config: DoohConfigV3,
): BudgetAllocation {
  return allocateBudget(
    result.eventCpmTnd,
    result.maxBudgetTnd,
    result.accepting,
    targetBudgetTnd,
    config,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Mixed cart — standard + event in one campaign (simulator's combined view)
// ─────────────────────────────────────────────────────────────────────────────

export type CombinedCartInput = {
  screenhosts: readonly ScreenhostInput[];
  /** Standard portion. Omit (or pass null) when the cart has no standard component. */
  standard?: {
    contentSeconds: number;
    daysCount: number;
    /** Requested budget for the standard portion; omit to leave `standardBudget` null. */
    targetBudgetTnd?: number;
  } | null;
  /** Event portion. Omit (or pass null) when the cart has no event component. */
  event?: {
    contentSeconds: number;
    durationHours: number;
    /** Requested budget for the event portion; omit to leave `eventBudget` null. */
    targetBudgetTnd?: number;
  } | null;
};

export type CombinedCartResult = {
  standard: StandardCampaignResult | null;
  event: EventCampaignResult | null;
  standardBudget: BudgetAllocation | null;
  eventBudget: BudgetAllocation | null;
  /** C_max_total = standard.maxBudgetTnd + event.maxBudgetTnd. */
  totalMaxBudgetTnd: number;
  /** C_cible_total = standardBudget.targetBudgetTnd + eventBudget.targetBudgetTnd. */
  totalTargetBudgetTnd: number;
};

/**
 * Combine a standard + event portion into one cart.
 *
 * The event is computed first; its `windowHours` is then fed into the standard run as
 * `eventSlotsBlockedHours`, so the standard portion already accounts for the event's
 * blackout on every screenhost (matching the simulator's evtSlots wiring).
 */
export function combineCart(input: CombinedCartInput, config: DoohConfigV3): CombinedCartResult {
  const event = input.event
    ? computeEventCampaign(
        input.screenhosts,
        input.event.contentSeconds,
        input.event.durationHours,
        config,
      )
    : null;

  const standard = input.standard
    ? computeStandardCampaign(
        input.screenhosts,
        input.standard.contentSeconds,
        input.standard.daysCount,
        config,
        event?.windowHours ?? 0,
      )
    : null;

  const standardBudget =
    standard && input.standard?.targetBudgetTnd !== undefined
      ? applyBudget(standard, input.standard.targetBudgetTnd, config)
      : null;

  const eventBudget =
    event && input.event?.targetBudgetTnd !== undefined
      ? applyEventBudget(event, input.event.targetBudgetTnd, config)
      : null;

  return {
    standard,
    event,
    standardBudget,
    eventBudget,
    totalMaxBudgetTnd: (standard?.maxBudgetTnd ?? 0) + (event?.maxBudgetTnd ?? 0),
    totalTargetBudgetTnd:
      (standardBudget?.targetBudgetTnd ?? 0) + (eventBudget?.targetBudgetTnd ?? 0),
  };
}
