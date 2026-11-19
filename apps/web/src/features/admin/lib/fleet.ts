import type { FleetScreenWire, FleetStatus } from '@/features/admin/services/admin-fleet.service';

// FLEET-1 (operator 18/11) — « Parc d'écrans », the pure half: the words, colours, sentences and
// filters the page shows. The STATE itself is decided by the api (lib/fleet/status.ts).

export interface StatusMeta {
  label: string;
  /** One line under the counter: what it means for the admin. */
  hint: string;
  chip: string;
  dot: string;
}

export const STATUS_META: Record<FleetStatus, StatusMeta> = {
  hors_ligne_ouverture: {
    label: 'Hors ligne pendant l’ouverture',
    hint: 'Aucun signal alors que le lieu est ouvert ou que des pubs sont prévues.',
    chip: 'bg-red-100 text-red-800',
    dot: 'bg-red-500',
  },
  muet: {
    label: 'Connecté mais ne diffuse pas',
    hint: 'Des pubs sont prévues mais aucune n’est passée depuis trop longtemps.',
    chip: 'bg-orange-100 text-orange-800',
    dot: 'bg-orange-500',
  },
  diffuse: {
    label: 'En diffusion',
    hint: 'Connecté, les pubs prévues passent.',
    chip: 'bg-green-100 text-green-800',
    dot: 'bg-green-500',
  },
  rien_prevu: {
    label: 'Rien de prévu',
    hint: 'Connecté, aucune campagne à cette heure. Normal.',
    chip: 'bg-gray-100 text-gray-700',
    dot: 'bg-gray-400',
  },
  hors_ligne: {
    label: 'Éteint (hors ouverture)',
    hint: 'Aucun signal, mais rien n’est prévu et le lieu est fermé.',
    chip: 'bg-slate-100 text-slate-600',
    dot: 'bg-slate-300',
  },
  jamais: {
    label: 'Jamais connecté',
    hint: 'L’écran n’a encore jamais été relié à une TV.',
    chip: 'bg-slate-50 text-slate-500',
    dot: 'bg-slate-200',
  },
};

/** Most urgent first (twin of the api's FLEET_STATUS_ORDER). */
export const STATUS_ORDER: readonly FleetStatus[] = [
  'hors_ligne_ouverture',
  'muet',
  'diffuse',
  'rien_prevu',
  'hors_ligne',
  'jamais',
];

/** The four counters at the top (the two quiet states are folded into the list). */
export const COUNTER_STATUSES: readonly FleetStatus[] = [
  'hors_ligne_ouverture',
  'muet',
  'diffuse',
  'rien_prevu',
];

/** « à l’instant », « il y a 4 min », « il y a 3 h », « il y a 2 j ». */
export const sinceLabel = (iso: string | null, now: Date): string => {
  if (!iso) return 'jamais';
  const min = Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000);
  if (min < 1) return 'à l’instant';
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `il y a ${h} h`;
  return `il y a ${Math.floor(h / 24)} j`;
};

const names = (s: FleetScreenWire): string => s.now.campaigns.map((c) => c.name).join(', ');

/** The one sentence a row says. */
export const statusSentence = (s: FleetScreenWire, now: Date): string => {
  const last = s.last_proof
    ? `dernier passage ${sinceLabel(s.last_proof.at, now)}`
    : 'aucun passage encore';
  switch (s.status) {
    case 'diffuse':
      return `Diffuse ${names(s)} · ${last}`;
    case 'muet':
      return `Devrait diffuser ${names(s)} · ${last}`;
    case 'rien_prevu':
      return s.match_now
        ? 'Match en cours : les campagnes sont en pause'
        : 'Aucune campagne à cette heure';
    case 'hors_ligne_ouverture': {
      const since = s.last_seen_at
        ? `Hors ligne depuis ${sinceLabel(s.last_seen_at, now).replace('il y a ', '')}`
        : 'Hors ligne, jamais vu en ligne';
      const planned =
        s.now.planned_reps > 0 ? ` · ${s.now.planned_reps} passages prévus cette heure` : '';
      return since + planned;
    }
    case 'hors_ligne':
      return `Éteint · dernier signal ${sinceLabel(s.last_seen_at, now)}`;
    case 'jamais':
      return 'Pas encore installé';
  }
};

/** « 38 / 45 » — aired today against planned so far (the bar), the day's total apart. */
export const todayRatio = (s: FleetScreenWire): number =>
  s.today.planned_so_far > 0 ? Math.min(1, s.today.aired / s.today.planned_so_far) : 0;

export const countByStatus = (screens: readonly FleetScreenWire[]): Record<FleetStatus, number> => {
  const out = Object.fromEntries(STATUS_ORDER.map((st) => [st, 0])) as Record<FleetStatus, number>;
  for (const s of screens) out[s.status] += 1;
  return out;
};

export interface FleetFilters {
  status: FleetStatus | 'all';
  zone: string | 'all';
  search: string;
}

export const filterFleet = (
  screens: readonly FleetScreenWire[],
  f: FleetFilters,
): FleetScreenWire[] => {
  const q = f.search.trim().toLowerCase();
  return screens
    .filter(
      (s) =>
        (f.status === 'all' || s.status === f.status) &&
        (f.zone === 'all' || s.venue.zone === f.zone) &&
        (q === '' ||
          s.name.toLowerCase().includes(q) ||
          s.venue.name.toLowerCase().includes(q) ||
          s.now.campaigns.some((c) => c.name.toLowerCase().includes(q))),
    )
    .sort(
      (a, b) =>
        STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) ||
        a.venue.name.localeCompare(b.venue.name) ||
        a.name.localeCompare(b.name),
    );
};

export const zonesOf = (screens: readonly FleetScreenWire[]): string[] =>
  [...new Set(screens.map((s) => s.venue.zone).filter((z): z is string => z !== null))].sort();

/** One hour cell of the day strip: what colour tells the admin at a glance. */
export type HourTone = 'match' | 'idle' | 'future' | 'ok' | 'partial' | 'missed';

export const hourTone = (
  h: { hour: number; planned: number; aired: number; blackout_minutes: number },
  currentHour: number,
): HourTone => {
  if (h.blackout_minutes >= 60) return 'match';
  if (h.planned === 0) return 'idle';
  if (h.hour > currentHour) return 'future';
  if (h.hour === currentHour) return h.aired > 0 ? 'ok' : 'future';
  if (h.aired >= h.planned) return 'ok';
  return h.aired > 0 ? 'partial' : 'missed';
};

export const HOUR_TONE_CLASS: Record<HourTone, string> = {
  match: 'bg-brand-accent/40 text-brand-deep',
  idle: 'bg-gray-50 text-gray-300',
  future: 'bg-white text-gray-500 border border-dashed border-gray-300',
  ok: 'bg-green-500 text-white',
  partial: 'bg-orange-300 text-orange-950',
  missed: 'bg-red-500 text-white',
};

export const HOUR_TONE_LABEL: Record<HourTone, string> = {
  ok: 'Tout est passé',
  partial: 'Une partie seulement',
  missed: 'Rien n’est passé',
  future: 'À venir',
  idle: 'Rien de prévu',
  match: 'Match (campagnes en pause)',
};
