// E7 — the reversement rail (VF EPIC 5): Revenu = (diffusé ÷ cible) × C_cible, split
// 50 % SH / 44 % Toodooh / 3 % Agent SH / 3 % Agent SC per settlement line.
//
// D51 — ORIGIN-NEUTRAL, ON PURPOSE: this module is pure money math over numbers. It imports
// nothing from the schema, the campaign libs or the DB layer, and it never branches on an
// origin — the Event engine later reuses the SAME rail with its own base. The origin lives
// only on the persisted line's `source` column, written by the caller. A boundary test pins
// this (tests/reversement-split.test.ts).
//
// UNIT: integer MILLIMES (1 TND = 1000 millimes), so the four lines always sum EXACTLY to the
// base — floating-point can never leak or mint a millime. The floor residue of the three
// non-Toodooh lines lands on the TOODOOH line (pinned): the platform absorbs the rounding,
// never a payee.

export interface ReversementPcts {
  sh: number;
  toodooh: number;
  agentSh: number;
  agentSc: number;
}

/** VF EPIC 5 split — the calibratable dispatch_config columns default to these. */
export const DEFAULT_REVERSEMENT_PCTS: ReversementPcts = {
  sh: 50,
  toodooh: 44,
  agentSh: 3,
  agentSc: 3,
};

export interface ReversementSplit {
  baseMillimes: number;
  shMillimes: number;
  toodoohMillimes: number;
  agentShMillimes: number;
  agentScMillimes: number;
}

export const tndToMillimes = (tnd: number): number => Math.round(tnd * 1000);
export const millimesToTnd = (millimes: number): number => millimes / 1000;

/**
 * Split a base into the four exact-sum lines. Percentages must be ≥ 0 and sum to 100 (validated
 * — a drifted config must fail loudly, never mis-split money). SH and the two agent lines floor;
 * Toodooh takes the remainder, so Σ lines ≡ base by construction.
 */
export const computeReversement = (
  baseMillimes: number,
  pcts: ReversementPcts = DEFAULT_REVERSEMENT_PCTS,
): ReversementSplit => {
  if (!Number.isInteger(baseMillimes) || baseMillimes < 0) {
    throw new Error(
      `reversement base must be a non-negative integer millime amount, got ${baseMillimes}`,
    );
  }
  const parts = [pcts.sh, pcts.toodooh, pcts.agentSh, pcts.agentSc];
  if (parts.some((p) => !Number.isFinite(p) || p < 0)) {
    throw new Error('reversement percentages must be finite and ≥ 0');
  }
  const sum = parts.reduce((s, p) => s + p, 0);
  if (Math.abs(sum - 100) > 1e-9) {
    throw new Error(`reversement percentages must sum to 100, got ${sum}`);
  }
  const shMillimes = Math.floor((baseMillimes * pcts.sh) / 100);
  const agentShMillimes = Math.floor((baseMillimes * pcts.agentSh) / 100);
  const agentScMillimes = Math.floor((baseMillimes * pcts.agentSc) / 100);
  const toodoohMillimes = baseMillimes - shMillimes - agentShMillimes - agentScMillimes;
  return { baseMillimes, shMillimes, toodoohMillimes, agentShMillimes, agentScMillimes };
};

/**
 * The SPEC revenue base (EPIC 5): (delivered ÷ target) × C_cible, quantized to millimes. When
 * C_cible = target × CPM/1000 this reduces to delivered × CPM/1000 exactly (pinned) — the
 * proportional form is kept because a later origin (Events) may price C_cible independently.
 */
export const reversementBaseMillimes = (
  deliveredUnits: number,
  targetUnits: number,
  targetValueTnd: number,
): number => {
  if (!(targetUnits > 0)) return 0;
  return Math.round((deliveredUnits / targetUnits) * targetValueTnd * 1000);
};
