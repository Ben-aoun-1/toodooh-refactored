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
  expectedImp: number; // Σ créneau.impressions
  deliveredImp: number; // Σ impressions of DELIVERED créneaux
  manquementImp: number; // expected − delivered
  earningsTnd: number; // round4(delivered_imp × cpm/1000) — the SH payable, the SOURCE OF TRUTH (FIX B)
}

// Per-(campaign, screenhost): binary per créneau, valued on the potential. Earnings are the rounded
// per-SH figure — NOTHING on the undiffused part.
export const valueAllocation = (a: AllocationInput, cpm: number): AllocationValuation => {
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

// Aggregate + apply B.4 with MONEY CONSERVATION (FIX B — per-SH rounded earnings are the single source
// of truth, so the screencaster debit equals Σ screenhost earnings to the cent):
//   budget  = expected_imp × cpm/1000
//   P_perte = manquement_imp × cpm/1000                 (the gap value — drives the s_min threshold)
//   refund  = P_perte ≥ s_min ? (budget − Σ earnings) : 0
//   spend   = budget − refund
// ⇒ PARTIAL (P_perte ≥ s_min): spend = Σ earnings EXACTLY (conserves). RÉUSSIE (sub-s_min gap): refund
//   0, spend = budget — the platform keeps the recorded micro-gap. Snapshot cpm + s_min never recomputed.
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
  const budgetTnd = round4((expectedImp * cpm) / 1000);
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
