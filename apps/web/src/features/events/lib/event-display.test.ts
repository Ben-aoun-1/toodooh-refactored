import { describe, expect, it } from 'vitest';

import {
  POSITIONNE_CTA,
  STATUT_LABELS,
  SUGGESTED_BADGE,
  WINDOW_LINE,
  formatEventDate,
  formatEventHours,
  validateSuggestForm,
} from './event-display';

// EV1 — the pure display + validation rules of the Événements surface.

describe('the status + card literals', () => {
  it('labels the three derived statuses in French', () => {
    expect(STATUT_LABELS.a_venir).toBe('À venir');
    expect(STATUT_LABELS.en_cours).toBe('En cours');
    expect(STATUT_LABELS.termine).toBe('Terminé');
  });

  it('spells the ± 1 h window line and the badges ONCE', () => {
    expect(WINDOW_LINE).toBe('Diffusion : 1 h avant · match · 1 h après');
    expect(SUGGESTED_BADGE).toBe('Suggéré par un annonceur');
    expect(POSITIONNE_CTA).toBe('Je me positionne');
  });
});

describe('Tunis formatting', () => {
  it('renders the kickoff date and the match interval in Tunis wall-clock (UTC+1)', () => {
    // 19:00 UTC = 20:00 Tunis.
    expect(formatEventDate('2027-03-10T19:00:00.000Z')).toBe('10 mars 2027');
    expect(formatEventHours('2027-03-10T19:00:00.000Z', '2027-03-10T21:30:00.000Z')).toBe(
      '20h00 - 22h30',
    );
  });
});

describe('validateSuggestForm — the four required fields (server-mirrored French)', () => {
  const valid = { team_a: 'EST', team_b: 'CA', date: '2027-04-01', kickoff_time: '20:00' };

  it('a complete form has no errors', () => {
    expect(validateSuggestForm(valid)).toEqual({});
  });

  it.each([
    ['team_a', "L'équipe A est obligatoire."],
    ['team_b', "L'équipe B est obligatoire."],
    ['date', 'La date du match est obligatoire.'],
    ['kickoff_time', "L'horaire du match est obligatoire."],
  ] as const)('a missing %s carries its own message', (field, message) => {
    const errors = validateSuggestForm({ ...valid, [field]: '   ' });
    expect(errors[field]).toBe(message);
    expect(Object.keys(errors)).toEqual([field]);
  });
});
