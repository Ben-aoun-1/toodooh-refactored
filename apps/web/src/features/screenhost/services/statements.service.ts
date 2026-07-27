import { apiClient } from '@/lib/api-client';

// FCT2 — the owner's monthly « Relevés de reversement » over REST: server-generated + STORED PDFs
// (Σ reversement_lines.sh_amount_tnd per venue per settled month), replacing the mock-fed
// client-side jsPDF relevé (data/ownerStatementDetails.ts — dead once this is the source).

export interface OwnerStatementRow {
  id: string;
  screenhost_id: string;
  screenhost_name: string;
  month: string; // 'YYYY-MM'
  total_sh_tnd: number;
  reference: string;
  created_at: string;
}

/** The download filename — mirrors GET /screenhosts/statements/:id/pdf's content-disposition. */
export const releveFilename = (reference: string): string => `releve-${reference}.pdf`;

/** « Relevé de reversement — Juillet 2026 » from the 'YYYY-MM' month key. */
export const statementDesignation = (month: string): string => {
  const d = new Date(`${month}-01T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return 'Relevé de reversement';
  const label = d.toLocaleDateString('fr-FR', { month: 'long', timeZone: 'UTC' });
  return `Relevé de reversement — ${label.charAt(0).toUpperCase() + label.slice(1)} ${month.slice(0, 4)}`;
};

export const statementsService = {
  /** Every relevé across the caller's venues, newest month first. */
  list(): Promise<OwnerStatementRow[]> {
    return apiClient.get<OwnerStatementRow[]>('/screenhosts/statements');
  },

  /** The STORED relevé PDF (owner-scoped; a foreign statement is a plain 404). */
  download(id: string): Promise<Blob> {
    return apiClient.getBlob(`/screenhosts/statements/${id}/pdf`);
  },
};
