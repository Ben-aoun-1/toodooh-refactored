import { describe, expect, it } from 'vitest';

import {
  BROADCASTS_MATCHES_REQUIRED_ERROR,
  RAMADAN_HOURS_ERROR,
  initialVenueDeclarations,
  isValidVenueDeclarations,
  venueDeclarationErrors,
  venueDeclarationsPayload,
} from './venue-declarations';

describe('venue declarations (Mariem 11/11 — Ramadan hours + « Diffusez-vous les matchs ? »)', () => {
  it('starts with an overnight Ramadan window and the match question unanswered', () => {
    const d = initialVenueDeclarations();
    expect(d).toEqual({ ramadanOpening: 20, ramadanClosing: 2, broadcastsMatches: null });
    expect(venueDeclarationErrors(d)).toEqual({
      broadcastsMatches: BROADCASTS_MATCHES_REQUIRED_ERROR,
    });
    expect(isValidVenueDeclarations(d)).toBe(false);
  });

  it('Non is an answer; an equal Ramadan pair is not', () => {
    const no = { ...initialVenueDeclarations(), broadcastsMatches: false };
    expect(isValidVenueDeclarations(no)).toBe(true);
    expect(venueDeclarationsPayload(no)).toEqual({
      ramadan_opening_hour: 20,
      ramadan_closing_hour: 2,
      broadcasts_matches: false,
    });
    expect(venueDeclarationErrors({ ...no, ramadanOpening: 5, ramadanClosing: 5 })).toEqual({
      ramadanHours: RAMADAN_HOURS_ERROR,
    });
  });

  it('Oui goes on the wire as true', () => {
    const yes = { ramadanOpening: 18, ramadanClosing: 23, broadcastsMatches: true };
    expect(venueDeclarationsPayload(yes).broadcasts_matches).toBe(true);
  });
});
