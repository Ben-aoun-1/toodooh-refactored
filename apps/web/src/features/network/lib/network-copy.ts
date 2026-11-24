import {
  entryQuartiers,
  entryRegions,
  type NetworkCounts,
  type NetworkEntry,
  type NetworkKind,
  type NetworkTab,
} from './network-entries';
import { NO_VALUE, plural } from './network-format';

// RESEAU-1 — every sentence of the two pages, verbatim from the prototype, keyed by page. The
// shared components read their words here, so « établissements » never leaks onto « Parcs TV ».

export interface NetworkCopy {
  heroLabel: string;
  headline: string;
  headlineAccent: string;
  lede: string;
  mapLabel: string;
  mapCaption: string;
  portraitTitle: string;
  portraitAccent: string;
  portraitIntro: string;
  regionTileTitle: string;
  listTitle: string;
  listAccent: string;
  listIntro: string;
  searchLabel: string;
  dockLabel: string;
  dockAction: string;
  dialogTitle: string;
  dialogBody: string;
  dialogNote: string;
  noneExcluded: string;
  noMatch: string;
  loadError: string;
}

export const NETWORK_COPY: Record<NetworkKind, NetworkCopy> = {
  venues: {
    heroLabel: 'Récapitulatif du réseau',
    headline: 'Des lieux de vie,',
    headlineAccent: 'une audience mesurée.',
    lede: 'Les établissements du réseau Toodooh, là où vos campagnes rencontrent leur public.',
    mapLabel: 'Carte du réseau par quartier',
    mapCaption: 'Cliquez sur un quartier pour filtrer la liste. Positions indicatives.',
    portraitTitle: 'Le portrait ',
    portraitAccent: 'du réseau',
    portraitIntro:
      'Chaque établissement est qualifié à son inscription : catégorie, région, quartier, CSP, répartition hommes / femmes et répartition des âges.',
    regionTileTitle: 'Région',
    listTitle: 'Les établissements, ',
    listAccent: 'un par un',
    listIntro:
      'Chaque lieu du réseau, avec sa catégorie, son quartier et le profil de son audience.',
    searchLabel: 'Rechercher un établissement',
    dockLabel: 'Sélection',
    dockAction: 'Ne plus diffuser dans ces établissements',
    dialogTitle: 'Ne plus diffuser dans ces établissements ?',
    dialogBody:
      'Vos campagnes ne seront plus diffusées dans les établissements suivants. Votre choix est transmis à Toodooh et pris en compte automatiquement.',
    dialogNote: 'Vous pourrez réintégrer ces établissements à tout moment depuis cette page.',
    noneExcluded:
      "Vous n'avez exclu aucun établissement. Vos campagnes peuvent être diffusées dans l'ensemble du réseau.",
    noMatch: 'Aucun établissement ne correspond à ces critères.',
    loadError: 'Impossible de charger le réseau Screenhosts pour le moment.',
  },
  parks: {
    heroLabel: 'Récapitulatif des parcs',
    headline: 'Une enseigne,',
    headlineAccent: 'plusieurs emplacements.',
    lede: 'Les parcs Toodooh : une même enseigne, présente dans plusieurs emplacements. Diffusez votre campagne dans tout le parc en une seule fois.',
    mapLabel: 'Carte des emplacements des parcs par quartier',
    mapCaption:
      'Chaque point compte les emplacements des parcs dans le quartier. Cliquez pour filtrer la liste. Positions indicatives.',
    portraitTitle: 'Le portrait ',
    portraitAccent: 'des parcs',
    portraitIntro:
      'Chaque parc est qualifié à son inscription, emplacement par emplacement : catégorie, région, quartier, CSP, répartition hommes / femmes et répartition des âges.',
    regionTileTitle: 'Emplacements par région',
    listTitle: 'Les parcs, ',
    listAccent: 'un par un',
    listIntro: 'Chaque parc, avec sa catégorie, ses emplacements et le profil de son audience.',
    searchLabel: 'Rechercher un parc',
    dockLabel: 'Sélection de parcs',
    dockAction: 'Ne plus diffuser dans ces parcs',
    dialogTitle: 'Ne plus diffuser dans ces parcs ?',
    dialogBody:
      'Vos campagnes ne seront plus diffusées dans aucun emplacement des parcs suivants. Votre choix est transmis à Toodooh et pris en compte automatiquement.',
    dialogNote: 'Vous pourrez réintégrer ces parcs à tout moment depuis cette page.',
    noneExcluded:
      "Vous n'avez exclu aucun parc. Vos campagnes peuvent être diffusées dans tous les parcs.",
    noMatch: 'Aucun parc ne correspond à ces critères.',
    loadError: 'Impossible de charger les parcs TV pour le moment.',
  },
};

export const TAB_LABELS: ReadonlyArray<[NetworkTab, string]> = [
  ['tous', 'Tous'],
  ['inclus', 'Inclus'],
  ['exclus', 'Exclus'],
];

export function tabCount(tab: NetworkTab, c: NetworkCounts): number {
  return tab === 'tous' ? c.total : tab === 'inclus' ? c.included : c.excluded;
}

/** The four hero counters; « personnes par mois » is null when the network has no figure. */
export function heroStats(
  kind: NetworkKind,
  c: NetworkCounts,
  personsPerMonth: number | null,
): Array<{ label: string; value: number | null }> {
  return kind === 'venues'
    ? [
        { label: 'établissements', value: c.total },
        { label: 'régions', value: c.regions },
        { label: 'quartiers', value: c.quartiers },
        { label: 'personnes par mois', value: personsPerMonth },
      ]
    : [
        { label: 'parcs', value: c.total },
        { label: 'emplacements', value: c.spots },
        { label: 'régions', value: c.regions },
        { label: 'quartiers', value: c.quartiers },
      ];
}

/** « 27 établissements sur 30 dans votre réseau » and its right-hand note. */
export function mineText(kind: NetworkKind, c: NetworkCounts): { main: string; sub: string } {
  if (kind === 'venues') {
    return {
      main: `${plural(c.included, 'établissement', 'établissements')} sur ${c.total} dans votre réseau`,
      sub:
        c.excluded === 0
          ? ''
          : c.excluded > 1
            ? `${c.excluded} exclus par vous`
            : '1 exclu par vous',
    };
  }
  const excluded =
    c.excluded === 0
      ? ''
      : c.excluded > 1
        ? ` · ${c.excluded} parcs exclus par vous`
        : ' · 1 parc exclu par vous';
  return {
    main: `${plural(c.included, 'parc', 'parcs')} sur ${c.total} dans votre réseau`,
    sub: `${plural(c.spotsIncluded, 'emplacement', 'emplacements')} sur ${c.spots}${excluded}`,
  };
}

export function dotLabel(
  kind: NetworkKind,
  quartier: string,
  included: number,
  count: number,
): string {
  return kind === 'venues'
    ? `${quartier}, ${included} sur ${count} dans votre réseau`
    : `${quartier}, ${plural(included, 'emplacement', 'emplacements')} sur ${count} dans votre réseau`;
}

export function countLine(kind: NetworkKind, shown: number, total: number): string {
  const many = shown > 1;
  if (kind === 'venues') {
    return `${shown}${many ? ' établissements affichés sur ' : ' établissement affiché sur '}${total}`;
  }
  return `${shown}${many ? ' parcs affichés sur ' : ' parc affiché sur '}${total}`;
}

export function dockText(kind: NetworkKind, n: number): string {
  if (kind === 'venues') {
    return n > 1 ? `${n} établissements sélectionnés` : `${n} établissement sélectionné`;
  }
  return n > 1 ? `${n} parcs sélectionnés` : `${n} parc sélectionné`;
}

export function toastText(kind: NetworkKind, done: number): string {
  if (kind === 'venues') {
    return done > 1
      ? `${done} établissements ont été retirés de votre réseau. Vos campagnes n’y seront plus diffusées.`
      : 'Un établissement a été retiré de votre réseau. Vos campagnes n’y seront plus diffusées.';
  }
  return done > 1
    ? `${done} parcs ont été retirés de votre réseau. Vos campagnes n’y seront plus diffusées, dans aucun de leurs emplacements.`
    : 'Un parc a été retiré de votre réseau. Vos campagnes n’y seront plus diffusées, dans aucun de ses emplacements.';
}

export function emptyText(kind: NetworkKind, tab: NetworkTab, excluded: number): string {
  const copy = NETWORK_COPY[kind];
  return tab === 'exclus' && excluded === 0 ? copy.noneExcluded : copy.noMatch;
}

/** The line under a card's name: « Ennasr, Ariana » or « 3 emplacements, Ariana, Tunis ». */
export function locationLine(kind: NetworkKind, entry: NetworkEntry): string {
  if (kind === 'venues') {
    const spot = entry.spots[0];
    return [spot?.quartier, spot?.region].filter(Boolean).join(', ') || NO_VALUE;
  }
  return [emplacements(entry), ...entryRegions(entry)].join(', ');
}

/** What the confirm dialog prints next to a name: its quartier, or its number of locations. */
export function dialogDetail(kind: NetworkKind, entry: NetworkEntry): string {
  return kind === 'venues' ? (entryQuartiers(entry)[0] ?? '') : emplacements(entry);
}

function emplacements(entry: NetworkEntry): string {
  return plural(entry.spots.length, 'emplacement', 'emplacements');
}

export const SOON_TITLE = 'Bientôt disponible';
export const SOON_BODY =
  'Les parcs TV arrivent prochainement sur Toodooh. Vous pourrez alors les consulter, les exclure et les réintégrer à tout moment depuis cette page.';
