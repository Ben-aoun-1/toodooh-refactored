import { type DetectorAllocation, detectMissedSlots, tunisNowSlot } from './dispatch/redispatch.js';

// NET-IMP1 (Mejri 2026-08-04, ruled): « Impressions affichées = Impressions prédites −
// Impressions perdues » — impressions lost while the venue was not airing are redispatched to
// another host and must never count twice, while rémunération stays predicted-based. THE ONE
// computation home: every owner-facing « impressions générées » figure derives here (the web's
// lib/impressions-display.ts mirrors it over the wire field).
//
// UNIT: PHYSICAL impressions (the créneaux unit) end to end — the payout rows' expected_imp /
// delivered_imp are Σ créneau.impressions (valuation.ts), and the E6 detector's imp_physical is
// the same unit. T converts to VALUE (earnings/facturation) and never touches these figures.
//
// « Perdues » = the engine's manquement notion (E6): elapsed créneaux without a delivered proof,
// whether or not the day was declared in screenhost_unavailability — declared days ride the same
// manquement path (R1, deliberate interpretation, flagged to Mejri for veto).

/**
 * SETTLED rows (campaign_screenhost_payout): reconcile's own arithmetic gives
 * affichées = expected − manquement = expected − (expected − delivered) = delivered.
 * Displayed converges to reality at clôture — pinned by test against valueAllocation.
 */
export const displayImpressionsSettled = (line: {
  expectedImp: number;
  deliveredImp: number;
}): number => line.deliveredImp;

export interface InFlightAllocation {
  screenhostId: string;
  creneaux: readonly { date: string; hour: number; impressions: number }[];
}

/**
 * « Prédites » for ONE allocation: Σ créneau.impressions — the FULL plan promise, PHYSICAL.
 * THE sum itself, so the in-flight display below and every other caller (IMP-EST1's dry-run
 * estimate, lib/impressions-estimate.ts) read the same definition: should « prédites » ever stop
 * counting a créneau class, it changes HERE and both move together.
 */
export const predictedImpressionsOf = (allocation: {
  creneaux: readonly { impressions: number }[];
}): number => allocation.creneaux.reduce((sum, c) => sum + c.impressions, 0);

/** « Prédites » for a whole plan (simulated or frozen): Σ allocations Σ créneau.impressions. */
export const predictedImpressions = (
  allocations: readonly { creneaux: readonly { impressions: number }[] }[],
): number => allocations.reduce((sum, a) => sum + predictedImpressionsOf(a), 0);

export interface InFlightDisplay {
  screenhostId: string;
  /** Σ créneau.impressions — the FULL plan promise (future créneaux still count). */
  predictedImp: number;
  /** Elapsed ∧ undelivered so far — the E6 detector's buckets, reused verbatim. */
  missedImp: number;
  /** affichées = predicted − missed-so-far. */
  displayImp: number;
}

/**
 * IN-FLIGHT campaigns: affichées = full predicted − missed-so-far, per venue. PURE — the caller
 * loads `deliveredBySh` via lib/reconcile/delivered-slots.ts (loadDeliveredSlots), exactly like
 * the redispatch round does; the bucketing IS detectMissedSlots (never reimplemented), so the
 * displayed figure and the engine's manquement can never disagree. Redispatched-and-placed
 * impressions need no special handling here: they arrive at the receiving venue as real plan
 * créneaux and ride its predicted (R5, pinned by the two-venue conservation fixture).
 */
export const displayImpressionsInFlight = (
  allocations: readonly InFlightAllocation[],
  deliveredBySh: ReadonlyMap<string, ReadonlySet<string>>,
  now: Date,
): InFlightDisplay[] => {
  const nowSlot = tunisNowSlot(now);
  const detectorInput: DetectorAllocation[] = allocations.map((a) => ({
    screenhostId: a.screenhostId,
    creneaux: a.creneaux,
    deliveredSlots: deliveredBySh.get(a.screenhostId) ?? new Set<string>(),
  }));
  const detected = detectMissedSlots(detectorInput, nowSlot);
  const missedBySh = new Map(detected.perScreenhost.map((m) => [m.screenhost_id, m.imp_physical]));
  return allocations.map((a) => {
    const predictedImp = predictedImpressionsOf(a);
    const missedImp = missedBySh.get(a.screenhostId) ?? 0;
    return {
      screenhostId: a.screenhostId,
      predictedImp,
      missedImp,
      displayImp: predictedImp - missedImp,
    };
  });
};
