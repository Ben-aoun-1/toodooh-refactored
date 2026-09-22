import { describe, expect, it } from 'vitest';

import type { AdminScreenRow } from '@/features/admin/services/admin-screens.service';
import { DEVICE_STATUS_LABELS } from '@/features/screenhost/lib/device-liveness';

import {
  LOCATION_STATUS_BADGE,
  LOCATION_STATUS_FILTER_OPTIONS,
  SCREEN_STATUS_BADGE,
  declaredScreensTotalLabel,
  roomsLabel,
  screenInstallNote,
  screenStatusOf,
  screensCountLabel,
} from './venue-screens';

// ADM-FIX1 — a venue whose screens never ran must not read « Active », and a screen row must not
// be badged off `screens.is_active` (a column nothing writes).

const screen = (over: Partial<AdminScreenRow>): AdminScreenRow => ({
  id: 'sc1',
  name: 'Écran 1',
  installed: false,
  connected: false,
  last_seen_at: null,
  paired_at: null,
  ...over,
});

describe('LOCATION_STATUS_BADGE', () => {
  it('names the never-installed venue « Jamais installée », and does NOT paint it green', () => {
    expect(LOCATION_STATUS_BADGE.never_installed.label).toBe('Jamais installée');
    expect(LOCATION_STATUS_BADGE.never_installed.classes).toContain('amber');
    expect(LOCATION_STATUS_BADGE.never_installed.classes).not.toContain('green');
  });

  it('keeps the three statuses that were already served', () => {
    expect(LOCATION_STATUS_BADGE.active.label).toBe('Active');
    expect(LOCATION_STATUS_BADGE.inactive.label).toBe('Inactive');
    expect(LOCATION_STATUS_BADGE.no_screens.label).toBe('Sans écran');
    expect(LOCATION_STATUS_BADGE.active.classes).toContain('green');
  });
});

describe('LOCATION_STATUS_FILTER_OPTIONS', () => {
  it('offers « Tous les statuts » plus EVERY badged status — the filter cannot fall behind', () => {
    expect(LOCATION_STATUS_FILTER_OPTIONS[0]).toEqual({ value: 'all', label: 'Tous les statuts' });
    expect(LOCATION_STATUS_FILTER_OPTIONS.slice(1).map((o) => o.value)).toEqual(
      Object.keys(LOCATION_STATUS_BADGE),
    );
    expect(LOCATION_STATUS_FILTER_OPTIONS.map((o) => o.label)).toContain('Jamais installée');
  });
});

describe('screenStatusOf', () => {
  it('reuses the connected / offline / never derivation', () => {
    expect(screenStatusOf(screen({ connected: true, last_seen_at: '2026-09-20T10:00:00Z' }))).toBe(
      'connected',
    );
    expect(screenStatusOf(screen({ connected: false, last_seen_at: '2026-09-01T10:00:00Z' }))).toBe(
      'offline',
    );
    expect(screenStatusOf(screen({ connected: false, last_seen_at: null }))).toBe('never');
  });

  it('a paired-but-silent screen is installed yet « Jamais connecté »', () => {
    const paired = screen({ installed: true, paired_at: '2026-09-10T08:00:00Z' });
    expect(screenStatusOf(paired)).toBe('never');
    expect(SCREEN_STATUS_BADGE[screenStatusOf(paired)].label).toBe(DEVICE_STATUS_LABELS.never);
    // Liveness alone cannot tell it from a declared-only row — the note is what does.
    expect(screenInstallNote(paired)).toBeNull();
    expect(screenStatusOf(screen({ installed: false }))).toBe('never');
    expect(screenInstallNote(screen({ installed: false }))).toBe('Jamais installé');
  });

  it('borrows the shared French labels rather than restating them', () => {
    expect(SCREEN_STATUS_BADGE.connected.label).toBe(DEVICE_STATUS_LABELS.connected);
    expect(SCREEN_STATUS_BADGE.offline.label).toBe(DEVICE_STATUS_LABELS.offline);
  });
});

describe('screensCountLabel', () => {
  it('shows declared vs installed, singular at 0 and 1', () => {
    expect(screensCountLabel(3, 0)).toBe('3 déclarés · 0 installé');
    expect(screensCountLabel(1, 1)).toBe('1 déclaré · 1 installé');
    expect(screensCountLabel(4, 2)).toBe('4 déclarés · 2 installés');
  });

  // SCR-DECL1 — a venue nobody declared reads « Non déclaré », not « 0 déclaré ».
  it('reads « Non déclaré » when the declaration is 0', () => {
    expect(screensCountLabel(0, 0)).toBe('Non déclaré · 0 installé');
    expect(screensCountLabel(0, 1)).toBe('Non déclaré · 1 installé');
  });
});

describe('the declaration labels (SCR-DECL1)', () => {
  it('rooms: the count, or « Non renseigné » when never declared', () => {
    expect(roomsLabel(2)).toBe('Salles : 2');
    expect(roomsLabel(null)).toBe('Salles : Non renseigné');
  });

  it('the user detail sums the owner’s venues', () => {
    expect(declaredScreensTotalLabel([{ screen_count: 3 }, { screen_count: 2 }])).toBe(
      '5 déclarés',
    );
    expect(declaredScreensTotalLabel([{ screen_count: 1 }])).toBe('1 déclaré');
    expect(declaredScreensTotalLabel([{ screen_count: 0 }])).toBe('Non déclaré');
    expect(declaredScreensTotalLabel([])).toBe('Non déclaré');
  });
});
