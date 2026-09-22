import { type ResolvedDispatchConfig } from './config.js';
import { type BuiltPlan, buildPlan } from './plan.js';
import { type AssemblePoolResult } from './pool.js';

// IMP-EST1 — the step of runDispatch between the pool and the freeze, extracted VERBATIM so the
// « Impressions estimées » dry-run (lib/impressions-estimate.ts) reaches its verdict through the
// SAME code: buildPlan over the assembled pool, then the two clôtures in the order runDispatch has
// always checked them. PURE — no I/O, no clock. runDispatch's behaviour is unchanged: it returns
// the refusals below as it did, and freezes `built` on OK.

/** The engine inputs the plan is built against (the campaign's own CPM, S, T and derived seuil). */
export interface PlanStepInputs {
  iCible: number;
  cpm: number;
  s: number;
  /** E1 — the attention index T for S (tForDuration over the campaign's own tiers). */
  t: number;
  /** E3 — the value-based anti-miette seuil, seuilImpressions(cpm). */
  seuil: number;
}

export type PlanStepOutcome =
  | { status: 'TOO_THIN'; nMin: number; nMax: number }
  | { status: 'NO_ELIGIBLE'; saturated: boolean }
  | { status: 'OK'; built: BuiltPlan };

export const planFromPool = (
  inputs: PlanStepInputs,
  config: Pick<ResolvedDispatchConfig, 'gMois' | 'joursActifs' | 'rMinEfficace' | 'fMaxSeconds'>,
  assembled: AssemblePoolResult,
): PlanStepOutcome => {
  const { windowDays, pool, candidateCount } = assembled;
  const built = buildPlan({
    iCible: inputs.iCible,
    cpm: inputs.cpm,
    s: inputs.s,
    t: inputs.t,
    seuilDiffusable: inputs.seuil,
    gMois: config.gMois,
    joursActifs: config.joursActifs,
    rMinEfficace: config.rMinEfficace,
    fMaxSeconds: config.fMaxSeconds,
    windowDays,
    pool,
  });

  // Clôture: a too-thin (N_min>N_max / empty pool) or no-allocation result is NOT a deliverable
  // plan — do NOT freeze it. Freezing an empty plan + the unique index would lock the campaign
  // forever; instead return the clôture alert so the advertiser can adjust the cursor / targeting
  // and re-dispatch (renvoi curseur). A genuine PARTIAL (nRetenus>0, not too-thin) IS delivered → frozen.
  // CF-HF4 — an EMPTY pool is an INVENTORY refusal, not a materiality one: candidates
  // existed but every one fell to capacity/days (saturated — « réessayez avec une autre
  // période ») vs the targeting matching nothing at all. TOO_THIN keeps meaning what its
  // message says (N_min > N_max on a real pool).
  if (pool.length === 0) return { status: 'NO_ELIGIBLE', saturated: candidateCount > 0 };
  if (built.isTooThin) return { status: 'TOO_THIN', nMin: built.nMin, nMax: built.nMax };
  if (built.nRetenus === 0) return { status: 'NO_ELIGIBLE', saturated: candidateCount > 0 };
  return { status: 'OK', built };
};
