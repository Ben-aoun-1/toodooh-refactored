import { formatDistance } from 'date-fns';
import { fr } from 'date-fns/locale';

import type {
  AssignVenue,
  AssignableSensor,
  SensorVenueCard,
} from '../services/agent-sensors.service';

// Agent Screenhost spec VF §12 « Suivi des capteurs » and §14 « Assigner un capteur » — the
// pages' rules and wording, pure.

export type SensorFilter = 'all' | 'on' | 'off';

export const SENSOR_FILTERS: { key: SensorFilter; label: string }[] = [
  { key: 'all', label: 'Tous' },
  { key: 'on', label: 'En ligne' },
  { key: 'off', label: 'Hors ligne' },
];

/** The violet banner: singular with one sensor offline, plural with several, none otherwise. */
export const offlineBanner = (offline: number): string | null =>
  offline > 1
    ? 'Les capteurs hors ligne sont signalés en orange : prévenez les Screenhosts concernés ou passez les vérifier.'
    : offline === 1
      ? 'Un capteur hors ligne est signalé en orange : prévenez le Screenhost ou passez le vérifier.'
      : null;

/** En ligne = at least one sensor online; Hors ligne = at least one offline; plus the name search. */
export const filterSensorVenues = (
  rows: readonly SensorVenueCard[],
  filter: SensorFilter,
  query: string,
): SensorVenueCard[] => {
  const q = query.trim().toLowerCase();
  return rows.filter(
    (r) =>
      (filter === 'all' || (filter === 'on' ? r.online > 0 : r.offline > 0)) &&
      (!q || r.name.toLowerCase().includes(q)),
  );
};

export const SENSOR_EMPTY = 'Aucun Screenhost ne correspond à ce filtre.';

/** « il y a 5 minutes », or « – » for a sensor never seen. */
export const lastActivity = (iso: string | null, now: Date = new Date()): string =>
  iso ? formatDistance(new Date(iso), now, { addSuffix: true, locale: fr }) : '–';

export const batteryLabel = (pct: number | null): string => (pct === null ? '–' : `${pct} %`);

/** The 24 h curve: the polyline's points in a 760 × 170 box (a missing reading counts as 0). */
export const curvePoints = (
  values: readonly (number | null)[],
  w = 760,
  h = 170,
): [number, number][] => {
  const v = values.map((x) => x ?? 0);
  const max = Math.max(...v, 1);
  const last = Math.max(v.length - 1, 1);
  return v.map((x, i) => [(i / last) * w, h - (x / max) * (h - 10)]);
};

/** The hour labels under the curve (Tunis time, UTC+1 all year), at five positions. */
export const curveLabels = (at: readonly string[]): { index: number; label: string }[] =>
  [0, 6, 12, 18, 23]
    .filter((i) => i < at.length)
    .map((index) => ({
      index,
      label: `${String((new Date(at[index] ?? '').getUTCHours() + 1) % 24).padStart(2, '0')}h`,
    }));

/** A heat cell's shade step (0 = empty, 1…5 from light to strong) against the grid's maximum. */
export const heatStep = (value: number | null, max: number): 0 | 1 | 2 | 3 | 4 | 5 => {
  if (value === null) return 0;
  if (max <= 0) return 1;
  const r = Math.min(value / max, 1);
  return r > 0.8 ? 5 : r > 0.6 ? 4 : r > 0.4 ? 3 : r > 0.2 ? 2 : 1;
};

export const heatMax = (grid: readonly { days: (number | null)[] }[]): number =>
  Math.max(0, ...grid.flatMap((r) => r.days.map((d) => d ?? 0)));

export const HEAT_CAPTION = {
  type: "Semaine type : moyenne de toutes les mesures passées, par jour et par heure, dans les horaires d'ouverture.",
  week: 'Cette semaine : mesure du capteur, par jour et par heure. Les jours à venir sont vides.',
} as const;

// ── « Assigner mes capteurs » ──────────────────────────────────────────────────────────────

export type AssignFilter = 'all' | 'free' | 'done';

export const assignCounts = (sensors: readonly AssignableSensor[]) => {
  const free = sensors.filter((s) => !s.screenhost_id && !s.screenhost_name).length;
  return { all: sensors.length, free, done: sensors.length - free };
};

const isAssigned = (s: AssignableSensor) => Boolean(s.screenhost_id || s.screenhost_name);

export const filterAssignable = (
  sensors: readonly AssignableSensor[],
  filter: AssignFilter,
  query: string,
): AssignableSensor[] => {
  const q = query.trim().toLowerCase();
  return sensors.filter(
    (s) =>
      (filter === 'all' || (filter === 'free' ? !isAssigned(s) : isAssigned(s))) &&
      (!q || `${s.label} ${s.screenhost_name ?? ''}`.toLowerCase().includes(q)),
  );
};

export const SENSOR_STATUS: Record<AssignableSensor['status'], { label: string; badge: string }> = {
  online: { label: 'En ligne', badge: 'b-act' },
  offline: { label: 'Hors ligne', badge: 'b-att' },
  never: { label: 'Pas encore connecté', badge: 'b-gr' },
};

/** The picker's list: the search, and the venue the agent came from placed first. */
export const pickerVenues = (
  venues: readonly AssignVenue[],
  query: string,
  fromId: string | null,
): AssignVenue[] => {
  const q = query.trim().toLowerCase();
  return venues
    .filter((v) => !q || v.name.toLowerCase().includes(q))
    .sort((a, b) => Number(b.screenhost_id === fromId) - Number(a.screenhost_id === fromId));
};

/** « Affilié · 2 capteurs » / « En attente d'activation · aucun capteur ». */
export const pickerSubline = (v: AssignVenue): string =>
  `${v.status === 'en_cours' ? 'Affilié' : "En attente d'activation"} · ${
    v.sensor_count ? `${v.sensor_count} capteur${v.sensor_count > 1 ? 's' : ''}` : 'aucun capteur'
  }`;

export const assignedToast = (sensor: string, venue: string) =>
  `Capteur ${sensor} assigné à ${venue}`;
