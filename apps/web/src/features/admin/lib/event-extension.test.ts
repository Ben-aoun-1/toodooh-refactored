import { describe, expect, it } from 'vitest';

import { apiFootballLabel, canExtend, formatExtension, isValidExtension } from './event-extension';

describe('EVT-ET1 admin extension rules', () => {
  it('accepts 5–180 minutes in steps of 5', () => {
    expect([5, 15, 45, 180].every(isValidExtension)).toBe(true);
    expect([0, 3, 7, 185, 12.5, -5].some(isValidExtension)).toBe(false);
  });

  it('offers « Prolonger » until the match has ended, never on an annulé one', () => {
    const now = new Date('2027-06-10T21:00:00Z');
    expect(canExtend({ annule: false, ends_at: '2027-06-10T21:30:00Z' }, now)).toBe(true);
    expect(canExtend({ annule: false, ends_at: '2027-06-10T20:59:00Z' }, now)).toBe(false);
    expect(canExtend({ annule: true, ends_at: '2027-06-10T21:30:00Z' }, now)).toBe(false);
  });

  it('formats durations and the live link in French', () => {
    expect(formatExtension(45)).toBe('45 min');
    expect(formatExtension(60)).toBe('1 h');
    expect(formatExtension(75)).toBe('1 h 15');
    expect(apiFootballLabel({ fixture_id: null, status: null })).toBe('Non lié');
    expect(apiFootballLabel({ fixture_id: 1, status: 'ET' })).toBe('Lié · Prolongation');
    expect(apiFootballLabel({ fixture_id: 1, status: 'XYZ' })).toBe('Lié · XYZ');
  });
});
