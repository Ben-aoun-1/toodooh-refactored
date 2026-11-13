import { describe, expect, it } from 'vitest';

import { fixtureKeys, matchNameKey } from '../src/lib/event-match-name.js';

// SUGG-2 — the duplicate gate's comparison key (pure).
describe('event match-name key', () => {
  it('folds case, accents, spacing and every separator', () => {
    const key = 'libye|esperance de tunis';
    expect(matchNameKey('Libye - Espérance de Tunis')).toBe(key);
    expect(matchNameKey('Libye – Espérance de Tunis')).toBe(key);
    expect(matchNameKey('LIBYE  —  ESPERANCE DE TUNIS')).toBe(key);
    expect(matchNameKey('Libye vs Espérance de Tunis')).toBe(key);
    expect(fixtureKeys('Espérance de Tunis', 'libye').has(key)).toBe(true);
    expect(fixtureKeys(' libye ', 'Espérance  de Tunis').has(key)).toBe(true);
  });

  it('leaves a name that is not « A - B » whole, so it matches no fixture', () => {
    expect(matchNameKey('Soirée Ligue des champions')).toBe('soiree ligue des champions');
    expect(
      fixtureKeys('Soirée Ligue', 'des champions').has(matchNameKey('Soirée Ligue des champions')),
    ).toBe(false);
  });

  it('a hyphenated team name is not split inside the team', () => {
    expect(matchNameKey('Paris Saint-Germain - Real Madrid')).toBe(
      'paris saint-germain|real madrid',
    );
  });
});
