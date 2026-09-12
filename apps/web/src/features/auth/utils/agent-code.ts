/**
 * Agent-code field control (Kais GTM spec, 2026-06-19): the entered referral code must match
 * the issued format — a 2-char TYPE prefix ('SH' screenhost_agent | 'SC' screencast_agent)
 * followed by exactly 6 digits, case-insensitive. This SUPERSEDES the F5 "any 1–16 digits"
 * gate (F5 numeric ruling, 2026-06-11): Kais's GTM format is now the contract. FORMAT only —
 * resolution is server-side: since AGENT-V1 (2026-09-12) an unmatched or wrong-type code is
 * REFUSED (409 at /api/signup, pre-checked by /api/signup/agent-code-availability). Generation lives in apps/api/src/lib/agent-code.ts and mints
 * the same shape; a cross-check test keeps the two in sync (the two apps don't share a package).
 * Pure: no I/O, no state.
 *
 * The prefix set + digit count are the single retune point on this side — change the charset or
 * the length here and the regex follows.
 */
export const AGENT_CODE_PREFIXES = ['SH', 'SC'] as const;
export const AGENT_CODE_DIGITS = 6;

// ^(SH|SC)\d{6}$, built from the constants above. Case-insensitive so a user who types lower-
// case still passes (normalizeAgentCode uppercases regardless — the issued format is uppercase).
const AGENT_CODE_PATTERN = new RegExp(
  `^(?:${AGENT_CODE_PREFIXES.join('|')})\\d{${AGENT_CODE_DIGITS}}$`,
  'i',
);

// Uppercase + strip ALL whitespace as the user types, so 'sh 12 34 56' normalizes silently to
// 'SH123456'. Normalization NEVER repairs an invalid code — it only cases + de-spaces.
export function normalizeAgentCode(v: string): string {
  return v.replace(/\s+/g, '').toUpperCase();
}

export function isValidAgentCode(v: string): boolean {
  return AGENT_CODE_PATTERN.test(v);
}

export const AGENT_CODE_ERROR = 'Code agent invalide (format SH/SC + 6 chiffres).';
