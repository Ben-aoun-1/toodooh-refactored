// Reconciliation valuation (L-redisp, Youssef §B) — PURE money math, no DB. The frozen plan promised
// potential impressions per créneau (date, hour); proof_of_play shows what aired. Value the shortfall
// on the potential and apply B.4. Snapshot cpm + s_min are passed in (read from
// campaign_dispatch_plan, NEVER recomputed).
//
// DELIVERY MODEL (FIX A — spam-resistant, binary per créneau on the SERVER clock): a créneau is
// DELIVERED iff ≥1 VIDEO_ENDED proof_of_play for that (campaign, screenhost) has its SERVER received_at
// in that créneau's date+hour (Africa/Tunis). Binary per slot: many proofs in one hour credit it ONCE,
// and a screenhost cannot fabricate more delivered slots than there were real broadcast hours — so it
// can't loop a VIDEO_ENDED to inflate earnings. NOT a raw count, NOT the client event_ts.
//   delivered_imp = Σ impressions of DELIVERED créneaux; manquement_imp = Σ impressions of UNDELIVERED.

// TND at 4-decimal precision (matches the numeric(14,4) money columns + s_min), so threshold/identity
// comparisons never flip on float noise.
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

// Stable "date:hour" key — created here and by the ingest side so a proof bucket matches a créneau.
export const slotKey = (date: string, hour: number): string => `${date}:${hour}`;

export interface ReconCreneau {
  date: string; // YYYY-MM-DD (Africa/Tunis)
  hour: number; // 0–23 (Africa/Tunis)
  impressions: number; // potential impressions for the slot
}

export interface AllocationInput {
  screenhostId: string;
  creneaux: readonly ReconCreneau[];
  // The set of slotKey(date,hour) the SH actually aired (≥1 VIDEO_ENDED whose received_at is in it).
  deliveredSlots: ReadonlySet<string>;
}

export interface AllocationValuation {
  screenhostId: string;
  expectedImp: number; // Σ créneau.impressions (PHYSICAL — the créneaux unit)
  deliveredImp: number; // Σ impressions of DELIVERED créneaux (PHYSICAL)
  manquementImp: number; // expected − delivered
  earningsTnd: number; // round4(delivered_imp × T × cpm/1000) — the SH payable, SOURCE OF TRUTH (FIX B)
}

// Per-(campaign, screenhost): binary per créneau, valued on the potential. Earnings keep their
// BASIS (each SH is paid only its DELIVERED créneaux — nothing on the undiffused part; a
// defaulter's undelivered share stays unpaid, US-3.7's payment half). E6: the VALUE unit is
// FACTURABLE (physical × the plan's frozen T) — the unit the advertiser is billed in, so the
// campaign-level conservation identity holds in one currency. Pre-E1 plans carry T = 1.0 and are
// numerically unchanged.
export const valueAllocation = (a: AllocationInput, cpm: number, t = 1): AllocationValuation => {
  let expectedImp = 0;
  let deliveredImp = 0;
  for (const c of a.creneaux) {
    expectedImp += c.impressions;
    if (a.deliveredSlots.has(slotKey(c.date, c.hour))) deliveredImp += c.impressions;
  }
  return {
    screenhostId: a.screenhostId,
    expectedImp,
    deliveredImp,
    manquementImp: expectedImp - deliveredImp,
    earningsTnd: round4((deliveredImp * t * cpm) / 1000),
  };
};

// FCT2 (US-FCT-11) — the monthly-consumption sum: PROOF-VERIFIED facturable impressions whose
// créneau date falls in [from, to] (inclusive ISO YYYY-MM-DD, Africa/Tunis — the créneau's own
// calendar date IS the attribution key; a proof can only ever credit its own slot's date, so no
// cross-month leak is possible). The exact logical complement of E6's detectMissedSlots: same
// créneaux, same deliveredSlots gate, same PHYSICAL unit × the plan's frozen T — unfloored, the
// reconcile convention (valueAllocation), never the E6 detector's Math.floor. An UNPROVEN créneau
// contributes NOTHING: engaged-but-undelivered is not consumption.
export const deliveredFacturableInRange = (
  allocations: readonly AllocationInput[],
  t: number,
  from: string,
  to: string,
): number => {
  let physical = 0;
  for (const a of allocations) {
    for (const c of a.creneaux) {
      if (c.date < from || c.date > to) continue;
      if (!a.deliveredSlots.has(slotKey(c.date, c.hour))) continue;
      physical += c.impressions;
    }
  }
  return physical * t;
};

// E6 — the redispatch context the NET settlement needs. Defaults reproduce the pre-E6 math
// exactly (t 1, no reliquat, nothing replaced), so pre-E6 callers/fixtures are untouched.
export interface ReconcileNetOpts {
  /** The plan's frozen attention index (t_tier_coef) — physical → facturable. */
  t?: number;
  /** The plan's CURRENT reliquat_stocke: promised volume never allocated NOR replaced. */
  reliquatStockeFact?: number;
  /** Σ over redispatch rounds of (placed_fact − reliquat_consumed_fact): the missed-sourced
   * placements whose ORIGINAL créneaux still sit in the plan — the double-count the NET math
   * removes so a replaced-and-delivered slot can never also be refunded. */
  replacedMissedFact?: number;
}

export interface CampaignValuation {
  expectedImp: number;
  deliveredImp: number;
  manquementImp: number;
  /** E6 — the NET loss value (gross missed facturable − replaced + stored reliquat), the refund gate. */
  pPerteTnd: number;
  refundTnd: number;
  spendTnd: number;
  status: 'reussie' | 'partial';
  perScreenhost: AllocationValuation[];
}

// Aggregate + apply B.4, NET (E6) and money-conserving (FIX B):
//   gross_gap_fact = manquement_imp × T
//   net_gap_fact   = max(0, gross_gap_fact − replaced_missed) + reliquat_stocke
//   P_perte(NET)   = net_gap_fact × cpm/1000              — drives the S_min refund gate
//   budget         = (expected_imp × T − replaced_missed + reliquat_stocke) × cpm/1000
//                    (the ORIGINAL promise: redispatch additions live in expected, so the
//                     replaced volume is deducted once; the stored crumb the advertiser bought is
//                     added — never delivered, never replaced, it is in the gap BY CONSTRUCTION)
//   refund         = P_perte ≥ s_min ? max(0, budget − Σ earnings) : 0
//   spend          = budget − refund
// CONSERVATION IDENTITY: spend = Σ payouts + (refund > 0 ? 0 : unrefunded net gap) — a refunding
// settlement debits EXACTLY what the screenhosts earned; a RÉUSSIE keeps the sub-S_min net gap
// with the platform. budget − Σ earnings ≡ the net gap value by algebra (expected − delivered =
// manquement), so no slot is ever refunded twice: a replaced-and-delivered slot raises delivered
// AND is deducted from the promise once.
export const reconcileCampaign = (
  allocations: readonly AllocationInput[],
  cpm: number,
  sMin: number,
  opts: ReconcileNetOpts = {},
): CampaignValuation => {
  const t = opts.t ?? 1;
  const reliquatStockeFact = opts.reliquatStockeFact ?? 0;
  const replacedMissedFact = opts.replacedMissedFact ?? 0;

  const perScreenhost = allocations.map((a) => valueAllocation(a, cpm, t));
  const expectedImp = perScreenhost.reduce((sum, p) => sum + p.expectedImp, 0);
  const deliveredImp = perScreenhost.reduce((sum, p) => sum + p.deliveredImp, 0);
  const manquementImp = expectedImp - deliveredImp;

  const grossGapFact = manquementImp * t;
  const netGapFact = Math.max(0, grossGapFact - replacedMissedFact) + reliquatStockeFact;
  const pPerteTnd = round4((netGapFact * cpm) / 1000);
  const budgetTnd = round4(
    ((expectedImp * t - replacedMissedFact + reliquatStockeFact) * cpm) / 1000,
  );
  const sumEarningsTnd = round4(perScreenhost.reduce((sum, p) => sum + p.earningsTnd, 0));
  // refund = budget − Σ earnings (NOT P_perte): makes spend == Σ earnings exactly for a PARTIAL.
  const refundTnd = pPerteTnd >= sMin ? Math.max(0, round4(budgetTnd - sumEarningsTnd)) : 0;
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
