/**
 * PISTES-V2 — the lever référentiel of the Piste 02 spec (docs/specs/piste-02-angles-morts.md §6),
 * verbatim, and the ONE mapping from a venue's business sector to its référentiel category.
 *
 * Only the matched category's block is sent to the model (spec §4: sending all ten raises the risk
 * of contamination between categories). A sector with no category gets no generation at all — the
 * card keeps its « À venir » wait state rather than receiving advice written for another trade.
 */

/** The eight transversal lever families (spec §6). */
export const FAMILLES_LEVIERS = {
  A: 'Offre et assortiment',
  B: 'Programmation et animation',
  C: 'Communication locale et réseaux sociaux',
  D: 'Organisation, planning et service',
  E: 'Aménagement, confort et ambiance',
  F: 'Partenariats de proximité',
  G: 'Formules et conditions tarifaires',
  H: 'Fidélisation et relation client',
} as const;

export type FamilleLevier = keyof typeof FAMILLES_LEVIERS;

export const isFamilleLevier = (value: unknown): value is FamilleLevier =>
  typeof value === 'string' && Object.hasOwn(FAMILLES_LEVIERS, value);

const INTERDITS_TRANSVERSAUX =
  "Recrutement ou réduction d'effectif, travaux et investissements, changement d'enseigne, stratégie de prix de fond, conseil juridique ou fiscal, promesse de résultat chiffré, mention d'un concurrent nommé.";

export type ReferentielCategory =
  | 'Cafés'
  | 'Restaurants / bars'
  | 'Salles de sport'
  | 'Cabinets médicaux'
  | 'Pharmacies'
  | 'Supermarchés'
  | 'Hôtels'
  | 'Salons de coiffure'
  | 'Station Service'
  | 'Espaces de loisirs';

const SPECIFIQUES: Record<ReferentielCategory, { admissibles: string; interdits: string }> = {
  Cafés: {
    admissibles:
      "formules horaires calées sur les creux (matinée, goûter), offre à emporter si déclarée, programmation calme en journée (jeux, lecture, musique d'ambiance), valorisation explicite de l'usage travail si wifi déclaré, communication ciblée sur les créneaux calmes, partenariats avec bureaux, salles de sport et établissements scolaires du quartier, carte saisonnière, aménagement de la terrasse si déclarée.",
    interdits:
      "toute référence à l'alcool sauf `service_alcool: true`, toute offre de restauration préparée sauf `cuisine_sur_place: true`, tout événement au-delà de l'horaire de fermeture déclaré.",
  },
  'Restaurants / bars': {
    admissibles:
      "formule déjeuner rapide, service continu sur le creux d'après-midi, plat du jour, accueil de groupes si déclaré, brunch uniquement en CSP Moyen ou Premium, formats afterwork uniquement si sous-catégorie bar et `service_alcool: true`, vente à emporter si déclarée, partenariats avec les entreprises voisines, réorganisation du planning de service.",
    interdits:
      "toute incitation à la consommation d'alcool, toute mention d'alcool hors condition ci-dessus, toute recommandation portant sur les marges fournisseurs.",
  },
  'Salles de sport': {
    admissibles:
      "positionnement de cours collectifs sur les créneaux creux, formules d'accès heures calmes, séances découverte, créneaux dédiés à des publics spécifiques (débutants, seniors, femmes), communication sur la disponibilité des équipements aux heures creuses, partenariats entreprises et établissements scolaires du quartier, ateliers non médicaux (récupération, mobilité), organisation du planning des coachs.",
    interdits:
      'tout conseil nutritionnel, tout discours sur le poids, les calories, la silhouette ou la perte de masse, toute recommandation de complément alimentaire, toute promesse de résultat physique.',
  },
  'Cabinets médicaux': {
    admissibles:
      "organisation du planning de consultation, ouverture de plages dédiées à un type de suivi, réduction du temps d'attente, rappel de rendez-vous, confort et aménagement de la salle d'attente, information pratique aux patients, ajustement des horaires d'ouverture du secrétariat.",
    interdits:
      'toute action promotionnelle, toute incitation à la consultation, tout discours commercial adressé aux patients, tout contenu de santé, toute remise ou avantage tarifaire. Le registre reste exclusivement organisationnel.',
  },
  Pharmacies: {
    admissibles:
      "agencement et rotation saisonnière de l'espace parapharmacie dans le respect de la réglementation, organisation du comptoir aux heures de pointe, ajustement des horaires d'ouverture, services annexes autorisés, signalétique et parcours en officine, planification des réceptions de commandes hors affluence.",
    interdits:
      "toute recommandation portant sur le médicament, toute promotion ou remise sur un produit de santé, tout conseil thérapeutique, toute incitation à l'achat de produits de santé.",
  },
  Supermarchés: {
    admissibles:
      "rotation des mises en avant, fluidification des caisses aux heures de pointe, déplacement des opérations de réassort hors des créneaux d'affluence, animations et dégustations positionnées sur les creux, ajustement des horaires de retrait ou de livraison, communication locale de quartier, signalétique en rayon.",
    interdits: 'stratégie de prix de fond, négociation fournisseurs, politique de référencement.',
  },
  Hôtels: {
    admissibles:
      "ouverture du lobby ou de l'espace bar à une clientèle extérieure en journée, offre de journée et salles de réunion si espace déclaré, ouverture du petit-déjeuner aux non-résidents, partenariats avec entreprises et organisateurs d'événements locaux, communication sur les périodes basses, organisation des équipes de réception selon le flux réel.",
    interdits:
      'stratégie tarifaire des chambres, distribution et canaux de réservation, classement et labellisation.',
  },
  'Salons de coiffure': {
    admissibles:
      "mise en place ou promotion de la prise de rendez-vous, ouverture de créneaux décalés (tôt le matin, fin de journée), prestations courtes positionnées sur les heures creuses, formules de journée calme, communication sur les réseaux sociaux locaux, aménagement de l'espace d'attente, partenariats de proximité.",
    interdits:
      'promesses esthétiques, conseil dermatologique ou capillaire à visée thérapeutique, recommandation de produits de soin nommés.',
  },
  'Station Service': {
    admissibles:
      "offre de la boutique et du snacking calée sur les flux réels, services annexes (lavage, gonflage, café), signalétique et éclairage de l'aire, organisation des équipes selon les pics, horaires des prestations de lavage, communication routière locale.",
    interdits: 'prix du carburant, approvisionnement, réglementation des dépôts.',
  },
  'Espaces de loisirs': {
    admissibles:
      "tarification ou formules heures calmes, réservation de groupes, animations et tournois en semaine, partenariats avec écoles, clubs et entreprises, programmation spécifique en période de vacances scolaires, organisation des rotations d'équipements.",
    interdits:
      "tout format de jeu d'argent ou de pari, toute promesse relative à la sécurité des mineurs, toute action supposant un nouvel équipement.",
  },
};

/**
 * The venue sector (business_sectors.name) → its référentiel category, plus the sous-catégorie the
 * sector name itself carries. Prod 2026-10-12: venues use exactly these five sectors (Café 28,
 * Resto 12, Resto/Bar 3, Salle de sport 3, Espace de loisir 2); every other sector row is an
 * ADVERTISER sector and maps to nothing.
 */
const SECTOR_TO_CATEGORY: Record<
  string,
  { categorie: ReferentielCategory; sousCategorie: string | null }
> = {
  Café: { categorie: 'Cafés', sousCategorie: null },
  Resto: { categorie: 'Restaurants / bars', sousCategorie: 'Restaurant' },
  'Resto/Bar': { categorie: 'Restaurants / bars', sousCategorie: 'Bar' },
  'Salle de sport': { categorie: 'Salles de sport', sousCategorie: null },
  'Espace de loisir': { categorie: 'Espaces de loisirs', sousCategorie: null },
};

export const referentielCategoryFor = (
  sectorName: string | null,
): { categorie: ReferentielCategory; sousCategorie: string | null } | null =>
  sectorName === null ? null : (SECTOR_TO_CATEGORY[sectorName] ?? null);

/** The référentiel block for ONE category: the eight families, then its own levers and bans. */
export const referentielBlock = (categorie: ReferentielCategory): string => {
  const familles = Object.entries(FAMILLES_LEVIERS)
    .map(([code, label]) => `${code} · ${label}`)
    .join('\n');
  const own = SPECIFIQUES[categorie];
  return [
    'Familles transversales (à combiner avec les leviers spécifiques) :',
    familles,
    '',
    `Interdits transversaux, toutes catégories : ${INTERDITS_TRANSVERSAUX}`,
    '',
    `Leviers admissibles · ${categorie} : ${own.admissibles}`,
    `Interdits spécifiques · ${categorie} : ${own.interdits}`,
  ].join('\n');
};
