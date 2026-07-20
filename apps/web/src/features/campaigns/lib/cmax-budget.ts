import { isErrorWithCode } from '@/lib/errors';

/**
 * E5 (VF US-1.4) — the pure cursor-vs-ceiling rules behind the bounded Validation slider.
 * The interim flat 5 000 ceiling retires: the slider max IS c_max_tnd, and a budget above a
 * freshly-fetched ceiling is pulled back WITH a visible notice — never a silent clamp.
 */

const int = new Intl.NumberFormat('fr-TN', { maximumFractionDigits: 0 });

export interface BudgetClampResult {
  next: number | null;
  /** True when the value was pulled back — the caller MUST surface the notice. */
  clamped: boolean;
}

/**
 * Pull-back (US-1.4): a budget over the ceiling clamps down to it; a zero ceiling clears the
 * budget entirely (0 is not a valid budget — the zero-state blocks the step instead). At or
 * under the ceiling nothing moves.
 */
export const clampBudgetToCmax = (value: number | null, cMaxTnd: number): BudgetClampResult => {
  if (value == null || value <= cMaxTnd) return { next: value, clamped: false };
  return { next: cMaxTnd > 0 ? cMaxTnd : null, clamped: true };
};

/** « Budget maximum disponible : … » — the helper line under the slider, eligible_count worked in. */
export const cmaxHelperLine = (cMaxTnd: number, eligibleCount: number): string =>
  `Budget maximum disponible : ${int.format(cMaxTnd)} TND — calculé sur l'inventaire réel de votre ciblage (${int.format(eligibleCount)} établissement${eligibleCount > 1 ? 's' : ''} éligible${eligibleCount > 1 ? 's' : ''}).`;

export const CMAX_PULLBACK_NOTICE = 'Le budget a été ajusté à l’inventaire disponible.';
export const CMAX_ZERO_STATE =
  'Aucun inventaire disponible pour ce ciblage — élargissez vos catégories ou zones.';

/** The submit-time refusal (server gate) — the FE re-reads the live ceiling and re-clamps. */
export const isBudgetExceedsCmax = (err: unknown): boolean =>
  isErrorWithCode(err) && err.code === 'BUDGET_EXCEEDS_CMAX';
