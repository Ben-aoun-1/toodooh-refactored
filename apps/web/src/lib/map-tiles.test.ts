import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { MAP_TILE_ATTRIBUTION, MAP_TILE_URL } from './map-tiles';

// Operator 2026-10-12 (option B) — CARTO answers key-less tiles with « API KEY REQUIRED »: every
// map uses OSM standard through lib/map-tiles, with the OSM attribution the usage policy requires.

const walk = (dir: string, acc: string[] = []): string[] => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\./.test(entry)) acc.push(full);
  }
  return acc;
};

describe('the app basemap', () => {
  it('is OpenStreetMap standard, credited', () => {
    expect(MAP_TILE_URL).toBe('https://tile.openstreetmap.org/{z}/{x}/{y}.png');
    expect(MAP_TILE_ATTRIBUTION).toContain('OpenStreetMap');
  });

  it('no source loads CARTO tiles any more', () => {
    const offenders = walk(join(__dirname, '..')).filter((f) =>
      readFileSync(f, 'utf8').includes('cartocdn'),
    );
    expect(offenders).toEqual([]);
  });
});
