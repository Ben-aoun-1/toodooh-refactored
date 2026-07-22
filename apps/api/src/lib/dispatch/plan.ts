import { type DispatchCreneau } from '../../db/schema.js';

import { computeR, computeRi, physicalFromFacturable } from './eligibility.js';
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
  capaciteUtile: number; // Ai·Hi·R_eff (R_eff already nets other campaigns' engaged seconds, see below)
  residualCapacity: number; // = capaciteUtile (the seconds-cap is baked into R_eff, not subtracted here)
  // R_eff = MIN[(3600/S)·T, residual_seconds/S] for THIS screen — the per-screen reps/hour ceiling
  // after the cross-campaign F-second cap. computeRi clamps r_i to this (not the global F-based R), so
  // Σ over all campaigns of r_i×S ≤ F on every screen even when campaigns have different spot durations.
  repsCap: number;
  slots: { dayOfWeek: number; hour: number; affluence: number }[]; // broadcastable (weekday,hour)→Ai
  // E2 (jours_dispo_i) — THIS venue's available window days (the global window minus its declared
  // unavailability). The ONE day source: capacity was computed over these, and every créneaux
  // builder MUST iterate these (never the global windowDays) so placements and capacity agree.
  days: WindowDay[];
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
  // E3 (Mariem 2026-07-15 amendment) — a sub-seuil uncovered remainder (0 < V − couvert < seuil)
  // is a crumb, NOT a clôture-1: it is STORED (« stocké ») for the redispatch (E6) to fold into
  // its own remaining loss (E6's materiality validation runs on the TOTAL). 0 when covered or
  // when the remainder is ≥ the seuil (that stays the partial path, unchanged).
  reliquatStocke: number;
  allocations: PlanAllocation[];
}

// A.4 — N is a VALIDATION output, not a target. N_min = ⌈I_cible / max capacité_utile⌉ (anti-
// oversell); N_max = ⌊Budget_SH / S_min⌋ (anti-miettes), Budget_SH = I_cible·CPM/1000.
export const computeBounds = (
  iCible: number,
  maxCapaciteUtile: number,
  seuilDiffusable: number,
): { nMin: number; nMax: number } => {
  const nMin =
    maxCapaciteUtile > 0 ? Math.ceil(iCible / maxCapaciteUtile) : Number.POSITIVE_INFINITY;
  // N_max = ⌊Budget_SH / S_min⌋ = ⌊I_cible / seuil_diffusable⌋ — CPM cancels, so compute it
  // DIRECTLY: exact (no FP off-by-one at integer boundaries) and self-evidently CPM-free.
  const nMax = seuilDiffusable > 0 ? Math.floor(iCible / seuilDiffusable) : 0;
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
        impressions: Math.round(slot.affluence * rI), // whole impressions
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
  const r = computeR(s, fMaxSeconds); // PHYSICAL ceiling — E1: T lives in the capacity, not in R

  const maxCap = input.pool.reduce((m, p) => Math.max(m, p.capaciteUtile), 0);
  const { nMin, nMax } = computeBounds(iCible, maxCap, seuilDiffusable);

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
    // E1 (VF, US-2.9) — the allocation a_i is FACTURABLE impressions; the physical slots that must
    // air are a_i ÷ T (the same T that discounted the capacity — one source, both directions).
    // Clamp to THIS screen's residual-aware cap (repsCap), not the global F-based r — so r_i never
    // pushes this screen's total campaign-seconds/hour over F when other campaigns already air there.
    const rI = computeRi(
      physicalFromFacturable(ret.ai, t),
      p.avgAffluence,
      p.hours,
      rMinEfficace,
      p.repsCap,
    );
    allocations.push({
      screenhostId: ret.id,
      iiPotentiel: ret.ai,
      rI,
      revenuPrevisionnel: (ret.ai * cpm) / 1000,
      // E2 — the venue's OWN available days, not the global window (one day source).
      creneaux: buildCreneaux(p.days, p.slots, rI),
    });
  }

  // E3 amendment — after selection returns, a sub-seuil remainder is stored, not flagged partial.
  const reliquat = iCible - couvert;
  const reliquatStocke = reliquat > 0 && reliquat < seuilDiffusable ? reliquat : 0;

  return {
    sMin,
    gJour,
    r,
    couvert,
    // Clôture 1 (partial): pool couldn't cover I_cible by a MATERIAL margin (≥ seuil). Clôture 2
    // (too thin): covering I_cible would force more screenhosts than materiality allows
    // (N_min > N_max), or the pool is empty. A sub-seuil shortfall is neither — it lands in
    // reliquatStocke for E6.
    nMin: Number.isFinite(nMin) ? nMin : 0,
    nMax,
    nRetenus: retenus.length,
    isPartial: couvert < iCible && reliquatStocke === 0,
    isTooThin: input.pool.length === 0 || nMin > nMax,
    reliquatStocke,
    allocations,
  };
};
