import { describe, expect, it } from 'vitest';

import { DECLARED_COUNT_ERROR } from '@/lib/screen-declaration';

import {
  NOT_DECLARED_LABEL,
  declarationPatchFrom,
  declarationSummary,
  declaredCountInput,
} from './venue-declaration';

// SCR-DECL1 — the owner « Écrans et salles » card logic (pure; no render harness).

describe('declarationSummary', () => {
  it('reads « N écrans · M salles », singular at one', () => {
    expect(declarationSummary(3, 2)).toBe('3 écrans · 2 salles');
    expect(declarationSummary(1, 1)).toBe('1 écran · 1 salle');
  });

  it('is null while either count is undeclared (0 screens, or rooms never given)', () => {
    expect(declarationSummary(0, 2)).toBeNull();
    expect(declarationSummary(3, null)).toBeNull();
    expect(NOT_DECLARED_LABEL).toBe('À renseigner');
  });
});

describe('declarationPatchFrom', () => {
  it('sends BOTH exact counts', () => {
    expect(declarationPatchFrom('3', ' 2 ')).toEqual({ patch: { screen_count: 3, room_count: 2 } });
  });

  it('refuses a blank or invalid count with the shared French message', () => {
    for (const [screens, rooms] of [
      ['', '2'],
      ['3', ''],
      ['0', '2'],
      ['3', '100'],
      ['6-10', '2'],
    ]) {
      expect(declarationPatchFrom(screens ?? '', rooms ?? '')).toEqual({
        error: DECLARED_COUNT_ERROR,
      });
    }
  });
});

describe('the prefill', () => {
  it('shows a saved declaration and leaves « never declared » empty (the field is required)', () => {
    expect(declaredCountInput(3)).toBe('3');
    expect(declaredCountInput(0)).toBe('');
    expect(declaredCountInput(null)).toBe('');
  });
});
