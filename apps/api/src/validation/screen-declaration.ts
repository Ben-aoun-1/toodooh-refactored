import { z } from 'zod';

// SCR-DECL1 (operator rulings 2026-09-21) — a venue's DECLARED screens and rooms
// (screenhosts.screen_count / room_count). Exact integers (Q3: the lossy « 6-10 » → 8 /
// « 10+ » → 10 buckets are gone), both REQUIRED for an owner (Q5), bounded per D1. Used by the
// signup (individual top level + every fleet entry) and by the owner / admin per-venue edit.
//
// The bounds are ONE definition: the web copy (apps/web/src/lib/screen-declaration.ts) is read
// from disk by its test and compared byte for byte with the shared block below.
// ── shared block: declared screens / rooms bounds ──
export const DECLARED_COUNT_MIN = 1;
export const DECLARED_COUNT_MAX = 99;
// ── end shared block ──

export const declaredCountSchema = z.number().int().min(DECLARED_COUNT_MIN).max(DECLARED_COUNT_MAX);

type DeclarationField = 'screen_count' | 'room_count';

interface SignupDeclaration {
  profile_type?: string;
  screen_count?: number;
  room_count?: number;
}

/**
 * The signup body's rule for one count: an individual_owner must carry it at the top level (a
 * fleet owner carries it per establishment, where the entry schema already requires it).
 */
export const individualDeclares =
  (field: DeclarationField) =>
  (body: SignupDeclaration): boolean =>
    body.profile_type !== 'individual_owner' || body[field] !== undefined;

export const declarationRequired = (field: DeclarationField) => ({
  message: `${field} is required for an owner signup`,
  path: [field],
});
