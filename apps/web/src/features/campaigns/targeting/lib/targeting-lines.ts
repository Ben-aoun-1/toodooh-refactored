/**
 * Targeting builder — pure logic (L-target).
 *
 * The screencaster targets venues LINE BY LINE: each line = a CATEGORY × a CLASS. Either axis may be
 * "toutes" (ALL), represented as `null`; the null/null line = "tout le réseau" (the whole network).
 * A line may appear at most once — dedup treats ALL (null) as a concrete value, matching the API's
 * `UNIQUE NULLS NOT DISTINCT`. This module is the single source of truth for line identity, dedup,
 * the summary label, and the wire (de)serialisation; the React components stay thin over it.
 */

export type TargetingClass = 'populaire' | 'moyen' | 'premium';

export const TARGETING_CLASSES: readonly TargetingClass[] = ['populaire', 'moyen', 'premium'];

export const CLASS_LABELS: Record<TargetingClass, string> = {
  populaire: 'Populaire',
  moyen: 'Moyen',
  premium: 'Premium',
};

/** A targeting line. `null` on an axis = "toutes" (ALL). */
export interface TargetingLine {
  categoryId: string | null;
  class: TargetingClass | null;
}

/** The API wire shape (snake_case) for one line. */
export interface TargetingLineWire {
  category_id: string | null;
  class: TargetingClass | null;
}

/** Identity used for dedup. NULL (ALL) is a concrete token so two "all" lines collide. */
export const lineSignature = (line: TargetingLine): string =>
  `${line.categoryId ?? 'ALL'}::${line.class ?? 'ALL'}`;

/** The null/null line — "tout le réseau" (exhaustive). */
export const isAllNetwork = (line: TargetingLine): boolean =>
  line.categoryId === null && line.class === null;

export const allNetworkLine = (): TargetingLine => ({ categoryId: null, class: null });

/**
 * Index of an existing line that collides with `candidate` (same signature), skipping `exceptIndex`
 * (the line being edited). -1 when none — i.e. `candidate` is unique.
 */
export const duplicateIndexOf = (
  lines: readonly TargetingLine[],
  candidate: TargetingLine,
  exceptIndex = -1,
): number => {
  const sig = lineSignature(candidate);
  return lines.findIndex((line, i) => i !== exceptIndex && lineSignature(line) === sig);
};

/** True when any signature repeats across the set. */
export const hasDuplicate = (lines: readonly TargetingLine[]): boolean => {
  const seen = new Set<string>();
  for (const line of lines) {
    const sig = lineSignature(line);
    if (seen.has(sig)) return true;
    seen.add(sig);
  }
  return false;
};

/** A human label for one line, e.g. "Restaurant · Premium", "Toutes catégories · Premium". */
export const lineLabel = (
  line: TargetingLine,
  categoryName: (id: string) => string | undefined,
): string => {
  if (isAllNetwork(line)) return 'Tout le réseau';
  const cat = line.categoryId
    ? (categoryName(line.categoryId) ?? 'Catégorie')
    : 'Toutes catégories';
  const cls = line.class ? CLASS_LABELS[line.class] : 'Toutes classes';
  return `${cat} · ${cls}`;
};

/**
 * The first (category × class) combination not already present — used to seed a freshly "+ added"
 * line so it never starts as a duplicate (no immediate amber flash). Specific categories are tried
 * before "toutes", and the null/null whole-network combo is never auto-seeded (that's the toggle's
 * job). Returns null only when every combination is already taken.
 */
export const firstAvailableLine = (
  lines: readonly TargetingLine[],
  categoryIds: readonly string[],
): TargetingLine | null => {
  const categoryAxis: (string | null)[] = [...categoryIds, null];
  const classAxis: (TargetingClass | null)[] = [...TARGETING_CLASSES, null];
  for (const categoryId of categoryAxis) {
    for (const cls of classAxis) {
      if (categoryId === null && cls === null) continue; // never auto-seed "tout le réseau"
      const candidate: TargetingLine = { categoryId, class: cls };
      if (duplicateIndexOf(lines, candidate) === -1) return candidate;
    }
  }
  return null;
};

export const toWire = (lines: readonly TargetingLine[]): TargetingLineWire[] =>
  lines.map((line) => ({ category_id: line.categoryId, class: line.class }));

export const fromWire = (rows: readonly TargetingLineWire[]): TargetingLine[] =>
  rows.map((row) => ({ categoryId: row.category_id, class: row.class }));
