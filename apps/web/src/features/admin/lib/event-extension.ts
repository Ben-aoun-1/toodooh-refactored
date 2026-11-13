// EVT-ET1 (operator rulings 2026-10-27) — the admin's view of a match's live state and of its
// manual « Prolonger ». Pure; the api re-checks every rule (5–180 minutes, steps of 5, not after
// the match has ended, not annulé).

export const MIN_EXTENSION = 5;
export const MAX_EXTENSION = 180;
/** The quick picks the window offers; any other step of 5 can be typed. */
export const EXTENSION_PRESETS = [15, 30, 45, 60, 90] as const;

export const isValidExtension = (minutes: number): boolean =>
  Number.isInteger(minutes) &&
  minutes >= MIN_EXTENSION &&
  minutes <= MAX_EXTENSION &&
  minutes % 5 === 0;

/** « Prolonger » is offered until the match's current end. */
export const canExtend = (event: { annule: boolean; ends_at: string }, now: Date): boolean =>
  !event.annule && new Date(event.ends_at).getTime() > now.getTime();

/** « 1 h 15 » / « 45 min ». */
export const formatExtension = (minutes: number): string => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, '0')}`;
};

const STATUS_LABELS: Record<string, string> = {
  TBD: 'Horaire à définir',
  NS: 'Pas commencé',
  '1H': '1re mi-temps',
  HT: 'Mi-temps',
  '2H': '2e mi-temps',
  ET: 'Prolongation',
  BT: 'Pause avant prolongation',
  P: 'Tirs au but',
  SUSP: 'Suspendu',
  INT: 'Interrompu',
  FT: 'Terminé',
  AET: 'Terminé après prolongation',
  PEN: 'Terminé aux tirs au but',
  PST: 'Reporté',
  CANC: 'Annulé',
  ABD: 'Abandonné',
  AWD: 'Sur tapis vert',
  WO: 'Forfait',
  LIVE: 'En cours',
};

/** The API-Football column of the admin list. */
export const apiFootballLabel = (link: {
  fixture_id: number | null;
  status: string | null;
}): string => {
  if (link.fixture_id === null) return 'Non lié';
  const status = link.status ? (STATUS_LABELS[link.status] ?? link.status) : null;
  return status ? `Lié · ${status}` : 'Lié';
};
