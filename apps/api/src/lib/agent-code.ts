import { randomBytes } from 'node:crypto';

// Agent referral codes (P1). Opaque (no type prefix — the agent TYPE is implied by the
// owner's role). The alphabet is the locked 32-symbol set: the 26 letters minus I and O
// plus the digits 2-9 (0 and 1 dropped). That leaves L in — exactly 32 symbols, which is
// what makes the draw unbiased: 256 is a multiple of 32, so `byte % 32` is perfectly
// uniform (dropping L to 31 would reintroduce modulo bias). node:crypto only — no new dep.
export const AGENT_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const AGENT_CODE_LENGTH = 8;

// One unbiased draw. charAt (not []) keeps the return a plain string under
// noUncheckedIndexedAccess — the index is provably in range, but charAt avoids the
// `string | undefined` the index signature would otherwise yield.
export const generateAgentCode = (): string => {
  let code = '';
  for (const byte of randomBytes(AGENT_CODE_LENGTH)) {
    code += AGENT_CODE_ALPHABET.charAt(byte % AGENT_CODE_ALPHABET.length);
  }
  return code;
};

// Uniqueness-safe generation that NEVER relies on catching a unique-violation: a failed
// statement poisons the surrounding pg transaction. Instead the caller supplies an `exists`
// predicate (a SELECT on agents.code, run inside the same tx); we regenerate on the rare hit.
// The collision odds against 32^8 (~1.1e12) are negligible, so 5 attempts is generous; we
// throw rather than insert a probable-but-unverified dup if it somehow exhausts.
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
