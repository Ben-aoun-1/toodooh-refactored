import type {
  AdminLocationStatus,
  AdminScreenRow,
} from '@/features/admin/services/admin-screens.service';
import {
  DEVICE_STATUS_LABELS,
  type DeviceStatus,
  deviceStatusOf,
} from '@/features/screenhost/lib/device-liveness';

/**
 * ADM-FIX1 — the « Localités et écrans » presentation rules, kept pure because apps/web has no
 * render harness (a rule living inside the page is unpinnable).
 *
 * The page used to claim a venue was « Active » on the strength of a screens ROW existing, and to
 * badge each screen « Actif » off `screens.is_active` — a column no code ever writes, so it reads
 * true forever. A declaration is not an installation: INSTALLED is the operator ruling
 * (`paired_at` or `last_seen_at` set — either proof a real device ran), served by the API.
 *
 * The per-screen vocabulary is NOT a second liveness truth: it delegates to `deviceStatusOf`,
 * the same connected / offline / never derivation the owner fleet and the admin eligibility card
 * already render.
 */

export interface StatusBadge {
  label: string;
  classes: string;
}

export const LOCATION_STATUS_BADGE: Record<AdminLocationStatus, StatusBadge> = {
  active: { label: 'Active', classes: 'bg-green-100 text-green-800' },
  inactive: { label: 'Inactive', classes: 'bg-gray-100 text-gray-800' },
  // Amber, never green: screens are declared but nothing was ever installed behind them.
  never_installed: { label: 'Jamais installée', classes: 'bg-amber-50 text-amber-800' },
  no_screens: { label: 'Sans écran', classes: 'bg-slate-100 text-slate-700' },
};

/** The status filter, « Tous les statuts » first — the option list IS the badge vocabulary. */
export const LOCATION_STATUS_FILTER_OPTIONS: {
  value: 'all' | AdminLocationStatus;
  label: string;
}[] = [
  { value: 'all', label: 'Tous les statuts' },
  ...(Object.keys(LOCATION_STATUS_BADGE) as AdminLocationStatus[]).map((value) => ({
    value,
    label: LOCATION_STATUS_BADGE[value].label,
  })),
];

/** The screens-table chip — the shared connected / offline / never vocabulary, admin tones. */
export const SCREEN_STATUS_BADGE: Record<DeviceStatus, StatusBadge> = {
  connected: { label: DEVICE_STATUS_LABELS.connected, classes: 'bg-green-100 text-green-800' },
  offline: { label: DEVICE_STATUS_LABELS.offline, classes: 'bg-amber-50 text-amber-700' },
  never: { label: DEVICE_STATUS_LABELS.never, classes: 'bg-gray-100 text-gray-500' },
};

/** One screen row's display state — `deviceStatusOf` is the ONE derivation, not a copy of it. */
export const screenStatusOf = (
  row: Pick<AdminScreenRow, 'connected' | 'last_seen_at'>,
): DeviceStatus => deviceStatusOf(row);

/**
 * The per-row twin of the venue's « Jamais installée ». Liveness alone cannot say it: a paired
 * device that never reported and a row no device ever answered are BOTH « Jamais connecté ».
 */
export const screenInstallNote = (row: Pick<AdminScreenRow, 'installed'>): string | null =>
  row.installed ? null : 'Jamais installé';

const plural = (n: number, word: string): string => `${n} ${word}${n > 1 ? 's' : ''}`;

/** SCR-DECL1 — the wording of a count nobody declared yet (0 screens, NULL rooms). */
export const NOT_DECLARED_LABEL = 'Non déclaré';
export const ROOMS_NOT_GIVEN_LABEL = 'Non renseigné';

/**
 * « 3 déclarés · 0 installé » — French agreement, and the page's own `> 1` convention: zero and
 * one stay singular (the listing already writes « 1 localité trouvée » / « 0 localité trouvée »).
 * SCR-DECL1: `declared` is the owner's DECLARATION (declared_screens_count), no longer the rows;
 * 0 means never declared and reads « Non déclaré », never « 0 déclaré ».
 */
export const screensCountLabel = (declared: number, installed: number): string =>
  `${declared > 0 ? plural(declared, 'déclaré') : NOT_DECLARED_LABEL} · ${plural(installed, 'installé')}`;

/** SCR-DECL1 — the venue's declared rooms: « Salles : 2 », or « Non renseigné » (NULL). */
export const roomsLabel = (rooms: number | null): string =>
  `Salles : ${rooms === null ? ROOMS_NOT_GIVEN_LABEL : rooms}`;

/** SCR-DECL1 — the admin user detail: the owner's declared screens summed over their venues. */
export const declaredScreensTotalLabel = (venues: readonly { screen_count: number }[]): string => {
  const total = venues.reduce((sum, venue) => sum + venue.screen_count, 0);
  return total > 0 ? plural(total, 'déclaré') : NOT_DECLARED_LABEL;
};
