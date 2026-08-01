import { apiClient } from '@/lib/api-client';

// REV3 — the admin « Factures Screenhost » wire. The four actions are POSTs mirroring the api's
// transition matrix; the api is the authority and 409s anything out of matrix, so a UI that offers
// a wrong button produces a French error rather than an illegal transition.
//
// This is the ONLY wire in the product that carries a facture `status` — §5 forbids it on every
// owner projection, and the admin table is the single stated exception.

export interface AdminFactureRow {
  id: string;
  reference: string;
  screenhost_id: string;
  screenhost_name: string;
  month: string;
  /** HT — Σ sh_amount_tnd. Kept for completeness; the table's « Montant » column is the TTC. */
  total_sh_tnd: number;
  /** What the owner is actually paid, and what a versement freezes. */
  montant_ttc: number;
  status: string;
  /** Non-null if and only if the facture is currently refused (the api clears it on re-deposit). */
  refusal_motif: string | null;
  deposited_at: string | null;
  created_at: string;
  designation: string;
}

export const adminFacturesService = {
  /** Every facture, newest month first. `statut` filters server-side. */
  list(statut?: string): Promise<AdminFactureRow[]> {
    const q = statut && statut !== 'all' ? `?statut=${encodeURIComponent(statut)}` : '';
    return apiClient.get<AdminFactureRow[]>(`/admin/screenhost-factures${q}`);
  },

  /** « Voir » — a short-TTL presigned view of the SIGNED document the owner deposited. */
  signedUrl(id: string): Promise<{ url: string }> {
    return apiClient.get<{ url: string }>(`/admin/screenhost-factures/${id}/signed-url`);
  },

  /** en_verification → en_paiement. WRITES the versement line into the owner's history. */
  valider(id: string): Promise<{ id: string; status: string }> {
    return apiClient.post<{ id: string; status: string }>(
      `/admin/screenhost-factures/${id}/valider`,
      {},
    );
  },

  /** en_verification → refusee. The motif is REQUIRED and reaches the owner's notification. */
  refuser(id: string, motif: string): Promise<{ id: string; status: string }> {
    return apiClient.post<{ id: string; status: string }>(
      `/admin/screenhost-factures/${id}/refuser`,
      { motif },
    );
  },

  /** en_paiement → payee. Writes NOTHING to the versements — the money moved at validation. */
  marquerPayee(id: string): Promise<{ id: string; status: string }> {
    return apiClient.post<{ id: string; status: string }>(
      `/admin/screenhost-factures/${id}/marquer-payee`,
      {},
    );
  },

  /** THE PAPER PATH — emise and never deposited → payee AND a versement, in one action. */
  paper(id: string): Promise<{ id: string; status: string }> {
    return apiClient.post<{ id: string; status: string }>(
      `/admin/screenhost-factures/${id}/paper`,
      {},
    );
  },
};
