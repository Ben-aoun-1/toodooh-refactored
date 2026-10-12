import { hourOfSlot } from '../../half-hour-slots.js';
import type { ReportData } from '../assemble.js';

import { type ContexteCalendaire, contexteCalendaire } from './calendar.js';
import {
  type FamilleLevier,
  type ReferentielCategory,
  referentielCategoryFor,
} from './referentiel.js';

/**
 * PISTES-V2 — the spec's input contract (docs/specs/piste-02-angles-morts.md §2) built from the
 * month's ReportData plus the venue facts the report does not carry, and the backend's choice of
 * mode (§8). PURE: the DB reads live in facts.ts, so every rule here is pinned by unit tests.
 *
 * Deviations from the contract, all ruled 2026-10-12 and recorded in the spec's header:
 * - `mesure.affluence_horaire` holds SENSOR-MEASURED cells only (invariant 3); an hour is the mean
 *   of its measured half-hours. `entrees` is not measured by the platform and is omitted.
 * - `mesure.mediane_ouverture` + a per-cell `pct_mediane` carry the spec's own step-2 ratios, so a
 *   body saying « 38 % de votre niveau habituel » passes post-check 6 (numbers come from the input).
 * - `uptime_capteur_pct` is the share of the month's audience data points that are sensor
 *   measurements (100 − the report's « dont N % estimés »): the closest signal the platform has.
 * - `attributs_declares` is {} (not collected yet → the model applies the rule of doubt).
 * - `profil_demographique_par_plage` is omitted: demographics are venue-level only, and a
 *   venue-level profile presented per slot would be a fabricated contrast.
 */

const DAY_NAMES = [
  'lundi',
  'mardi',
  'mercredi',
  'jeudi',
  'vendredi',
  'samedi',
  'dimanche',
] as const;

/** Spec §8 — fewer measured days than this: the fixed « insuffisant » text, no AI call. */
export const MIN_MEASURED_DAYS = 10;
/** Spec §8 — an uptime under this degrades the analysis (no precise hour may be cited). */
export const DEGRADED_UPTIME_PCT = 80;
/** Spec §8 — a strong/weak gap under this is a regular venue: intensify, never invent a gap. */
export const REGULAR_GAP_PCT = 20;

/** Spec §8 — the fixed text of the « insuffisant » mode (also the post-check fallback, §9). */
export const INSUFFICIENT_BODY =
  'La mesure de ce mois est trop partielle pour identifier un créneau sous-exploité de manière fiable. Cette lecture sera disponible dès le prochain rapport complet.';

export interface VenueFacts {
  venueName: string;
  sectorName: string | null;
  /** targeting_class: populaire | moyen | premium. */
  venueClass: string | null;
  zoneName: string | null;
  city: string | null;
  governorateName: string | null;
  openingHour: number | null;
  closingHour: number | null;
  /** Declared unavailability days inside the month (YYYY-MM-DD). */
  closures: string[];
}

export interface PisteHistory {
  /** Lever families used over the 3 previous months (spec §2 historique). */
  familles: FamilleLevier[];
  titres: string[];
  creneaux: string[];
}

export interface HourlyCell {
  jour: (typeof DAY_NAMES)[number];
  heure: number;
  occupancy_moyenne: number;
  pct_mediane: number;
}

export interface Piste02Input {
  periode: { debut: string; fin: string; libelle: string };
  etablissement: {
    nom: string;
    categorie: ReferentielCategory;
    sous_categorie: string | null;
    csp: 'Populaire' | 'Moyen' | 'Premium' | null;
    zone: string | null;
    horaires_ouverture: Record<string, [string, string][]>;
    jours_fermeture_exceptionnelle: string[];
    attributs_declares: Record<string, boolean>;
  };
  mesure: {
    jours_mesures: number;
    uptime_capteur_pct: number;
    mediane_ouverture: number;
    affluence_horaire: HourlyCell[];
  };
  comparatif: {
    mois_precedent: { affluence_totale_variation_pct: number } | null;
    meme_mois_annee_precedente: null;
  };
  contexte_calendaire: ContexteCalendaire;
  historique_recommandations: {
    familles_leviers_utilisees_3_derniers_mois: FamilleLevier[];
    titres_precedents: string[];
    creneaux_deja_cites: string[];
  };
}

export type Piste02Plan =
  /** No référentiel category for the sector: no generation, the card keeps « À venir ». */
  | { kind: 'skip'; reason: 'no_category' }
  /** Spec §8 « insuffisant »: the fixed text is stored, no AI call. */
  | { kind: 'insufficient'; reason: 'few_measured_days' | 'no_hours' | 'no_hourly_measure' }
  | {
      kind: 'generate';
      statut: 'genere' | 'degrade';
      /** The backend's mode instructions, passed to the model (spec §8: « transmet le mode »). */
      consignes: string[];
      /** true when an exact hour must not appear in the body (the uptime degraded mode). */
      noPreciseHour: boolean;
      input: Piste02Input;
    };

const MONTHS_FR = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
] as const;

const round1 = (n: number): number => Math.round(n * 10) / 10;
const hh = (h: number): string => `${String(h % 24).padStart(2, '0')}:00`;

const cspOf = (venueClass: string | null): Piste02Input['etablissement']['csp'] =>
  venueClass === 'populaire'
    ? 'Populaire'
    : venueClass === 'moyen'
      ? 'Moyen'
      : venueClass === 'premium'
        ? 'Premium'
        : null;

const zoneOf = (facts: VenueFacts): string | null => {
  const parts = [facts.zoneName ?? facts.city, facts.governorateName].filter(
    (p): p is string => typeof p === 'string' && p.trim() !== '',
  );
  return parts.length > 0 ? [...new Set(parts)].join(', ') : null;
};

/** The median of a non-empty list. */
const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[mid] ?? 0)
    : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
};

/**
 * The typical week as hourly cells: per (weekday, hour), the mean of the half-hours the SENSOR
 * measured (an estimation-only hour is left out). heatValues/heatKinds are 7 rows (lundi first)
 * over the heatSlots columns, and closed hours are already zeroed to kind none by assemble.
 */
export const measuredHourlyCells = (
  data: Pick<ReportData, 'heatSlots' | 'heatValues' | 'heatKinds'>,
): { jour: (typeof DAY_NAMES)[number]; heure: number; occupancy: number }[] => {
  const out: { jour: (typeof DAY_NAMES)[number]; heure: number; occupancy: number }[] = [];
  DAY_NAMES.forEach((jour, day) => {
    const byHour = new Map<number, number[]>();
    data.heatSlots.forEach((slot, col) => {
      if (data.heatKinds[day]?.[col] !== 'measured') return;
      const value = data.heatValues[day]?.[col];
      if (value === undefined) return;
      const hour = hourOfSlot(slot);
      byHour.set(hour, [...(byHour.get(hour) ?? []), value]);
    });
    for (const [heure, values] of [...byHour.entries()].sort((a, b) => a[0] - b[0])) {
      out.push({ jour, heure, occupancy: values.reduce((s, v) => s + v, 0) / values.length });
    }
  });
  return out;
};

export interface PlanArgs {
  month: string; // YYYY-MM
  data: Pick<ReportData, 'range' | 'kpis' | 'heatSlots' | 'heatValues' | 'heatKinds'>;
  facts: VenueFacts;
  /** The previous month's audience total, or null when it has no measured day. */
  previousGlobal: number | null;
  history: PisteHistory;
  /** true when the venue has no stored piste yet (spec §8 « premier rapport »). */
  firstReport: boolean;
}

/** The backend's mode decision + the input contract (spec §2 + §8). */
export function planPiste02(args: PlanArgs): Piste02Plan {
  const { data, facts } = args;
  const category = referentielCategoryFor(facts.sectorName);
  if (!category) return { kind: 'skip', reason: 'no_category' };
  if (data.kpis.measuredDays < MIN_MEASURED_DAYS) {
    return { kind: 'insufficient', reason: 'few_measured_days' };
  }
  if (facts.openingHour === null || facts.closingHour === null) {
    return { kind: 'insufficient', reason: 'no_hours' };
  }
  const cells = measuredHourlyCells(data);
  if (cells.length === 0) return { kind: 'insufficient', reason: 'no_hourly_measure' };

  const med = median(cells.map((c) => c.occupancy));
  const uptime = Math.round(100 - (data.kpis.estimatedPct ?? 100));
  const max = Math.max(...cells.map((c) => c.occupancy));
  const min = Math.min(...cells.map((c) => c.occupancy));
  const gapPct = max > 0 ? ((max - min) / max) * 100 : 0;
  const calendrier = contexteCalendaire(data.range.from, data.range.to);

  const consignes: string[] = [];
  let statut: 'genere' | 'degrade' = 'genere';
  const noPreciseHour = uptime < DEGRADED_UPTIME_PCT;
  if (noPreciseHour) {
    statut = 'degrade';
    consignes.push(
      `Mode imposé : degrade. L'uptime du capteur (${uptime} %) est inférieur à ${DEGRADED_UPTIME_PCT} % : ne cite aucun créneau horaire précis, raisonne par demi-journée et par jour de semaine.`,
    );
  }
  if (gapPct < REGULAR_GAP_PCT) {
    statut = 'degrade';
    consignes.push(
      `Mode imposé : degrade. L'écart entre le créneau le plus fort et le plus faible est inférieur à ${REGULAR_GAP_PCT} % : indique explicitement que la fréquentation est régulière et oriente vers un levier d'intensification plutôt que de comblement. Ne fabrique pas un angle mort inexistant.`,
    );
  }
  if (calendrier.ramadan) {
    consignes.push(
      'Ramadan actif sur la période : comparaisons intermensuelles neutralisées, analyse interne à la période uniquement.',
    );
  }
  if (args.firstReport) {
    consignes.push(
      "Premier rapport de l'établissement : pas d'historique de familles de leviers, privilégie la famille D ou C, les moins engageantes.",
    );
  }
  if (consignes.length === 0) consignes.push('Mode : genere.');

  const variation =
    args.previousGlobal !== null && args.previousGlobal > 0 && !calendrier.ramadan
      ? round1(((data.kpis.global - args.previousGlobal) / args.previousGlobal) * 100)
      : null;
  const horaires = Object.fromEntries(
    DAY_NAMES.map((d) => [d, [[hh(facts.openingHour ?? 0), hh(facts.closingHour ?? 0)]]]),
  ) as Record<string, [string, string][]>;
  const monthIndex = Number(args.month.slice(5, 7)) - 1;

  return {
    kind: 'generate',
    statut,
    consignes,
    noPreciseHour,
    input: {
      periode: {
        debut: data.range.from,
        fin: data.range.to,
        libelle: `${MONTHS_FR[monthIndex] ?? ''} ${args.month.slice(0, 4)}`,
      },
      etablissement: {
        nom: facts.venueName,
        categorie: category.categorie,
        sous_categorie: category.sousCategorie,
        csp: cspOf(facts.venueClass),
        zone: zoneOf(facts),
        horaires_ouverture: horaires,
        jours_fermeture_exceptionnelle: [...facts.closures].sort(),
        attributs_declares: {},
      },
      mesure: {
        jours_mesures: data.kpis.measuredDays,
        uptime_capteur_pct: uptime,
        mediane_ouverture: round1(med),
        affluence_horaire: cells.map((c) => ({
          jour: c.jour,
          heure: c.heure,
          occupancy_moyenne: round1(c.occupancy),
          pct_mediane: med > 0 ? Math.round((c.occupancy / med) * 100) : 0,
        })),
      },
      comparatif: {
        mois_precedent: variation === null ? null : { affluence_totale_variation_pct: variation },
        meme_mois_annee_precedente: null,
      },
      contexte_calendaire: calendrier,
      historique_recommandations: {
        familles_leviers_utilisees_3_derniers_mois: args.history.familles,
        titres_precedents: args.history.titres,
        creneaux_deja_cites: args.history.creneaux,
      },
    },
  };
}
