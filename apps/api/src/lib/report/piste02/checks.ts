import type { Piste02Input } from './input.js';
import { type FamilleLevier, isFamilleLevier } from './referentiel.js';

/**
 * PISTES-V2 — the backend post-checks of the Piste 02 spec (docs/specs/piste-02-angles-morts.md
 * §9), applied to every generation before it can be stored or shown. PURE. A failing generation
 * is retried with the failures named; after the last attempt the fixed « insuffisant » text is
 * stored instead (§9: « Deux échecs consécutifs déclenchent le texte de repli »).
 */

export interface Piste02Output {
  statut: 'genere' | 'degrade' | 'insuffisant';
  titre: string;
  corps: string;
  famille_levier: string;
  creneaux_cites: string[];
  hypothese_formulee: string;
  confiance: 'haute' | 'moyenne' | 'faible';
}

/** §9.2 — the body length window (wider than the prompt's 45–70 on purpose). */
export const MIN_WORDS = 40;
export const MAX_WORDS = 80;

/** §9.3 — the blacklist, matched at word start so plurals and « écrans » are caught too. */
export const BLACKLIST = [
  'cpm',
  'remplissage',
  'dispatching',
  'algorithme',
  'score',
  'campagne',
  'écran',
  'diffusion',
  'régie',
  'impression',
] as const;

export const wordCount = (text: string): number =>
  text.trim() === '' ? 0 : text.trim().split(/\s+/).length;

/** Every number written in a text: « 38 », « 6,5 », « 15h30 » → 15 and 30. */
const numbersIn = (text: string): number[] =>
  [...text.matchAll(/\d+(?:[.,]\d+)?/g)].map((m) => Number(m[0].replace(',', '.')));

/** The rounding tolerance of §9.6: a cited figure may round the input's value to the unit. */
const ROUNDING = 0.5;

export interface CheckContext {
  input: Piste02Input;
  /** The uptime degraded mode: no exact hour may appear in the body (spec §8). */
  noPreciseHour: boolean;
}

/** All §9 checks; [] = the generation may be stored. Each entry is a short French reason. */
export function checkPiste02(out: Piste02Output, ctx: CheckContext): string[] {
  const failures: string[] = [];
  const corps = out.corps.trim();

  // §9.1 — required fields present (the JSON shape itself is enforced by structured outputs).
  if (corps === '' || out.titre.trim() === '' || out.hypothese_formulee.trim() === '') {
    failures.push('champs obligatoires vides (titre, corps ou hypothese_formulee)');
  }
  if (!isFamilleLevier(out.famille_levier)) {
    failures.push(`famille_levier « ${out.famille_levier} » hors référentiel (A à H)`);
  }

  // §9.2 — length.
  const words = wordCount(corps);
  if (words < MIN_WORDS || words > MAX_WORDS) {
    failures.push(`le corps compte ${words} mots (attendu entre 45 et 70)`);
  }

  // §9.3 — blacklist.
  const lower = corps.toLowerCase();
  for (const term of BLACKLIST) {
    if (new RegExp(`(^|[^\\p{L}])${term}`, 'u').test(lower)) {
      failures.push(`terme interdit « ${term} »`);
    }
  }

  // §9.4 — form.
  if (corps.includes('—')) failures.push('tiret cadratin');
  if (corps.includes('!')) failures.push("point d'exclamation");
  if (/\p{Extended_Pictographic}/u.test(corps)) failures.push('émoji');
  if (/(^|\n)\s*([-•*]|\d+[.)])\s/.test(corps)) failures.push('liste à puces');

  // §9.5 — lever rotation.
  const used = ctx.input.historique_recommandations.familles_leviers_utilisees_3_derniers_mois;
  if (isFamilleLevier(out.famille_levier) && used.includes(out.famille_levier as FamilleLevier)) {
    failures.push(`famille ${out.famille_levier} déjà utilisée ces trois derniers mois`);
  }

  // §9.6 — every number of the body comes from the input, to the rounding.
  const known = numbersIn(JSON.stringify(ctx.input));
  for (const n of numbersIn(corps)) {
    if (!known.some((k) => Math.abs(k - n) <= ROUNDING)) {
      failures.push(`le nombre ${n} ne figure pas dans les données`);
    }
  }

  // §9.7 — no repeated title.
  const previous = ctx.input.historique_recommandations.titres_precedents.map((t) =>
    t.trim().toLowerCase(),
  );
  if (previous.includes(out.titre.trim().toLowerCase())) failures.push('titre déjà utilisé');

  // §8 — the uptime degraded mode cites no exact hour (« 15h », « 9 h 30 »).
  if (ctx.noPreciseHour && /\d{1,2}\s?h(\s?\d{2})?\b/.test(corps)) {
    failures.push('créneau horaire précis cité alors que le mode degrade l’interdit');
  }

  return failures;
}
