import { format, parseISO, subDays, subMonths } from 'date-fns';

/**
 * Period model for the "Mes performances" page (Lane F). The mockups' pills — 7j / 28j (default) /
 * 3m / 12m / Depuis le début / Personnalisé — resolve to an INCLUSIVE ISO date range that every
 * period-driven section filters against CLIENT-SIDE (the datasets are fetched once per venue).
 * Pure module: all date maths live here (date-fns), never in components.
 */

export type PeriodKey = '7d' | '28d' | '3m' | '12m' | 'all' | 'custom';

export interface DateRange {
  /** Inclusive ISO YYYY-MM-DD lower bound. */
  from: string;
  /** Inclusive ISO YYYY-MM-DD upper bound. */
  to: string;
}

export const PERIOD_PILLS: { key: PeriodKey; label: string }[] = [
  { key: '7d', label: '7 derniers jours' },
  { key: '28d', label: '28 derniers jours' },
  { key: '3m', label: '3 mois' },
  { key: '12m', label: '12 mois' },
  { key: 'all', label: 'Depuis le début' },
  { key: 'custom', label: 'Personnalisé' },
];

/**
 * PERF-CUSTOM1 (opérateur, 2026-09-01) — « Personnalisé » est PARQUÉ, pas réparé : la pastille est
 * désactivée et annoncée « bientôt disponible » plutôt que de rester un clic sans effet.
 *
 * Pour qui le déparque : le clic écrit `periode=custom` SANS du/au (il n'y a pas encore de bornes),
 * `parsePeriodSelection` retombe alors sur '28d', donc `active` ne vaut jamais 'custom' et
 * PeriodFilters ne rend jamais les champs de dates qui auraient fourni ces bornes. Circulaire.
 * Détail complet au BACKLOG, entrée PERF-CUSTOM1.
 *
 * Le chemin URL est laissé INTACT : la branche custom fonctionne dès que les deux bornes sont
 * présentes, et aucun lien de ce genre ne peut exister dans la nature (l'UI n'a jamais su en
 * produire). C'est exactement ce qu'un dépaquage voudrait retrouver.
 */
export const PARKED_PERIOD_KEYS: readonly PeriodKey[] = ['custom'];
export const PARKED_PERIOD_NOTE = 'bientôt disponible';

/** Is this pill parked (rendered, disabled, annotated) rather than usable? */
export const isPeriodParked = (key: PeriodKey): boolean => PARKED_PERIOD_KEYS.includes(key);

/** The pill's visible text — parked pills carry the note so the owner gets an honest "not yet". */
export const periodPillLabel = (pill: { key: PeriodKey; label: string }): string =>
  isPeriodParked(pill.key) ? `${pill.label} — ${PARKED_PERIOD_NOTE}` : pill.label;

/** "Depuis le début" lower bound — before any TOODOOH data exists, so it filters nothing out. */
export const ALL_TIME_FROM = '2020-01-01';

const iso = (d: Date): string => format(d, 'yyyy-MM-dd');

/** ISO YYYY-MM-DD of a Date — the page's "today" anchor (components never do date maths). */
export const isoDate = (d: Date): string => iso(d);

/**
 * PERF-QA1 R8 — the TUNIS calendar day of `now` ('YYYY-MM-DD'; en-CA yields ISO). The server
 * buckets impressions on Africa/Tunis days; anchoring the page on the BROWSER-local day shifted
 * edge-of-day impressions onto the wrong curve point (the confirmed 26/06 case).
 */
export function tunisTodayIso(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Tunis' }).format(now);
}

/**
 * The Tunis "today" as a local-midnight Date — the ONE anchor every range/window derivation
 * uses, so all subsequent date-fns maths run on the server's calendar.
 */
export function tunisToday(now: Date = new Date()): Date {
  return parseISO(tunisTodayIso(now));
}

/**
 * The ONE impressions-daily fetch window per venue: the API bounds the range to 400 days, so the
 * page fetches the maximal [today−399, today] window once and filters client-side. A custom
 * period older than that window simply has no impression data (surfaced in the CF-9).
 */
export function impressionsFetchWindow(today: Date): DateRange {
  return { from: iso(subDays(today, 399)), to: iso(today) };
}

/**
 * Resolve a pill to its inclusive range, `today` included. 'custom' uses the provided pair when
 * BOTH ends are set (swapped if reversed); an incomplete custom pair falls back to the 28-day
 * default so the page never filters on a half-range.
 */
export function resolvePeriodRange(
  key: PeriodKey,
  today: Date,
  custom?: { from: string; to: string },
): DateRange {
  switch (key) {
    case '7d':
      return { from: iso(subDays(today, 6)), to: iso(today) };
    case '28d':
      return { from: iso(subDays(today, 27)), to: iso(today) };
    case '3m':
      return { from: iso(subMonths(today, 3)), to: iso(today) };
    case '12m':
      return { from: iso(subMonths(today, 12)), to: iso(today) };
    case 'all':
      return { from: ALL_TIME_FROM, to: iso(today) };
    case 'custom': {
      if (!custom || !custom.from || !custom.to) {
        return resolvePeriodRange('28d', today);
      }
      return custom.from <= custom.to
        ? { from: custom.from, to: custom.to }
        : { from: custom.to, to: custom.from };
    }
  }
}

/**
 * MEJ-4 (Mejri 31/08 pt 4) — THE période lives in the URL.
 *
 * It used to live in component state alone, so every reload silently snapped back to « 28
 * derniers jours ». That is the exact mechanism that turned a coherent « aujourd'hui » reading
 * into the 28-day estimated one Mejri then reported as fictitious: she had not changed the
 * filter, the refresh had. Carrying it in the query string also makes a view shareable — the
 * link IS the période.
 *
 * `periode` holds the pill key; `du` / `au` hold the custom bounds. Anything unparsable falls
 * back to the 28-day default rather than filtering on half a range (the resolvePeriodRange rule).
 */
export const PERIOD_PARAM = 'periode';
export const CUSTOM_FROM_PARAM = 'du';
export const CUSTOM_TO_PARAM = 'au';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const PERIOD_KEYS: readonly PeriodKey[] = PERIOD_PILLS.map((pill) => pill.key);

export interface PeriodSelection {
  period: PeriodKey;
  /** Only ever set for 'custom', and only when BOTH bounds parsed. */
  custom?: { from: string; to: string };
}

/** The default the page falls back to whenever the URL says nothing usable. */
export const DEFAULT_PERIOD_SELECTION: PeriodSelection = { period: '28d' };

const isPeriodKey = (value: string | null): value is PeriodKey =>
  value !== null && (PERIOD_KEYS as readonly string[]).includes(value);

/** Read the active période out of a query string. Never throws; never returns a half-range. */
export function parsePeriodSelection(params: URLSearchParams): PeriodSelection {
  const key = params.get(PERIOD_PARAM);
  if (!isPeriodKey(key)) return DEFAULT_PERIOD_SELECTION;
  if (key !== 'custom') return { period: key };
  const from = params.get(CUSTOM_FROM_PARAM);
  const to = params.get(CUSTOM_TO_PARAM);
  if (from === null || to === null || !ISO_DATE.test(from) || !ISO_DATE.test(to)) {
    return DEFAULT_PERIOD_SELECTION;
  }
  return { period: 'custom', custom: { from, to } };
}

/**
 * The query string for a selection, PRESERVING every other param (the venue picker or any future
 * one). The custom bounds are dropped for the non-custom pills so a stale `du`/`au` can never
 * outlive the pill that owned them.
 */
export function writePeriodSelection(
  params: URLSearchParams,
  selection: PeriodSelection,
): URLSearchParams {
  const next = new URLSearchParams(params);
  next.set(PERIOD_PARAM, selection.period);
  const custom = selection.period === 'custom' ? selection.custom : undefined;
  if (custom && ISO_DATE.test(custom.from) && ISO_DATE.test(custom.to)) {
    next.set(CUSTOM_FROM_PARAM, custom.from);
    next.set(CUSTOM_TO_PARAM, custom.to);
  } else {
    next.delete(CUSTOM_FROM_PARAM);
    next.delete(CUSTOM_TO_PARAM);
  }
  return next;
}

/** Inclusive containment — ISO date strings compare lexicographically. */
export function inRange(dateIso: string, range: DateRange): boolean {
  return dateIso >= range.from && dateIso <= range.to;
}

/** 'YYYY-MM-DD' → 'DD/MM/YYYY' (the mockups' date format). Returns '—' on a malformed input. */
export function formatDateFr(dateIso: string): string {
  const d = parseISO(dateIso);
  return Number.isNaN(d.getTime()) ? '—' : format(d, 'dd/MM/yyyy');
}

const MONTHS_FR = [
  'Janvier',
  'Février',
  'Mars',
  'Avril',
  'Mai',
  'Juin',
  'Juillet',
  'Août',
  'Septembre',
  'Octobre',
  'Novembre',
  'Décembre',
] as const;

/** 'YYYY-MM' → 'Juin 2026' (the monthly-report card/history titles). '—' on malformed input. */
export function monthLabelFr(month: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return '—';
  const name = MONTHS_FR[Number(match[2]) - 1];
  return name ? `${name} ${match[1]}` : '—';
}

/**
 * PERF-QA1 R1 — « Généré le » comes from the report row's REAL generated_at (ISO timestamp),
 * never re-derived from the month key (the retired firstOfFollowingMonth lied whenever a report
 * was generated late, regenerated, or caught up). '—' on malformed input.
 */
export function formatGeneratedAtFr(isoTimestamp: string): string {
  const d = parseISO(isoTimestamp);
  return Number.isNaN(d.getTime()) ? '—' : format(d, 'dd/MM/yyyy');
}

/** '05/06 – 18/06'-style compact period for campaign rows (S05); year-less per the mockup. */
export function formatCompactPeriod(startIso: string | null, endIso: string | null): string {
  const compact = (value: string | null): string | null => {
    if (!value) return null;
    const d = parseISO(value);
    return Number.isNaN(d.getTime()) ? null : format(d, 'dd/MM');
  };
  const start = compact(startIso);
  const end = compact(endIso);
  if (start && end) return `${start} – ${end}`;
  return start ?? end ?? '—';
}

/** '05/06 – 18/06/2026'-style period for the campaign-history table (S06). */
export function formatTablePeriod(startIso: string | null, endIso: string | null): string {
  const start = startIso ? parseISO(startIso) : null;
  const end = endIso ? parseISO(endIso) : null;
  const startOk = start && !Number.isNaN(start.getTime()) ? start : null;
  const endOk = end && !Number.isNaN(end.getTime()) ? end : null;
  if (startOk && endOk) return `${format(startOk, 'dd/MM')} – ${format(endOk, 'dd/MM/yyyy')}`;
  if (endOk) return format(endOk, 'dd/MM/yyyy');
  if (startOk) return format(startOk, 'dd/MM/yyyy');
  return '—';
}

/**
 * GREEN2 item 8a — the « Maximum observé » rider: the REAL peak date, or an honest « — » when no
 * peak exists yet (the mockup's literal « JJ/MM/AAAA » token must never reach the screen).
 */
export const peakObservedLabel = (peak: { date: string } | null | undefined): string =>
  peak ? formatDateFr(peak.date) : '—';
