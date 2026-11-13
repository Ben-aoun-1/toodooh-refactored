import { type ToursPlanDetail } from '../../../db/schema.js';
import { NOOP_TRACE, type EngineTrace } from '../../engine-journal/trace.js';
import { SEUIL_SH_TND } from '../../vf-constants.js';
import { getDispatchConfig } from '../config.js';
import { computeR } from '../eligibility.js';
import { type DbExecutor } from '../pool.js';

import { type AssembleToursOpts, type ToursPool, assembleToursPool } from './assemble.js';
import { type Calcul, type CalculParams, couper, precalculer } from './calculer.js';
import { buildToursDetail } from './detail.js';

// DISP-TOURS — ONE calculation of a campaign by the tours engine, from the DB to the admin
// snapshot: the cart (at every opening, R12), the budget cursor's ceiling, the « impressions
// estimées », the admin fiche and the launch (R13) all call this, so the advertiser, the admin
// and the frozen plan can never see different figures for the same state.

export interface ToursCampaignInputs {
  /** The spot length S (seconds). */
  s: number;
  /** T for S (tForDuration over the campaign's own tiers). */
  t: number;
  /** The campaign's own CPM. */
  cpm: number;
  /** The targeted budget (the cart's « budget visé »); Infinity = the maximum. */
  budgetTnd: number;
}

export interface ToursCampaignCalcul {
  pool: ToursPool;
  params: CalculParams & { fMaxSeconds: number; s: number; capHeure: number };
  calcul: Calcul;
  detail: ToursPlanDetail;
}

export const calculerCampagne = async (
  executor: DbExecutor,
  campaign: { id: string; startDate: string; endDate: string },
  inputs: ToursCampaignInputs,
  opts: Omit<AssembleToursOpts, 'trace'> & { trace?: EngineTrace; now?: Date },
): Promise<ToursCampaignCalcul> => {
  const trace = opts.trace ?? NOOP_TRACE;
  const config = await getDispatchConfig();
  const t0 = performance.now();
  const pool = await assembleToursPool(executor, campaign, config.fMaxSeconds, {
    ...opts,
    trace,
  });
  const t1 = performance.now();
  const params = {
    rPlein: computeR(inputs.s, config.fMaxSeconds),
    t: inputs.t,
    cpm: inputs.cpm,
    pctSh: config.pctSh,
    seuilShTnd: SEUIL_SH_TND,
    fMaxSeconds: config.fMaxSeconds,
    s: inputs.s,
    capHeure: pool.capHeure,
  };
  const pre = precalculer(pool.venues, params);
  const t2 = performance.now();
  const budgetTnd = Number.isFinite(inputs.budgetTnd) ? inputs.budgetTnd : pre.cMaxTnd;
  const calcul = couper(pre, budgetTnd, params);
  const t3 = performance.now();

  const heuresTypes = [...calcul.heures.values()].reduce((sum, h) => sum + h.length, 0);
  const cutTranche = calcul.final.file[calcul.final.fill.cut];
  const journal: ToursPlanDetail['journal'] = [
    {
      phase: 'precalcul',
      result: { pool: pool.venues.length, heuresTypes, exclus: pool.excluded.length },
      ms: Math.round(t1 - t0),
    },
    {
      phase: 'file',
      result: {
        tranches: calcul.file.length,
        iMax: calcul.iMax,
        cMaxTnd: calcul.cMaxTnd,
        exclusPlein: pre.exclusMax.size,
      },
      ms: Math.round(t2 - t1),
    },
    {
      phase: 'remplissage',
      result: {
        iCible: calcul.iCible,
        trancheCoupure: cutTranche ? calcul.final.fill.cut + 1 : 0,
        k: calcul.final.fill.k,
      },
      ms: Math.round(t3 - t2),
    },
    {
      phase: 'anti_miette',
      result: {
        retires: calcul.final.retires.length,
        impressionsRedistribuees: calcul.final.retires.reduce((sum, r) => sum + r.impressions, 0),
      },
      ms: 0,
    },
    { phase: 'verification', result: { ...calcul.verification }, ms: 0 },
  ];
  for (const entry of journal) trace.event(`tours_${entry.phase}`, entry.result);

  const detail = buildToursDetail({
    calcul,
    params,
    budgetTnd,
    week: pool.week,
    excluded: pool.excluded,
    journal,
    computedAt: opts.now ?? new Date(),
  });
  return { pool, params, calcul, detail };
};
