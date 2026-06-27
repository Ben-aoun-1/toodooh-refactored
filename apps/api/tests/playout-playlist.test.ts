import { describe, expect, it } from 'vitest';

import { buildPlaylist, isWindowActive } from '../src/lib/playout/playlist.js';

describe('isWindowActive — campaign window covers now (V1 active rule)', () => {
  const now = new Date(2026, 6, 15); // local 2026-07-15

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
});

describe('buildPlaylist — sources → UPDATE_PLAYLIST.data', () => {
  it('maps each source to a video (id = campaign id, default priority 0, loop true)', () => {
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
      },
    ]);
  });

  it('empty sources → empty playlist (still loop true)', () => {
    expect(buildPlaylist([])).toEqual({ videos: [], loop: true });
  });
});
