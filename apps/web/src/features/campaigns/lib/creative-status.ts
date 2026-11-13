// A creative's validation status in French — ONE home for the « Vos créations » lists of the
// classic wizard and of the Foot parcours (each list keeps its own chip colours).

export const CREATIVE_STATUS_LABEL: Record<string, string> = {
  pending: 'En attente de validation',
  approved: 'Validée',
  rejected: 'Refusée',
};

/** The French label, or the raw status for one the web does not know yet. */
export const creativeStatusLabel = (status: string): string =>
  CREATIVE_STATUS_LABEL[status] ?? status;
