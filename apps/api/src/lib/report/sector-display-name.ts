// ── shared block — BYTE-IDENTICAL in apps/api and apps/web (pinned by test). Edit BOTH. ────────
/**
 * UI-1 (operator, 04/09) — the owner-facing DISPLAY name of a business sector.
 *
 * Two stored names read badly to an owner: « Resto » and « Resto/Bar ». They are shown as
 * « Restaurants » and « Lounges/Bars ».
 *
 * **The stored name never changes.** It is the only shared key with the hub catalog — the hub holds
 * catégorie NAMES, never toodooh's UUIDs — so renaming the rows would break ingest, the outbound
 * sync and every match. This maps at RENDER and nowhere else: matching, filtering, the wire and the
 * database all continue to speak the stored name.
 *
 * The page and the PDF share this definition because they render the SAME line for the same venue
 * (`categoryLabel`, « secteur · Classe »). A venue must not read « Restaurants · Premium » on its
 * performance page and « Resto · Premium » in the PDF it downloads from that page.
 */
const SECTOR_DISPLAY_NAMES: ReadonlyMap<string, string> = new Map([
  ['resto', 'Restaurants'],
  ['resto/bar', 'Lounges/Bars'],
]);

/** Casefolded, deaccented, whitespace-collapsed — so a drifted row still matches its label. */
export function normalizeSectorName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

/**
 * The label to SHOW for a stored sector name. Identity for anything unmapped, which is every other
 * sector — the map is a two-entry exception list, not a translation layer.
 */
export function sectorDisplayName(name: string): string {
  return SECTOR_DISPLAY_NAMES.get(normalizeSectorName(name)) ?? name;
}
// ── end shared block ──────────────────────────────────────────────────────────────────────────
