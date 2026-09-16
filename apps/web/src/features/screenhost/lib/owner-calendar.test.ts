import { describe, expect, it } from 'vitest';

import {
  DEVICE_BADGE_LABEL,
  isTileToggleable,
  screenBadge,
  sensorBadge,
  tileStateOf,
} from './owner-calendar';
import { monthGrid } from './unavailability-calendar';

describe('CAL-2 — the Figma owner calendar rules', () => {
  const cells = monthGrid(2026, 8); // September 2026, Monday-first
  const today = '2026-09-16';
  const declared = new Set(['2026-09-20', '2026-09-10']);
  const stateOf = (iso: string) => {
    const cell = cells.find((c) => c.iso === iso);
    if (!cell) throw new Error(`no cell ${iso}`);
    return tileStateOf(cell, today, declared);
  };

  it('leaves the neighbouring months blank, greys the past, marks today', () => {
    expect(stateOf('2026-08-31')).toBe('blank'); // the Monday before the 1st
    expect(stateOf('2026-09-15')).toBe('past');
    // a declared day in the past is still just « past » — it can no longer change
    expect(stateOf('2026-09-10')).toBe('past');
    expect(stateOf('2026-09-16')).toBe('today');
  });

  it('colours future days by the owner declaration', () => {
    expect(stateOf('2026-09-17')).toBe('available');
    expect(stateOf('2026-09-20')).toBe('unavailable');
  });

  it('only future tiles toggle (the api refuses today and the past)', () => {
    expect(isTileToggleable('available')).toBe(true);
    expect(isTileToggleable('unavailable')).toBe(true);
    expect(isTileToggleable('today')).toBe(false);
    expect(isTileToggleable('past')).toBe(false);
    expect(isTileToggleable('blank')).toBe(false);
  });

  it('reads devices with the Figma labels', () => {
    expect(DEVICE_BADGE_LABEL[screenBadge('connected')]).toBe('Active');
    expect(DEVICE_BADGE_LABEL[screenBadge('offline')]).toBe('En panne');
    expect(DEVICE_BADGE_LABEL[screenBadge('never')]).toBe('Inactif');
    expect(DEVICE_BADGE_LABEL[sensorBadge('active')]).toBe('Active');
    expect(DEVICE_BADGE_LABEL[sensorBadge('offline')]).toBe('En panne');
    expect(DEVICE_BADGE_LABEL[sensorBadge('never')]).toBe('Inactif');
  });
});
