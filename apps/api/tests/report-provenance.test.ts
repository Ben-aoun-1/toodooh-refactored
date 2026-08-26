import { describe, expect, it } from 'vitest';

import {
  PROVENANCE_LABELS,
  affluenceEmpty,
  cellProvenance,
  provenanceGrid,
} from '../src/lib/report/affluence-provenance.js';

// AFF1 — the api TWIN of apps/web/src/features/screenhost/lib/affluence-provenance.ts: the PDF
// applies the SAME (value, source) → kind rule as the page, and the SAME French labels. Each
// package pins the rule + the labels in its own test so neither side can drift silently.
describe('cellProvenance (twin of the web helper)', () => {
  it('a known provenance wins whatever the value — a measured 0 is a measurement', () => {
    expect(cellProvenance(5, 'measured')).toBe('measured');
    expect(cellProvenance(0, 'measured')).toBe('measured');
    expect(cellProvenance(40, 'backup')).toBe('backup');
    expect(cellProvenance(0, 'backup')).toBe('backup');
  });
  it('unknown provenance WITH a value is an estimation (never measured); without a value, none', () => {
    expect(cellProvenance(12, null)).toBe('backup');
    expect(cellProvenance(0, null)).toBe('none');
  });
});

describe('provenanceGrid', () => {
  it('maps a 7×24 grid + sources, tolerating a missing sources grid', () => {
    const grid = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
    const sources: ('measured' | 'backup' | null)[][] = Array.from({ length: 7 }, () =>
      Array.from({ length: 24 }, () => null),
    );
    grid[0]![9] = 5;
    sources[0]![9] = 'measured';
    grid[4]![20] = 12;
    const kinds = provenanceGrid(grid, sources);
    expect(kinds[0]?.[9]).toBe('measured');
    expect(kinds[4]?.[20]).toBe('backup');
    expect(kinds[6]?.[0]).toBe('none');
    expect(provenanceGrid(grid, [])[0]?.[9]).toBe('backup');
  });
});

describe('labels + empty rule (byte-twins of the page)', () => {
  it('pins the French labels', () => {
    expect(PROVENANCE_LABELS.measured).toBe('Mesuré (capteur)');
    expect(PROVENANCE_LABELS.backup).toBe('Estimation');
  });
  it('empty ONLY with no measured, no backup AND no data', () => {
    expect(affluenceEmpty({ has_data: false, counts: { measured: 0, backup: 0 } })).toBe(true);
    expect(affluenceEmpty({ has_data: true, counts: { measured: 0, backup: 0 } })).toBe(false);
    expect(affluenceEmpty({ has_data: true, counts: { measured: 0, backup: 3 } })).toBe(false);
  });
});
