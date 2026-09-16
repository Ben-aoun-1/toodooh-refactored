import { describe, expect, it } from 'vitest';

import {
  EXCLUSION_REASON_LABEL,
  columnLabels,
  exclusionLabel,
  exclusionSummary,
} from './eligible-hosts';

describe('ELIG-1 — eligible-hosts labels', () => {
  it('every engine exclusion code the api can send has a French label', () => {
    // The api's ExclusionReason union, verbatim — keep in step with lib/campaign-eligible-hosts.ts.
    const apiCodes = [
      'excluded',
      'capacity_missing',
      'hours_missing',
      'targeting_mismatch',
      'zone_mismatch',
      'inactive',
      'no_available_days',
      'no_residual_capacity',
      'not_event_eligible',
      'no_bloc_available',
      'no_sector',
    ];
    for (const code of apiCodes) {
      expect(EXCLUSION_REASON_LABEL).toHaveProperty(code);
      expect(exclusionLabel(code)).not.toBe(code);
    }
  });

  it('an unknown code is shown as is rather than hidden', () => {
    expect(exclusionLabel('something_new')).toBe('something_new');
  });

  it('groups exclusions by reason, most frequent first', () => {
    const summary = exclusionSummary([
      { id: '1', name: 'A', reason: 'inactive' },
      { id: '2', name: 'B', reason: 'targeting_mismatch' },
      { id: '3', name: 'C', reason: 'targeting_mismatch' },
    ]);
    expect(summary.map((s) => [s.reason, s.count])).toEqual([
      ['targeting_mismatch', 2],
      ['inactive', 1],
    ]);
    expect(exclusionSummary([])).toEqual([]);
  });

  it('names the columns after the engine that answered', () => {
    expect(columnLabels('event').hours).toBe('Blocs dispo');
    expect(columnLabels('standard').hours).toBe('Heures diffusables');
  });
});
