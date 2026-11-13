import { describe, expect, it } from 'vitest';

import {
  coverageCaption,
  kickoffClock,
  sliderPercent,
  spotLengthLine,
  stepState,
  zonesSummary,
} from './positioning-display';

describe('kickoffClock — the ticket stub', () => {
  it('reads the kickoff in Tunis wall-clock (UTC+1, no DST)', () => {
    expect(kickoffClock('2026-12-09T20:00:00.000Z')).toBe('21:00');
    expect(kickoffClock('2026-07-01T18:45:00.000Z')).toBe('19:45');
  });
});

describe('zonesSummary — the récap line', () => {
  it('no zone is the whole network', () => {
    expect(zonesSummary([])).toBe('Tout le réseau');
  });

  it('counts the zones, then names them', () => {
    expect(zonesSummary(['Grand Tunis'])).toBe('1 zone · Grand Tunis');
    expect(zonesSummary(['Grand Tunis', 'Sahel'])).toBe('2 zones · Grand Tunis, Sahel');
  });
});

describe('coverageCaption — the map caption', () => {
  it('words the whole network and the zones picked', () => {
    expect(coverageCaption({ wholeNetwork: true, count: 5, withoutCoordinates: 0 })).toBe(
      'Tout le réseau · 5 établissements',
    );
    expect(coverageCaption({ wholeNetwork: false, count: 5, withoutCoordinates: 0 })).toBe(
      '5 établissements couverts',
    );
  });

  it('agrees in number', () => {
    expect(coverageCaption({ wholeNetwork: true, count: 1, withoutCoordinates: 0 })).toBe(
      'Tout le réseau · 1 établissement',
    );
    expect(coverageCaption({ wholeNetwork: false, count: 1, withoutCoordinates: 0 })).toBe(
      '1 établissement couvert',
    );
  });

  it('says how many covered venues the map cannot plot (MAP-2)', () => {
    expect(coverageCaption({ wholeNetwork: false, count: 6, withoutCoordinates: 2 })).toBe(
      '6 établissements couverts, dont 2 sans coordonnées',
    );
  });
});

describe('stepState — the stepper dots', () => {
  it('done behind, current, todo ahead', () => {
    expect(stepState(1, 2)).toBe('done');
    expect(stepState(2, 2)).toBe('current');
    expect(stepState(3, 2)).toBe('todo');
  });
});

describe('sliderPercent — the filled part of the minutes track', () => {
  it('maps the range onto 0–100', () => {
    expect(sliderPercent(2, 2, 18)).toBe(0);
    expect(sliderPercent(10, 2, 18)).toBe(50);
    expect(sliderPercent(18, 2, 18)).toBe(100);
  });

  it('clamps a value outside the range', () => {
    expect(sliderPercent(20, 2, 18)).toBe(100);
    expect(sliderPercent(0, 2, 18)).toBe(0);
  });

  it('a one-value range is full once the value reaches it', () => {
    expect(sliderPercent(2, 2, 2)).toBe(100);
    expect(sliderPercent(0, 2, 2)).toBe(0);
  });
});

describe('spotLengthLine — « Vos créations »', () => {
  it('names the pod slot a spot airs in', () => {
    expect(spotLengthLine('video', 11)).toBe('11s → créneau de 12 s');
    expect(spotLengthLine('photo', 20)).toBe('20s → créneau de 20 s');
  });

  it('keeps the bare length when the spot cannot air in a pod', () => {
    expect(spotLengthLine('video', 31)).toBe('31s');
    expect(spotLengthLine('video', null)).toBe('—s');
  });
});
