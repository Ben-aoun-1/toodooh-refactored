import { describe, expect, it } from 'vitest';

import { startFloorHelperText } from './wizard-dates';

// CF-Q2/CF-W1 — the Période step CONSUMES the server floor. Ruling #10 repealed the weekend
// filter (any start day is legal); the helper line carries no jours-ouvrés phrasing anymore.

describe('startFloorHelperText', () => {
  it('renders the French helper line from the wire ISO date (ruling #10 copy)', () => {
    expect(startFloorHelperText('2026-07-21')).toBe('Lancement possible à partir du 21/07/2026.');
  });

  it('returns null while the config has not arrived (no line, no crash)', () => {
    expect(startFloorHelperText(undefined)).toBeNull();
    expect(startFloorHelperText('')).toBeNull();
  });
});
