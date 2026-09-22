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
      'owner_not_approved',
      'no_installed_screen',
    ];
    for (const code of apiCodes) {
      expect(EXCLUSION_REASON_LABEL).toHaveProperty(code);
      expect(exclusionLabel(code)).not.toBe(code);
    }
  });

  it('ELIG-2 — a venue whose owner is not validated says so in French', () => {
    expect(EXCLUSION_REASON_LABEL.owner_not_approved).toBe('Propriétaire non validé');
    expect(exclusionLabel('owner_not_approved')).toBe('Propriétaire non validé');
    const summary = exclusionSummary([
      { id: '1', name: 'A', reason: 'owner_not_approved' },
      { id: '2', name: 'B', reason: 'owner_not_approved' },
      { id: '3', name: 'C', reason: 'inactive' },
    ]);
    expect(summary[0]).toEqual({
      reason: 'owner_not_approved',
      label: 'Propriétaire non validé',
      count: 2,
    });
  });

  it('MAP-TV1 — a venue with no installed screen says so in French', () => {
    expect(EXCLUSION_REASON_LABEL.no_installed_screen).toBe('Aucun écran installé');
    expect(exclusionLabel('no_installed_screen')).toBe('Aucun écran installé');
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
