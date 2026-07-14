import { describe, expect, it } from 'vitest';

import {
  isJourOuvre,
  premiereDateDisponible,
  startDateViolation,
  tunisDateOf,
} from '../src/lib/campaign-dates.js';

// CF-Q2 (spec §1.4) — the centralized start-date rule. RULED: the spec's EXAMPLE beats its
// prose — the floor is TWO WORKING DAYS of lead; week-end starts are blocked outright.
// Anchor week: Mon 2026-07-13 … Sun 2026-07-19 (fixed dates, no clock mocking needed).

const at = (iso: string, time = '10:00:00Z'): Date => new Date(`${iso}T${time}`);

describe('premiereDateDisponible — the RULED counting matrix', () => {
  it('vendredi → mardi (the authoritative spec example)', () => {
    expect(premiereDateDisponible(at('2026-07-17'))).toBe('2026-07-21');
  });
  it('jeudi → lundi', () => {
    expect(premiereDateDisponible(at('2026-07-16'))).toBe('2026-07-20');
  });
  it('samedi → mardi', () => {
    expect(premiereDateDisponible(at('2026-07-18'))).toBe('2026-07-21');
  });
  it('dimanche → mardi', () => {
    expect(premiereDateDisponible(at('2026-07-19'))).toBe('2026-07-21');
  });
  it('lundi → mercredi', () => {
    expect(premiereDateDisponible(at('2026-07-13'))).toBe('2026-07-15');
  });
  it('mardi → jeudi, mercredi → vendredi (mid-week continuity)', () => {
    expect(premiereDateDisponible(at('2026-07-14'))).toBe('2026-07-16');
    expect(premiereDateDisponible(at('2026-07-15'))).toBe('2026-07-17');
  });
});

describe('timezone pinning — the rule counts the Africa/Tunis calendar date', () => {
  it('23:30 UTC on Friday is ALREADY Saturday in Tunis (UTC+1) → the samedi floor applies', () => {
    // 2026-07-17T23:30Z = 2026-07-18 00:30 Africa/Tunis
    expect(tunisDateOf(at('2026-07-17', '23:30:00Z'))).toBe('2026-07-18');
    expect(premiereDateDisponible(at('2026-07-17', '23:30:00Z'))).toBe('2026-07-21');
  });
  it('an early-UTC instant stays the same Tunis date', () => {
    expect(tunisDateOf(at('2026-07-17', '06:00:00Z'))).toBe('2026-07-17');
  });
});

describe('isJourOuvre', () => {
  it('Mon–Fri are ouvrés; Sat/Sun are not', () => {
    for (const d of ['2026-07-13', '2026-07-14', '2026-07-15', '2026-07-16', '2026-07-17']) {
      expect(isJourOuvre(d)).toBe(true);
    }
    expect(isJourOuvre('2026-07-18')).toBe(false);
    expect(isJourOuvre('2026-07-19')).toBe(false);
  });
});

describe('startDateViolation', () => {
  const today = at('2026-07-13'); // lundi → floor 2026-07-15 (mercredi)

  it('null for the floor itself and anything later that is ouvré', () => {
    expect(startDateViolation('2026-07-15', today)).toBeNull();
    expect(startDateViolation('2026-07-16', today)).toBeNull();
    expect(startDateViolation('2026-07-24', today)).toBeNull(); // a later vendredi
  });

  it('TOO_SOON for an ouvré date before the floor (today and J+1 included)', () => {
    expect(startDateViolation('2026-07-13', today)).toBe('TOO_SOON');
    expect(startDateViolation('2026-07-14', today)).toBe('TOO_SOON');
    expect(startDateViolation('2026-07-10', today)).toBe('TOO_SOON'); // the past
  });

  it('NON_WORKING_DAY for any week-end date, even far in the future (blocked outright)', () => {
    expect(startDateViolation('2026-07-18', today)).toBe('NON_WORKING_DAY');
    expect(startDateViolation('2026-08-15', today)).toBe('NON_WORKING_DAY'); // a far samedi
  });
});
