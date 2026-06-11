/**
 * Agent-code field control (F5 — Kais QA ruling 2026-06-11: numeric, no fixed length — "pas
 * besoin de 8 chiffres"; supersedes the F4 exactly-8 gate). FORMAT only — resolution stays
 * server-side, where unmatched codes are still accepted and stored unlinked. Generation is
 * unchanged (apps/api/src/lib/agent-code.ts still mints 8 digits); only this signup-side
 * check loosens. The 16-digit ceiling is a sanity bound, not a business rule.
 * Pure: no I/O, no state.
 */
export const AGENT_CODE_MAX_LENGTH = 16;

// Strip whitespace as the user types, so a code pasted as "12 34 56 78" normalizes silently.
export function normalizeAgentCode(v: string): string {
  return v.replace(/\s+/g, '');
}

export function isValidAgentCode(v: string): boolean {
  return /^\d{1,16}$/.test(v);
}

export const AGENT_CODE_ERROR = 'Code agent invalide (chiffres uniquement).';
