import { describe, expect, it } from 'vitest';

import type { HourStatusRow } from '@/features/admin/services/admin-testing.service';

import {
  CAMPAIGN_HEADER,
  SPS_STORED_LABEL,
  configNumber,
  dayCountLabel,
  dayRanges,
  dayRangesLabel,
  fmt,
  fmtTnd,
  halfHourSourceLabel,
  hostLossDefinition,
  spsObservationLabel,
  spsSectionTitle,
  spsVariableLabel,
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

describe('SPS labels — « c’est quoi ? » (Mejri 19/09)', () => {
  const windows = { acceptation: 90, activite: 30, respect_evenements: 90 };
  const weights = { acceptation: 40, respect_evenements: 30, activite: 20, remplissage: 10 };

  it('R5 — each variable names its weight and its window, read from the api (never hard-coded)', () => {
    expect(spsVariableLabel('acceptation', weights, windows)).toBe(
      'Taux d’acceptation des campagnes (%) — poids 40 % (fenêtre 90 j)',
    );
    expect(spsVariableLabel('respect_evenements', weights, windows)).toBe(
      'Respect des événements acceptés (%) — poids 30 % (fenêtre 90 j)',
    );
    expect(spsVariableLabel('activite', weights, { ...windows, activite: 14 })).toBe(
      'Activité de l’écran — heures diffusées / heures programmées (%) — poids 20 % (fenêtre 14 j)',
    );
    expect(spsVariableLabel('remplissage', weights, windows)).toBe(
      'Taux de remplissage de la semaine (%) — poids 10 % (hebdomadaire)',
    );
  });

  it('a variable without a known weight or window says so rather than inventing one', () => {
    expect(spsVariableLabel('somethingNew', {}, {})).toBe('somethingNew — poids ? %');
  });

  it('R4, R7 — the evidence follows the période, so no label names a fixed window', () => {
    expect(spsObservationLabel('decided')).toBe('Décisions prises (acceptées + refusées)');
    expect(spsObservationLabel('attested')).toBe('Décisions prises pour les événements reçus');
    expect(spsObservationLabel('scheduledElapsed')).toBe('Heures programmées déjà passées');
    // The unit stays: every variable carries one (18/09).
    expect(spsObservationLabel('engagedSeconds')).toBe('Temps d’antenne réservé (s)');
    for (const key of ['decided', 'attested', 'scheduledElapsed', 'engagedSeconds']) {
      expect(spsObservationLabel(key)).not.toMatch(/derniers jours|semaine|fenêtre/);
    }
  });

  it('an unknown key falls back to itself rather than disappearing', () => {
    expect(spsObservationLabel('somethingNew')).toBe('somethingNew');
  });

  it('the block title says which période the evidence covers', () => {
    expect(spsSectionTitle('2026-09-01', '2026-09-18')).toBe(
      'SPS — score, variables, poids ; preuves du 2026-09-01 au 2026-09-18',
    );
  });

  it('ruling A — the stored score is never called an average', () => {
    expect(SPS_STORED_LABEL).not.toMatch(/moyenne/i);
    expect(SPS_STORED_LABEL).toMatch(/dernier calcul/);
  });
});

describe('R3 — a half-hour entered by hand is « manuelle », never « grille »', () => {
  it('names the source of a half-hour', () => {
    expect(halfHourSourceLabel('backup')).toBe('manuelle');
    expect(halfHourSourceLabel('measured')).toBe('mesuré');
  });
});

describe('the campaigns table (Mejri 19/09)', () => {
  it('R1, R2, R6 — the renamed headers; the loss is in DT, the missed quantity a count', () => {
    expect(CAMPAIGN_HEADER).toEqual({
      elapsed: 'Heures allouées',
      delivered: 'Heures diffusées',
      missed: 'Heures manquées',
      missedImpressions: 'Impressions non diffusées (nombre)',
      hostLoss: 'Perte financière du Host (DT)',
    });
  });

  it('R2 — the host’s share moves from the header into the definition when the config has it', () => {
    expect(hostLossDefinition(50)).toMatch(/^la part \(50 %\) de la valeur des impressions/);
    expect(hostLossDefinition(null)).toMatch(/^la part de la valeur des impressions/);
    expect(hostLossDefinition(50)).toMatch(/arrondie au millime inférieur/);
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
