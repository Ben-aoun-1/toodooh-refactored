import { describe, expect, it } from 'vitest';

import { deviceLine, isBlockingIssue, offlineStretches, yesNo } from './fleet-health';

describe('FLEET-2 — « Santé de la TV » display', () => {
  it('the device line and yes/no/unknown', () => {
    expect(
      deviceLine({
        app_version_name: '1.5.6',
        app_version_code: 21,
        android_release: '11',
        android_sdk: 30,
        manufacturer: 'TCL',
        model: 'Smart TV Pro',
        overlay_granted: true,
        auto_start_allowed: null,
        start_reason: 'boot',
        service_started_at: null,
      }),
    ).toBe('TCL Smart TV Pro · Android 11');
    expect([yesNo(true), yesNo(false), yesNo(null)]).toEqual(['oui', 'non', 'inconnu']);
    expect(isBlockingIssue('overlay_missing')).toBe(true);
    expect(isBlockingIssue('outdated')).toBe(false);
  });

  it('offline stretches from the connection history (newest first), an open one last seen', () => {
    const events = [
      { kind: 'disconnect', at: '2026-03-10T21:03:00Z' },
      { kind: 'connect', at: '2026-03-10T03:01:00Z' },
      { kind: 'playback_error', at: '2026-03-10T02:00:00Z' },
      { kind: 'disconnect', at: '2026-03-09T21:00:00Z' },
      { kind: 'connect', at: '2026-03-09T08:00:00Z' },
    ];
    expect(offlineStretches(events)).toEqual([
      { from: '2026-03-10T21:03:00Z', to: null },
      { from: '2026-03-09T21:00:00Z', to: '2026-03-10T03:01:00Z' },
    ]);
  });
});
