/**
 * Password policy — the backend's floor (slice-1 C3): min 10 + upper + lower + digit.
 * Single source of truth for signup (F2) and password-change (F6) so the two never drift. Pure: no
 * I/O, no state.
 */
export const PASSWORD_MIN_LENGTH = 10;

export interface PasswordChecks {
  minLen: boolean;
  upper: boolean;
  lower: boolean;
  digit: boolean;
}

export function passwordChecks(pw: string): PasswordChecks {
  return {
    minLen: pw.length >= PASSWORD_MIN_LENGTH,
    upper: /[A-Z]/.test(pw),
    lower: /[a-z]/.test(pw),
    digit: /\d/.test(pw),
  };
}

export function isValidPassword(pw: string): boolean {
  const c = passwordChecks(pw);
  return c.minLen && c.upper && c.lower && c.digit;
}
