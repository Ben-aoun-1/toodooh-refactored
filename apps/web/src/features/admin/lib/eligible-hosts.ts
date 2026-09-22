// ELIG-1 — the admin « Hosts éligibles » view of a campaign, at any status. The api answers from
// the REAL pool assembly (standard) or the REAL event ceiling (positioning); this file only types
// the wire and turns the engine's exclusion codes into French.

export type EligibleHostsKind = 'standard' | 'event';

export type ExclusionReason =
  | 'excluded'
  /** Legacy — no api after CAP-EVT1 sends it (the capacity is no standard gate any more). */
  | 'capacity_missing'
  | 'hours_missing'
  | 'targeting_mismatch'
  | 'zone_mismatch'
  | 'inactive'
  | 'no_available_days'
  | 'no_residual_capacity'
  | 'not_event_eligible'
  | 'event_capacity_missing'
  | 'no_bloc_available'
  | 'no_sector'
  | 'owner_not_approved'
  | 'no_installed_screen';

export interface EligibleHost {
  id: string;
  name: string;
  sector: string | null;
  class: string | null;
  sps: number;
  affluence: number;
  hours: number;
  capacity: number;
  days_available: number | null;
  allocation: { statut: string; impressions: number } | null;
}

export interface ExcludedHost {
  id: string;
  name: string;
  reason: ExclusionReason;
}

export interface EligibleHostsReport {
  kind: EligibleHostsKind;
  campaign: { id: string; name: string; status: string };
  window: { start: string; end: string } | null;
  spot_seconds: number;
  spot_source: 'creative' | 'default';
  cpm_tnd: number;
  eligible: EligibleHost[];
  excluded: ExcludedHost[];
  totals: {
    active_venues: number;
    eligible: number;
    excluded: number;
    capacity: number;
    c_max_tnd: number;
  };
}

export const EXCLUSION_REASON_LABEL: Record<ExclusionReason, string> = {
  excluded: 'Écarté par le moteur',
  capacity_missing: 'Capacité de diffusion non renseignée',
  hours_missing: "Horaires d'ouverture non renseignés",
  targeting_mismatch: 'Hors ciblage (catégorie ou gamme)',
  zone_mismatch: 'Hors zone géographique',
  inactive: 'Établissement inactif',
  no_available_days: 'Indisponible sur toute la période',
  no_residual_capacity: 'Écrans déjà pleins ou affluence nulle',
  not_event_eligible: 'Catégorie non éligible aux événements',
  // CAP-EVT1 (operator ruling 2026-09-22) — the capacity is the venue's EVENT switch: empty = no
  // events (standard campaigns never read it).
  event_capacity_missing: 'Non éligible aux événements (capacité de diffusion vide)',
  no_bloc_available: 'Aucun bloc disponible pendant le match',
  no_sector: 'Catégorie non renseignée',
  // ELIG-2 (operator ruling 2026-09-16) — only a venue whose owner is validated counts anywhere.
  owner_not_approved: 'Propriétaire non validé',
  // MAP-TV1 (operator ruling 2026-09-21) — only a venue with a TV that ever ran is sold.
  no_installed_screen: 'Aucun écran installé',
};

export const exclusionLabel = (reason: string): string =>
  (EXCLUSION_REASON_LABEL as Record<string, string>)[reason] ?? reason;

export const ALLOCATION_STATUT_LABEL: Record<string, string> = {
  EN_ATTENTE: 'Proposé — en attente',
  ACCEPTE: 'Proposé — accepté',
  REFUSE: 'Proposé — refusé',
};

/** Exclusions grouped by reason, most frequent first — the panel's one-line summary. */
export const exclusionSummary = (
  excluded: readonly ExcludedHost[],
): { reason: ExclusionReason; label: string; count: number }[] => {
  const counts = new Map<ExclusionReason, number>();
  for (const e of excluded) counts.set(e.reason, (counts.get(e.reason) ?? 0) + 1);
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, label: exclusionLabel(reason), count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'fr'));
};

/** What the « capacité » and « heures » columns mean differs between the two engines. */
export const columnLabels = (
  kind: EligibleHostsKind,
): { affluence: string; hours: string; capacity: string } =>
  kind === 'event'
    ? { affluence: 'A_max (pers/h)', hours: 'Blocs dispo', capacity: 'Impressions max' }
    : {
        affluence: 'Affluence moy./h',
        hours: 'Heures diffusables',
        capacity: 'Capacité facturable',
      };
