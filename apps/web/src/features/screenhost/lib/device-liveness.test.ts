import { describe, expect, it } from 'vitest';

import type { OwnerDeviceRow } from '@/features/screenhost/services/owner-devices.service';

import {
  DEVICE_STATUS_LABELS,
  deviceCounts,
  deviceStatusOf,
  groupByVenue,
  lastSeenLabel,
} from './device-liveness';

// CF-D1 — the pure liveness presentation. The TRUTH is the server's `connected` flag (computed
// against the E6 tolerance); this module only derives the three display states and the French
// relative label.

const row = (over: Partial<OwnerDeviceRow>): OwnerDeviceRow => ({
  id: 'sc1',
  name: 'Écran 1',
  venue_id: 'v1',
  venue_name: 'Café Aouina',
  last_seen_at: null,
  connected: false,
  paired_at: null,
  created_at: '2026-07-01T10:00:00.000Z',
  ...over,
});

describe('deviceStatusOf', () => {
  it('connected wins; a seen-but-stale device is offline; never-seen is never', () => {
    expect(deviceStatusOf(row({ connected: true, last_seen_at: '2026-07-20T10:00:00Z' }))).toBe(
      'connected',
    );
    expect(deviceStatusOf(row({ connected: false, last_seen_at: '2026-07-20T10:00:00Z' }))).toBe(
      'offline',
    );
    expect(deviceStatusOf(row({ connected: false, last_seen_at: null }))).toBe('never');
  });

  it('pins the French labels', () => {
    expect(DEVICE_STATUS_LABELS).toEqual({
      connected: 'Connecté',
      offline: 'Hors ligne',
      never: 'Jamais connecté',
    });
  });
});

describe('lastSeenLabel (« vu il y a … »)', () => {
  const now = new Date('2026-07-20T12:00:00Z');
  it('minutes under an hour (floored, minimum 1)', () => {
    expect(lastSeenLabel('2026-07-20T11:59:40Z', now)).toBe('vu il y a 1 min');
    expect(lastSeenLabel('2026-07-20T11:35:00Z', now)).toBe('vu il y a 25 min');
  });
  it('hours under a day, then days', () => {
    expect(lastSeenLabel('2026-07-20T09:30:00Z', now)).toBe('vu il y a 2 h');
    expect(lastSeenLabel('2026-07-17T12:00:00Z', now)).toBe('vu il y a 3 j');
  });
});

describe('groupByVenue / deviceCounts (fleet)', () => {
  const rows = [
    row({ id: 'a1', venue_id: 'v1', venue_name: 'Café Aouina', connected: true }),
    row({ id: 'a2', venue_id: 'v1', venue_name: 'Café Aouina' }),
    row({
      id: 'b1',
      venue_id: 'v2',
      venue_name: 'Salle Bardo',
      last_seen_at: '2026-07-20T09:00:00Z',
    }),
  ];

  it('groups preserving the server order, one group per venue', () => {
    const groups = groupByVenue(rows);
    expect(groups.map((g) => g.venueName)).toEqual(['Café Aouina', 'Salle Bardo']);
    expect(groups[0]?.devices.map((d) => d.id)).toEqual(['a1', 'a2']);
    expect(groups[1]?.devices.map((d) => d.id)).toEqual(['b1']);
  });

  it('counts the three states for the summary chips', () => {
    expect(deviceCounts(rows)).toEqual({ connected: 1, offline: 1, never: 1 });
  });
});
