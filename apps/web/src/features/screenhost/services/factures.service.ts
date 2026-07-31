import { apiClient } from '@/lib/api-client';

// REV2 — the owner's « Mes factures ». Supersedes FCT2's « Relevés de reversement »: the same
// monthly per-venue rows the billing sweep writes, but the DOCUMENT REVERSED DIRECTION. The venue
// is the ÉMETTEUR and Toodooh is the CLIENT — a supplier invoice the screenhost issues to us and
// returns signed. « Toujours facture, jamais relevé ».
//
// THE ROUTE PATHS STAY `/screenhosts/statements`. They are plumbing, not vocabulary: renaming them
// would be an api change, and commit 1 is ratified. The ENTITY is the facture; the URL is only where
// its bytes are fetched from — the same reasoning that keeps the api's `statements/<venue>/<month>`
// storage key untouched.
//
// THE WIRE CARRIES NO STATUS, deliberately (US-REV §5): a screenhost learns that a facture moved to
// en_verification through a NOTIFICATION, never a badge on a line. The api pins the absence; this
// interface pins it on the consuming side — adding `status` here would be the regression.

export interface OwnerFactureRow {
  id: string;
  screenhost_id: string;
  screenhost_name: string;
  month: string; // 'YYYY-MM'
  /** Σ sh_amount_tnd settled that month — HT. The TTC the owner sees is derived, never stored. */
  total_sh_tnd: number;
  /** FS- + 8 uppercase hex, derived from the row id. */
  reference: string;
  created_at: string;
  /** ISO instant of the last signed deposit, or null. The ONLY deposit signal the owner gets. */
  deposited_at: string | null;
  /** « Facture <Mois> <Année> » — rendered server-side so both apps say the same words. */
  designation: string;
}

/** One per-source revenue line — REV2 commit 3, derived by the api's single computation home. */
export interface OwnerFactureLine {
  /** 'campaign' | 'event' — the reversement_lines.source bucket. */
  source: string;
  /** Σ sh_amount_tnd for that source in the month (HT). */
  amount_ht_tnd: number;
}

/**
 * The DETAIL wire: the list row, plus the breakdown.
 *
 * The lines live here and not on the list because the detail screen's « Imprimer » renders it as
 * the printable — it is a signable artifact like the PDF, and the two must show the same lines.
 * A list row needs a total, not a breakdown. Still no `status`, on either wire.
 */
export interface OwnerFactureDetail extends OwnerFactureRow {
  lines: OwnerFactureLine[];
}

/** The download filename — mirrors GET /screenhosts/statements/:id/pdf's content-disposition. */
export const factureFilename = (reference: string): string => `facture-${reference}.pdf`;

/** What the deposit drop zone accepts — the api's DECLARED_TO_CONTAINER document subset. */
export const SIGNED_DEPOSIT_ACCEPT = 'application/pdf,image/jpeg,image/png';

export const facturesService = {
  /** Every facture across the caller's venues, newest month first. */
  list(): Promise<OwnerFactureRow[]> {
    return apiClient.get<OwnerFactureRow[]>('/screenhosts/statements');
  },

  /** One facture with its per-source lines (owner-scoped; a foreign facture is a plain 404). */
  detail(id: string): Promise<OwnerFactureDetail> {
    return apiClient.get<OwnerFactureDetail>(`/screenhosts/statements/${id}`);
  },

  /** The STORED facture PDF (owner-scoped; a foreign facture is a plain 404). */
  download(id: string): Promise<Blob> {
    return apiClient.getBlob(`/screenhosts/statements/${id}/pdf`);
  },

  /**
   * Return the printed, signed and stamped document. Multipart — the api byte-sniffs it and caps it
   * at 10 MB. A re-deposit REPLACES: the storage key is derived from the facture id, so the object
   * is overwritten in place and exactly one file ever exists per facture. That is the rule the UI
   * states (« Le dernier fichier déposé remplace le précédent. »), and it is structural, not a
   * cleanup either side has to remember.
   */
  depositSigned(id: string, file: File): Promise<{ id: string; deposited: boolean }> {
    const form = new FormData();
    form.append('file', file);
    return apiClient.postForm<{ id: string; deposited: boolean }>(
      `/screenhosts/statements/${id}/signed-deposit`,
      form,
    );
  },
};
