/**
 * SCR-DECL1 (operator rulings 2026-09-21) — a venue's DECLARED screens and rooms, the ONE input
 * rule shared by the signup wizard, the owner's Paramètres and the admin « Localités et écrans ».
 * Exact integers (Q3: the lossy « 6-10 » → 8 / « 10+ » → 10 buckets are gone), both required
 * for an owner (Q5), bounded per D1.
 *
 * The bounds are ONE definition: the api validates against a twin
 * (apps/api/src/validation/screen-declaration.ts) whose shared block is pinned byte for byte
 * against the one below by screen-declaration.test.ts.
 */
// ── shared block: declared screens / rooms bounds ──
export const DECLARED_COUNT_MIN = 1;
export const DECLARED_COUNT_MAX = 99;
// ── end shared block ──

export const DECLARED_COUNT_ERROR = `Saisissez un nombre entier entre ${DECLARED_COUNT_MIN} et ${DECLARED_COUNT_MAX}.`;

/** A typed count → the integer, or null when blank, not a whole number, or out of bounds. */
export const parseDeclaredCount = (raw: string): number | null => {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value >= DECLARED_COUNT_MIN && value <= DECLARED_COUNT_MAX ? value : null;
};

export const DECLARATION_EMPTY_ERROR = "Renseignez le nombre d'écrans ou de salles.";

/**
 * The admin's edit on « Localités et écrans »: a BLANK input is left unchanged (an admin must not
 * have to invent a legacy venue's unknown room count), a typed one must be a valid count, and at
 * least one must be given. The owner's own card requires both (Q5) — see venue-declaration.
 */
export const partialDeclarationPatch = (
  screensInput: string,
  roomsInput: string,
): { patch: { screen_count?: number; room_count?: number } } | { error: string } => {
  const screens = screensInput.trim() === '' ? undefined : parseDeclaredCount(screensInput);
  const rooms = roomsInput.trim() === '' ? undefined : parseDeclaredCount(roomsInput);
  if (screens === null || rooms === null) return { error: DECLARED_COUNT_ERROR };
  if (screens === undefined && rooms === undefined) return { error: DECLARATION_EMPTY_ERROR };
  return {
    patch: {
      ...(screens !== undefined ? { screen_count: screens } : {}),
      ...(rooms !== undefined ? { room_count: rooms } : {}),
    },
  };
};

/** A stored count → the input's text: a declaration below the minimum (0 = never declared) is
 *  shown EMPTY, so the field reads « to fill in », never « 0 ». */
export const declaredCountInput = (value: number | null): string =>
  value !== null && value >= DECLARED_COUNT_MIN ? String(value) : '';
