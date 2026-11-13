// STOP-1 (operator rulings 2026-10-27) — « Arrêter la campagne », pure: who sees the button, the
// reason the confirm window asks for, and the result toast. Twin of the api's
// lib/campaign-stop.ts rules (STOPPABLE_STATUSES, reason 3–500 characters, superadmin only).

export const STOP_REASON_MIN = 3;
export const STOP_REASON_MAX = 500;

/** A superadmin may stop a standard campaign that is on air or paid and not started yet. */
export const canStopCampaign = (
  role: string | null | undefined,
  row: { status: string; campaign_type: string; event_id: string | null },
): boolean =>
  role === 'superadmin' &&
  (row.status === 'active' || row.status === 'upcoming') &&
  row.campaign_type !== 'event' &&
  row.event_id === null;

export function parseStopReason(
  raw: string,
): { ok: true; value: string } | { ok: false; error: string } {
  const reason = raw.trim();
  if (reason.length < STOP_REASON_MIN || reason.length > STOP_REASON_MAX) {
    return {
      ok: false,
      error: `Indiquez le motif de l’arrêt (${STOP_REASON_MIN} à ${STOP_REASON_MAX} caractères).`,
    };
  }
  return { ok: true, value: reason };
}

const tnd = (n: number): string => `${n.toFixed(3).replace('.', ',')} TND`;

/** « Campagne arrêtée — 30,000 TND remboursés à l’annonceur. » */
export const stoppedToast = (refundTnd: number): string =>
  refundTnd > 0
    ? `Campagne arrêtée — ${tnd(refundTnd)} remboursés à l’annonceur.`
    : 'Campagne arrêtée.';

/** What the confirm window tells the superadmin will happen. */
export const stopConsequence = (status: string): string =>
  status === 'upcoming'
    ? 'La campagne n’a pas commencé : elle est annulée et son budget est entièrement remboursé à l’annonceur.'
    : 'La diffusion s’arrête maintenant. Les établissements sont payés pour ce qui a été diffusé ; le reste est remboursé à l’annonceur, même sous 20 TND.';
