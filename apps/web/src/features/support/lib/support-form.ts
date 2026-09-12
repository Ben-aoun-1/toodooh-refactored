// SUP-1 — the support / appointment forms' pure rules (no render harness: pinned here).

export const SUPPORT_OBJECTIVES = [
  'Renseignements',
  'Inscription',
  'Diffusion',
  'Ciblage',
  'Budget',
  'Accompagnement',
  'Support',
  'Facturation',
  'Autre',
] as const;

export const isAutreObjective = (value: string): boolean => value.trim().toLowerCase() === 'autre';

export interface SupportPayload {
  kind: 'support' | 'appointment';
  objective: string;
  other_detail?: string;
  message?: string;
  appointment_date?: string;
}

/** The one client-side check before the round trip; the api re-validates. null = valid. */
export const supportPayloadError = (p: SupportPayload): string | null => {
  if (!p.objective.trim()) return 'Choisissez un objectif.';
  if (isAutreObjective(p.objective) && !(p.other_detail ?? '').trim()) {
    return 'Veuillez préciser dans la description';
  }
  if (p.kind === 'appointment' && !p.appointment_date) return 'Choisissez un créneau.';
  return null;
};

export const SUPPORT_SENT_TOAST = 'Message envoyé au support. Nous vous répondrons rapidement.';
export const APPOINTMENT_SENT_TOAST = 'Demande de rendez-vous envoyée. Un agent vous recontacte.';
export const SUPPORT_FAILED_TOAST = "L'envoi a échoué. Merci de réessayer.";
/** Mejri 11/09 point 8 — « Commentaires additionnels », plural, in both forms. */
export const SUPPORT_COMMENT_LABEL = 'Commentaires additionnels';
