// ── shared block — BYTE-IDENTICAL in apps/api and apps/web (pinned by test). Edit BOTH. ────────
/**
 * MEJ-14a (Mejri, ruled through the operator 2026-09-01) — the S04 « Profil typologique » bar fill.
 *
 * The EMPTY mockup draws DECORATIVE bar widths (sexe 50/50; ages 32/28/14/6) and both surfaces
 * reproduced them faithfully while the figures were still « en attente ». A coloured bar with no
 * figure behind it reads as a measurement — that is the complaint: an empty section looked like
 * measured data. **The ruling supersedes mockup fidelity on this point:** pending draws the track
 * and nothing else.
 *
 * The page and the PDF share this definition so they cannot disagree about when a bar is filled —
 * they disagreed by construction before, each carrying its own copy of the decorative widths.
 */
export interface DemoBarInput {
  /** No figures computable yet — the « en attente » state. */
  pending: boolean;
  /** This row's count. */
  count: number;
  /** The largest count in the row's group (sexe, or the age bands); 0 when nothing is computable. */
  maxCount: number;
}

/**
 * Bar fill as a percentage of the track, clamped to [0, 100].
 *
 * Pending → **0**, so the bar renders empty. `maxCount <= 0` is also 0: with no positive reference
 * there is no ratio to draw, and a bar drawn anyway would be decoration again.
 */
export function demoBarPct({ pending, count, maxCount }: DemoBarInput): number {
  if (pending || maxCount <= 0) return 0;
  return Math.max(0, Math.min(100, (count / maxCount) * 100));
}
// ── end shared block ──────────────────────────────────────────────────────────────────────────
