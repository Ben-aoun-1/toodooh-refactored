import type { OwnerDeviceRow } from '@/features/screenhost/services/owner-devices.service';

/**
 * CF-D1 — pure device-liveness presentation over the live wire. The truth is the server's
 * `connected` flag (computed against the E6 heartbeat tolerance — one liveness truth); this
 * module only derives the three DISPLAY states and the French relative-time label. The old
 * Supabase status enum (active/inactive/maintenance/unavailable) had no live backing and is gone.
 */
export type DeviceStatus = 'connected' | 'offline' | 'never';

export const DEVICE_STATUS_LABELS: Record<DeviceStatus, string> = {
  connected: 'Connecté',
  offline: 'Hors ligne',
  never: 'Jamais connecté',
};

export const deviceStatusOf = (
  row: Pick<OwnerDeviceRow, 'connected' | 'last_seen_at'>,
): DeviceStatus => {
  if (row.connected) return 'connected';
  return row.last_seen_at === null ? 'never' : 'offline';
};

/** « vu il y a 5 min » / « vu il y a 2 h » / « vu il y a 3 j » — floor units, minutes minimum 1. */
export const lastSeenLabel = (lastSeenAtIso: string, now: Date): string => {
  const ms = now.getTime() - new Date(lastSeenAtIso).getTime();
  const minutes = Math.max(1, Math.floor(ms / 60_000));
  if (minutes < 60) return `vu il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `vu il y a ${hours} h`;
  const days = Math.floor(hours / 24);
  return `vu il y a ${days} j`;
};

export interface VenueDevices {
  venueId: string;
  venueName: string;
  devices: OwnerDeviceRow[];
}

/** Fleet grouping — preserves the server's venue-then-name order. */
export const groupByVenue = (rows: readonly OwnerDeviceRow[]): VenueDevices[] => {
  const groups: VenueDevices[] = [];
  const byId = new Map<string, VenueDevices>();
  for (const row of rows) {
    let group = byId.get(row.venue_id);
    if (!group) {
      group = { venueId: row.venue_id, venueName: row.venue_name, devices: [] };
      byId.set(row.venue_id, group);
      groups.push(group);
    }
    group.devices.push(row);
  }
  return groups;
};

/** The summary chips' counts. */
export const deviceCounts = (rows: readonly OwnerDeviceRow[]): Record<DeviceStatus, number> => {
  const counts: Record<DeviceStatus, number> = { connected: 0, offline: 0, never: 0 };
  for (const row of rows) counts[deviceStatusOf(row)] += 1;
  return counts;
};
