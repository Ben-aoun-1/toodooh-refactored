/**
 * PERF-QA2 — THE pistes generator (S07), one home for the page and the PDF.
 *
 * SUPERSESSION (opérateur + architecte, 2026-08-20): R3's « 3 thèmes FIXES, corps 01/03
 * statiques, langage du mockup » is retired in favour of Mejri's « Retour rapport » spec of
 * 13-juil. Piste 01 becomes an EVENT teaser, Piste 03 becomes a real SPS analysis, and only
 * Piste 02 stays AI-authored — falling back to « À venir » rather than generic prose (US-P.10,
 * amendment 2026-08-20). The titles survive both rulings.
 *
 * Everything here is PURE: the DB reads live in assemble.ts, so both surfaces
 * (GET /:id/pistes and the rendered PDF) build their three cards from the SAME function and
 * cannot drift. Bodies are capped at BODY_MAX_CHARS — the S07 card fits 2 lines and a 3rd
 * overflows page 4 (the R3.1 layout interlock, re-pinned here for the generated bodies).
 */

export interface PisteView {
  num: '01' | '02' | '03';
  title: string;
  body: string;
  /** true → the italic wait-state styling (page + PDF). */
  pending: boolean;
}

/** The layout interlock: a body over this wraps to a 3rd line and overflows page 4. */
export const BODY_MAX_CHARS = 225;

// ── titles (survive the R3 → 13-juil supersession) ────────────────────────────────────────────
export const PISTE_01_TITLE = 'Anticipez les temps forts';
export const PISTE_02_TITLE = 'Repérez vos angles morts';
export const PISTE_03_TITLE = 'Résumé du SPS et recommandations';

// ── Piste 01 — l'aguiche événementielle ───────────────────────────────────────────────────────
// Her spec verbatim: « pas nécessaire de les mentionner en détails, juste par exemple cette
// semaine on a des matchs importants ». So: NO name, NO date, NO count — only the fact that
// something is coming, and what to do about it. The window (14 days) is expressed in words
// (« cette semaine » / « ces prochains jours »), never as a number (ruling 2026-08-20).
// Events are `type = 'sport'` by DB check constraint, hence « match ».
export const PISTE_01_NO_EVENTS_BODY =
  "Aucun temps fort n'est programmé pour l'instant. Dès qu'un match important sera à l'affiche, annoncez sa diffusion à vos clients pour remplir votre lieu ce jour-là.";

/** Days from the anchor day at/under which the teaser says « cette semaine ». */
export const THIS_WEEK_DAYS = 7;

export interface UpcomingEvents {
  /** Official, non-cancelled events whose kickoff falls inside the window. Always ≥ 1. */
  count: number;
  /** Whole Tunis days from the anchor day to the soonest kickoff (0 = today). */
  soonestInDays: number;
}

const piste01Body = (events: UpcomingEvents | null): string => {
  if (!events || events.count <= 0) return PISTE_01_NO_EVENTS_BODY;
  const when = events.soonestInDays <= THIS_WEEK_DAYS ? 'cette semaine' : 'ces prochains jours';
  return events.count === 1
    ? `Un match important est à l'affiche ${when} — annoncez sa diffusion à vos clients dès maintenant pour remplir votre lieu ce jour-là.`
    : `Plusieurs matchs importants sont à l'affiche ${when} — annoncez leur diffusion à vos clients dès maintenant pour remplir votre lieu ces jours-là.`;
};

// ── Piste 02 — l'angle mort (AI-authored) ─────────────────────────────────────────────────────
// US-P.10 (amendment 2026-08-20): when the analysis has not been produced, the card says « À
// venir » — an explicit wait state, in the same register as Piste 03's. The R3.1 generic
// paragraph is RETIRED: prose that applies to any venue reads as advice while saying nothing, and
// the spec asks for generated content or an honest wait. Pistes 01 and 03 are unaffected — they
// are computed from the real event catalogue and the real SPS, which IS the « génération
// automatique » the spec describes.
export const PISTE_02_WAIT_BODY = 'À venir';

// ── Piste 03 — l'analyse SPS ──────────────────────────────────────────────────────────────────
// SPS went LIVE 30/07 (40/30/20/10, weights admin-editable). A scored venue reads its score, the
// variable that costs it the most points, and the ONE lever that moves that variable. A scoreless
// venue keeps the EXACT wait copy — the string is ruled, do not reword.
export const PISTE_03_WAIT_BODY = 'En attente de votre score de priorité.';

export type SpsKey = 'acceptation' | 'respect_evenements' | 'activite' | 'remplissage';

export interface SpsCriterion {
  key: SpsKey;
  label: string;
  weight: number;
  value: number;
}

export interface SpsBlock {
  score: number;
  criteria: SpsCriterion[];
}

/** ONE lever per variable — the concrete action that raises THAT variable, nothing generic. */
const SPS_LEVERS: Record<SpsKey, string> = {
  acceptation: 'Acceptez davantage de campagnes proposées : chaque refus pèse sur votre priorité.',
  respect_evenements:
    'Diffusez les événements que vous acceptez : une diffusion non constatée fait chuter cette variable.',
  activite:
    "Gardez votre écran allumé sur vos heures d'ouverture : un créneau sans diffusion prouvée compte comme manqué.",
  remplissage:
    "Ouvrez davantage de créneaux : élargissez vos heures d'ouverture ou réduisez vos jours indisponibles.",
};

/** fr-FR score style, mirroring the S08 card: integer, or ONE comma decimal. */
const fmtScore = (n: number): string =>
  Number.isInteger(n) ? String(n) : (Math.round(n * 10) / 10).toFixed(1).replace('.', ',');

/**
 * The WEAKEST WEIGHTED variable = the one costing the most points, weight × (100 − value) / 100.
 * Not the lowest raw value: a 0/100 on a 3 %-weighted variable matters less than a 60/100 on a
 * 40 %-weighted one, and the owner's effort should go where the score actually moves. Ties break
 * on the ruled criteria order (the array order assemble.ts and the /sps read both use).
 */
export function weakestCriterion(criteria: SpsCriterion[]): SpsCriterion | null {
  let worst: SpsCriterion | null = null;
  let worstLoss = -1;
  for (const c of criteria) {
    const loss = (c.weight * (100 - c.value)) / 100;
    if (loss > worstLoss) {
      worst = c;
      worstLoss = loss;
    }
  }
  return worst;
}

const piste03 = (sps: SpsBlock | null): { body: string; pending: boolean } => {
  const weakest = sps ? weakestCriterion(sps.criteria) : null;
  if (!sps || !weakest) return { body: PISTE_03_WAIT_BODY, pending: true };
  return {
    body: `Votre score de priorité est de ${fmtScore(sps.score)}/100. Point faible : ${weakest.label} (${fmtScore(weakest.value)}/100, poids ${fmtScore(weakest.weight)} %). ${SPS_LEVERS[weakest.key]}`,
    pending: false,
  };
};

export interface PistesInput {
  /** Upcoming OFFICIAL events in the window; null when there are none. */
  events: UpcomingEvents | null;
  /** The venue's live SPS breakdown; null while it has no computable score. */
  sps: SpsBlock | null;
  /** The cached AI body for Piste 02; null/blank → the « À venir » wait state (US-P.10). */
  aiBody: string | null;
}

/**
 * The three S07 cards. The ONE generator: the owner page's /pistes read and the PDF template
 * both call this, so screen and document can never disagree on a body again.
 */
export function buildPistes(input: PistesInput): [PisteView, PisteView, PisteView] {
  const ai = typeof input.aiBody === 'string' && input.aiBody.trim() !== '' ? input.aiBody : null;
  const p3 = piste03(input.sps);
  return [
    { num: '01', title: PISTE_01_TITLE, body: piste01Body(input.events), pending: false },
    {
      num: '02',
      title: PISTE_02_TITLE,
      body: ai ?? PISTE_02_WAIT_BODY,
      // No analysis yet → the italic wait treatment, exactly like an unscored SPS.
      pending: ai === null,
    },
    { num: '03', title: PISTE_03_TITLE, body: p3.body, pending: p3.pending },
  ];
}
