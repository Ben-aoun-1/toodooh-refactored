import { randomInt } from 'node:crypto';

// Agent referral codes (P1, format reruled by F2 — "Numéros", 2026-06-10): exactly 8 DIGITS,
// kept as a string so leading zeros survive (a code is an identifier, never a number). Opaque
// (no type prefix — the agent TYPE is implied by the owner's role). The draw must stay
// unbiased and 256 is NOT a multiple of 10, so `byte % 10` is out (it would favor 0-5);
// node:crypto randomInt rejection-samples internally, giving each digit a perfectly uniform
// draw. node:crypto only — no new dep. The web signup gate enforces the matching /^\d{8}$/
// (apps/web/src/features/auth/utils/agent-code.ts).
export const AGENT_CODE_ALPHABET = '0123456789';
export const AGENT_CODE_LENGTH = 8;

// One unbiased draw per digit. charAt (not []) keeps the return a plain string under
// noUncheckedIndexedAccess — the index is provably in range, but charAt avoids the
// `string | undefined` the index signature would otherwise yield.
export const generateAgentCode = (): string => {
  let code = '';
  for (let i = 0; i < AGENT_CODE_LENGTH; i += 1) {
    code += AGENT_CODE_ALPHABET.charAt(randomInt(AGENT_CODE_ALPHABET.length));
  }
  return code;
};

// Uniqueness-safe generation that NEVER relies on catching a unique-violation: a failed
// statement poisons the surrounding pg transaction. Instead the caller supplies an `exists`
// predicate (a SELECT on agents.code, run inside the same tx); we regenerate on the rare hit.
// The collision space dropped from 32^8 (~1.1e12) to 10^8 with the numeric format — still
// negligible at this scale (hundreds of agents, not millions), so 5 attempts stays generous;
// we throw rather than insert a probable-but-unverified dup if it somehow exhausts.
export const MAX_AGENT_CODE_ATTEMPTS = 5;

export const generateUniqueAgentCode = async (
  exists: (code: string) => Promise<boolean>,
): Promise<string> => {
  for (let attempt = 0; attempt < MAX_AGENT_CODE_ATTEMPTS; attempt += 1) {
    const code = generateAgentCode();
    if (!(await exists(code))) return code;
  }
  throw new Error(
    `Failed to generate a unique agent code after ${MAX_AGENT_CODE_ATTEMPTS} attempts`,
  );
};
