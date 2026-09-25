import { describe, expect, it } from 'vitest';

import {
  EXCLUSION_REASON_LABEL,
  columnLabels,
  exclusionLabel,
  exclusionSummary,
  shareText,
} from './eligible-hosts';

describe('ELIG-1 — eligible-hosts labels', () => {
  it('every engine exclusion code the api can send has a French label', () => {
    // The api's ExclusionReason union, verbatim — keep in step with lib/campaign-eligible-hosts.ts.
    const apiCodes = [
      'excluded',
      'hours_missing',
      'targeting_mismatch',
      'zone_mismatch',
      'inactive',
      'no_available_days',
      'no_residual_capacity',
      'not_event_eligible',
      'event_capacity_missing',
      'no_bloc_available',
      'no_sector',
      'owner_not_approved',
      'no_installed_screen',
      'not_in_frozen_week',
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

  it('CAP-EVT1 — an event venue whose capacity is empty says it is not event-eligible', () => {
    expect(exclusionLabel('event_capacity_missing')).toBe(
      'Non éligible aux événements (capacité de diffusion vide)',
    );
    // The retired standard code keeps a French label (an api from before CAP-EVT1 still sends it).
    expect(exclusionLabel('capacity_missing')).toBe('Capacité de diffusion non renseignée');
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

// ELIG-3 — the « part attribuée » column: one label, « — » when there is nothing to show.
describe('ELIG-3 — part attribuée', () => {
  it('the column label is the same on both engines', () => {
    expect(columnLabels('standard').share).toBe('Part attribuée');
    expect(columnLabels('event').share).toBe('Part attribuée');
  });

  it('renders the share fr-grouped, and « — » for no budget, an event or an older api', () => {
    expect(shareText(8484)).toBe((8484).toLocaleString('fr-FR'));
    expect(shareText(0)).toBe('0');
    expect(shareText(null)).toBe('—');
    expect(shareText(undefined)).toBe('—');
  });
});
