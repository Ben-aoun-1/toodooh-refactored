import type { SensorStatus } from '@/features/screenhost/services/owner-sensors.service';

import type { DeviceStatus } from './device-liveness';
import type { CalendarCell } from './unavailability-calendar';

// CAL-2 — the pure rules of the Figma owner calendar (« Mon calendrier et mes dispositifs de
// diffusion »): what a day tile looks like and how a device reads. No React, pinned in tests.

/**
 * The tile a day renders:
 *  - blank       : a day of the neighbouring months (Figma leaves the slot empty);
 *  - past        : a day before today, number only, greyed, no tile;
 *  - today       : number with a green dot, not toggleable (the api refuses today);
 *  - available   : a future day, green tile;
 *  - unavailable : a future day the owner declared, red tile.
 */
export type TileState = 'blank' | 'past' | 'today' | 'available' | 'unavailable';

export const tileStateOf = (
  cell: CalendarCell,
  todayIso: string,
  declared: ReadonlySet<string>,
): TileState => {
  if (!cell.inMonth) return 'blank';
  if (cell.iso < todayIso) return 'past';
  if (cell.iso === todayIso) return 'today';
  return declared.has(cell.iso) ? 'unavailable' : 'available';
};

/** Only a future tile can be clicked. */
export const isTileToggleable = (state: TileState): boolean =>
  state === 'available' || state === 'unavailable';

/** Figma's tile colours (exact hexes from the frame). */
export const TILE_CLASSES: Record<TileState, string> = {
  blank: 'invisible',
  past: 'text-gray-300',
  today: 'text-gray-900 font-semibold',
  available: 'bg-[#E3F7EC] text-gray-900 hover:ring-2 hover:ring-brand-primary',
  unavailable: 'bg-[#FFEBEC] text-gray-900 hover:ring-2 hover:ring-red-300',
};

/** Figma's device badges: « Active » / « En panne » / « Inactif », with a leading dot. */
export type DeviceBadge = 'active' | 'down' | 'inactive';

export const DEVICE_BADGE_LABEL: Record<DeviceBadge, string> = {
  active: 'Active',
  down: 'En panne',
  inactive: 'Inactif',
};

export const DEVICE_BADGE_CLASSES: Record<DeviceBadge, { pill: string; dot: string }> = {
  active: { pill: 'bg-[#E3F7EC] text-[#2B8A57]', dot: 'bg-[#2B8A57]' },
  down: { pill: 'bg-orange-50 text-orange-700', dot: 'bg-orange-500' },
  inactive: { pill: 'bg-[#FFEBEC] text-red-700', dot: 'bg-red-500' },
};

/**
 * A screen: connected → Active; it was connected and went dark → En panne; never connected →
 * Inactif. A sensor reads the same way from the measured half-hours the hub sends.
 */
export const screenBadge = (status: DeviceStatus): DeviceBadge =>
  status === 'connected' ? 'active' : status === 'offline' ? 'down' : 'inactive';

export const sensorBadge = (status: SensorStatus): DeviceBadge =>
  status === 'active' ? 'active' : status === 'offline' ? 'down' : 'inactive';
