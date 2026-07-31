// REV2 — where a screenhost's SIGNED facture is stored, and how large it may be.
//
// The key is derived from the FACTURE id, deliberately: a re-deposit therefore overwrites the same
// object rather than accumulating versions. « Le dernier fichier déposé remplace le précédent » is
// the product rule, and deriving the key makes it structural instead of something the route has to
// remember to clean up — there is no orphan to delete because there was never a second object.

/** 10 MB — the justificatif cap (CF-M2), reused: a signed scan is the same class of document. */
export const MAX_JUSTIFICATIF_BYTES = 10 * 1024 * 1024;

/** Private prefix, served THROUGH the api like the facture PDF itself — never presigned. */
export const signedFactureKey = (factureId: string): string => `signed-factures/${factureId}.pdf`;
