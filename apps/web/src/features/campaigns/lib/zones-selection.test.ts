import { describe, expect, it } from 'vitest';

import {
  COVERAGE_MAP_NOTE,
  defaultZoneSelection,
  toggleZone,
  zonesHint,
  zonesRecapLabel,
} from './zones-selection';

// CF-Z1 — the Zones step's pinned selection logic.

describe('toggleZone', () => {
  it('adds an unselected zone and removes a selected one', () => {
    expect(toggleZone([], 'gt')).toEqual(['gt']);
    expect(toggleZone(['gt'], 'gt')).toEqual([]);
    expect(toggleZone(['gt'], 'sfax')).toEqual(['gt', 'sfax']);
    expect(toggleZone(['gt', 'sfax'], 'gt')).toEqual(['sfax']);
  });
});

describe('zonesRecapLabel (the StepCart couverture line)', () => {
  it('« Tout le réseau » when nothing is selected (whole-network semantics)', () => {
    expect(zonesRecapLabel([])).toBe('Tout le réseau');
  });
  it('the selected names otherwise', () => {
    expect(zonesRecapLabel(['Grand Tunis'])).toBe('Grand Tunis');
    expect(zonesRecapLabel(['Grand Tunis', 'Grand Sfax'])).toBe('Grand Tunis, Grand Sfax');
  });
});

describe('defaultZoneSelection (fresh wizard → Grand Tunis preselected)', () => {
  it('a FRESH untouched wizard defaults to every fetched zone (V1: exactly Grand Tunis)', () => {
    expect(defaultZoneSelection(['gt'], { isEdit: false, touched: false, current: [] })).toEqual([
      'gt',
    ]);
  });

  it('an edited campaign keeps its persisted set — even empty (whole network stays chosen)', () => {
    expect(defaultZoneSelection(['gt'], { isEdit: true, touched: false, current: [] })).toEqual([]);
    expect(defaultZoneSelection(['gt'], { isEdit: true, touched: false, current: ['gt'] })).toEqual(
      ['gt'],
    );
  });

  it('a user who touched the step is never overridden', () => {
    expect(defaultZoneSelection(['gt'], { isEdit: false, touched: true, current: [] })).toEqual([]);
  });

  it('an already-populated selection is preserved', () => {
    expect(
      defaultZoneSelection(['gt', 'sfax'], { isEdit: false, touched: false, current: ['sfax'] }),
    ).toEqual(['sfax']);
  });
});

describe('COVERAGE_MAP_NOTE (MAP-5)', () => {
  it('says the map shows the eligible screenhosts, not where the campaign will play', () => {
    expect(COVERAGE_MAP_NOTE).toBe(
      "La carte montre les screenhosts éligibles à votre campagne. C'est une visualisation : votre campagne ne sera pas forcément diffusée sur chacun d'eux.",
    );
  });
});

describe('zonesHint', () => {
  it('no zone means the whole network; any zone, only those', () => {
    expect(zonesHint(0)).toBe(
      'Aucune zone sélectionnée : votre campagne sera diffusée sur tout le réseau.',
    );
    expect(zonesHint(1)).toBe('Votre campagne sera diffusée dans les zones sélectionnées.');
    expect(zonesHint(3)).toBe('Votre campagne sera diffusée dans les zones sélectionnées.');
  });
});
