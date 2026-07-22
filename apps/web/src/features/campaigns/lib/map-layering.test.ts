import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { EXIT_DIALOG_Z } from '@/features/campaigns/components/WizardExitDialog';

import {
  MAP_BADGE_Z_CLASS,
  MAP_COLLAPSED_CLASSES,
  MAP_CONTROL_Z_CLASS,
  MAP_EXPANDED_CLASSES,
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

  it('collapsed is the ~180px rounded corner square; expanded is the 28rem canvas (CF-U4)', () => {
    expect(MAP_COLLAPSED_CLASSES).toContain('h-[180px]');
    expect(MAP_COLLAPSED_CLASSES).toContain('w-[180px]');
    expect(MAP_COLLAPSED_CLASSES).toContain('rounded-2xl');
    expect(MAP_EXPANDED_CLASSES).toContain('h-[28rem]');
    expect(MAP_EXPANDED_CLASSES).toContain('w-full');
  });

  it('CF-U4 — the wrapper animates the expand/collapse (the height transition lives in the contract)', () => {
    expect(MAP_STACK_CLASSES).toContain('transition-[height,width]');
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

  it('CF-U4 — StepZones renders ONE map mount (the transition needs no remount on toggle)', () => {
    const src = readFileSync(
      join(__dirname, '..', 'pages', 'new-campaign', 'StepZones.tsx'),
      'utf8',
    );
    // The single shared slot: a conditional CLASS, not conditional mounts.
    expect(src).toContain("mapExpanded ? '' : 'flex justify-end'");
    expect(src).not.toContain('{mapExpanded && coverageMap}');
  });

  it('StepZones starts collapsed and resets per entry (local useState(false))', () => {
    const src = readFileSync(
      join(__dirname, '..', 'pages', 'new-campaign', 'StepZones.tsx'),
      'utf8',
    );
    expect(src).toContain('useState(false)');
    expect(src).toContain('expanded={mapExpanded}');
    expect(src).toMatch(/lazy\(\(\) => import\('\.\/ZonesCoverageMap'\)\)/); // still a lazy chunk
  });
});
