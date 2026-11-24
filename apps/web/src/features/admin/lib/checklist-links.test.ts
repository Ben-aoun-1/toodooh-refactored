import { describe, expect, it } from 'vitest';

import type { AdminChecklistRow } from '@/features/admin/services/admin-checklists.service';

import { countFor, decisionLabel, decisionTone, filterChecklists } from './checklist-links';

const row = (id: string, linked: boolean, status: AdminChecklistRow['status'] = 'validated') =>
  ({
    id,
    name: id,
    category: 'Cafés',
    governorate: 'Ariana',
    delegation: null,
    agent_name: 'Agent',
    agent_code: 'SH1',
    result: 'elig',
    agent_opinion: 'oui',
    status,
    sent_at: '2026-11-15T10:00:00Z',
    decided_at: null,
    decided_by_name: null,
    manager_comment: null,
    screenhost: linked ? { id: `sh-${id}`, name: `Host ${id}` } : null,
  }) satisfies AdminChecklistRow;

describe('admin checklist links', () => {
  const rows = [row('a', false), row('b', true), row('c', false, 'sent')];

  it('« À relier » keeps the fiches with no Host, « Reliées » the others, « Toutes » every one', () => {
    expect(filterChecklists(rows, 'a_relier').map((r) => r.id)).toEqual(['a', 'c']);
    expect(filterChecklists(rows, 'reliees').map((r) => r.id)).toEqual(['b']);
    expect(filterChecklists(rows, 'toutes')).toHaveLength(3);
    expect(countFor(rows, 'a_relier')).toBe(2);
  });

  it('the manager’s decision reads in French', () => {
    expect(decisionLabel('validated')).toBe('Validée par le manager');
    expect(decisionLabel('refused')).toBe('Refusée par le manager');
    expect(decisionLabel('sent')).toBe('En attente du manager');
    expect(decisionTone('refused')).toBe('ko');
  });
});
