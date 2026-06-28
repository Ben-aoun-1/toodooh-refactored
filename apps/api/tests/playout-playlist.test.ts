import { describe, expect, it } from 'vitest';

import { buildPlaylist, isWindowActive } from '../src/lib/playout/playlist.js';

describe('isWindowActive — campaign window covers now (V1 active rule, Africa/Tunis)', () => {
  // Anchored to a UTC instant (firmly 2026-07-15 in Africa/Tunis, UTC+1) so the assertion is
  // independent of the test runner's local timezone.
  const now = new Date('2026-07-15T12:00:00Z');

  it('is true within the window (inclusive boundaries)', () => {
    expect(isWindowActive('2026-07-01', '2026-07-31', now)).toBe(true);
    expect(isWindowActive('2026-07-15', '2026-07-15', now)).toBe(true);
  });

  it('is false before/after the window or when a bound is missing', () => {
    expect(isWindowActive('2026-07-16', '2026-07-31', now)).toBe(false);
    expect(isWindowActive('2026-07-01', '2026-07-14', now)).toBe(false);
    expect(isWindowActive(null, '2026-07-31', now)).toBe(false);
    expect(isWindowActive('2026-07-01', null, now)).toBe(false);
  });

  it('"today" is pinned to Africa/Tunis, not UTC (midnight boundary)', () => {
    // 23:30Z is still 2026-07-15 in UTC but already 2026-07-16 in Tunis (UTC+1).
    const lateUtc = new Date('2026-07-15T23:30:00Z');
    expect(isWindowActive('2026-07-16', '2026-07-16', lateUtc)).toBe(true); // Tunis sees the 16th
    expect(isWindowActive('2026-07-15', '2026-07-15', lateUtc)).toBe(false);
  });
});

describe('buildPlaylist — sources → UPDATE_PLAYLIST.data', () => {
  it('maps each source to a video (id = campaign id, default priority 0, reps 0, loop true)', () => {
    const pl = buildPlaylist([
      { campaignId: 'c1', campaignName: 'Promo', url: 'http://x/v.mp4', durationSeconds: 30 },
    ]);
    expect(pl.loop).toBe(true);
    expect(pl.videos).toEqual([
      {
        id: 'c1',
        url: 'http://x/v.mp4',
        campaign_name: 'Promo',
        duration_seconds: 30,
        priority: 0,
        reps_per_hour: 0, // no allocation rI on the source → 0 (player falls back)
      },
    ]);
  });

  it('carries reps_per_hour (R_i) from the source for spot cadence', () => {
    const pl = buildPlaylist([
      {
        campaignId: 'c1',
        campaignName: 'Promo',
        url: 'http://x/v.mp4',
        durationSeconds: 30,
        repsPerHour: 6,
      },
    ]);
    expect(pl.videos[0]?.reps_per_hour).toBe(6);
  });

  it('empty sources → empty playlist (still loop true)', () => {
    expect(buildPlaylist([])).toEqual({ videos: [], loop: true });
  });
});
