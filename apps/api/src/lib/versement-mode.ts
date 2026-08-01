// REV3 — the FROZEN payout-mode label a versement carries, and the ONE place it is built.
//
// A VERSEMENT ROW MUST NEVER HOLD PAYOUT COORDINATES. `users.bank_rib` / `bank_iban` is the single
// home for live bank data (REV1), and a versement is readable by the owner over an owner route —
// putting the digits here would create a second home AND publish them. So the row stores a LABEL:
// the account type plus the last four digits, which is enough for an owner to recognise which
// account a past payment went to and useless to anyone else.
//
// IT IS FROZEN AT WRITE, not derived at read. That is the load-bearing property of the whole table.
// An owner who updates their RIB next month must still see the account a past versement actually
// went to; a label computed on read would silently rewrite history the moment the coordinates
// moved. This function is therefore called exactly once per versement — at validation or at the
// paper action — and never again.

/** How many trailing digits a masked label may reveal. Four is the bank-statement convention. */
export const MASK_VISIBLE_DIGITS = 4;

const MASK_BULLETS = '••••';

/** The mode every payout uses today. Kept as a constant so a second mode is an explicit edit. */
export const VERSEMENT_MODE_PREFIX = 'Virement bancaire';

/** What the label says when the owner had no coordinates on file at payment time. */
export const VERSEMENT_MODE_UNKNOWN = `${VERSEMENT_MODE_PREFIX} — coordonnées non renseignées`;

const lastDigits = (value: string): string | null => {
  const digits = value.replace(/\D/g, '');
  if (digits.length < MASK_VISIBLE_DIGITS) return null;
  return digits.slice(-MASK_VISIBLE_DIGITS);
};

/**
 * « Virement bancaire — IBAN ••••1234 ».
 *
 * The IBAN wins when both are present: it is the coordinate an international transfer actually
 * uses, and a Tunisian IBAN embeds the RIB, so its last four digits are the RIB's last four too —
 * the label reads the same either way.
 *
 * Returns the « coordonnées non renseignées » wording rather than throwing when nothing is on file.
 * An admin CAN validate a facture for an owner who has not finished their payout setup, and the
 * versement must still record what was true at that moment; refusing to build a label would either
 * block the validation or leave the row lying about the mode.
 */
export const maskedPayoutLabel = (
  rib: string | null | undefined,
  iban: string | null | undefined,
): string => {
  const ibanTail = iban ? lastDigits(iban.trim()) : null;
  if (ibanTail) return `${VERSEMENT_MODE_PREFIX} — IBAN ${MASK_BULLETS}${ibanTail}`;
  const ribTail = rib ? lastDigits(rib.trim()) : null;
  if (ribTail) return `${VERSEMENT_MODE_PREFIX} — RIB ${MASK_BULLETS}${ribTail}`;
  return VERSEMENT_MODE_UNKNOWN;
};

/**
 * True when a string contains no run of digits long enough to be a coordinate.
 *
 * Exported so the leak is asserted on the VALUE rather than on the function that produced it: a
 * future edit that formats the label differently still has to pass this. A RIB is 20 digits and a
 * TN IBAN is 22 after the prefix, so anything above the visible-digit budget is a leak.
 */
export const isMaskedSafe = (label: string): boolean =>
  !new RegExp(`[0-9]{${MASK_VISIBLE_DIGITS + 1},}`).test(label);
