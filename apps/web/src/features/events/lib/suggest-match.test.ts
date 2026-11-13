import { describe, expect, it } from 'vitest';

import { existingEventIdOf, suggestedPeriodLine } from './suggest-match';

describe('SUGG-2 « Suggérer un match »', () => {
  it('reads the twin id of the 409 refusal, and nothing else', () => {
    expect(existingEventIdOf({ error: 'CONFLICT', existing_event_id: 'e-1' })).toBe('e-1');
    expect(existingEventIdOf({ error: 'CONFLICT' })).toBeNull();
    expect(existingEventIdOf({ existing_event_id: '' })).toBeNull();
    expect(existingEventIdOf({ existing_event_id: 42 })).toBeNull();
    expect(existingEventIdOf('CONFLICT')).toBeNull();
    expect(existingEventIdOf(null)).toBeNull();
    expect(existingEventIdOf(undefined)).toBeNull();
  });

  it('spells the period the screencaster chose, in Tunis time', () => {
    // 19:00 UTC = 20:00 in Tunis (UTC+1, no DST).
    expect(suggestedPeriodLine({ kickoff_at: '2026-11-20T19:00:00.000Z' })).toBe(
      'Période définie par vous : 20 novembre 2026 · 20h00 (heure de Tunis)',
    );
  });
});
