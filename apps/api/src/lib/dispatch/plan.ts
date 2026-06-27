import { type DispatchCreneau } from '../../db/schema.js';

import { computeR, computeRi } from './eligibility.js';
import { type EligibleScreenhost, selection } from './selection.js';
import { computeGJour, computeSMin } from './thresholds.js';

// Dispatch pipeline (Youssef's spec A.2/A.4/A.5/A.6/A.7) — PURE. The DB layer assembles the pool
// (fetch + enrich) + the window days, then calls buildPlan; it persists the frozen result. Keeping
// this pure makes the bounds, repetitions, cadence and the two clôtures unit-testable.

export interface PoolEntry {
  id: string;
  sps: number;
  anciennete: number;
  revenuJour: number;
  activeToday: boolean;
  avgAffluence: number; // Ai
  hours: number; // Hi — broadcastable slot count over the window
  capaciteUtile: number; // Ai·Hi·R
  residualCapacity: number; // capaciteUtile − other campaigns' engagements (capped by F)
  slots: { dayOfWeek: number; hour: number; affluence: number }[]; // broadcastable (weekday,hour)→Ai
}

export interface WindowDay {
  date: string; // ISO YYYY-MM-DD
  dayOfWeek: number; // 1=Mon … 7=Sun
}

export interface BuildPlanInput {
  iCible: number;
  cpm: number;
  s: number;
  t: number;
  seuilDiffusable: number;
  gMois: number;
  joursActifs: number;
  rMinEfficace: number;
  fMaxSeconds: number;
  windowDays: WindowDay[];
  pool: PoolEntry[];
}

export interface PlanAllocation {
  screenhostId: string;
  iiPotentiel: number;
  rI: number;
  revenuPrevisionnel: number;
  creneaux: DispatchCreneau[];
}

export interface BuiltPlan {
  sMin: number;
  gJour: number;
  r: number;
  couvert: number;
  nMin: number;
  nMax: number;
  nRetenus: number;
  isPartial: boolean;
  isTooThin: boolean;
  allocations: PlanAllocation[];
}

// A.4 — N is a VALIDATION output, not a target. N_min = ⌈I_cible / max capacité_utile⌉ (anti-
// oversell); N_max = ⌊Budget_SH / S_min⌋ (anti-miettes), Budget_SH = I_cible·CPM/1000.
export const computeBounds = (
  iCible: number,
  cpm: number,
  maxCapaciteUtile: number,
  sMin: number,
): { nMin: number; nMax: number } => {
  const nMin =
    maxCapaciteUtile > 0 ? Math.ceil(iCible / maxCapaciteUtile) : Number.POSITIVE_INFINITY;
  const budgetSH = (iCible * cpm) / 1000;
  const nMax = sMin > 0 ? Math.floor(budgetSH / sMin) : 0;
  return { nMin, nMax };
};

// A.6 — one date×hour broadcastable slot per (window day, weekday slot); reps = R_i; potential
// impressions = affluence × R_i. (Calendar dates expand from the window × the weekly slot pattern.)
export const buildCreneaux = (
  windowDays: readonly WindowDay[],
  slots: readonly { dayOfWeek: number; hour: number; affluence: number }[],
  rI: number,
): DispatchCreneau[] => {
  const byDow = new Map<number, { hour: number; affluence: number }[]>();
  for (const slot of slots) {
    const list = byDow.get(slot.dayOfWeek) ?? [];
    list.push({ hour: slot.hour, affluence: slot.affluence });
    byDow.set(slot.dayOfWeek, list);
  }
  const creneaux: DispatchCreneau[] = [];
  for (const day of windowDays) {
    for (const slot of byDow.get(day.dayOfWeek) ?? []) {
      creneaux.push({
        date: day.date,
        hour: slot.hour,
        reps: rI,
        impressions: slot.affluence * rI,
      });
    }
  }
  return creneaux;
};

export const buildPlan = (input: BuildPlanInput): BuiltPlan => {
  const { iCible, cpm, s, t, seuilDiffusable, gMois, joursActifs, rMinEfficace, fMaxSeconds } =
    input;
  const gJour = computeGJour(gMois, joursActifs);
  const sMin = computeSMin(seuilDiffusable, cpm);
  const r = computeR(s, t, fMaxSeconds);

  const maxCap = input.pool.reduce((m, p) => Math.max(m, p.capaciteUtile), 0);
  const { nMin, nMax } = computeBounds(iCible, cpm, maxCap, sMin);

  const eligible: EligibleScreenhost[] = input.pool.map((p) => ({
    id: p.id,
    sps: p.sps,
    anciennete: p.anciennete,
    residualCapacity: p.residualCapacity,
    revenuJour: p.revenuJour,
    activeToday: p.activeToday,
  }));
  const { retenus, couvert } = selection(eligible, iCible, { seuilDiffusable, gJour });

  const byId = new Map(input.pool.map((p) => [p.id, p]));
  const allocations: PlanAllocation[] = [];
  for (const ret of retenus) {
    const p = byId.get(ret.id);
    if (!p) continue;
    const rI = computeRi(ret.ai, p.avgAffluence, p.hours, rMinEfficace, r);
    allocations.push({
      screenhostId: ret.id,
      iiPotentiel: ret.ai,
      rI,
      revenuPrevisionnel: (ret.ai * cpm) / 1000,
      creneaux: buildCreneaux(input.windowDays, p.slots, rI),
    });
  }

  return {
    sMin,
    gJour,
    r,
    couvert,
    // Clôture 1 (partial): pool couldn't cover I_cible. Clôture 2 (too thin): covering I_cible would
    // force more screenhosts than materiality allows (N_min > N_max), or the pool is empty.
    nMin: Number.isFinite(nMin) ? nMin : 0,
    nMax,
    nRetenus: retenus.length,
    isPartial: couvert < iCible,
    isTooThin: input.pool.length === 0 || nMin > nMax,
    allocations,
  };
};
