/**
 * CF-SK1 (ruling #9) — wording the confirm outcome. A cart can now resolve two ways at once:
 * already-approved spots LAUNCH immediately (À venir / Active — no admin review), new spots go
 * to En attente. The toast has to say which happened without lying about either.
 */

export interface ConfirmSplit {
  launched: number;
  pendingReview: number;
}

const campagnes = (n: number): string => `${n} campagne${n > 1 ? 's' : ''}`;

/**
 * The success toast. All-new-spot carts keep the pre-CF-SK1 pending-only copy (nothing changed
 * for them); all-approved carts say launched; a MIXED cart says both, in that order.
 */
export const confirmSuccessMessage = ({ launched, pendingReview }: ConfirmSplit): string => {
  if (launched > 0 && pendingReview > 0) {
    return `${campagnes(launched)} lancée${launched > 1 ? 's' : ''}, ${pendingReview} en attente de validation.`;
  }
  if (launched > 0) {
    return `${campagnes(launched)} lancée${launched > 1 ? 's' : ''} — diffusion programmée.`;
  }
  return `${campagnes(pendingReview)} soumise${pendingReview > 1 ? 's' : ''} — en attente de validation.`;
};

/**
 * The Validation-step reassurance: an already-approved spot means no review wait. Only
 * 'approved' earns the line — pending/rejected/absent say nothing (the wizard must never
 * promise a launch the admin still has to bless).
 */
export const APPROVED_SPOT_REASSURANCE =
  'Spot déjà validé — votre campagne sera lancée dès la confirmation du panier.';

export const approvedSpotNotice = (
  contentValidationStatus: string | null | undefined,
): string | null => (contentValidationStatus === 'approved' ? APPROVED_SPOT_REASSURANCE : null);
