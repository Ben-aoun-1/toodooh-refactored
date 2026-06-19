import { randomInt } from 'node:crypto';

// System-generated temporary password for internal AGENT accounts (the admin no longer types one
// — Kais GTM). Unambiguous alphanumeric only (no 0/O/1/l/I) so a password that is emailed and then
// re-typed survives transcription. The length sits well above the ruling-7 ≥12 privileged-account
// floor. node:crypto randomInt rejection-samples each pick uniformly (no `% len` modulo bias, since
// 256 is not a multiple of the alphabet size); node:crypto only — no new dep.
export const TEMP_PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
export const TEMP_PASSWORD_LENGTH = 16;

// charAt (not []) keeps the return a plain string under noUncheckedIndexedAccess — the index is
// provably in range, but charAt avoids the `string | undefined` the index signature would yield.
export const generateTempPassword = (): string => {
  let password = '';
  for (let i = 0; i < TEMP_PASSWORD_LENGTH; i += 1) {
    password += TEMP_PASSWORD_ALPHABET.charAt(randomInt(TEMP_PASSWORD_ALPHABET.length));
  }
  return password;
};
