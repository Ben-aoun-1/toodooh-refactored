import { apiClient } from '@/lib/api-client';

// REV3 — the owner's « Historique des versements ». A versement is the PAYMENT EVENT: the facture
// is the document, reversement_lines is the computation, and this is the record that Toodooh
// actually paid it, once.
//
// EXACTLY FOUR FIELDS, and the interface is the pin on the consuming side. The api projects only
// these four; adding a fifth here would mean either the wire grew (a regression the api test
// catches) or the web invented one.
//
// WHAT IS DELIBERATELY ABSENT, and why each matters:
//   status      §5 — the owner reads no lifecycle on a line, and a versement has none anyway
//   facture_id  an internal join key; exposing it invites this surface to link a payment back to a
//               document and re-introduce status through the door
//   created_by  which admin acted is internal
//   the RIB/IBAN — `mode_label_masked` is a LABEL (type + last four digits) frozen at write, never
//               live coordinates. users.bank_* stays the only home for those.

export interface OwnerVersementRow {
  /** « Facture juillet 2026 » — frozen at write, not re-derived. */
  designation: string;
  /** The facture's TTC. */
  montant_ttc: number;
  /** When the payment was recorded (validation, or the paper action). */
  created_at: string;
  /** « Virement bancaire — IBAN ••••7890 ». Frozen: a later bank change never rewrites it. */
  mode_label_masked: string;
}

/**
 * OWN-REV1 — the owner dashboard's two money cards, both TTC (SH-TTC1):
 * `a_encaisser_ttc` = « Revenus » (owed), `encaisse_ttc` = « Revenu encaissé » (Σ versements).
 */
export interface OwnerRevenueSummary {
  a_encaisser_ttc: number;
  encaisse_ttc: number;
}

export const versementsService = {
  /** The caller's versements, newest first. */
  list(): Promise<OwnerVersementRow[]> {
    return apiClient.get<OwnerVersementRow[]>('/screenhosts/versements');
  },
  /** OWN-REV1 — owed vs paid, TTC. */
  revenueSummary(): Promise<OwnerRevenueSummary> {
    return apiClient.get<OwnerRevenueSummary>('/screenhosts/revenue-summary');
  },
};
