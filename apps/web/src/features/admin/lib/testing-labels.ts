import { addDays, format, parseISO } from 'date-fns';

import type { HourState, HourStatusRow } from '@/features/admin/services/admin-testing.service';

// ADM-OBS2 (Mejri 17/09, rulings of 2026-09-18) — every label, unit and small derivation of the
// admin « Tests » page, kept pure so it is tested without a DOM (apps/web has no render harness).
// The names answer « c'est quoi ? »: each says what is counted, over which window, in which unit.

/** A number as the bench shows it: integers as-is, fractions to 2 decimals, missing as « — ». */
export const fmt = (v: number | null | undefined): string =>
  v === null || v === undefined ? '—' : Number.isInteger(v) ? String(v) : v.toFixed(2);

/** A TND amount to the millime (3 decimals), the precision the settlement pays in. */
export const fmtTnd = (v: number | null | undefined): string =>
  v === null || v === undefined ? '—' : v.toFixed(3);

// ── SPS ──────────────────────────────────────────────────────────────────────────────────────────

/** The four variables, each a percentage (0–100). */
export const SPS_VARIABLE_LABEL: Record<string, string> = {
  acceptation: 'Taux d’acceptation des campagnes (%)',
  respect_evenements: 'Respect des événements acceptés (%)',
  activite: 'Activité de l’écran — heures diffusées / heures programmées (%)',
  remplissage: 'Taux de remplissage de la semaine (%)',
};

/** Which window (in `windows_days`) each piece of evidence is counted over. */
const OBSERVATION_WINDOW: Record<string, string> = {
  decided: 'acceptation',
  attested: 'respect_evenements',
  scheduledElapsed: 'activite',
};

/** The evidence behind the variables, named for what it counts and over which window. */
export const spsObservationLabel = (key: string, windowsDays: Record<string, number>): string => {
  const window = OBSERVATION_WINDOW[key];
  const days = window === undefined ? undefined : windowsDays[window];
  const over = days === undefined ? '' : `, ${days} derniers jours`;
  switch (key) {
    case 'decided':
      return `Décisions prises (acceptées + refusées)${over}`;
    case 'attested':
      return `Contrôles d’événements reçus${over}`;
    case 'scheduledElapsed':
      return `Heures programmées déjà passées${over}`;
    case 'engagedSeconds':
      return 'Temps d’antenne réservé cette semaine (s)';
    default:
      return key;
  }
};

/** « Période de calcul » of each windowed variable. */
export const SPS_WINDOW_LABEL: Record<string, string> = {
  acceptation: 'Période de calcul — taux d’acceptation',
  activite: 'Période de calcul — activité de l’écran',
  respect_evenements: 'Période de calcul — respect des événements',
};

/** Ruling A — the stored score is the last daily computation, NOT an average. */
export const SPS_LIVE_LABEL = 'SPS actuel';
export const SPS_STORED_LABEL =
  'SPS enregistré (dernier calcul quotidien, utilisé par le dispatch)';

// ── Période ──────────────────────────────────────────────────────────────────────────────────────

export interface DayRange {
  from: string;
  to: string;
  count: number;
}

/** Consecutive days grouped into ranges (input in any order; duplicates ignored). */
export const dayRanges = (days: readonly string[]): DayRange[] => {
  const sorted = [...new Set(days)].sort();
  const out: DayRange[] = [];
  for (const day of sorted) {
    const last = out.at(-1);
    if (last !== undefined && format(addDays(parseISO(last.to), 1), 'yyyy-MM-dd') === day) {
      last.to = day;
      last.count += 1;
    } else {
      out.push({ from: day, to: day, count: 1 });
    }
  }
  return out;
};

/** « le 2026-08-26 » / « du 2026-08-26 au 2026-08-28 », ranges comma-joined; « — » when none. */
export const dayRangesLabel = (days: readonly string[]): string => {
  const ranges = dayRanges(days);
  if (ranges.length === 0) return '—';
  return ranges.map((r) => (r.count === 1 ? `le ${r.from}` : `du ${r.from} au ${r.to}`)).join(', ');
};

/** « 3 jours » / « 1 jour » / « 0 jour ». */
export const dayCountLabel = (n: number): string => `${n} jour${n > 1 ? 's' : ''}`;

// ── Statut par heure ─────────────────────────────────────────────────────────────────────────────

export const HOUR_STATE_LABEL: Record<HourState, string> = {
  libre: 'libre',
  partiel: 'partiel',
  plein: 'plein',
  indisponible: 'indisponible (choix du host)',
  reservee_evenement: 'réservée (événement)',
};

export const HOUR_STATE_CLASS: Record<HourState, string> = {
  libre: 'text-gray-500',
  partiel: 'text-amber-700',
  plein: 'text-red-700',
  indisponible: 'text-blue-700',
  reservee_evenement: 'text-violet-700',
};

/** « 24 heures : 10 libres, 8 partielles, 2 pleines, 3 indisponibles, 1 réservée (événement) ». */
export const statusCounts = (rows: readonly HourStatusRow[]): string => {
  const n = (state: HourState) => rows.filter((h) => h.state === state).length;
  return (
    `${rows.length} heures : ${n('libre')} libres, ${n('partiel')} partielles, ` +
    `${n('plein')} pleines, ${n('indisponible')} indisponibles, ` +
    `${n('reservee_evenement')} réservées (événement)`
  );
};

// ── Jours de la période ──────────────────────────────────────────────────────────────────────────

export const DAY_SOURCE_LABEL: Record<string, string> = {
  measured: 'mesuré',
  estimated: 'estimé',
};

/** A number read out of the raw config JSON, or null when absent or not a number. */
export const configNumber = (config: Record<string, unknown>, key: string): number | null => {
  const v = config[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
};
