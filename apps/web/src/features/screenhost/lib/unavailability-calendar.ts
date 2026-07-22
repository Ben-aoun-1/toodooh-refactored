/**
 * E2 — the availability calendar's pure rules, leaflet-free and pinned without mounting the page.
 */

/** The honest consequence copy (spec-ruled wording — frozen plans are never rewritten). */
export const UNAVAILABILITY_CONSEQUENCE_COPY =
  'Les jours indisponibles sont exclus des prochaines campagnes. Les campagnes déjà planifiées ne sont pas affectées.';

/** Only STRICTLY-FUTURE days toggle — today and the past are locked (the api's PAST_OR_TODAY). */
export const isDayToggleable = (dayIso: string, todayIso: string): boolean => dayIso > todayIso;

export interface CalendarCell {
  iso: string;
  dayOfMonth: number;
  inMonth: boolean;
}

const pad = (n: number): string => String(n).padStart(2, '0');
export const isoOf = (year: number, monthIndex: number, day: number): string =>
  `${year}-${pad(monthIndex + 1)}-${pad(day)}`;

/**
 * The month grid, Monday-first, padded to full weeks with the neighbours' days (inMonth: false).
 * Pure date math on (year, monthIndex) — no Date arithmetic leaks into the component.
 */
export const monthGrid = (year: number, monthIndex: number): CalendarCell[] => {
  const first = new Date(year, monthIndex, 1);
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  // Monday-first offset: JS getDay() is Sun=0.
  const lead = (first.getDay() + 6) % 7;
  const cells: CalendarCell[] = [];
  for (let i = lead; i > 0; i -= 1) {
    const d = new Date(year, monthIndex, 1 - i);
    cells.push({
      iso: isoOf(d.getFullYear(), d.getMonth(), d.getDate()),
      dayOfMonth: d.getDate(),
      inMonth: false,
    });
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push({ iso: isoOf(year, monthIndex, day), dayOfMonth: day, inMonth: true });
  }
  while (cells.length % 7 !== 0) {
    const last = cells[cells.length - 1];
    const d = new Date(`${last?.iso ?? ''}T00:00:00`);
    d.setDate(d.getDate() + 1);
    cells.push({
      iso: isoOf(d.getFullYear(), d.getMonth(), d.getDate()),
      dayOfMonth: d.getDate(),
      inMonth: false,
    });
  }
  return cells;
};

export const MONTH_LABELS_FR = [
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
];

export const WEEKDAY_LABELS_FR = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
