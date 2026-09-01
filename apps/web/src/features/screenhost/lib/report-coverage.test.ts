import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { coverageLabel, daysInRange } from './report-coverage';

// RPT-COV1 (Mejri, ruled through the operator 2026-09-01) — « le rapport mensuel d'août est
// disponible alors que nous avons uniquement les données du 31/08 ». The ruling is NOT a
// minimum-data threshold: a month with real data still gets its report. What was missing is that
// the document never said how thin it was. Page and PDF share this rule byte for byte.
const readShared = (path: string): string => {
  const source = readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
  const start = source.indexOf('// ── shared block');
  const end = source.indexOf('// ── end shared block ──');
  if (start === -1 || end === -1) throw new Error(`shared block markers missing in ${path}`);
  return source.slice(start, end);
};

describe('the coverage rule is ONE rule', () => {
  it('the api copy and the web copy are byte-identical', () => {
    expect(readShared('./report-coverage.ts')).toBe(
      readShared('../../../../../api/src/lib/report/coverage.ts'),
    );
  });
});

describe('coverageLabel — a thin report says so on its face', () => {
  it("Mejri's August: one day of data in a 31-day month", () => {
    expect(coverageLabel({ daysWithData: 1, daysInPeriod: 31 })).toBe('1 jour de données sur 31');
  });

  it('agrees in the plural', () => {
    expect(coverageLabel({ daysWithData: 12, daysInPeriod: 31 })).toBe(
      '12 jours de données sur 31',
    );
    expect(coverageLabel({ daysWithData: 0, daysInPeriod: 31 })).toBe('0 jour de données sur 31');
  });

  it('a FULL month states its own completeness rather than going quiet', () => {
    // Rendering only when thin would make the line a warning badge, and its ABSENCE ambiguous:
    // the reader could not tell "complete" from "we forgot to say".
    expect(coverageLabel({ daysWithData: 31, daysInPeriod: 31 })).toBe(
      '31 jours de données sur 31',
    );
  });

  it('never claims more coverage than the period holds', () => {
    expect(coverageLabel({ daysWithData: 40, daysInPeriod: 31 })).toBe(
      '31 jours de données sur 31',
    );
    expect(coverageLabel({ daysWithData: -3, daysInPeriod: 31 })).toBe('0 jour de données sur 31');
  });

  it('an empty or malformed period renders NOTHING, never « 0 jour sur 0 »', () => {
    expect(coverageLabel({ daysWithData: 0, daysInPeriod: 0 })).toBeNull();
    expect(coverageLabel({ daysWithData: 1, daysInPeriod: -1 })).toBeNull();
    expect(coverageLabel({ daysWithData: 1, daysInPeriod: Number.NaN })).toBeNull();
  });
});

describe('daysInRange — the denominator, both bounds counted', () => {
  it('a whole month is its own length', () => {
    expect(daysInRange('2026-08-01', '2026-08-31')).toBe(31);
    expect(daysInRange('2026-02-01', '2026-02-28')).toBe(28);
    expect(daysInRange('2026-06-01', '2026-06-30')).toBe(30);
  });

  it('a single day is 1 — inclusive, not a difference', () => {
    expect(daysInRange('2026-08-31', '2026-08-31')).toBe(1);
  });

  it('a reversed or malformed range is 0, which makes the label render nothing', () => {
    expect(daysInRange('2026-08-31', '2026-08-01')).toBe(0);
    expect(daysInRange('nonsense', '2026-08-31')).toBe(0);
    expect(coverageLabel({ daysWithData: 1, daysInPeriod: daysInRange('b', 'a') })).toBeNull();
  });
});
