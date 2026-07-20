/**
 * Tunisian phone normalization — the signup wizard's single home (prod-blocker lane).
 *
 * Real-world entry formats (mobile keyboards, contact autofill, copy/paste) arrive with
 * separators (spaces incl. NBSP, dots, dashes, parentheses) and any of the prefix spellings
 * (+216, 00216, bare 216, or the national 8 digits). The old inline validator accepted ONLY
 * `+216\d{8}` after whitespace-stripping, and the input's eager `+216`-forcing onChange
 * manufactured broken values out of already-prefixed entries (`216 22 333 444` became
 * `+216216...`) — a silently-held Suivant gate. Everything canonicalizes here instead, BEFORE
 * the unchanged wire contract: the payload still carries `+216XXXXXXXX`.
 */

// Visual separators tolerated between digits. `\s` already covers NBSP (U+00A0) and the
// narrow no-break space (U+202F) that iOS autofill inserts.
const SEPARATORS = /[\s.\-()]/g;

/** Strip visual separators only — never digits or the leading `+`. */
export const cleanPhoneInput = (raw: string): string => (raw || '').replace(SEPARATORS, '');

/**
 * Canonical `+216XXXXXXXX` from any real-world spelling, or `null` when the digits don't
 * form a Tunisian number. Accepted after cleaning: `+216` + 8 digits, `00216` + 8 digits,
 * bare `216` + 8 digits, or the national 8 digits alone.
 */
export const canonicalTunisiaPhone = (raw: string): string | null => {
  const cleaned = cleanPhoneInput(raw);
  const match =
    /^\+216(\d{8})$/.exec(cleaned) ??
    /^00216(\d{8})$/.exec(cleaned) ??
    /^216(\d{8})$/.exec(cleaned) ??
    /^(\d{8})$/.exec(cleaned);
  return match ? `+216${match[1]}` : null;
};

export const isValidTunisiaPhone = (raw: string): boolean => canonicalTunisiaPhone(raw) !== null;

/** The inline gate message — tells the user the expected NATIONAL format, not a regex. */
export const PHONE_FORMAT_ERROR = 'Numéro invalide — format attendu : 22 333 444';
