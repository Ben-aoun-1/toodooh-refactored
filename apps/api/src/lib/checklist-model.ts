// Mariem 12/11/2026 (Agent Screenhost spec VF §11 « Checklist », prototype
// Toodooh_Interface_Agent_Screenhost_VF.html) — the qualification questionnaire, ONE model:
// questions, helps, display conditions, eliminatory answers, the pages a fiche shows and the
// proposed result. Pure, no import.
//
// TWIN FILE: apps/api/src/lib/checklist-model.ts and
// apps/web/src/features/agent/lib/checklist-model.ts are byte-identical (the api recomputes the
// result and renders the answers for the Hub; the web draws the questionnaire). The api test
// tests/checklist-model.test.ts fails when the two files differ: edit one, copy it to the other.

export type Answers = Record<string, string | string[] | undefined>;

export type Opt =
  | string
  | { v: string; l?: string; elim?: boolean; other?: boolean; all?: boolean };

/** A display condition on the answers, as data. */
export type Cond =
  | { f: string; eq: string }
  | { f: string; ne: string }
  | { f: string; in: readonly string[] }
  | { all: readonly Cond[] };

export interface Field {
  id: string;
  label: string;
  req?: boolean;
  kind?: 'date' | 'time' | 'number' | 'range' | 'tel' | 'email';
  select?: 'gouvernorat' | 'delegation';
  def?: 'today' | 'now';
  /** Shown masked to the manager and the admin (the venue's Wi-Fi password). */
  secret?: boolean;
}

export interface Question {
  id: string;
  page: string;
  type: 'choice' | 'multi' | 'fields';
  title?: string;
  help?: string;
  /** « ↳ si … » — the caption of a conditional question. */
  rule?: string;
  when?: Cond;
  /** When it holds, the rest of the questionnaire is skipped (only the `fin` questions stay). */
  stop?: Cond;
  fin?: boolean;
  options?: readonly Opt[];
  fields?: readonly Field[];
}

export const GOUVERNORATS: readonly string[] = [
  'Ariana',
  'Béja',
  'Ben Arous',
  'Bizerte',
  'Gabès',
  'Gafsa',
  'Jendouba',
  'Kairouan',
  'Kasserine',
  'Kébili',
  'Le Kef',
  'Mahdia',
  'La Manouba',
  'Médenine',
  'Monastir',
  'Nabeul',
  'Sfax',
  'Sidi Bouzid',
  'Siliana',
  'Sousse',
  'Tataouine',
  'Tozeur',
  'Tunis',
  'Zaghouan',
];

/**
 * Délégations per governorate. The prototype holds the Grand Tunis only; a governorate missing
 * here takes a free-text délégation until the official list is supplied.
 */
export const DELEGATIONS: Record<string, readonly string[]> = {
  Tunis: [
    'Bab Bhar',
    'Bab Souika',
    'Carthage',
    'Cité El Khadra',
    'Djebel Jelloud',
    'El Kabaria',
    'El Menzah',
    'El Omrane',
    'El Omrane supérieur',
    'El Ouardia',
    'Ettahrir',
    'Ezzouhour',
    'Hraïria',
    'La Goulette',
    'La Marsa',
    'Le Bardo',
    'Le Kram',
    'Médina',
    'Séjoumi',
    'Sidi El Béchir',
    'Sidi Hassine',
  ],
  Ariana: [
    'Ariana Ville',
    'Ettadhamen',
    'Kalâat el-Andalous',
    'La Soukra',
    'Mnihla',
    'Raoued',
    'Sidi Thabet',
  ],
  'Ben Arous': [
    'Ben Arous',
    'Bou Mhel el-Bassatine',
    'El Mourouj',
    'Ezzahra',
    'Fouchana',
    'Hammam Chott',
    'Hammam Lif',
    'Médina Jedida',
    'Mégrine',
    'Mohamedia',
    'Mornag',
    'Radès',
  ],
  'La Manouba': [
    'Borj El Amri',
    'Djedeida',
    'Douar Hicher',
    'El Batan',
    'La Manouba',
    'Mornaguia',
    'Oued Ellil',
    'Tebourba',
  ],
};

/** The list to pick from, or null when the governorate takes a free text. */
export const delegationsOf = (gouvernorat: string | undefined): readonly string[] | null =>
  gouvernorat ? (DELEGATIONS[gouvernorat] ?? null) : [];

const CATS_MATCH = ['Cafés', 'Restaurants', 'Lounges / bars', 'Espaces de loisirs'] as const;
export const SEUIL_COUVERTURE = 30;

export interface ChecklistPage {
  id: string;
  step: 1 | 2 | 3;
  title: string;
}

export const CHECKLIST_PAGES: readonly ChecklistPage[] = [
  { id: 'etab', step: 1, title: "L'établissement" },
  { id: 'obs', step: 1, title: 'Ton observation' },
  { id: 'tv', step: 1, title: 'Les téléviseurs' },
  { id: 'contact', step: 1, title: 'Le contact' },
  { id: 'cadre', step: 2, title: "L'accord du gérant" },
  { id: 'equip', step: 2, title: "L'équipement" },
  { id: 'freq', step: 2, title: 'La fréquentation' },
  { id: 'public', step: 2, title: 'Le public' },
  { id: 'lieu', step: 2, title: 'Le lieu' },
  { id: 'echange', step: 2, title: "L'échange avec le gérant" },
  { id: 'avis', step: 3, title: 'Ton avis' },
  { id: 'action', step: 3, title: 'La prochaine action' },
];

export const STEP_CAPTION: Record<1 | 2 | 3, string> = {
  1: 'Étape 1 · Présélection',
  2: 'Étape 2 · Qualification',
  3: 'Étape finale',
};

/** The step's name as the Hub receives it. */
export const STEP_NAME: Record<1 | 2 | 3, 'Présélection' | 'Qualification' | 'Clôture'> = {
  1: 'Présélection',
  2: 'Qualification',
  3: 'Clôture',
};

const DECIDEUR: Cond = { f: 'contact', eq: 'decideur' };

export const QUESTIONS: readonly Question[] = [
  {
    id: 'nom',
    page: 'etab',
    type: 'fields',
    fields: [{ id: 'nom', label: "Nom de l'établissement", req: true }],
  },
  {
    id: 'categorie',
    page: 'etab',
    title: 'Catégorie',
    type: 'choice',
    options: [
      'Cafés',
      'Restaurants',
      'Lounges / bars',
      'Salles de sport',
      'Salons de coiffure',
      'Supermarchés',
      'Pharmacies',
      'Cabinets médicaux',
      'Hôtels',
      'Station service',
      'Espaces de loisirs',
      'Épicerie / supérette',
      'Autre',
    ],
  },
  {
    id: 'position',
    page: 'etab',
    title: 'Localisation',
    help: "Le gouvernorat d'abord, puis la délégation, proposée automatiquement.",
    type: 'fields',
    fields: [
      { id: 'gouvernorat', label: 'Gouvernorat', req: true, select: 'gouvernorat' },
      { id: 'quartier', label: 'Délégation', req: true, select: 'delegation' },
    ],
  },
  {
    id: 'obs',
    page: 'obs',
    title: "Quand observes-tu l'établissement ?",
    help: 'Prérempli avec le moment présent. Corrige si tu saisis la fiche après ta visite.',
    type: 'fields',
    fields: [
      { id: 'o_date', label: 'Jour de la prospection', kind: 'date', req: true, def: 'today' },
      { id: 'o_heure', label: 'Heure de la prospection', kind: 'time', req: true, def: 'now' },
    ],
  },
  {
    id: 'affluence',
    page: 'obs',
    title: "Combien de personnes sont présentes en moyenne dans l'établissement ?",
    help: "Observe sur place et renseigne-toi auprès du personnel. Le minimum est de 20 personnes en moyenne ; l'appréciation dépend de la catégorie.",
    type: 'choice',
    options: [
      { v: 'moins', l: 'Moins de 20', elim: true },
      { v: 'plus', l: '20 ou plus' },
    ],
    stop: { f: 'affluence', eq: 'moins' },
  },
  {
    id: 'potentiel',
    page: 'obs',
    rule: 'si 20 ou plus',
    when: { f: 'affluence', eq: 'plus' },
    title: "Comment estimes-tu le potentiel de l'établissement ?",
    help: 'Note de 1 à 5. La note 1 correspond à 20 personnes en moyenne.',
    type: 'choice',
    options: ['1', '2', '3', '4', '5'],
  },
  {
    id: 'tv',
    page: 'tv',
    title: "L'établissement a-t-il au moins un téléviseur ?",
    type: 'choice',
    options: ['Oui', { v: 'Non', l: 'Non', elim: true }],
    stop: { f: 'tv', eq: 'Non' },
  },
  {
    id: 'tvnb',
    page: 'tv',
    rule: 'si téléviseur',
    when: { f: 'tv', eq: 'Oui' },
    type: 'fields',
    fields: [{ id: 'tvnb', label: 'Nombre de téléviseurs', kind: 'number', req: true }],
  },
  {
    id: 'tvcouv',
    page: 'tv',
    rule: 'si téléviseur',
    when: { f: 'tv', eq: 'Oui' },
    title: 'Quelle part de la salle a un écran dans son champ de vision ?',
    help: '0 % : écran isolé que personne ne regarde. 100 % : des écrans visibles depuis toutes les places.',
    type: 'fields',
    fields: [
      {
        id: 'tvcouv',
        label: 'Couverture du champ de vision par les écrans',
        kind: 'range',
        req: true,
      },
    ],
  },
  {
    id: 'tvon',
    page: 'tv',
    rule: 'si téléviseur',
    when: { f: 'tv', eq: 'Oui' },
    title: 'Étaient-ils allumés lors de ton passage ?',
    type: 'choice',
    options: ['Tous', 'Certains', 'Aucun'],
  },
  {
    id: 'contact',
    page: 'contact',
    title: "Où en est le contact avec l'établissement ?",
    type: 'choice',
    options: [
      { v: 'non', l: 'Non approché' },
      { v: 'absent', l: 'Approché, décideur absent' },
      { v: 'decideur', l: 'Décideur rencontré' },
    ],
  },
  {
    id: 'contactinfo',
    page: 'contact',
    rule: 'si approché',
    when: { f: 'contact', in: ['absent', 'decideur'] },
    title: 'Ton interlocuteur',
    type: 'fields',
    fields: [
      { id: 'c_nom', label: 'Nom (facultatif)' },
      { id: 'c_fonction', label: 'Fonction (gérant, propriétaire, responsable de salle...)' },
      { id: 'c_tel', label: 'Téléphone (facultatif)', kind: 'tel' },
      { id: 'c_mail', label: 'E-mail (facultatif)', kind: 'email' },
    ],
  },
  {
    id: 'mesure',
    page: 'cadre',
    when: DECIDEUR,
    title: "Le gérant accepte-t-il la mesure d'affluence anonyme ?",
    help: 'Le capteur ne filme pas : il compte, comme un compteur de passage.',
    type: 'choice',
    options: ['Oui', 'Réticent', { v: 'Non', l: 'Non', elim: true }],
    stop: { f: 'mesure', eq: 'Non' },
  },
  {
    id: 'rne',
    page: 'cadre',
    when: DECIDEUR,
    title:
      "L'établissement est-il exploité par une entreprise immatriculée au RNE, avec un RIB à son nom ?",
    type: 'choice',
    options: ['Oui', { v: 'Non', l: 'Non', elim: true }, 'À vérifier'],
    stop: { f: 'rne', eq: 'Non' },
  },
  {
    id: 'capteur',
    page: 'cadre',
    when: DECIDEUR,
    title:
      "Le capteur peut-il être placé près de l'écran, avec une prise secteur et l'accord du gérant ?",
    type: 'choice',
    options: [
      { v: 'ok', l: "Oui, le gérant est d'accord" },
      { v: 'accord', l: 'Emplacement possible, accord à obtenir' },
      { v: 'non', l: 'Aucun emplacement possible' },
    ],
  },
  {
    id: 'wifi',
    page: 'equip',
    title: "Y a-t-il un Wi-Fi dans l'établissement ?",
    type: 'choice',
    options: [
      { v: 'stable', l: 'Oui, stable' },
      { v: 'instable', l: 'Oui, mais instable' },
      { v: 'non', l: 'Non', elim: true },
    ],
    stop: { f: 'wifi', eq: 'non' },
  },
  {
    id: 'wifidetail',
    page: 'equip',
    rule: 'si Wi-Fi',
    when: { f: 'wifi', in: ['stable', 'instable'] },
    type: 'fields',
    fields: [
      { id: 'ssid', label: 'Nom du Wi-Fi (facultatif)' },
      { id: 'wifi_mdp', label: 'Mot de passe du Wi-Fi (facultatif)', secret: true },
    ],
  },
  {
    id: 'tvmarque',
    page: 'equip',
    title: 'Quelles marques de téléviseurs ?',
    help: 'Plusieurs réponses possibles.',
    type: 'multi',
    options: ['Samsung', 'LG', 'TCL', 'Maxwell', 'Condor', 'Telefunken', 'Autre'],
  },
  {
    id: 'tvos',
    page: 'equip',
    title: 'Quel système équipe les téléviseurs ?',
    help: "La marque ne suffit pas : c'est le système qui dit si l'application s'installe.",
    type: 'choice',
    options: [
      { v: 'android', l: 'Android TV ou Google TV' },
      { v: 'mixte', l: 'Parc mixte' },
      { v: 'autre', l: 'Autre système', other: true },
      { v: 'inconnu', l: 'Je ne sais pas' },
    ],
  },
  {
    id: 'jours',
    page: 'freq',
    title: "Jours d'ouverture",
    type: 'multi',
    options: [
      { v: 'Toute la semaine', all: true },
      'Lundi',
      'Mardi',
      'Mercredi',
      'Jeudi',
      'Vendredi',
      'Samedi',
      'Dimanche',
    ],
  },
  {
    id: 'heures',
    page: 'freq',
    title: 'Horaires habituels',
    help: 'Une fermeture après minuit est acceptée.',
    type: 'fields',
    fields: [
      { id: 'h_ouv', label: 'Ouverture', kind: 'time', req: true },
      { id: 'h_ferm', label: 'Fermeture', kind: 'time', req: true },
    ],
  },
  {
    id: 'wk',
    page: 'freq',
    title: 'Les horaires changent-ils le week-end ?',
    type: 'choice',
    options: [
      { v: 'oui', l: 'Oui, horaires spéciaux' },
      { v: 'non', l: 'Non, mêmes horaires' },
    ],
  },
  {
    id: 'wkheures',
    page: 'freq',
    rule: 'si horaires spéciaux le week-end',
    when: { f: 'wk', eq: 'oui' },
    type: 'fields',
    fields: [
      { id: 'wk_ouv', label: 'Ouverture le week-end', kind: 'time', req: true },
      { id: 'wk_ferm', label: 'Fermeture le week-end', kind: 'time', req: true },
    ],
  },
  {
    id: 'pointe',
    page: 'freq',
    title: 'Heures de pointe',
    type: 'multi',
    options: ['Matin', 'Midi', 'Après-midi', 'Soirée', 'Nuit'],
  },
  {
    id: 'pointesrc',
    page: 'freq',
    title: "D'où vient cette information ?",
    type: 'choice',
    options: ['Observé', 'Déclaré par le gérant', 'Les deux'],
  },
  {
    id: 'gamme',
    page: 'public',
    title: "Gamme de l'établissement",
    type: 'choice',
    options: ['Populaire', 'Moyen', 'Premium'],
  },
  {
    id: 'public',
    page: 'public',
    title: 'Quel public domine ?',
    help: 'Plusieurs réponses possibles. Elles serviront au ciblage contextuel.',
    type: 'multi',
    options: [
      'Hommes',
      'Femmes',
      'Étudiants',
      'Salariés',
      'Entrepreneurs et indépendants',
      'Sportifs',
      'Familles',
      'Parents',
      'Enfants',
      'Couples',
      'Retraités',
      'Touristes',
      'Autre',
    ],
  },
  {
    id: 'age',
    page: 'public',
    title: "Tranches d'âge dominantes",
    type: 'multi',
    options: ['10-16', '17-30', '31-45', '46-60', '60 et plus'],
  },
  {
    id: 'matchs',
    page: 'public',
    rule: 'si café, restaurant, lounge / bar ou espace de loisirs',
    when: { f: 'categorie', in: CATS_MATCH },
    title: "L'établissement diffuse-t-il les matchs ?",
    type: 'choice',
    options: ['Oui', 'Non'],
  },
  {
    id: 'zone',
    page: 'lieu',
    title: 'Zone à couvrir',
    type: 'choice',
    options: ['Intérieure', 'Extérieure', 'Les deux'],
  },
  {
    id: 'dims',
    page: 'lieu',
    type: 'fields',
    fields: [
      { id: 'surface', label: 'Surface estimée (m²)', kind: 'number' },
      { id: 'entrees', label: "Nombre d'entrées et sorties", kind: 'number', req: true },
    ],
  },
  {
    id: 'vitrine',
    page: 'lieu',
    title: 'Vitrine ou façade ouverte sur la rue ?',
    type: 'choice',
    options: ['Oui', 'Non'],
  },
  {
    id: 'enseigne',
    page: 'lieu',
    title: 'Établissement isolé ou enseigne ?',
    type: 'choice',
    options: [
      { v: 'isole', l: 'Établissement isolé' },
      { v: 'enseigne', l: 'Enseigne à plusieurs adresses' },
    ],
  },
  {
    id: 'nbadr',
    page: 'lieu',
    rule: 'si enseigne',
    when: { f: 'enseigne', eq: 'enseigne' },
    type: 'fields',
    fields: [{ id: 'nbadr', label: "Nombre d'adresses de l'enseigne", kind: 'number', req: true }],
  },
  {
    id: 'comprend',
    page: 'echange',
    when: DECIDEUR,
    title: 'Le gérant comprend-il le principe Toodooh ?',
    type: 'choice',
    options: ['Oui', 'En partie', 'Non'],
  },
  {
    id: 'interet',
    page: 'echange',
    when: DECIDEUR,
    title: "Quel est son niveau d'intérêt ?",
    type: 'choice',
    options: ['Très intéressé', 'Neutre', 'Sceptique'],
  },
  {
    id: 'objection',
    page: 'echange',
    rule: 'si neutre ou sceptique',
    when: { all: [DECIDEUR, { f: 'interet', in: ['Neutre', 'Sceptique'] }] },
    title: 'Quelle est son objection principale ?',
    type: 'choice',
    options: [
      'Mesure et image',
      'Revenu',
      'Liberté de refuser les campagnes',
      "Disponibilité de l'écran",
      'Autre',
    ],
  },
  {
    id: 'rapports',
    page: 'echange',
    when: DECIDEUR,
    title: "Les rapports de fréquentation l'intéressent-ils ?",
    type: 'choice',
    options: ['Oui', 'Non'],
  },
  {
    id: 'promesse',
    page: 'echange',
    when: DECIDEUR,
    title: 'Règle de zéro promesse',
    type: 'choice',
    options: [{ v: 'ok', l: "Je n'ai promis aucune estimation de revenu" }],
  },
  {
    id: 'avis',
    page: 'avis',
    fin: true,
    title: 'Ton avis : proposes-tu cet établissement ?',
    help: "Ton avis accompagne la fiche. Le manager donne l'éligibilité finale.",
    type: 'choice',
    options: [
      { v: 'oui', l: 'Oui, je le propose' },
      { v: 'non', l: 'Non, je ne le propose pas' },
    ],
  },
  {
    id: 'avis_com',
    page: 'avis',
    fin: true,
    type: 'fields',
    fields: [{ id: 'avis_com', label: 'Commentaire pour le manager (facultatif)' }],
  },
  {
    id: 'action',
    page: 'action',
    fin: true,
    title: 'Quelle est la prochaine action ?',
    help: 'Chaque fiche se termine par une action, quel que soit le parcours.',
    type: 'choice',
    options: [
      { v: 'decideur', l: 'Rencontrer le propriétaire ou le décideur' },
      { v: 'rdv', l: 'Prochain rendez-vous' },
      { v: 'relance', l: 'Relance' },
      { v: 'reobs', l: 'Nouvelle observation à un autre créneau' },
      { v: 'test', l: 'Garder en période de test' },
      { v: 'install', l: 'Installation du capteur et inscription' },
      { v: 'abandon', l: 'Abandon définitif' },
      'Autre',
    ],
  },
  {
    id: 'a_canal',
    page: 'action',
    fin: true,
    rule: 'si relance',
    when: { f: 'action', eq: 'relance' },
    title: 'Par quel canal ?',
    type: 'choice',
    options: ['Appel', 'WhatsApp', 'E-mail', 'Visite sur place'],
  },
  {
    id: 'a_date',
    page: 'action',
    fin: true,
    rule: 'sauf abandon',
    when: {
      f: 'action',
      in: ['decideur', 'rdv', 'relance', 'reobs', 'test', 'install', 'Autre'],
    },
    type: 'fields',
    fields: [{ id: 'a_date', label: 'Date prévue', kind: 'date', req: true }],
  },
];

// ── evaluation ─────────────────────────────────────────────────────────────────────────────

export const optValue = (o: Opt): string => (typeof o === 'string' ? o : o.v);
export const optLabel = (o: Opt): string => (typeof o === 'string' ? o : (o.l ?? o.v));
export const optIsOther = (o: Opt): boolean =>
  optValue(o) === 'Autre' || (typeof o !== 'string' && o.other === true);
export const optIsElim = (o: Opt): boolean => typeof o !== 'string' && o.elim === true;
export const optIsAll = (o: Opt): boolean => typeof o !== 'string' && o.all === true;

const text = (a: Answers, id: string): string | undefined => {
  const v = a[id];
  return typeof v === 'string' && v !== '' ? v : undefined;
};
const list = (a: Answers, id: string): string[] => {
  const v = a[id];
  return Array.isArray(v) ? v : [];
};

export const holds = (c: Cond, a: Answers): boolean => {
  if ('all' in c) return c.all.every((x) => holds(x, a));
  const v = text(a, c.f);
  if ('eq' in c) return v === c.eq;
  if ('ne' in c) return v !== undefined && v !== c.ne;
  return v !== undefined && c.in.includes(v);
};

/** Whether « Autre » (or an « other » option) is selected: the answer then needs a precision. */
export const otherSelected = (q: Question, a: Answers): boolean => {
  if (!q.options) return false;
  const selected = q.type === 'multi' ? list(a, q.id) : [text(a, q.id)];
  return q.options.some((o) => optIsOther(o) && selected.includes(optValue(o)));
};

/** The questions a fiche shows: conditions applied, and nothing after a stop but the closing ones. */
export const visibleQuestions = (a: Answers): Question[] => {
  const out: Question[] = [];
  let stopped = false;
  for (const q of QUESTIONS) {
    if (stopped && !q.fin) continue;
    if (q.when && !holds(q.when, a)) continue;
    out.push(q);
    if (q.stop && holds(q.stop, a)) stopped = true;
  }
  return out;
};

/** The pages of the visible questions, in order (10, 12, or fewer after an eliminatory answer). */
export const pagesOf = (visible: readonly Question[]): ChecklistPage[] => {
  const ids: string[] = [];
  for (const q of visible) if (!ids.includes(q.page)) ids.push(q.page);
  return ids.flatMap((id) => CHECKLIST_PAGES.filter((p) => p.id === id));
};

export const isAnswered = (q: Question, a: Answers): boolean => {
  if (q.type === 'choice') {
    return text(a, q.id) !== undefined && (!otherSelected(q, a) || !!text(a, `${q.id}_autre`));
  }
  if (q.type === 'multi') {
    return list(a, q.id).length > 0 && (!otherSelected(q, a) || !!text(a, `${q.id}_autre`));
  }
  return (q.fields ?? []).every((f) => !f.req || text(a, f.id) !== undefined);
};

/** The first unanswered visible question of a page (or of the whole fiche), else null. */
export const firstMissing = (a: Answers, pageId?: string): Question | null =>
  visibleQuestions(a)
    .filter((q) => !pageId || q.page === pageId)
    .find((q) => !isAnswered(q, a)) ?? null;

/** Whether an eliminatory answer was given (the red banner; the fiche closes). */
export const hasEliminatory = (a: Answers): boolean =>
  visibleQuestions(a).some(
    (q) =>
      q.type === 'choice' && (q.options ?? []).some((o) => optIsElim(o) && optValue(o) === a[q.id]),
  );

export type ChecklistResult = 'elig' | 'non' | 'inc';

export interface ResultDetail {
  res: ChecklistResult;
  motifs: string[];
  cond: string[];
  verif: string[];
  sig: string[];
}

/** The proposed result of a fiche. An answer hidden by a condition never counts. */
export const checklistResult = (a: Answers): ResultDetail => {
  const visible = visibleQuestions(a);
  const v = (id: string): string | undefined =>
    visible.some((q) => q.id === id || (q.fields ?? []).some((f) => f.id === id))
      ? text(a, id)
      : undefined;
  const r: ResultDetail = { res: 'elig', motifs: [], cond: [], verif: [], sig: [] };
  if (v('affluence') === 'moins') r.motifs.push('Affluence inférieure à 20 personnes en moyenne');
  if (v('tv') === 'Non') r.motifs.push('Aucun téléviseur');
  if (v('mesure') === 'Non') r.motifs.push("Mesure d'affluence refusée par le gérant");
  if (v('rne') === 'Non') {
    r.motifs.push("Pas d'immatriculation au RNE ni de RIB au nom de l'entreprise");
  }
  if (v('wifi') === 'non') r.motifs.push('Pas de Wi-Fi');
  if (r.motifs.length) {
    r.res = 'non';
    return r;
  }
  const couv = v('tvcouv');
  if (couv !== undefined && Number(couv) < SEUIL_COUVERTURE) {
    r.sig.push(`Couverture visuelle faible (${couv} %)`);
  }
  if (v('tvon') === 'Aucun') r.sig.push('Téléviseurs éteints lors du passage');
  if (v('rne') === 'À vérifier') r.verif.push('Immatriculation au RNE et RIB');
  if (v('wifi') === 'instable') r.cond.push("Wi-Fi stable à l'emplacement de l'écran");
  if (v('tvos') === 'autre') {
    r.cond.push("Appareil compatible avec l'application Toodooh (téléviseur non Android)");
  }
  if (v('tvos') === 'mixte') r.verif.push('Téléviseurs compatibles dans le parc mixte');
  if (v('tvos') === 'inconnu') r.verif.push('Système des téléviseurs');
  if (v('capteur') === 'accord') r.cond.push("Accord du gérant pour l'emplacement du capteur");
  if (v('capteur') === 'non') r.cond.push("Emplacement du capteur près de l'écran");
  if (v('mesure') === 'Réticent') r.sig.push("Réticence sur la mesure d'affluence");
  if (v('zone') === 'Extérieure') r.sig.push('Zone à couvrir uniquement extérieure');
  if (v('comprend') === 'Non') r.sig.push('Principe Toodooh non compris');
  if (v('interet') === 'Sceptique') {
    const objection = v('objection');
    r.sig.push(`Gérant sceptique${objection ? ` : ${objection.toLowerCase()}` : ''}`);
  }
  if (v('contact') === 'non' || v('contact') === 'absent') {
    r.res = 'inc';
    r.cond.unshift(
      "Rencontrer le gérant pour remplir la page « L'accord du gérant » (mesure d'affluence, RNE et RIB, capteur) et « L'échange avec le gérant »",
    );
  }
  return r;
};

export const RESULT_FR: Record<ChecklistResult, string> = {
  elig: 'Éligible',
  non: 'Non éligible',
  inc: 'À compléter',
};

// ── read-only rendering (the manager's and the admin's view in the Hub) ────────────────────

export interface RenderedItem {
  label: string;
  value: string;
  secret?: boolean;
  eliminatory?: boolean;
}

export interface RenderedPage {
  title: string;
  step: 'Présélection' | 'Qualification' | 'Clôture';
  items: RenderedItem[];
}

const frDate = (iso: string): string =>
  /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.split('-').reverse().join('/') : iso;

const fieldValue = (f: Field, raw: string | undefined): string => {
  if (raw === undefined) return '';
  if (f.kind === 'date') return frDate(raw);
  if (f.kind === 'range') return `${raw} %`;
  if (f.kind === 'time') return raw.replace(':', 'h');
  return raw;
};

/** Every visible answer as label / value, page by page, and the titles of the hidden pages. */
export const renderAnswers = (a: Answers): { pages: RenderedPage[]; hidden_pages: string[] } => {
  const visible = visibleQuestions(a);
  const shown = pagesOf(visible);
  const pages = shown.map((p) => ({
    title: p.title,
    step: STEP_NAME[p.step],
    items: visible
      .filter((q) => q.page === p.id)
      .flatMap((q): RenderedItem[] => {
        if (q.type === 'fields') {
          return (q.fields ?? []).map((f) => ({
            label: f.label.replace(' (facultatif)', ''),
            value: fieldValue(f, text(a, f.id)),
            ...(f.secret ? { secret: true } : {}),
          }));
        }
        const chosen = q.type === 'multi' ? list(a, q.id) : [text(a, q.id) ?? ''];
        const picked = (q.options ?? []).filter((o) => chosen.includes(optValue(o)));
        const other = otherSelected(q, a) ? text(a, `${q.id}_autre`) : undefined;
        return [
          {
            label: q.title ?? q.id,
            value: `${picked.map(optLabel).join(', ')}${other ? ` : ${other}` : ''}`,
            ...(picked.some(optIsElim) ? { eliminatory: true } : {}),
          },
        ];
      }),
  }));
  return {
    pages,
    hidden_pages: CHECKLIST_PAGES.filter((p) => !shown.includes(p)).map((p) => p.title),
  };
};
