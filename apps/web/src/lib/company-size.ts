/**
 * The `company_size` scale — ONE home (SIZE-MISM1, Mejri 07/09).
 *
 * Signup (`SignUpForm`) and Paramètres (`ProfileSettings`) render the SAME stored
 * `company_size` string, but each used to hard-code its own option set — signup wrote
 * « 50 - 100 », Settings offered 1-5 / 6-10 / 11-50 / 51-200 / 200+. The sets were disjoint,
 * so a value chosen at signup matched no `<option>` and the select fell back to its empty
 * placeholder (« Sélectionner »). Neither surface may declare its own literal again; both
 * import from here, and `company-size.test.ts` pins that by scanning the two sources.
 *
 * The field is DUAL-PURPOSE, which is why the scale is a parameter rather than one list:
 * an advertiser/agency picks an employee band, an owner picks how many établissements are
 * in their parc. The stored string is whatever the chosen scale offers.
 */

/** Which reading of `company_size` a surface is showing. */
export type CompanySizeScale = 'company' | 'parc';

/** Employee bands — advertiser / agency. */
export const COMPANY_SIZE_OPTIONS: readonly string[] = [
  '0 - 10',
  '10 - 50',
  '50 - 100',
  '100 - 500',
  '500 et plus',
];

/** Établissement count of an owner's parc. */
export const PARC_COUNT_OPTIONS: readonly string[] = [
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '10',
  '11',
  '12',
  '12+',
];

/** The selectable values for a scale — the single source both surfaces map over. */
export const companySizeOptions = (scale: CompanySizeScale): readonly string[] =>
  scale === 'parc' ? PARC_COUNT_OPTIONS : COMPANY_SIZE_OPTIONS;

/**
 * The field label for a scale. Settings used to read « Taille de l'entreprise » for everyone,
 * including a fleet owner whose stored value is a parc count — the third half of the mismatch.
 */
export const companySizeLabel = (scale: CompanySizeScale): string =>
  scale === 'parc' ? "Nombre d'établissements de votre parc" : "Taille de l'entreprise";
