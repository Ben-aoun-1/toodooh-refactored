// Operator ticket 2026-10-09 (ruling Q4A) — a screencaster's Consulter shows the positioning's
// placement as TOTALS only: never the venues' names nor a per-venue list. A refused offer no longer
// places anything, so it is left out of every figure.

export interface PlacementLineInput {
  statut: string;
  blocs_count: number;
  montant_tnd: number;
}

export interface PlacementTotals {
  /** Venues holding a live offer (accepted or awaiting the owner's answer). */
  venues: number;
  accepted: number;
  pending: number;
  /** One bloc = one minute of the advertiser's seat. */
  minutes: number;
  montantTnd: number;
}

export const placementTotals = (lines: readonly PlacementLineInput[]): PlacementTotals => {
  const live = lines.filter((l) => l.statut !== 'REFUSE');
  return {
    venues: live.length,
    accepted: live.filter((l) => l.statut === 'ACCEPTE').length,
    pending: live.filter((l) => l.statut === 'EN_ATTENTE').length,
    minutes: live.reduce((sum, l) => sum + l.blocs_count, 0),
    montantTnd: Math.round(live.reduce((sum, l) => sum + l.montant_tnd * 1000, 0)) / 1000,
  };
};
