import type { BoostAdditionsWire } from '@/features/campaigns/services/boost.api';

/**
 * CF-B1 (spec §3.3) — the Booster's client-side rules, one leaflet-free home so the gating, the
 * exclusion pickers and the French refusal wording are pinned without mounting the modal.
 */

/** The CF-Q1 disabled state retires: Active AND À venir boost (spec §3.3). */
export const canBoostCampaign = (status: string): boolean =>
  status === 'active' || status === 'upcoming';

/** At least ONE addition among the three — a same-end date is NOT an addition. */
export const hasBoostAddition = (
  additions: BoostAdditionsWire,
  currentEndDate: string | null,
): boolean =>
  Boolean(
    (additions.new_end_date &&
      currentEndDate !== null &&
      additions.new_end_date > currentEndDate) ||
    (additions.added_zone_ids?.length ?? 0) > 0 ||
    (additions.added_category_ids?.length ?? 0) > 0,
  );

/** The pickers offer ONLY what the campaign does not already target (strictly additive). */
export const newOptions = <T extends { id: string }>(
  all: readonly T[],
  existingIds: readonly (string | null | undefined)[],
): T[] => {
  const existing = new Set(existingIds.filter((id): id is string => Boolean(id)));
  return all.filter((option) => !existing.has(option.id));
};

export const BOOST_SUCCESS_TOAST =
  'Campagne boostée — les nouveaux emplacements attendent l’accord des établissements.';

/**
 * The E5.1 consequence, said to the user: an axis with ZERO selections already covers the whole
 * network — « adding » there would narrow, so the picker is closed with this wording.
 */
export const WHOLE_NETWORK_AXIS_NOTE =
  'Votre campagne couvre déjà tout le réseau sur cet axe — rien à ajouter.';

const BOOST_REASON_FR: Record<string, string> = {
  NOT_BOOSTABLE: 'Seule une campagne active ou à venir peut être boostée.',
  NO_ADDITION: 'Ajoutez au moins un élément : une date de fin, une zone ou une catégorie.',
  INVALID_END_DATE: 'La nouvelle date de fin ne peut pas précéder la fin actuelle.',
  ZONE_NOT_FOUND: 'Zone inconnue.',
  ZONE_ALREADY_TARGETED: 'Cette zone est déjà ciblée par la campagne.',
  ZONES_WHOLE_NETWORK: 'La campagne couvre déjà toutes les zones.',
  CATEGORY_NOT_FOUND: 'Catégorie inconnue.',
  CATEGORY_ALREADY_TARGETED: 'Cette catégorie est déjà ciblée par la campagne.',
  CATEGORIES_WHOLE_NETWORK: 'La campagne couvre déjà toutes les catégories.',
  NO_FUTURE_WINDOW: 'La fenêtre de diffusion restante est vide.',
  BUDGET_BELOW_MINIMUM: 'Le budget complémentaire minimum est de 100 TND.',
  BUDGET_EXCEEDS_CMAX: 'Le budget complémentaire dépasse le plafond disponible.',
  INSUFFICIENT_BALANCE: 'Solde insuffisant pour ce boost.',
  TOO_THIN: 'L’inventaire ajouté est trop mince pour diffuser ce budget.',
  NO_ELIGIBLE: 'Aucun écran éligible sur le périmètre ajouté.',
  NO_PLAN: 'La campagne n’a pas encore de plan de diffusion.',
};

export const boostReasonFr = (code: string): string =>
  BOOST_REASON_FR[code] ?? 'Le boost a été refusé.';
