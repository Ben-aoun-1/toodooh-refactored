import { describe, expect, it } from 'vitest';

import { deletionOrder, nextScreenNames } from '../src/lib/screens.js';

// SCR-DECL1 — the « Écran N » naming and the deletion order the declared-screens reconciliation
// (lib/screens.ts updateScreenDeclaration) relies on. Pure; the DB behaviour is covered by
// screenhost-declaration.test.ts.
const T0 = new Date('2026-09-01T08:00:00Z');

describe('the row naming and deletion order (pure)', () => {
  it('takes the lowest free « Écran N » numbers', () => {
    expect(nextScreenNames([], 2)).toEqual(['Écran 1', 'Écran 2']);
    expect(nextScreenNames(['Écran 1', 'Écran 2', 'Écran 5'], 3)).toEqual([
      'Écran 3',
      'Écran 4',
      'Écran 6',
    ]);
    expect(nextScreenNames(['TV bar'], 1)).toEqual(['Écran 1']);
  });

  it('deletes the highest number first; an unnumbered name last', () => {
    const at = (ms: number) => new Date(T0.getTime() + ms);
    const order = deletionOrder([
      { name: 'Écran 2', createdAt: at(2) },
      { name: 'TV bar', createdAt: at(9) },
      { name: 'Écran 10', createdAt: at(1) },
      { name: 'Écran 3', createdAt: at(3) },
    ]).map((r) => r.name);
    expect(order).toEqual(['Écran 10', 'Écran 3', 'Écran 2', 'TV bar']);
  });
});
