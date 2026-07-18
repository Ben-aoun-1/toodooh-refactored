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

describe('CF-D1 — the lead parameter (calibratable; default 2 pinned above)', () => {
  it('lead 0 → the floor is TODAY, whatever the weekday (week-ends included)', () => {
    expect(premiereDateDisponible(at('2026-07-17'), 0)).toBe('2026-07-17'); // vendredi
    expect(premiereDateDisponible(at('2026-07-18'), 0)).toBe('2026-07-18'); // samedi — today, NOT pushed to lundi
    expect(premiereDateDisponible(at('2026-07-19'), 0)).toBe('2026-07-19'); // dimanche
  });
  it('lead 1 → the next jour ouvré (vendredi → lundi, samedi → lundi)', () => {
    expect(premiereDateDisponible(at('2026-07-17'), 1)).toBe('2026-07-20');
    expect(premiereDateDisponible(at('2026-07-18'), 1)).toBe('2026-07-20');
    expect(premiereDateDisponible(at('2026-07-13'), 1)).toBe('2026-07-14');
  });
  it('startDateViolation at lead 0: today is legal, yesterday stays TOO_SOON', () => {
    const saturday = at('2026-07-18');
    expect(startDateViolation('2026-07-18', saturday, 0)).toBeNull();
    expect(startDateViolation('2026-07-19', saturday, 0)).toBeNull();
    expect(startDateViolation('2026-07-17', saturday, 0)).toBe('TOO_SOON');
  });
  it('an explicit lead 2 matches the default (the ven→mar example is the SAME rule)', () => {
    expect(premiereDateDisponible(at('2026-07-17'), 2)).toBe('2026-07-21');
    expect(startDateViolation('2026-07-20', at('2026-07-17'), 2)).toBe('TOO_SOON');
    expect(startDateViolation('2026-07-21', at('2026-07-17'), 2)).toBeNull();
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

describe('startDateViolation — ruling #10: the working-day LEAD is the only constraint', () => {
  const today = at('2026-07-13'); // lundi → floor 2026-07-15 (mercredi)

  it('null for the floor itself and anything later — WEEK-ENDS INCLUDED', () => {
    expect(startDateViolation('2026-07-15', today)).toBeNull();
    expect(startDateViolation('2026-07-16', today)).toBeNull();
    expect(startDateViolation('2026-07-18', today)).toBeNull(); // samedi past the floor: LEGAL
    expect(startDateViolation('2026-07-19', today)).toBeNull(); // dimanche past the floor: LEGAL
    expect(startDateViolation('2026-08-15', today)).toBeNull(); // a far samedi: LEGAL
  });

  it('from mercredi: floor vendredi — the following samedi/dimanche are selectable', () => {
    const wednesday = at('2026-07-15');
    expect(premiereDateDisponible(wednesday)).toBe('2026-07-17'); // vendredi
    expect(startDateViolation('2026-07-17', wednesday)).toBeNull();
    expect(startDateViolation('2026-07-18', wednesday)).toBeNull(); // samedi
    expect(startDateViolation('2026-07-19', wednesday)).toBeNull(); // dimanche
  });

  it('from vendredi: floor mardi (the unchanged example) — the intervening week-end is TOO_SOON, never NON_WORKING_DAY', () => {
    const friday = at('2026-07-17');
    expect(premiereDateDisponible(friday)).toBe('2026-07-21'); // mardi
    expect(startDateViolation('2026-07-18', friday)).toBe('TOO_SOON'); // samedi BEFORE the floor
    expect(startDateViolation('2026-07-19', friday)).toBe('TOO_SOON'); // dimanche BEFORE the floor
    expect(startDateViolation('2026-07-20', friday)).toBe('TOO_SOON'); // lundi BEFORE the floor
    expect(startDateViolation('2026-07-21', friday)).toBeNull();
  });

  it('TOO_SOON for any date before the floor (today, J+1, the past)', () => {
    expect(startDateViolation('2026-07-13', today)).toBe('TOO_SOON');
    expect(startDateViolation('2026-07-14', today)).toBe('TOO_SOON');
    expect(startDateViolation('2026-07-10', today)).toBe('TOO_SOON');
  });
});
