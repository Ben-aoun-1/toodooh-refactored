import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// Mariem 04/11 — « Je me positionne » for Foot redrawn from her mockup (Toodooh_Je_me_positionne_
// Foot.html). Source pins: the web has no render harness (vitest node env, .test.ts only).

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const PAGES = ['pages/EventPositioning.tsx', 'pages/EventGroupPositioning.tsx'];

const REDESIGN = [
  ...PAGES,
  'components/EventRecapStep.tsx',
  'components/EventGroupRecapStep.tsx',
  'components/EventRepeatsNote.tsx',
  'components/positioning/FootballGlyph.tsx',
  'components/positioning/FootCoverageMap.tsx',
  'components/positioning/FootCreativeStep.tsx',
  'components/positioning/FootSpotLibrary.tsx',
  'components/positioning/FootZonesStep.tsx',
  'components/positioning/GroupTicket.tsx',
  'components/positioning/ImpactTiles.tsx',
  'components/positioning/MatchTicket.tsx',
  'components/positioning/MinutesClock.tsx',
  'components/positioning/PitchRange.tsx',
  'components/positioning/PositioningCard.tsx',
  'components/positioning/PositioningFooter.tsx',
  'components/positioning/PositioningHero.tsx',
  'components/positioning/PositioningStepper.tsx',
  'components/positioning/TicketShell.tsx',
];

describe('the Foot parcours runs on its own steps', () => {
  it('both pages draw the pitch hero and the Foot steps, never the wizard steps', () => {
    for (const page of PAGES) {
      const src = read(page);
      expect(src, page).toContain('<PositioningHero');
      expect(src, page).toContain('<FootZonesStep');
      expect(src, page).toContain('<FootCreativeStep');
      expect(src, page).not.toContain('new-campaign/StepZones');
      expect(src, page).not.toContain('new-campaign/StepCreative');
    }
    expect(read('pages/EventPositioning.tsx')).toContain('<MatchTicket');
    expect(read('pages/EventGroupPositioning.tsx')).toContain('<GroupTicket');
  });

  it('the wizard Création step is classic-only again: the event branch lives in the Foot step', () => {
    const step = read('../campaigns/pages/new-campaign/StepCreative.tsx');
    expect(step).not.toMatch(/eventMode\??: boolean/); // no event prop left
    expect(step).toContain('eventMode: false');
    expect(step).not.toContain('features/events');
    const foot = read('components/positioning/FootCreativeStep.tsx');
    expect(foot).toContain('eventMode: true');
    expect(foot).toContain('filterEventSpots(allCreatives)');
    expect(foot).toContain('EVENT_VIDEO_DROPZONE_HINT');
    // Mariem 04/11 (Foot point 1) — the QR code stays on the Foot spot step.
    expect(foot).toContain('<SpotCtaFields key={selectedCreativeId}');
  });

  it('only a step already done is reachable from the stepper (forward moves keep their gates)', () => {
    expect(read('components/positioning/PositioningStepper.tsx')).toContain(
      "disabled={state !== 'done'}",
    );
  });

  it('each step opens at the top, on the stepper (the mockup scrolls back up)', () => {
    const hero = read('components/positioning/PositioningHero.tsx');
    expect(hero).toContain('scrollIntoView(');
    expect(hero).toContain('}, [currentStep]);');
  });
});

describe('the Foot map keeps the coverage-map contract', () => {
  const map = read('components/positioning/FootCoverageMap.tsx');

  it('OSM tiles, the shared stacking classes, no venue detail on a pin (MAP-DOTS)', () => {
    expect(map).toContain('MAP_TILE_URL');
    expect(map).toContain('MAP_STACK_CLASSES');
    expect(map).toContain('MAP_CONTAINER_CLASSES');
    expect(map).not.toContain('bindTooltip');
    expect(map).not.toContain('bindPopup');
    expect(map).not.toContain('sector_name');
    expect(map).not.toMatch(/className=[^`]*z-\[\d+\]/);
  });

  it('re-frames without a zoom animation and never on a detached box (leaving mid-zoom)', () => {
    expect(map).toContain('animate: false');
    expect(map).toContain('entry.contentRect.width === 0');
  });

  it('stays a lazy chunk', () => {
    expect(read('components/positioning/FootZonesStep.tsx')).toMatch(
      /lazy\(\(\) => import\('\.\/FootCoverageMap'\)\)/,
    );
  });
});

describe('Tailwind only, colours as theme tokens (CLAUDE.md)', () => {
  it('no inline style and no hex colour in a class', () => {
    for (const rel of REDESIGN) {
      const src = read(rel);
      expect(src, rel).not.toContain('style={{');
      expect(src, rel).not.toMatch(/-\[#[0-9A-Fa-f]{3,8}\]/);
    }
  });
});
