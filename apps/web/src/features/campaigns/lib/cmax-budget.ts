import { isErrorWithCode } from '@/lib/errors';

/**
 * E5 (VF US-1.4) — the pure cursor-vs-ceiling rules behind the bounded Validation slider.
 * The interim flat 5 000 ceiling retires: the slider max IS c_max_tnd, and a budget above a
 * freshly-fetched ceiling is pulled back WITH a visible notice — never a silent clamp.
 */

const int = new Intl.NumberFormat('fr-TN', { maximumFractionDigits: 0 });

/**
 * CF-U3 (Mejri) — the campaign budget FLOOR, mirroring the api's MIN_CAMPAIGN_BUDGET_TND
 * (lib/campaign-budget.ts; the two apps don't share a package — the mirror is test-pinned).
 * The slider min, the [floor, C_max] clamp and the insufficient-inventory threshold all read it.
 */
export const CAMPAIGN_BUDGET_FLOOR_TND = 100;

/** C_max below the floor ⇒ nothing sellable for this targeting (the zero-state treatment). */
export const isInventoryInsufficient = (cMaxTnd: number): boolean =>
  cMaxTnd < CAMPAIGN_BUDGET_FLOOR_TND;

export interface BudgetClampResult {
  next: number | null;
  /** True when the value was pulled back — the caller MUST surface the notice. */
  clamped: boolean;
}

/**
 * Pull-back (US-1.4): a budget over the ceiling clamps down to it; a ceiling below the floor
 * clears the budget entirely (the insufficient-inventory state blocks the step instead). A
 * stored sub-floor budget is NEVER auto-raised (raising an ask without consent is worse than
 * refusing — the submit gate + the French message own that case). At or under the ceiling
 * nothing moves.
 */
export const clampBudgetToCmax = (value: number | null, cMaxTnd: number): BudgetClampResult => {
  if (value == null || value <= cMaxTnd) return { next: value, clamped: false };
  return { next: isInventoryInsufficient(cMaxTnd) ? null : cMaxTnd, clamped: true };
};

/** « Budget maximum disponible : … » — the helper line under the slider; ceiling, floor and
 * eligible_count all said out loud. */
export const cmaxHelperLine = (cMaxTnd: number, eligibleCount: number): string =>
  `Budget maximum disponible : ${int.format(cMaxTnd)} TND (minimum : ${int.format(CAMPAIGN_BUDGET_FLOOR_TND)} TND) — calculé sur l'inventaire réel de votre ciblage (${int.format(eligibleCount)} établissement${eligibleCount > 1 ? 's' : ''} éligible${eligibleCount > 1 ? 's' : ''}).`;

export const CMAX_PULLBACK_NOTICE = 'Le budget a été ajusté à l’inventaire disponible.';
export const CMAX_ZERO_STATE =
  'Aucun inventaire disponible pour ce ciblage — élargissez vos catégories ou zones.';
// CF-HF4 — saturated ≠ empty targeting: venues MATCH but their capacity is fully engaged.
export const CMAX_SATURATED_STATE =
  'Inventaire momentanément saturé sur ce ciblage — réessayez avec une autre période.';

/** Pick the zero-inventory message: matching-but-saturated venues speak the saturated line. */
export const cmaxZeroStateMessage = (targetedCount: number | undefined): string =>
  (targetedCount ?? 0) > 0 ? CMAX_SATURATED_STATE : CMAX_ZERO_STATE;

/** The submit-time refusal (server gate) — the FE re-reads the live ceiling and re-clamps. */
export const isBudgetExceedsCmax = (err: unknown): boolean =>
  isErrorWithCode(err) && err.code === 'BUDGET_EXCEEDS_CMAX';

/** CF-U3 — the server floor refusal, surfaced in French by the wizard. */
export const isBudgetBelowMinimum = (err: unknown): boolean =>
  isErrorWithCode(err) && err.code === 'BUDGET_BELOW_MINIMUM';

export const BUDGET_FLOOR_ERROR = `Le budget minimum d'une campagne est de ${int.format(CAMPAIGN_BUDGET_FLOOR_TND)} TND.`;
