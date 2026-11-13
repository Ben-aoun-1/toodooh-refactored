// STOP-1 (operator rulings 2026-10-27) — « Arrêter la campagne », pure: who sees the button, the
// reason the confirm window asks for, and the result toast. Twin of the api's
// lib/campaign-stop.ts rules (STOPPABLE_STATUSES, reason 3–500 characters, superadmin only).
// Mariem 05/11 (ruling 1A) — a match positioning stops too, and « Supprimer » follows a stop
// (api lib/campaign-delete: only when nothing of it aired — the api has the last word).

export const STOP_REASON_MIN = 3;
export const STOP_REASON_MAX = 500;

interface StoppableRow {
  status: string;
  campaign_type: string;
  event_id: string | null;
}

/** A match positioning (EV4's binding) rather than a classic campaign. */
export const isPositioning = (row: Pick<StoppableRow, 'campaign_type' | 'event_id'>): boolean =>
  row.campaign_type === 'event' || row.event_id !== null;

/** A superadmin may stop a campaign or a positioning that is on air or paid and not started yet. */
export const canStopCampaign = (role: string | null | undefined, row: StoppableRow): boolean =>
  role === 'superadmin' && (row.status === 'active' || row.status === 'upcoming');

/** « Supprimer » — a superadmin, once the campaign was stopped (the api refuses one that aired). */
export const canDeleteCampaign = (
  role: string | null | undefined,
  row: { stopped_at?: string | null },
): boolean => role === 'superadmin' && typeof row.stopped_at === 'string';

export const stopLabel = (row: StoppableRow): string =>
  isPositioning(row) ? 'Arrêter le positionnement' : 'Arrêter la campagne';

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
export const stopConsequence = (row: StoppableRow): string => {
  if (isPositioning(row)) {
    return row.status === 'upcoming'
      ? 'Le match n’a pas commencé : le positionnement est annulé, son budget est entièrement remboursé à l’annonceur et ses places reviennent au match.'
      : 'Le positionnement s’arrête maintenant. Les établissements sont payés pour les blocs déjà diffusés ; le reste est remboursé à l’annonceur et ses places reviennent au match.';
  }
  return row.status === 'upcoming'
    ? 'La campagne n’a pas commencé : elle est annulée et son budget est entièrement remboursé à l’annonceur.'
    : 'La diffusion s’arrête maintenant. Les établissements sont payés pour ce qui a été diffusé ; le reste est remboursé à l’annonceur, même sous 20 TND.';
};

/** What « Supprimer » tells the superadmin before confirming. */
export const DELETE_CONSEQUENCE =
  'Elle disparaît de la plateforme, pour l’annonceur comme pour l’Admin. Si elle a été diffusée, même en partie, elle ne peut pas être supprimée : elle reste dans l’historique (gains des Hosts, factures).';

export const DELETED_TOAST = 'Campagne supprimée.';
