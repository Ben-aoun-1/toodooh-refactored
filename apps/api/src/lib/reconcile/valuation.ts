// Reconciliation valuation (L-redisp, Youssef §B) — PURE money math, no DB. The frozen plan promised
// potential impressions per (campaign, screenhost); proof_of_play shows what aired. Value the
// shortfall on the POTENTIAL and apply B.4. Snapshot cpm + s_min are passed in (read from
// campaign_dispatch_plan, NEVER recomputed).
//
// DELIVERY MODEL (V1 = RATIO, not per-créneau time-match): the V1 player LOOPS the playlist (no
// per-créneau scheduling) and proof event_ts is a nullable client clock, so a proof cannot be safely
// attributed to a specific planned (date,hour). Instead delivery_ratio = min(1, delivered_plays /
// expected_plays), applied to ii_potentiel. delivered_plays = VIDEO_ENDED proofs for the (campaign,
// screenhost); expected_plays = Σ créneau.reps (the planned plays). This is monotonic, robust to
// clock skew, and never over-credits (the min(1) cap). Flagged: an exact per-créneau model awaits a
// scheduling-aware player + a trusted timestamp.

// TND at 4-decimal precision (matches the numeric(14,4) money columns + s_min), so the p_perte ≥
// s_min threshold never flips on float noise.
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

export interface AllocationInput {
  screenhostId: string;
  iiPotentiel: number; // a_i — potential impressions allocated to this SH
  expectedPlays: number; // Σ créneau.reps — planned plays
  deliveredPlays: number; // VIDEO_ENDED proofs for (campaign, screenhost)
}

export interface AllocationValuation {
  screenhostId: string;
  expectedImp: number;
  deliveredImp: number;
  manquementImp: number;
  earningsTnd: number; // delivered_imp × cpm/1000 — the SH payable (NOTHING on the undiffused part)
}

// delivery_ratio = min(1, delivered/expected). 0 expected → 0 (nothing planned ⇒ nothing valued; also
// guards divide-by-zero).
export const deliveryRatio = (deliveredPlays: number, expectedPlays: number): number =>
  expectedPlays <= 0 ? 0 : Math.min(1, deliveredPlays / expectedPlays);

export const valueAllocation = (a: AllocationInput, cpm: number): AllocationValuation => {
  const ratio = deliveryRatio(a.deliveredPlays, a.expectedPlays);
  // Floor delivered impressions (conservative: never credit a fractional impression as delivered).
  const deliveredImp = Math.floor(ratio * a.iiPotentiel);
  return {
    screenhostId: a.screenhostId,
    expectedImp: a.iiPotentiel,
    deliveredImp,
    manquementImp: a.iiPotentiel - deliveredImp,
    earningsTnd: round4((deliveredImp * cpm) / 1000),
  };
};

export interface CampaignValuation {
  expectedImp: number;
  deliveredImp: number;
  manquementImp: number;
  pPerteTnd: number;
  refundTnd: number;
  spendTnd: number;
  status: 'reussie' | 'partial';
  perScreenhost: AllocationValuation[];
}

// Aggregate per-allocation valuations + apply B.4 (snapshot cpm + s_min):
//   P_perte    = manquement_imp × cpm/1000
//   refund     = P_perte ≥ s_min ? P_perte : 0   (a sub-S_min shortfall ⇒ RÉUSSIE, NOT refunded —
//                "micro-gaps negligible by design"; the advertiser keeps paying the full budget)
//   budget     = expected_imp × cpm/1000          (the promised spend)
//   spend      = budget − refund                  (the NET the advertiser pays; the wallet nets this)
//   status     = refund > 0 ? partial : réussie
// Net check: refunded (≥S_min) → spend = budget − P_perte = delivered × cpm/1000 (pay for what aired);
// not refunded (<S_min) → spend = budget (the micro-gap is absorbed). V1 = bill-the-delivered.
export const reconcileCampaign = (
  allocations: readonly AllocationInput[],
  cpm: number,
  sMin: number,
): CampaignValuation => {
  const perScreenhost = allocations.map((a) => valueAllocation(a, cpm));
  const expectedImp = perScreenhost.reduce((sum, p) => sum + p.expectedImp, 0);
  const deliveredImp = perScreenhost.reduce((sum, p) => sum + p.deliveredImp, 0);
  const manquementImp = expectedImp - deliveredImp;
  const pPerteTnd = round4((manquementImp * cpm) / 1000);
  const refundTnd = pPerteTnd >= sMin ? pPerteTnd : 0;
  const budgetTnd = round4((expectedImp * cpm) / 1000);
  const spendTnd = round4(budgetTnd - refundTnd);
  return {
    expectedImp,
    deliveredImp,
    manquementImp,
    pPerteTnd,
    refundTnd,
    spendTnd,
    status: refundTnd > 0 ? 'partial' : 'reussie',
    perScreenhost,
  };
};
