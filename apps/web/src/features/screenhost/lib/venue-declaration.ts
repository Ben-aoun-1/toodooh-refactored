import type { DeclarationPatch } from '@/features/screenhost/services/screenhost.service';
import {
  DECLARED_COUNT_ERROR,
  declaredCountInput,
  parseDeclaredCount,
} from '@/lib/screen-declaration';

// SCR-DECL1 — the owner's per-venue « Écrans et salles » editor: pure logic + pinned French copy
// (apps/web has no render harness). One card per venue (Q4: a fleet owner edits each
// établissement); both counts are required (Q5) and exact (Q3, 1–99 per D1). The input rule is
// the shared one (@/lib/screen-declaration) — the signup wizard and the admin use it too.

export { declaredCountInput };

export const DECLARATION_HEADING = 'Écrans et salles';
export const DECLARATION_INTRO =
  "Déclarez, pour chaque lieu, le nombre d'écrans et de salles. Le nombre d'écrans fixe les écrans que votre application TV peut appairer ; en le baissant, seuls des écrans jamais installés sont retirés.";
export const NOT_DECLARED_LABEL = 'À renseigner';
export const DECLARATION_SAVED_TOAST = 'Écrans et salles enregistrés';
export const DECLARATION_ERROR_TOAST = "Impossible d'enregistrer les écrans et salles";

const plural = (n: number, word: string): string => `${n} ${word}${n > 1 ? 's' : ''}`;

/** The card's summary — « 3 écrans · 2 salles » — or null while either count is undeclared
 *  (screens 0 = never declared, rooms null = never declared). */
export const declarationSummary = (screens: number, rooms: number | null): string | null =>
  screens >= 1 && rooms !== null && rooms >= 1
    ? `${plural(screens, 'écran')} · ${plural(rooms, 'salle')}`
    : null;

/** The save body from the two inputs — BOTH required — or the French error to show. */
export const declarationPatchFrom = (
  screensInput: string,
  roomsInput: string,
): { patch: DeclarationPatch } | { error: string } => {
  const screenCount = parseDeclaredCount(screensInput);
  const roomCount = parseDeclaredCount(roomsInput);
  if (screenCount === null || roomCount === null) return { error: DECLARED_COUNT_ERROR };
  return { patch: { screen_count: screenCount, room_count: roomCount } };
};
