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
 * FLOW-4 (operator, ruled 2026-09-17) — the « Audience moyenne / heure » description.
 *
 * « everything works by the hour; only the readings come each 30 min. » A day ADDS ITS HOUR
 * VALUES, and an hour is the mean of the half-hours it HAS, so moyenne/heure = Pers_atteintes ÷
 * heures d'ouverture — no × 2 any more. It supersedes FLOW-1 (« a day is the plain SUM of its
 * cells », Mejri 04/09) and the HOUR-AVG1 wording that followed from it: dividing by the
 * half-hours was a correction for a day that summed half-hour readings, and the day no longer
 * does. « des deux demi-heures » became « de ses demi-heures » for HOUR-AVG2 in the same move —
 * an hour has the halves it has, and a lone one IS the hour.
 *
 * No trailing period: the page appends « (estimation 14 h). » when the opening hours are inferred.
 * BYTE-IDENTICAL twin — the api's template.ts carries the same literal, each side pinned by its
 * own exact-literal test. Do not reword one without the other.
 */
export const PER_HOUR_DESC =
  "Personnes détectées par heure d'ouverture, moyenne de ses demi-heures";
