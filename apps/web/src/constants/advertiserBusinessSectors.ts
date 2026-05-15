import type { BusinessSector } from '../features/auth/types/auth';

/** Liste finale des secteurs d'activité (annonceurs), hors ligne « Agence de Publicité ». */
export const ADVERTISER_BUSINESS_SECTOR_NAMES: readonly string[] = [
  'Agriculture et agroalimentaire',
  'Automobile et mobilité',
  'Banque, assurance et finance',
  'Bâtiment, construction et immobilier',
  'Beauté, bien-être et cosmétique',
  'Commerce, retail et distribution',
  'Communication, marketing, média et publicité',
  'Conseil et services aux entreprises',
  'Culture, divertissement et création',
  'Éducation et formation',
  'Énergie, environnement et développement durable',
  'Hôtellerie, restauration et cafés',
  'Industrie et fabrication',
  'Informatique, technologie et télécommunications',
  'Logistique, transport et livraison',
  'Mode, textile et accessoires',
  'Maison, décoration et ameublement',
  'Santé, médical et pharmacie',
  'Secteur public, institutions et collectivités',
  'Services juridiques, comptables et administratifs',
  'Sport, fitness et loisirs',
  'Tourisme, voyage et événementiel',
  'Associations, ONG et organisations internationales',
  'Autre',
];

/** Secteur proposé par défaut à l'inscription agence. */
export const AGENCY_BUSINESS_SECTOR_NAME = 'Agence de Publicité';

function normalizeSectorName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

/** Secteurs réservés aux propriétaires (hors liste annonceur/agence). */
const OWNER_SIGNUP_SECTOR_NAMES = new Set<string>([
  'Cafés populaires',
  'Bars',
  'Restaurant',
  'Café étudiant',
  'Salon de thé',
  'Café gaming',
]);
const OWNER_SIGNUP_SECTOR_NAMES_NORMALIZED = new Set<string>(
  Array.from(OWNER_SIGNUP_SECTOR_NAMES).map(normalizeSectorName),
);

function isAdvertiserSectorByDisplayOrder(s: BusinessSector): boolean {
  return typeof s.display_order === 'number' && s.display_order >= 1;
}

/**
 * Secteurs affichés à l'inscription / profil annonceur-agence, dans l'ordre renvoyé par l'API
 * (colonne display_order en base).
 */
export function filterAdvertiserAgencySectorsByDbOrder(
  sectors: BusinessSector[],
): BusinessSector[] {
  return sectors.filter((s) => isAdvertiserSectorByDisplayOrder(s));
}

/**
 * Si les noms finaux ne sont pas encore en base, affiche les secteurs hors liste propriétaire.
 */
export function sectorsForAdvertiserAgencySignup(sectors: BusinessSector[]): BusinessSector[] {
  const strict = filterAdvertiserAgencySectorsByDbOrder(sectors);
  if (strict.length > 0) return strict;

  const loose = sectors.filter(
    (s) => !OWNER_SIGNUP_SECTOR_NAMES_NORMALIZED.has(normalizeSectorName(s.name)),
  );
  return loose;
}

/** Profil entreprise : même filtre + secteur actuel s'il n'est plus dans la liste (données historiques). */
export function sectorsForAdvertiserProfile(
  sectorsFromApi: BusinessSector[],
  selectedSectorId?: string | null,
): BusinessSector[] {
  let base = filterAdvertiserAgencySectorsByDbOrder(sectorsFromApi);
  if (base.length === 0) {
    base = sectorsForAdvertiserAgencySignup(sectorsFromApi);
  }
  if (selectedSectorId && !base.some((s) => s.id === selectedSectorId)) {
    const legacy = sectorsFromApi.find((s) => s.id === selectedSectorId);
    if (legacy) return [...base, legacy];
  }
  return base;
}
