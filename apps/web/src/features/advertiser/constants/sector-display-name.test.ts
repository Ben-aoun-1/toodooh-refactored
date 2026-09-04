import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ADVERTISER_BUSINESS_SECTOR_NAMES } from './advertiserBusinessSectors';
import { normalizeSectorName, sectorDisplayName } from './sector-display-name';

// UI-1 (operator, 04/09) — « Resto » and « Resto/Bar » read badly to an owner and are DISPLAYED as
// « Restaurants » and « Lounges/Bars ». The stored names never change: they are the only shared key
// with the hub catalog. The page and the PDF render the same « secteur · Classe » line, so the rule
// is ONE rule, read from disk and compared byte for byte. (The ev1-pins technique.)
const readShared = (path: string): string => {
  const source = readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
  const start = source.indexOf('// ── shared block');
  const end = source.indexOf('// ── end shared block ──');
  if (start === -1 || end === -1) throw new Error(`shared block markers missing in ${path}`);
  return source.slice(start, end);
};

describe('the sector display rule is ONE rule', () => {
  it('the api copy and the web copy are byte-identical', () => {
    expect(readShared('./sector-display-name.ts')).toBe(
      readShared('../../../../../api/src/lib/report/sector-display-name.ts'),
    );
  });
});

describe('sectorDisplayName', () => {
  it('maps the two renamed sectors', () => {
    expect(sectorDisplayName('Resto')).toBe('Restaurants');
    expect(sectorDisplayName('Resto/Bar')).toBe('Lounges/Bars');
  });

  // The stored values carry a capital B ('Resto/Bar', verified on prod). Keying on the normalised
  // name means a drifted row still renders the intended label instead of silently falling through.
  it('is insensitive to case, accents and stray whitespace', () => {
    expect(sectorDisplayName('resto')).toBe('Restaurants');
    expect(sectorDisplayName('RESTO/BAR')).toBe('Lounges/Bars');
    expect(sectorDisplayName('  Resto/Bar  ')).toBe('Lounges/Bars');
  });

  it('is the IDENTITY for every other owner sector', () => {
    for (const name of ['Café', 'Salle de sport', 'Espace de loisir']) {
      expect(sectorDisplayName(name)).toBe(name);
    }
  });

  it('is the IDENTITY for every advertiser sector', () => {
    for (const name of ADVERTISER_BUSINESS_SECTOR_NAMES) {
      expect(sectorDisplayName(name)).toBe(name);
    }
  });

  // One-way by construction: matching happens on STORED names everywhere, so feeding a display
  // name back in must not map it a second time or ever produce a stored name.
  it('does not re-map a display name, and never yields a stored name', () => {
    expect(sectorDisplayName('Restaurants')).toBe('Restaurants');
    expect(sectorDisplayName('Lounges/Bars')).toBe('Lounges/Bars');
  });

  it('leaves an unknown name alone rather than guessing', () => {
    expect(sectorDisplayName('Bar à jus')).toBe('Bar à jus');
    expect(sectorDisplayName('')).toBe('');
  });
});

describe('normalizeSectorName', () => {
  it('casefolds, deaccents and collapses whitespace', () => {
    expect(normalizeSectorName('  Café   Étudiant ')).toBe('cafe etudiant');
    expect(normalizeSectorName('Resto/Bar')).toBe('resto/bar');
  });
});
