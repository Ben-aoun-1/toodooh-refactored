import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  DECLARED_COUNT_ERROR,
  DECLARED_COUNT_MAX,
  DECLARED_COUNT_MIN,
  declaredCountInput,
  parseDeclaredCount,
} from './screen-declaration';

// SCR-DECL1 — the declared screens / rooms input rule (D1: integers 1–99). The api refuses what
// the web lets through with a 400, so the bounds are pinned across packages (the SIGN-3
// technique: the api's shared block is read from disk and compared byte for byte).
const readShared = (path: string): string => {
  const source = readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
  const start = source.indexOf('// ── shared block');
  const end = source.indexOf('// ── end shared block ──');
  if (start === -1 || end === -1) throw new Error(`shared block markers missing in ${path}`);
  return source.slice(start, end);
};

/** Strip block + line comments so prose about the rule can't satisfy (or trip) a pin. */
const codeOf = (path: string): string =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

describe('the declared-count bounds are ONE definition', () => {
  it('the api copy and the web copy are byte-identical', () => {
    expect(readShared('./screen-declaration.ts')).toBe(
      readShared('../../../api/src/validation/screen-declaration.ts'),
    );
  });

  it('are 1 and 99 (D1)', () => {
    expect([DECLARED_COUNT_MIN, DECLARED_COUNT_MAX]).toEqual([1, 99]);
    expect(DECLARED_COUNT_ERROR).toBe('Saisissez un nombre entier entre 1 et 99.');
  });
});

describe('parseDeclaredCount', () => {
  it('reads an exact whole number within the bounds', () => {
    expect(parseDeclaredCount('3')).toBe(3);
    expect(parseDeclaredCount(' 12 ')).toBe(12);
    expect(parseDeclaredCount('1')).toBe(1);
    expect(parseDeclaredCount('99')).toBe(99);
  });

  it('refuses blank, zero, out of range, decimals and the old buckets', () => {
    for (const raw of ['', '   ', '0', '100', '2.5', '-1', '6-10', '10+', 'abc', '1e2']) {
      expect(parseDeclaredCount(raw)).toBeNull();
    }
  });
});

describe('declaredCountInput', () => {
  it('shows a declaration, and leaves « never declared » (0 or null) empty — never « 0 »', () => {
    expect(declaredCountInput(3)).toBe('3');
    expect(declaredCountInput(0)).toBe('');
    expect(declaredCountInput(null)).toBe('');
  });
});

describe('the signup wizard asks for the exact number (Q3)', () => {
  const signupForm = codeOf('../features/auth/components/SignUpForm.tsx');

  it('offers no lossy bucket any more', () => {
    expect(signupForm).not.toContain("'6-10'");
    expect(signupForm).not.toContain("'10+'");
    expect(signupForm).not.toContain('screenOptions');
  });

  it('parses both counts through the one rule', () => {
    expect(signupForm).toContain("from '@/lib/screen-declaration'");
    expect(signupForm).toContain('parseDeclaredCount(');
  });
});
