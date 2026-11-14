import { describe, expect, it } from 'vitest';

import type { HostDecisionRow } from '@/features/admin/services/admin-host-decisions.service';

import {
  canAnswerForHost,
  hostDecisionSummary,
  refuseForHostQuestion,
  sortHostDecisions,
} from './host-decisions';

const row = (name: string, statut: HostDecisionRow['statut']): HostDecisionRow => ({
  kind: 'campaign',
  allocation_id: name,
  screenhost_id: name,
  screenhost_name: name,
  owner_label: null,
  statut,
  decided_at: null,
  owner_share_tnd: 10,
});

describe('Mariem 13/11 — the Admin answers for a Host', () => {
  it('answers only a share still awaiting its Host', () => {
    expect(canAnswerForHost(row('a', 'EN_ATTENTE'))).toBe(true);
    expect(canAnswerForHost(row('a', 'ACCEPTE'))).toBe(false);
    expect(canAnswerForHost(row('a', 'REFUSE'))).toBe(false);
    expect(canAnswerForHost(row('a', 'RESERVE'))).toBe(false);
  });
  it('lists the awaiting Hosts first', () => {
    const sorted = sortHostDecisions([
      row('Zeta', 'REFUSE'),
      row('Beta', 'ACCEPTE'),
      row('Gamma', 'EN_ATTENTE'),
      row('Alpha', 'EN_ATTENTE'),
    ]);
    expect(sorted.map((r) => r.screenhost_name)).toEqual(['Alpha', 'Gamma', 'Beta', 'Zeta']);
  });
  it('sums the answers up, plurals and empty groups handled', () => {
    expect(
      hostDecisionSummary([row('a', 'EN_ATTENTE'), row('b', 'ACCEPTE'), row('c', 'ACCEPTE')]),
    ).toBe('1 en attente · 2 acceptées');
    expect(hostDecisionSummary([row('a', 'REFUSE')])).toBe('1 refusée');
    expect(hostDecisionSummary([])).toBe('Aucun Host');
  });
  it('warns that a refusal is definitive', () => {
    expect(refuseForHostQuestion('Café Nord')).toBe(
      'Refuser pour Café Nord ? Ce refus est définitif : la part sera proposée à d’autres Hosts.',
    );
  });
});
