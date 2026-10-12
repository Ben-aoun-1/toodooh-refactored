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
 * cannot drift. PISTES-V2: the S07 cards grow (S07 moved to page 5), so the old 2-line interlock
 * of page 4 is retired.
 */

export interface PisteView {
  num: '01' | '02' | '03';
  title: string;
  body: string;
  /** true → the italic wait-state styling (page + PDF). */
  pending: boolean;
}

// ── titles (survive the R3 → 13-juil supersession) ────────────────────────────────────────────
export const PISTE_01_TITLE = 'Anticipez les temps forts';
export const PISTE_02_TITLE = 'Repérez vos angles morts';
export const PISTE_03_TITLE = 'Résumé du SPS et recommandations';

// ── Piste 01 — les matchs à venir ─────────────────────────────────────────────────────────────
// Operator 2026-10-12 (supersedes Mejri's 13-juil « pas nécessaire de les mentionner en détails »
// and the 2026-08-20 words-only window): the card NAMES the upcoming matches with their day and
// kickoff time, so the owner can announce them. Only CONFIRMED official matches (date AND time
// fixed, not cancelled — the EVT-PLAY1 definition) in the 14-day window, nearest first, at most
// PISTE_01_MAX_MATCHES. Events are `type = 'sport'` by DB check constraint, hence « match ».
export const PISTE_01_NO_EVENTS_BODY =
  "Aucun temps fort n'est programmé pour l'instant. Dès qu'un match important sera à l'affiche, annoncez sa diffusion à vos clients pour remplir votre lieu ce jour-là.";

/** The card names at most this many matches (the nearest ones). */
export const PISTE_01_MAX_MATCHES = 3;

export interface UpcomingMatch {
  name: string;
  /** Tunis calendar day of the kickoff, YYYY-MM-DD. */
  day: string;
  /** Tunis kickoff time, HH:MM. */
  time: string;
}

export interface UpcomingEvents {
  /** Confirmed official matches in the window, nearest first. Always ≥ 1 entry. */
  matches: UpcomingMatch[];
}

const WEEKDAYS_FR = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'] as const;

/** « mar. 20/10 à 20h » / « sam. 24/10 à 18h30 » — the kickoff as the owner reads it. */
export const formatKickoffFr = (day: string, time: string): string => {
  const [y, m, d] = day.split('-').map(Number);
  const weekday = WEEKDAYS_FR[new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1)).getUTCDay()] ?? '';
  const [hh = '00', mm = '00'] = time.split(':');
  const clock = mm === '00' ? `${Number(hh)}h` : `${Number(hh)}h${mm}`;
  return `${weekday} ${day.slice(8, 10)}/${day.slice(5, 7)} à ${clock}`;
};

const piste01Body = (events: UpcomingEvents | null): string => {
  const matches = (events?.matches ?? []).slice(0, PISTE_01_MAX_MATCHES);
  if (matches.length === 0) return PISTE_01_NO_EVENTS_BODY;
  const listed = matches.map((m) => `${m.name}, ${formatKickoffFr(m.day, m.time)}`).join(' · ');
  return matches.length === 1
    ? `À l'affiche : ${listed}. Annoncez sa diffusion à vos clients dès maintenant pour remplir votre lieu ce jour-là.`
    : `À l'affiche : ${listed}. Annoncez leur diffusion à vos clients dès maintenant pour remplir votre lieu ces jours-là.`;
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
