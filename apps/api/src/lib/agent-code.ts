import { randomInt } from 'node:crypto';

// Agent referral codes (P1; format reruled by Kais's GTM spec, 2026-06-19): a 2-char TYPE
// PREFIX + 6 random DIGITS (8 chars total), kept as a string so leading zeros survive (a code
// is an identifier, never a number). The prefix encodes the issuing agent's TYPE so a code is
// self-describing: 'SH' for screenhost_agent, 'SC' for screencast_agent. This SUPERSEDES the
// earlier opaque numeric-only format (no type prefix — the type was merely implied by the
// owner's role). The per-digit draw must stay unbiased and 256 is NOT a multiple of 10, so
// `byte % 10` is out (it would favor 0-5); node:crypto randomInt rejection-samples internally,
// giving each digit a perfectly uniform draw. node:crypto only — no new dep.
//
// The format lives in ONE place here — the prefix set, the digit alphabet, and the random
// length — so retuning the length or charset is a one-line change. The web signup gate
// enforces the SAME shape independently (apps/web/src/features/auth/utils/agent-code.ts,
// ^(SH|SC)\d{6}$), kept in sync by a cross-check test (the two apps don't share a package).
export const AGENT_CODE_PREFIXES = ['SH', 'SC'] as const;
export type AgentCodePrefix = (typeof AGENT_CODE_PREFIXES)[number];
export const AGENT_CODE_DIGIT_ALPHABET = '0123456789';
export const AGENT_CODE_RANDOM_LENGTH = 6;
// All prefixes are 2 chars; total length is derived so it tracks AGENT_CODE_RANDOM_LENGTH.
export const AGENT_CODE_PREFIX_LENGTH = 2;
export const AGENT_CODE_LENGTH = AGENT_CODE_PREFIX_LENGTH + AGENT_CODE_RANDOM_LENGTH;

// One unbiased draw per digit, appended to the type prefix. charAt (not []) keeps the return a
// plain string under noUncheckedIndexedAccess — the index is provably in range, but charAt
// avoids the `string | undefined` the index signature would otherwise yield.
export const generateAgentCode = (prefix: AgentCodePrefix): string => {
  let code = String(prefix);
  for (let i = 0; i < AGENT_CODE_RANDOM_LENGTH; i += 1) {
    code += AGENT_CODE_DIGIT_ALPHABET.charAt(randomInt(AGENT_CODE_DIGIT_ALPHABET.length));
  }
  return code;
};

// Uniqueness-safe generation that NEVER relies on catching a unique-violation: a failed
// statement poisons the surrounding pg transaction. Instead the caller supplies an `exists`
// predicate (a SELECT on agents.code, run inside the same tx); we regenerate on the rare hit.
// The random space per prefix is 10^6 — still negligible at this scale (hundreds of agents,
// not millions), so 5 attempts stays generous; we throw rather than insert a probable-but-
// unverified dup if it somehow exhausts.
export const MAX_AGENT_CODE_ATTEMPTS = 5;

export const generateUniqueAgentCode = async (
  prefix: AgentCodePrefix,
  exists: (code: string) => Promise<boolean>,
): Promise<string> => {
  for (let attempt = 0; attempt < MAX_AGENT_CODE_ATTEMPTS; attempt += 1) {
    const code = generateAgentCode(prefix);
    if (!(await exists(code))) return code;
  }
  throw new Error(
    `Failed to generate a unique agent code after ${MAX_AGENT_CODE_ATTEMPTS} attempts`,
  );
};
