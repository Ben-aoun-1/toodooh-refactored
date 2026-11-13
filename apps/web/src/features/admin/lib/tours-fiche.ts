import type { ToursFiche, ToursFicheVenue, ToursVenueStatut } from './eligible-hosts';

// DISP-TOURS — the admin fiche of a campaign on the tours engine (Mariem's spec §3.3), PURE: what
// each block prints, so the components only lay it out. « Que l'admin puisse refaire le calcul et
// voir pourquoi chaque Screenhost a reçu ce qu'il a reçu. »

const nf = (n: number, digits = 0): string =>
  n.toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits });

export const tnd = (n: number): string => `${nf(n, 2)} TND`;
export const imp = (n: number): string => nf(Math.round(n));

/** « Tours reçus » — e.g. « 1, 2, 3 partiel (11 passages) »; « — » when none. */
export const toursRecus = (tours: ToursFicheVenue['tours'], rPlein: number): string =>
  tours.length === 0
    ? '—'
    : tours
        .map((t) =>
          t.passages >= rPlein ? `${t.tour}` : `${t.tour} partiel (${t.passages} passages)`,
        )
        .join(', ');

export const STATUT: Record<
  ToursVenueStatut,
  { label: string; tone: 'green' | 'blue' | 'gray' | 'amber' | 'red' }
> = {
  retenu: { label: 'Retenu', tone: 'green' },
  plein: { label: 'Plein', tone: 'blue' },
  non_retenu: { label: 'Non retenu', tone: 'gray' },
  retire_budget: { label: 'Retiré < 30 TND', tone: 'amber' },
  exclu_plein: { label: 'Exclu < 30 TND', tone: 'red' },
};

/** Why a venue is out of the campaign, in one sentence (the row's detail). */
export const statutDetail = (v: ToursFicheVenue): string | null =>
  v.statut === 'retire_budget'
    ? 'Sous 30 TND au budget choisi : retiré, ses impressions sont allées aux établissements retenus.'
    : v.statut === 'exclu_plein'
      ? `Sous 30 TND même rempli (${tnd(v.plein_montant_tnd)} au maximum) : jamais proposé.`
      : null;

const DAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

export interface WeekGrid {
  days: { dayOfWeek: number; label: string }[];
  hours: number[];
  cell: (dayOfWeek: number, hour: number) => ToursFicheVenue['week'][number] | undefined;
}

/** Bloc 3 — weekdays in columns (with their number of dates), hours in rows. */
export const weekGrid = (v: ToursFicheVenue): WeekGrid => {
  const byKey = new Map(v.week.map((c) => [`${c.day_of_week}:${c.hour}`, c]));
  const maxN = new Map<number, number>();
  for (const c of v.week) maxN.set(c.day_of_week, Math.max(maxN.get(c.day_of_week) ?? 0, c.n));
  const days = [...new Set(v.week.map((c) => c.day_of_week))]
    .sort((a, b) => a - b)
    .map((d) => ({
      dayOfWeek: d,
      label: `${DAYS[d - 1] ?? d}${(maxN.get(d) ?? 0) > 0 ? ` ×${maxN.get(d) ?? 0}` : ''}`,
    }));
  const hours = [...new Set(v.week.map((c) => c.hour))].sort((a, b) => a - b);
  return { days, hours, cell: (d, h) => byKey.get(`${d}:${h}`) };
};

const ok = (b: unknown): string => (b === true ? 'OK' : 'échec');
const num = (r: Record<string, number | string | boolean>, k: string): number => {
  const v = r[k];
  return typeof v === 'number' ? v : 0;
};

/** Bloc 4 — one line per engine phase, with its result. */
export const journalLine = (
  entry: ToursFiche['journal'][number],
): { label: string; text: string } => {
  const r = entry.result;
  switch (entry.phase) {
    case 'precalcul':
      return {
        label: 'Pré-calcul',
        text: `${imp(num(r, 'pool'))} établissements dans le pool, ${imp(num(r, 'heuresTypes'))} heures-types.`,
      };
    case 'file':
      return {
        label: 'File',
        text: `${imp(num(r, 'tranches'))} tranches · maximum ${imp(num(r, 'iMax'))} impressions, ${tnd(num(r, 'cMaxTnd'))}${num(r, 'exclusPlein') > 0 ? ` · ${num(r, 'exclusPlein')} exclu(s) sous 30 TND même rempli(s)` : ''}.`,
      };
    case 'remplissage':
      return {
        label: 'Remplissage',
        text: `Objectif ${imp(num(r, 'iCible'))} impressions · ${num(r, 'trancheCoupure') > 0 ? `coupure à la tranche n° ${num(r, 'trancheCoupure')}${num(r, 'k') > 0 ? `, ${num(r, 'k')} passages/h` : ' (non prise)'}` : 'toutes les tranches entières'}.`,
      };
    case 'anti_miette':
      return {
        label: 'Seuil 30 TND',
        text:
          num(r, 'retires') > 0
            ? `${num(r, 'retires')} établissement(s) retiré(s), ${imp(num(r, 'impressionsRedistribuees'))} impressions redistribuées aux retenus.`
            : 'Aucun établissement sous 30 TND.',
      };
    case 'verification':
      return {
        label: 'Vérification',
        text: `Objectif : ${ok(r['objectif'])} · prix exact : ${ok(r['prixExact'])} · aucun host sous 30 TND : ${ok(r['aucunSousSeuil'])}.`,
      };
    default:
      return { label: entry.phase, text: '' };
  }
};

/** Bloc 1 — when and how the figures were computed. */
export const calculHint = (f: ToursFiche): string => {
  const at = new Date(f.computed_at);
  const when = `${at.toLocaleDateString('fr-FR', { timeZone: 'Africa/Tunis' })} à ${at.toLocaleTimeString('fr-FR', { timeZone: 'Africa/Tunis', hour: '2-digit', minute: '2-digit' })}`;
  return `${f.source === 'plan' ? 'Calcul figé au lancement' : 'Calcul à l’instant (non lancée)'}, le ${when} · spot ${f.params.s} s · F ${f.params.f_max_seconds} s · ${f.params.r_plein} passages/h · T ${nf(f.params.t, 2)} · CPM ${nf(f.params.cpm, 2)} TND · plafond ${tnd(f.c_max_tnd)} pour ${imp(f.i_max)} impressions.`;
};
