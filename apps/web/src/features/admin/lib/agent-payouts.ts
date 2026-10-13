import { format, subMonths } from 'date-fns';

// AGT-3 (agent specs v1.0 §10 « Versements ») — the hub's payouts view rules.

/** The month a payout run covers by default: the month that just ended ('YYYY-MM'). */
export const defaultPayoutMonth = (today: Date): string => format(subMonths(today, 1), 'yyyy-MM');

export const PAYOUT_STATUS_FR = { en_preparation: 'En préparation', effectue: 'Effectué' } as const;

/** Why a payout cannot be marked done yet, or null when it can. */
export const payoutBlocker = (p: {
  status: 'en_preparation' | 'effectue';
  invoice_required: boolean;
  invoice_uploaded_at: string | null;
  rib_validated: boolean;
}): string | null => {
  if (p.status === 'effectue') return null;
  if (!p.rib_validated) return 'RIB non validé';
  if (p.invoice_required && !p.invoice_uploaded_at) return 'Facture de l’agent attendue';
  return null;
};
