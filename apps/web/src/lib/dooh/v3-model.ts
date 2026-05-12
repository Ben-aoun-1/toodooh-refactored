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
