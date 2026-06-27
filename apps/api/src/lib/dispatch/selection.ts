// SÉLECTION UNIFIÉE (Youssef's spec A.3) — the SINGLE selection authority, PURE + deterministic.
// Called by dispatch (E=eligible, V=I_cible, plan=∅) AND, later, by redispatch (V=increment, plan=
// current) — verbatim. plan_courant is reflected into E by the caller (residualCapacity nets out
// engagements; revenuJour/activeToday come from the registre), so this function stays pure over an
// already-enriched E.
//
// INVARIANTS pinned here:
//  • Concentration — stop as soon as couvert ≥ V (never one screenhost more); N is an OUTPUT.
//  • Ordering — SPS desc; ancienneté (oldest last-service first) breaks EXACT ties only, never
//    modifies SPS; id is the final determinism tiebreak.
//  • Dignity — screenhosts active today with revenu_jour < G_jour move to the HEAD (finish what's
//    started), as a STABLE partition (their SPS order is preserved).
//  • Jamais de miette — never open an allocation < seuil_diffusable; a sub-seuil reliquat is pushed
//    onto the last retained screenhost that still has residual headroom (à capacité), then ARRÊT.
//  • Jamais de survente — a_i never exceeds residualCapacity (no phantom impressions).

export interface EligibleScreenhost {
  id: string;
  sps: number;
  anciennete: number; // last-service epoch (ms); 0 = never served → oldest → wins ties
  residualCapacity: number; // impressions still allocatable (capacité_utile − engagements); > 0
  revenuJour: number; // TND cumulative today across all campaigns (registre); V1 = 0
  activeToday: boolean; // already serving today (registre); V1 = false
}

export interface SelectionItem {
  id: string;
  ai: number;
}

export interface SelectionResult {
  retenus: SelectionItem[];
  couvert: number;
}

export interface SelectionThresholds {
  seuilDiffusable: number;
  gJour: number;
}

/**
 * The deterministic processing order: SPS desc, ancienneté asc (oldest first) on exact SPS ties, id
 * asc as the final tiebreak; then a STABLE dignity partition (active-today & under-G_jour first).
 */
export const orderedQueue = (
  E: readonly EligibleScreenhost[],
  gJour: number,
): EligibleScreenhost[] => {
  const sorted = [...E].sort((a, b) => {
    if (b.sps !== a.sps) return b.sps - a.sps;
    if (a.anciennete !== b.anciennete) return a.anciennete - b.anciennete;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  const isDignity = (sh: EligibleScreenhost): boolean => sh.activeToday && sh.revenuJour < gJour;
  return [...sorted.filter(isDignity), ...sorted.filter((sh) => !isDignity(sh))];
};

export const selection = (
  E: readonly EligibleScreenhost[],
  V: number,
  { seuilDiffusable, gJour }: SelectionThresholds,
): SelectionResult => {
  const queue = orderedQueue(E, gJour);
  const capacityById = new Map(E.map((sh) => [sh.id, sh.residualCapacity]));
  const retenus: SelectionItem[] = [];
  let couvert = 0;

  for (const sh of queue) {
    if (couvert >= V) break; // concentration — pas un de plus
    const remaining = V - couvert;
    const ai = Math.min(sh.residualCapacity, remaining);
    if (ai < seuilDiffusable) {
      // Sub-seuil: never open a miette. Push the reliquat onto the last retained screenhost that
      // still has residual headroom (à capacité) — never overselling its capacity — then ARRÊT.
      let reliquat = remaining;
      for (let k = retenus.length - 1; k >= 0 && reliquat > 0; k -= 1) {
        const r = retenus[k];
        if (!r) continue;
        const headroom = (capacityById.get(r.id) ?? 0) - r.ai;
        if (headroom > 0) {
          const add = Math.min(headroom, reliquat);
          r.ai += add;
          couvert += add;
          reliquat -= add;
        }
      }
      break;
    }
    retenus.push({ id: sh.id, ai });
    couvert += ai;
  }

  return { retenus, couvert };
};
