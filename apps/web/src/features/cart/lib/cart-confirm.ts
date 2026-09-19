import { ApiError } from '@/lib/api-client';

/**
 * CF-C1 — the confirm-refusal payload, parsed and spoken in French (pure, tested). The api's
 * 400 CART_CONFIRM_FAILED carries per-item reasons and/or the solde shortfall; both surface on
 * the cart page (per-line messages + the recharge CTA — spec §1.13).
 */

export interface CartConfirmFailure {
  itemReasons: Map<string, string>;
  solde: { balance: number; required: number } | null;
}

/** The add/confirm gate codes → French line messages (the api's precise codes). */
export const CART_REASON_FR: Record<string, string> = {
  NOT_DRAFT: 'Cette campagne n’est plus un brouillon.',
  MISSING_DATES: 'La période de diffusion manque.',
  INVALID_START_DATE: 'La date de début est trop proche — choisissez une date plus lointaine.',
  MISSING_CREATIVE: 'Aucun spot n’est associé à cette campagne.',
  MISSING_BUDGET: 'Le budget n’est pas renseigné.',
  BUDGET_BELOW_MINIMUM: 'Le budget est sous le minimum de 100 TND.',
  BUDGET_EXCEEDS_CMAX: 'Le budget dépasse l’inventaire disponible — ajustez-le dans l’éditeur.',
  NOT_FOUND: 'Cette campagne n’existe plus.',
  // CF-HF3 — the CF-SK1 approved-skip path uppercases prepareActivation's refusal reasons; these
  // four were unmapped and fell back to the say-nothing generic line.
  CONTENT_NOT_APPROVED: 'Le spot n’est pas encore approuvé par la modération.',
  NO_DURATION: 'Le spot n’a pas de durée de diffusion.',
  BUDGET_TOO_LOW: 'Le budget est inférieur à une unité CPM — aucune impression ciblable.',
  INSUFFICIENT_BALANCE: 'Le solde est insuffisant pour cette campagne.',
  // CPM-3 — an admin CPM change raced the confirm: nothing was launched, a new confirm prices at
  // the new CPM (retryable).
  CPM_CHANGED: 'Le CPM de cette campagne vient de changer — confirmez de nouveau.',
};

export const cartReasonFr = (reason: string): string =>
  CART_REASON_FR[reason] ?? 'Cette campagne n’est plus lançable.';

/** Parse the 400 CART_CONFIRM_FAILED body out of an unknown error; null when it isn't one. */
export const parseCartConfirmFailure = (err: unknown): CartConfirmFailure | null => {
  if (!(err instanceof ApiError) || err.code !== 'CART_CONFIRM_FAILED') return null;
  const body = err.body;
  if (typeof body !== 'object' || body === null) return { itemReasons: new Map(), solde: null };
  const itemReasons = new Map<string, string>();
  const items = (body as { items?: unknown }).items;
  if (Array.isArray(items)) {
    for (const entry of items) {
      if (
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as { campaign_id?: unknown }).campaign_id === 'string' &&
        typeof (entry as { reason?: unknown }).reason === 'string'
      ) {
        itemReasons.set(
          (entry as { campaign_id: string }).campaign_id,
          (entry as { reason: string }).reason,
        );
      }
    }
  }
  const rawSolde = (body as { solde?: unknown }).solde;
  const solde =
    typeof rawSolde === 'object' &&
    rawSolde !== null &&
    typeof (rawSolde as { balance?: unknown }).balance === 'number' &&
    typeof (rawSolde as { required?: unknown }).required === 'number'
      ? {
          balance: (rawSolde as { balance: number }).balance,
          required: (rawSolde as { required: number }).required,
        }
      : null;
  return { itemReasons, solde };
};

/**
 * The widget's stacking slot: BELOW modals/drawers (z-50) and the bell (z-[90]) — the
 * map-layering convention. Pinned in tests so a modal can never end up under the widget.
 */
export const CART_WIDGET_Z_CLASS = 'z-40';
