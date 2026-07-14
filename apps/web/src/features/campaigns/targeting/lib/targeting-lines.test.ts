import { describe, expect, it } from 'vitest';

import {
  type TargetingLine,
  allNetworkLine,
  duplicateIndexOf,
  firstAvailableLine,
  fromWire,
  hasDuplicate,
  isAllNetwork,
  lineLabel,
  lineSignature,
  toWire,
  needsTargetingFlush,
  categoryLineLabel,
  firstAvailableCategoryLine,
  toCategoryOnly,
} from './targeting-lines';

const cat = (categoryId: string | null, cls: TargetingLine['class']): TargetingLine => ({
  categoryId,
  class: cls,
});
const names: Record<string, string> = { r: 'Restaurant', g: 'Salle de sport' };
const nameOf = (id: string): string | undefined => names[id];

describe('lineSignature — NULL (ALL) is a concrete token', () => {
  it('treats null category/class as the "ALL" value', () => {
    expect(lineSignature(cat(null, null))).toBe('ALL::ALL');
    expect(lineSignature(cat('r', 'premium'))).toBe('r::premium');
    expect(lineSignature(cat('r', null))).toBe('r::ALL');
    expect(lineSignature(cat(null, 'premium'))).toBe('ALL::premium');
  });

  it('distinguishes "all categories · premium" from "restaurant · premium"', () => {
    expect(lineSignature(cat(null, 'premium'))).not.toBe(lineSignature(cat('r', 'premium')));
  });
});

describe('isAllNetwork / allNetworkLine', () => {
  it('only null/null is the whole network', () => {
    expect(isAllNetwork(allNetworkLine())).toBe(true);
    expect(isAllNetwork(cat('r', 'premium'))).toBe(false);
    expect(isAllNetwork(cat(null, 'premium'))).toBe(false);
    expect(isAllNetwork(cat('r', null))).toBe(false);
  });
});

describe('duplicateIndexOf — dedup with an edit exception', () => {
  const lines = [cat('r', 'premium'), cat('g', 'moyen')];

  it('finds an exact collision', () => {
    expect(duplicateIndexOf(lines, cat('r', 'premium'))).toBe(0);
    expect(duplicateIndexOf(lines, cat('g', 'moyen'))).toBe(1);
  });

  it('returns -1 for a unique candidate', () => {
    expect(duplicateIndexOf(lines, cat('r', 'moyen'))).toBe(-1);
    expect(duplicateIndexOf(lines, cat(null, null))).toBe(-1);
  });

  it('skips the line being edited (exceptIndex)', () => {
    // editing line 0 back to its own value is NOT a duplicate
    expect(duplicateIndexOf(lines, cat('r', 'premium'), 0)).toBe(-1);
    // but editing line 1 to match line 0 IS a duplicate
    expect(duplicateIndexOf(lines, cat('r', 'premium'), 1)).toBe(0);
  });

  it('treats two ALL/ALL lines as duplicates', () => {
    expect(duplicateIndexOf([allNetworkLine()], allNetworkLine())).toBe(0);
  });
});

describe('hasDuplicate', () => {
  it('detects a repeated signature', () => {
    expect(hasDuplicate([cat('r', 'premium'), cat('r', 'premium')])).toBe(true);
    expect(hasDuplicate([cat(null, null), cat(null, null)])).toBe(true);
  });
  it('passes a clean set', () => {
    expect(hasDuplicate([cat('r', 'premium'), cat('r', 'moyen'), cat(null, 'premium')])).toBe(
      false,
    );
  });
});

describe('lineLabel', () => {
  it('labels the whole network', () => {
    expect(lineLabel(allNetworkLine(), nameOf)).toBe('Tout le réseau');
  });
  it('labels a specific category × class', () => {
    expect(lineLabel(cat('r', 'premium'), nameOf)).toBe('Restaurant · Premium');
  });
  it('labels ALL on either axis', () => {
    expect(lineLabel(cat(null, 'premium'), nameOf)).toBe('Toutes catégories · Premium');
    expect(lineLabel(cat('r', null), nameOf)).toBe('Restaurant · Toutes classes');
  });
  it('falls back gracefully for an unknown category id', () => {
    expect(lineLabel(cat('zzz', 'moyen'), nameOf)).toBe('Catégorie · Moyen');
  });
});

describe('firstAvailableLine — seeds a non-duplicate "+ add"', () => {
  it('seeds the first specific category × class (enum order: populaire first)', () => {
    expect(firstAvailableLine([], ['r', 'g'])).toEqual({ categoryId: 'r', class: 'populaire' });
  });

  it('skips combinations already present', () => {
    const lines = [cat('r', 'populaire'), cat('r', 'moyen')];
    expect(firstAvailableLine(lines, ['r', 'g'])).toEqual({ categoryId: 'r', class: 'premium' });
  });

  it('never auto-seeds the whole-network (null/null) line', () => {
    // exhaust every combination EXCEPT null/null → must return null, not the all-network line
    const exhaustive: TargetingLine[] = [];
    for (const c of ['r', null] as (string | null)[]) {
      for (const k of ['populaire', 'moyen', 'premium'] as TargetingLine['class'][]) {
        exhaustive.push({ categoryId: c, class: k });
      }
    }
    exhaustive.push({ categoryId: 'r', class: null });
    const result = firstAvailableLine(exhaustive, ['r']);
    expect(result).toBeNull();
  });
});

describe('toWire / fromWire — round-trips the API shape', () => {
  it('serialises to snake_case', () => {
    expect(toWire([cat('r', 'premium'), cat(null, null)])).toEqual([
      { category_id: 'r', class: 'premium' },
      { category_id: null, class: null },
    ]);
  });
  it('round-trips', () => {
    const lines = [cat('r', 'premium'), cat(null, 'moyen'), cat('g', null), allNetworkLine()];
    expect(fromWire(toWire(lines))).toEqual(lines);
  });
});

describe('needsTargetingFlush (CF-Q1 — Suivant persists dirty edits first)', () => {
  it('flushes only with a persistable draft AND dirty edits', () => {
    expect(needsTargetingFlush('draft-1', true)).toBe(true);
  });
  it('skips when clean, when there is no draft id, or both', () => {
    expect(needsTargetingFlush('draft-1', false)).toBe(false);
    expect(needsTargetingFlush(null, true)).toBe(false);
    expect(needsTargetingFlush(null, false)).toBe(false);
  });
});

// ── CF-W1 — category-only wizard mode (classes hidden, not removed) ────────────────────────────
describe('firstAvailableCategoryLine', () => {
  it('seeds the first untaken category with the all-value class, never null/null', () => {
    expect(firstAvailableCategoryLine([], ['r', 'g'])).toEqual({ categoryId: 'r', class: null });
    expect(firstAvailableCategoryLine([{ categoryId: 'r', class: null }], ['r', 'g'])).toEqual({
      categoryId: 'g',
      class: null,
    });
  });

  it('returns null when every category is taken (no auto-seed of « tout le réseau »)', () => {
    expect(
      firstAvailableCategoryLine(
        [
          { categoryId: 'r', class: null },
          { categoryId: 'g', class: null },
        ],
        ['r', 'g'],
      ),
    ).toBeNull();
  });
});

describe('toCategoryOnly (hydrate normalization)', () => {
  it('coerces every class to the all-value and dedups BY CATEGORY, order preserved', () => {
    expect(
      toCategoryOnly([
        { categoryId: 'r', class: 'premium' },
        { categoryId: 'g', class: 'moyen' },
        { categoryId: 'r', class: 'populaire' }, // same category, other class → deduped
      ]),
    ).toEqual([
      { categoryId: 'r', class: null },
      { categoryId: 'g', class: null },
    ]);
  });

  it('keeps an all-network line as itself', () => {
    expect(toCategoryOnly([{ categoryId: null, class: null }])).toEqual([
      { categoryId: null, class: null },
    ]);
  });

  it('the wire shape out of a category-only set carries class = null on every line', () => {
    const wire = toWire(toCategoryOnly([{ categoryId: 'r', class: 'premium' }]));
    expect(wire).toEqual([{ category_id: 'r', class: null }]);
  });
});

describe('categoryLineLabel', () => {
  it('labels by category alone (no « · Toutes classes » noise)', () => {
    const name = (id: string) => (id === 'r' ? 'Restaurant' : undefined);
    expect(categoryLineLabel({ categoryId: 'r', class: null }, name)).toBe('Restaurant');
    expect(categoryLineLabel({ categoryId: null, class: null }, name)).toBe('Tout le réseau');
  });
});
