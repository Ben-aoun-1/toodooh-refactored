import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { EXIT_DIALOG_Z } from '@/features/campaigns/components/WizardExitDialog';

import * as layering from './map-layering';
import {
  MAP_BADGE_Z_CLASS,
  MAP_CANVAS_CLASSES,
  MAP_CONTROL_Z_CLASS,
  MAP_OVERLAY_Z_CLASS,
  MAP_STACK_CLASSES,
  MAP_STACK_Z,
} from './map-layering';

// CF-U2 — the map-under-modal regression (the exit intercept sank under leaflet's panes, which
// run z 200–800 inside the wrapper). The contract: the map wrapper is its OWN stacking context
// at a layer below the dialog, so no internal pane z-index can ever cross a modal again.

describe('coverage-map layering', () => {
  it('the exit dialog sits ABOVE the map stack (popup z > map pane z)', () => {
    expect(EXIT_DIALOG_Z).toBeGreaterThan(MAP_STACK_Z);
  });

  it('the wrapper creates the stacking context that traps the leaflet panes', () => {
    expect(MAP_STACK_CLASSES).toContain('isolate');
    expect(MAP_STACK_CLASSES).toContain(`z-${MAP_STACK_Z}`);
  });

  it('EXIT_DIALOG_Z matches the class WizardExitDialog actually renders', () => {
    const src = readFileSync(join(__dirname, '..', 'components', 'WizardExitDialog.tsx'), 'utf8');
    expect(src).toContain(`z-${EXIT_DIALOG_Z} `);
  });

  it('ZonesCoverageMap consumes the shared stack classes (no local re-derivation)', () => {
    const src = readFileSync(
      join(__dirname, '..', 'pages', 'new-campaign', 'ZonesCoverageMap.tsx'),
      'utf8',
    );
    expect(src).toContain('MAP_STACK_CLASSES');
    expect(src).not.toMatch(/isolate/); // the contract lives in map-layering.ts only
  });

  it('MAP-3 — ONE state: a full canvas from the first render, no collapsed square left to export', () => {
    expect(MAP_CANVAS_CLASSES).toContain('w-full');
    expect(MAP_CANVAS_CLASSES).toContain('min-h-[28rem]');
    expect(MAP_CANVAS_CLASSES).toContain('rounded-2xl');
    expect(Object.keys(layering)).not.toContain('MAP_COLLAPSED_CLASSES');
    expect(Object.keys(layering)).not.toContain('MAP_EXPANDED_CLASSES');
  });

  it('MAP-3 — the map offers no expand/collapse control (Mejri 08/09 point 2, 15/09)', () => {
    const src = readFileSync(
      join(__dirname, '..', 'pages', 'new-campaign', 'ZonesCoverageMap.tsx'),
      'utf8',
    );
    expect(src).not.toContain('Agrandir la carte');
    expect(src).not.toContain('Réduire la carte');
    expect(src).not.toMatch(/\bexpanded\b/);
    expect(src).not.toMatch(/\bonToggle\b/);
  });

  it('CF-U4 — the internal ladder stays inside the isolate (overlay < badge < controls)', () => {
    expect(MAP_OVERLAY_Z_CLASS).toBe('z-[500]');
    expect(MAP_BADGE_Z_CLASS).toBe('z-[600]');
    expect(MAP_CONTROL_Z_CLASS).toBe('z-[900]');
  });

  it('CF-U4 — the redesign pins: Positron tiles + CARTO attribution, brand markers, popup builder, count badge', () => {
    const src = readFileSync(
      join(__dirname, '..', 'pages', 'new-campaign', 'ZonesCoverageMap.tsx'),
      'utf8',
    );
    expect(src).toContain('basemaps.cartocdn.com/light_all');
    expect(src).toContain('CARTO');
    expect(src).toContain('buildPopupContent');
    expect(src).toContain('bindPopup');
    // CF-SK1 rider — the chip now shows the REAL category, with the CF-U4 wording as fallback.
    expect(src).toContain("venue.sector_name ?? 'Établissement couvert'");
    expect(src).toContain('Tout le réseau — ');
    expect(src).toContain('couvert');
    // Every layer class comes from map-layering.ts — no locally hardcoded z-[…] leaks in.
    expect(src).not.toMatch(/className=[^`]*z-\[\d+\]/);
  });

  it('MAP-3 — StepZones lays the zone list beside a full-size map, with no local collapse state', () => {
    const src = readFileSync(
      join(__dirname, '..', 'pages', 'new-campaign', 'StepZones.tsx'),
      'utf8',
    );
    expect(src).not.toContain('mapExpanded');
    expect(src).not.toContain("'flex justify-end'");
    expect(src).toContain('lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]');
    expect(src).toContain('Ajoutez une ou plusieurs zones de diffusion');
    expect(src).toMatch(/lazy\(\(\) => import\('\.\/ZonesCoverageMap'\)\)/); // still a lazy chunk
  });
});
