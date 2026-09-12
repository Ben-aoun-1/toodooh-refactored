import { describe, expect, it } from 'vitest';

import {
  SUPPORT_STATUSES,
  roleLabel,
  supportKindLabel,
  supportStatusLabel,
} from './support-status';

describe('admin support queue labels (SUP-1)', () => {
  it('two statuses, French labels', () => {
    expect(SUPPORT_STATUSES).toEqual(['new', 'handled']);
    expect(supportStatusLabel('new')).toBe('À traiter');
    expect(supportStatusLabel('handled')).toBe('Traité');
  });
  it('kinds and roles read in French', () => {
    expect(supportKindLabel('appointment')).toBe('Rendez-vous');
    expect(supportKindLabel('support')).toBe('Message');
    expect(roleLabel('fleet_owner')).toBe('Screenhost (réseau)');
    expect(roleLabel('unknown_role')).toBe('unknown_role');
  });
});
