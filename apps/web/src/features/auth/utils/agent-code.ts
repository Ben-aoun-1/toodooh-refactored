/**
 * Agent-code field control (F4 — "Numéros" ruling 2026-06-10): exactly 8 digits. FORMAT only —
 * resolution stays server-side, where unmatched codes are still accepted and stored unlinked.
 * Pure: no I/O, no state.
 */
export const AGENT_CODE_LENGTH = 8;

// Strip whitespace as the user types, so a code pasted as "12 34 56 78" normalizes silently.
export function normalizeAgentCode(v: string): string {
  return v.replace(/\s+/g, '');
}

export function isValidAgentCode(v: string): boolean {
  return /^\d{8}$/.test(v);
}

export const AGENT_CODE_ERROR = 'Code agent invalide (8 chiffres).';
