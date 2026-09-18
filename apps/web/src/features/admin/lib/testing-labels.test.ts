import { describe, expect, it } from 'vitest';

import type { HourStatusRow } from '@/features/admin/services/admin-testing.service';

import {
  SPS_STORED_LABEL,
  configNumber,
  dayCountLabel,
  dayRanges,
  dayRangesLabel,
  fmt,
  fmtTnd,
  spsObservationLabel,
  statusCounts,
} from './testing-labels';

// ADM-OBS2 — the admin « Tests » page's labels and small derivations (pure; no DOM harness here).

describe('fmt / fmtTnd', () => {
  it('integers as-is, fractions to 2 decimals, TND to the millime, missing as —', () => {
    expect(fmt(15)).toBe('15');
    expect(fmt(22.5)).toBe('22.50');
    expect(fmt(null)).toBe('—');
    expect(fmtTnd(0.45)).toBe('0.450');
    expect(fmtTnd(null)).toBe('—');
  });
});

describe('dayRanges — « Nombre de jours indisponibles + la période du … au … »', () => {
  it('groups consecutive days, across a month end, whatever the input order', () => {
    expect(dayRanges(['2026-09-01', '2026-08-30', '2026-08-31', '2026-09-05'])).toEqual([
      { from: '2026-08-30', to: '2026-09-01', count: 3 },
      { from: '2026-09-05', to: '2026-09-05', count: 1 },
    ]);
  });

  it('reads « du … au … » for a range, « le … » for a lone day, « — » for none', () => {
    expect(dayRangesLabel(['2026-08-26'])).toBe('le 2026-08-26');
    expect(dayRangesLabel(['2026-08-26', '2026-08-27', '2026-08-28', '2026-09-02'])).toBe(
      'du 2026-08-26 au 2026-08-28, le 2026-09-02',
    );
    expect(dayRangesLabel([])).toBe('—');
  });

  it('ignores duplicates', () => {
    expect(dayRanges(['2026-08-26', '2026-08-26'])).toEqual([
      { from: '2026-08-26', to: '2026-08-26', count: 1 },
    ]);
  });

  it('counts days in French', () => {
    expect(dayCountLabel(0)).toBe('0 jour');
    expect(dayCountLabel(1)).toBe('1 jour');
    expect(dayCountLabel(3)).toBe('3 jours');
  });
});

describe('SPS labels — « c’est quoi ? »', () => {
  const windows = { acceptation: 90, activite: 30, respect_evenements: 90 };

  it('names each piece of evidence with its window, read from the api (never hard-coded)', () => {
    expect(spsObservationLabel('decided', windows)).toBe(
      'Décisions prises (acceptées + refusées), 90 derniers jours',
    );
    expect(spsObservationLabel('attested', windows)).toBe(
      'Contrôles d’événements reçus, 90 derniers jours',
    );
    expect(spsObservationLabel('scheduledElapsed', { ...windows, activite: 14 })).toBe(
      'Heures programmées déjà passées, 14 derniers jours',
    );
    expect(spsObservationLabel('engagedSeconds', windows)).toBe(
      'Temps d’antenne réservé cette semaine (s)',
    );
  });

  it('an unknown key falls back to itself rather than disappearing', () => {
    expect(spsObservationLabel('somethingNew', windows)).toBe('somethingNew');
  });

  it('ruling A — the stored score is never called an average', () => {
    expect(SPS_STORED_LABEL).not.toMatch(/moyenne/i);
    expect(SPS_STORED_LABEL).toMatch(/dernier calcul/);
  });
});

describe('statusCounts', () => {
  const row = (state: HourStatusRow['state']): HourStatusRow => ({
    date: '2026-09-18',
    hour: 9,
    state,
    engaged_seconds: 0,
    pending_seconds: 0,
    seconds_free: 300,
    reps: 0,
    campaigns: 0,
  });

  it('counts all five states', () => {
    expect(
      statusCounts([row('libre'), row('libre'), row('partiel'), row('reservee_evenement')]),
    ).toBe(
      '4 heures : 2 libres, 1 partielles, 0 pleines, 0 indisponibles, 1 réservées (événement)',
    );
  });
});

describe('configNumber', () => {
  it('reads a finite number out of the raw config, null otherwise', () => {
    expect(configNumber({ fMaxSeconds: 300 }, 'fMaxSeconds')).toBe(300);
    expect(configNumber({ fMaxSeconds: '300' }, 'fMaxSeconds')).toBeNull();
    expect(configNumber({}, 'pctSh')).toBeNull();
  });
});
