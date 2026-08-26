import { describe, expect, it } from 'vitest';

import {
  ESTIMATED_ONLY_NOTE,
  PROVENANCE_LABELS,
  affluenceAllEstimated,
  affluenceEmpty,
  cellProvenance,
  dayProvenance,
  provenanceGrid,
  provenanceLabel,
} from './affluence-provenance';

// AFF1 — the ONE home of « what does this affluence cell mean » for the three owner surfaces
// (« Votre audience », S02, and — through the api twin — the PDF). apps/web has no render
// harness, so the rule lives here or it is unpinnable.
describe('cellProvenance (value, source) → measured | backup | none', () => {
  it('a slot the hub marked measured is measured — INCLUDING a measured zero', () => {
    expect(cellProvenance(5, 'measured')).toBe('measured');
    expect(cellProvenance(0, 'measured')).toBe('measured');
  });

  it('a slot the hub marked backup is an estimation, whatever its value', () => {
    expect(cellProvenance(40, 'backup')).toBe('backup');
    expect(cellProvenance(0, 'backup')).toBe('backup');
  });

  it('unknown provenance WITH a value is labelled the conservative way: estimation, never measured', () => {
    expect(cellProvenance(12, null)).toBe('backup');
  });

  it('unknown provenance without a value is no data at all (hachure)', () => {
    expect(cellProvenance(0, null)).toBe('none');
  });
});

describe('provenanceGrid — the 7×24 kinds grid from the api grid + sources', () => {
  const grid = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
  const sources: ('measured' | 'backup' | null)[][] = Array.from({ length: 7 }, () =>
    Array.from({ length: 24 }, () => null),
  );
  grid[0]![9] = 5;
  sources[0]![9] = 'measured';
  grid[0]![10] = 0;
  sources[0]![10] = 'measured';
  grid[1]![12] = 40;
  sources[1]![12] = 'backup';
  grid[4]![20] = 12; // NULL-source row with a value

  it('maps every cell through cellProvenance, Monday-first', () => {
    const kinds = provenanceGrid(grid, sources);
    expect(kinds).toHaveLength(7);
    expect(kinds.every((row) => row.length === 24)).toBe(true);
    expect(kinds[0]?.[9]).toBe('measured');
    expect(kinds[0]?.[10]).toBe('measured');
    expect(kinds[1]?.[12]).toBe('backup');
    expect(kinds[4]?.[20]).toBe('backup');
    expect(kinds[6]?.[0]).toBe('none');
  });

  it('tolerates a missing sources grid (pre-AFF1 payload): every value reads as estimation', () => {
    const kinds = provenanceGrid(grid, []);
    expect(kinds[0]?.[9]).toBe('backup');
    expect(kinds[0]?.[10]).toBe('none'); // a 0 without provenance is no data
    expect(kinds[6]?.[0]).toBe('none');
  });

  it('tolerates an empty grid (idle query): a 7×24 grid of none', () => {
    const kinds = provenanceGrid([], []);
    expect(kinds).toHaveLength(7);
    expect(kinds.flat().every((k) => k === 'none')).toBe(true);
  });
});

describe('dayProvenance — a day tile is only « mesuré » when ALL its data is', () => {
  it('none when the day holds no data at all', () => {
    expect(dayProvenance(['none', 'none'])).toBe('none');
  });
  it('backup as soon as ONE slot is an estimation', () => {
    expect(dayProvenance(['measured', 'backup', 'none'])).toBe('backup');
  });
  it('measured when every data-carrying slot is measured', () => {
    expect(dayProvenance(['measured', 'none', 'measured'])).toBe('measured');
  });
});

describe('labels', () => {
  it('pins the French labels', () => {
    expect(PROVENANCE_LABELS.measured).toBe('Mesuré (capteur)');
    expect(PROVENANCE_LABELS.backup).toBe('Estimation');
    expect(provenanceLabel('measured')).toBe('Mesuré (capteur)');
    expect(provenanceLabel('backup')).toBe('Estimation');
    expect(provenanceLabel('none')).toBe('Aucune donnée');
    expect(ESTIMATED_ONLY_NOTE).toBe(
      'Valeurs estimées (aucune mesure capteur sur les 4 dernières semaines)',
    );
  });
});

describe('affluenceAllEstimated — the one-line note under the summaries', () => {
  it('shows when the venue HAS data but not one measured slot', () => {
    expect(affluenceAllEstimated({ measured: 0, backup: 40 }, true)).toBe(true);
    // A NULL-source-only venue has data too (counts are pure tallies) → still estimated.
    expect(affluenceAllEstimated({ measured: 0, backup: 0 }, true)).toBe(true);
  });
  it('never shows without data, nor once a single measure exists', () => {
    expect(affluenceAllEstimated({ measured: 0, backup: 0 }, false)).toBe(false);
    expect(affluenceAllEstimated({ measured: 1, backup: 40 }, true)).toBe(false);
  });
});

describe('affluenceEmpty — the explanatory empty state', () => {
  it('is true ONLY with no measured, no backup AND no data', () => {
    expect(affluenceEmpty({ has_data: false, counts: { measured: 0, backup: 0 } })).toBe(true);
  });
  it('a NULL-source-only venue has data — it renders as estimation, not as empty', () => {
    expect(affluenceEmpty({ has_data: true, counts: { measured: 0, backup: 0 } })).toBe(false);
    expect(affluenceEmpty({ has_data: true, counts: { measured: 0, backup: 3 } })).toBe(false);
    expect(affluenceEmpty({ has_data: true, counts: { measured: 2, backup: 0 } })).toBe(false);
  });
});
