/**
 * PERF-R1 (operator 2026-08-30) — the S01 copy, in a pure pinnable home (apps/web has no render
 * harness; a literal living in a component is unpinnable). BYTE-IDENTICAL twins of the api's
 * template.ts constants — each side pins the exact literal in its own test. Do not reword one
 * without the other.
 */

/** The S01 lead: the merged rule stated up front — mesure first, estimation as the backup. */
export const AUDIENCE_KPIS_LEAD =
  "Indicateurs de densité d'audience dans votre lieu sur la période analysée — mesure du capteur en priorité, estimation en secours — croisés avec vos heures d'ouverture.";

/**
 * US-P.0 heritage, PERF-R1 condition — shown ONLY when NEITHER a reading NOR a backup cell fed
 * the période (measuredDays 0 AND estimatedPct null): the audience sensor and the proof of play
 * are two independent sensors, and each counter states its source.
 */
export const NO_MEASURE_NOTE =
  "Aucune mesure du capteur d'audience sur la période — les impressions proviennent de la preuve de diffusion, une source indépendante.";

/**
 * FLOW-1 (Mejri, ruled 2026-09-04) — the « Audience moyenne / heure » description, in HER terms:
 * moyenne/heure = Pers_atteintes ÷ heures d'ouverture réelles, and Pers_atteintes is « le nombre de
 * personnes détectées par le capteur sur la période ». « Densité moyenne d'audience » described a
 * LEVEL held over time, which is the reading this lane removed.
 *
 * No trailing period: the page appends « (estimation 14 h). » when the opening hours are inferred.
 * This sentence lived INLINE in both packages until now — twins by convention, agreeing only by
 * coincidence, with nothing to catch a one-sided reword. It is pinned on both sides from here.
 */
export const PER_HOUR_DESC = "Personnes détectées par heure d'ouverture, en moyenne";
