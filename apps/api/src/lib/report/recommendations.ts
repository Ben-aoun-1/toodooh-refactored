import { createHash } from 'node:crypto';

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';

import { env } from '../../env.js';
import { logger } from '../../logger.js';
import { hourOfSlot } from '../half-hour-slots.js';

import type { ProvenanceKind } from './affluence-provenance.js';
import { HEATMAP_SLOTS, type ReportData } from './assemble.js';

const log = logger.child({ module: 'report-recommendations' });

// R3 — Claude-powered body for the report's S07 Piste 02 ONLY: the model authors nothing but the
// « Repérez vos angles morts » paragraph (Pistes 01/03 are generated from data in pistes.ts).
// HARD FALLBACK CONTRACT unchanged from R2: this module
// NEVER throws into a report path — missing key, timeout, API error, refusal, schema-parse
// failure or cap violation ALL resolve to null, and Piste 02 keeps its « À venir » wait state.
// R3.1: an over-cap first draft earns ONE compress-retry turn before falling back, and every
// fallback path warns with a machine-greppable reason (refusal | parse_failure | over_cap).
// Logging carries the error message ONLY: never the key, never the prompt or response bodies.

const PisteBodySchema = z.object({
  body: z.string().describe('Un paragraphe de 30 mots maximum'),
});

// R3.1 — the model consistently overshoots a bare word budget (probe: haiku wrote 56–62 French
// words against « 40 mots maximum », so EVERY response died on the cap and prod PDFs showed the
// generic body). Ask LOW (30, in the prompt AND the schema description), ENFORCE at 40 words
// AND 210 chars, and give one compress-retry before falling back. The char guard is the RULED
// layout interlock: the S07 card fits 2 body lines (measured 2→3-line break between 225c and
// 253c; a 3rd line overflows page 4 by 16px), and words don't control wrapping — chars do.
const BODY_MAX_WORDS = 40;
const BODY_MAX_CHARS = 210;
const wordCount = (body: string): number => body.trim().split(/\s+/).length;
const withinCap = (body: string): boolean =>
  wordCount(body) <= BODY_MAX_WORDS && body.trim().length <= BODY_MAX_CHARS;

/**
 * The ONLY data that crosses the wire (data minimization, pinned by test): aggregates the report
 * already computed. No owner email/phone, no ids, nothing else.
 */
export interface RecommendationInput {
  commerce: string;
  categorie: string; // "catégorie · classe"
  periode: { du: string; au: string };
  audience: {
    globale: number | null;
    moyenneParJour: number | null;
    moyenneParHeure: number | null;
    pic: { valeur: number; date: string } | null;
  };
  /**
   * Busiest / quietest open slots from the heatmap, e.g. "Ven 18h" — the SAME ranking S02 colours,
   * so the two surfaces can never name different slots. MEJ-12: a slot whose value comes from the
   * admin's grid rather than the sensor is labelled "(estimation)", because the model otherwise
   * asserts it as a measurement.
   */
  creneaux: { plusForts: string[]; plusFaibles: string[] };
  campagnes: { nombre: number; revenuTotalTnd: string };
  demographie: {
    femmes: number;
    hommes: number;
    tranchesAge: { tranche: string; personnes: number }[];
  } | null;
}

const MODEL = 'claude-haiku-4-5';
const MAX_TOKENS = 1024;
const REQUEST_TIMEOUT_MS = 10_000;

/** Exported so MEJ-12's pin can assert the « (estimation) » instruction exists. */
export const SYSTEM_PROMPT = `Tu es le conseiller data d'un commerçant partenaire de TOODOOH, un réseau d'affichage publicitaire DOOH en Tunisie : des écrans installés dans son lieu diffusent des campagnes d'annonceurs, et le commerçant touche un revenu sur les impressions servies.

À partir des chiffres fournis en entrée — et UNIQUEMENT de ces chiffres — analyse les créneaux faibles et les périodes creuses du lieu, puis propose comment les redynamiser pour développer l'audience et les revenus publicitaires.

Règles strictes :
- Chaque affirmation chiffrée doit provenir des données fournies. N'invente aucune donnée, aucun événement, aucune tendance extérieure.
- Aucune promesse ni garantie de revenus : formule des pistes d'action, jamais des engagements de résultat.
- UN SEUL paragraphe de 30 mots maximum, sans titre.
- Rédige en français, en vouvoiement (« vous », « votre lieu »), dans le ton de conseil concret du rapport.
- Si une donnée est absente ou nulle, ne la mentionne pas.
- Chaque créneau nommé couvre 30 minutes (« 13h30 » = 13h30–14h00). Ne fusionne pas plusieurs créneaux en une plage horaire et ne cite jamais une heure absente des données fournies : le lieu est fermé en dehors des créneaux listés.
- Un créneau suivi de « (estimation) » n'a PAS été mesuré par le capteur : c'est la grille type saisie pour ce lieu. Tu peux le citer, mais dis alors qu'il est estimé — ne le présente jamais comme une fréquentation constatée.`;

// Lazy singleton — constructed on first use and ONLY when the key is provisioned (explicit
// apiKey from env.ts, never the SDK's ambient env resolution: the no-key path stays
// deterministic and testable).
let client: Anthropic | null = null;
const getClient = (): Anthropic | null => {
  if (!env.ANTHROPIC_API_KEY) return null;
  if (!client) {
    client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1 });
  }
  return client;
};

/** Whether the feature is on — the boot warning seam (mirrors isSyncEnabled). */
export const isRecommendationsEnabled = (): boolean => Boolean(env.ANTHROPIC_API_KEY);

// The compress-retry follow-up (R3.1): ONE extra turn when the first body busts the cap.
const COMPRESS_PROMPT = 'Réécris ce paragraphe en 30 mots maximum, sans rien ajouter.';

type ParseOutcome = { kind: 'ok'; body: string } | { kind: 'refusal' } | { kind: 'parse_failure' };

/** One messages.parse call → a classified outcome (the SAME options as R2/R3: 10s, 1 SDK retry). */
async function parseBody(
  anthropic: Anthropic,
  messages: Anthropic.MessageParam[],
): Promise<ParseOutcome> {
  const message = await anthropic.messages.parse(
    {
      model: MODEL,
      max_tokens: MAX_TOKENS,
      // PERF-QA2 belt-and-braces: greedy sampling so a cache MISS on unchanged inputs reproduces
      // as closely as the API allows. The real determinism guarantee is the digest cache below —
      // the model only ever runs on a miss. (temperature is still accepted on haiku-4-5; it is
      // rejected on the 4.6+ family, so a model bump must drop this line.)
      temperature: 0,
      system: SYSTEM_PROMPT,
      messages,
      output_config: { format: zodOutputFormat(PisteBodySchema) },
    },
    { timeout: REQUEST_TIMEOUT_MS, maxRetries: 1 },
  );
  // Refusal → fallback, never retried (the report must never surface a refusal).
  if (message.stop_reason === 'refusal') return { kind: 'refusal' };
  // parsed_output is null on parse failure; re-validate through the schema so a drifting SDK
  // (or a partial parse) can never hand the template a malformed body.
  const revalidated = PisteBodySchema.safeParse(message.parsed_output);
  if (!revalidated.success) return { kind: 'parse_failure' };
  return { kind: 'ok', body: revalidated.data.body };
}

// R3.1 observability — every fallback logs ONE warn with a machine-greppable reason. NEVER the
// body text, NEVER the input payload (data minimization holds in the logs too).
const FELL_BACK = 'AI recommendations fell back — Piste 02 keeps its « À venir » wait state';

/**
 * Generate the Piste 02 body for one report, or null for "keep the wait state". Uncached — the
 * month-end job and the regeneration script freeze the result into the stored PDF. An over-cap
 * first draft gets ONE compress-retry turn; anything else falls back immediately.
 */
export async function generateRecommendations(input: RecommendationInput): Promise<string | null> {
  const anthropic = getClient();
  if (!anthropic) return null;
  try {
    const ask: Anthropic.MessageParam[] = [{ role: 'user', content: JSON.stringify(input) }];
    const first = await parseBody(anthropic, ask);
    if (first.kind !== 'ok') {
      log.warn({ reason: first.kind }, FELL_BACK);
      return null;
    }
    if (withinCap(first.body)) return first.body;
    const second = await parseBody(anthropic, [
      ...ask,
      { role: 'assistant', content: first.body },
      { role: 'user', content: COMPRESS_PROMPT },
    ]);
    if (second.kind !== 'ok') {
      log.warn({ reason: second.kind }, FELL_BACK);
      return null;
    }
    if (withinCap(second.body)) return second.body;
    // both counts ride the warn so forensics can see WHICH guard fired (words vs chars)
    log.warn(
      { reason: 'over_cap', words: wordCount(second.body), chars: second.body.trim().length },
      FELL_BACK,
    );
    return null;
  } catch (err) {
    // Typed SDK errors first (status is the useful signal), then anything else — message ONLY.
    const reason =
      err instanceof Anthropic.APIError
        ? `api ${String(err.status ?? 'error')}: ${err.message}`
        : err instanceof Error
          ? err.message
          : String(err);
    log.warn({ reason }, 'AI recommendations failed — Piste 02 keeps its « À venir » wait state');
    return null;
  }
}

// PERF-QA2 — THE determinism seam. The cache used to key on `venueId|from|to`, and the frozen
// month-end path did not use it at all: the same venue could therefore carry TWO different Piste
// 02 bodies — the one frozen into the stored monthly PDF and the one the page regenerated later —
// because the model is resampled on every miss. Two windows that produce identical aggregates
// also diverged for no reason.
//
// The key is now `venueId|sha256(input)`: identical inputs yield an identical body for a venue no
// matter WHICH caller asks (page, on-demand PDF, month-end job, regeneration script) — the model
// only ever runs on a genuine miss. The digest stays venue-scoped on purpose: two venues with
// coincidentally identical aggregates never share a body.
//
// JSON.stringify over buildRecommendationInput's object literal is stable (V8 preserves insertion
// order, and every field is written positionally there) — the digest is a content hash, not a
// canonicalizer. Failures are NOT cached: the next request retries.
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 500;
interface CacheEntry {
  body: string;
  expiresAt: number;
}
const cache = new Map<string, CacheEntry>();

/** venue × input-digest — the key that makes two callers with the same inputs agree. */
export function recommendationCacheKey(venueId: string, input: RecommendationInput): string {
  return `${venueId}|${createHash('sha256').update(JSON.stringify(input)).digest('hex')}`;
}

export async function generateRecommendationsCached(
  venueId: string,
  input: RecommendationInput,
): Promise<string | null> {
  const key = recommendationCacheKey(venueId, input);
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.body;
  if (hit) cache.delete(key);

  const body = await generateRecommendations(input);
  if (body) {
    if (cache.size >= CACHE_MAX_ENTRIES) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(key, { body, expiresAt: Date.now() + CACHE_TTL_MS });
  }
  return body;
}

// ── report wiring — the ONE seam the job, the on-demand endpoint and the regeneration script
// call. The pistesFor* names predate R3 (they now yield the single Piste 02 body) and are kept
// so those call sites stay untouched. Gate: a venue with neither HOST nor CAST data keeps the
// generic body without an API call (all-null aggregates cannot ground anything).
// PERF-QA2: BOTH seams now go through the digest cache, so the body frozen into a stored PDF and
// the body the page shows for the same inputs are the SAME generation.

const DAY_LABELS_FR = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'] as const;
/**
 * PISTE-LBL1 (Mejri, 2026-09-02) — THE COLUMN → CLOCK LABEL, derived from the SAME array that
 * built the columns.
 *
 * It used to be `8 + columnIndex`, which was right while the grid was 14 hourly columns and became
 * nonsense the moment slice C made it 28 half-hour ones: column 15 printed « 23h » and column 25
 * printed « 33h », and the model turned the first into « vos créneaux nocturnes (23h-25h) » on a
 * café that closes at 21h. A bulk index conversion missed this one line.
 *
 * Indexing `HEATMAP_SLOTS` instead of re-deriving the arithmetic is the actual fix: there is now
 * ONE source for what column N means, and a future change to the window or the granularity moves
 * the labels with it instead of leaving them behind.
 */
const slotColumnLabel = (columnIndex: number): string | null => {
  const slot = HEATMAP_SLOTS[columnIndex];
  if (slot === undefined) return null; // a column the window does not have is not a créneau
  const hour = hourOfSlot(slot);
  return slot % 2 === 0 ? `${hour}h` : `${hour}h30`;
};

/**
 * Top/bottom OPEN slots from the 7×28 ramp levels (0 = closed/no-data, never a créneau).
 *
 * MEJ-12 (2026-09-01) — Piste 02 announced « Les lundis 13h-14h concentrent l'audience » while the
 * venue's real measured peak was lundi 20h-21h. The ranking was not wrong: `heatmapLevels` scores
 * by VALUE, and an admin had typed 1 396 into the hub grid at Monday 13h, so that cell legitimately
 * scored level 5 while the measured 20h cell scored 1 — S02 colours it exactly the same way. What
 * was wrong is that S02 DISCLOSES the cell as an estimation (dotted outline) and the payload did
 * not, so the model stated an admin's guess as observed footfall.
 *
 * The fix is disclosure, NOT exclusion: dropping backup cells would make the piste and S02 name
 * different slots, which is the defect this ticket is about. The ranking is untouched; the label
 * carries the provenance, and the system prompt tells the model what it means.
 */
const heatmapSlots = (
  levels: number[][],
  kinds: ProvenanceKind[][],
  values: number[][],
): { plusForts: string[]; plusFaibles: string[] } => {
  const open: { label: string; level: number; value: number }[] = [];
  levels.forEach((row, day) => {
    row.forEach((level, columnIndex) => {
      // level 0 is a CLOSED slot or one with no data, and it never becomes a créneau — which is
      // also why no label can name an hour outside [opening, closing): heatmapLevels zeroes those
      // columns before this ever sees them. Pinned, because Mejri's second sentence (« recommend
      // only within opening hours ») was this same bug read from the other side.
      if (level <= 0) return;
      const clock = slotColumnLabel(columnIndex);
      if (clock === null) return;
      const estimated = kinds[day]?.[columnIndex] !== 'measured';
      open.push({
        label: `${DAY_LABELS_FR[day] ?? '—'} ${clock}${estimated ? ' (estimation)' : ''}`,
        level,
        value: values[day]?.[columnIndex] ?? 0,
      });
    });
  });
  // Rank by VALUE, level as the tie-break. Sorting by level alone ranked on a coarse 1–5 bucket,
  // and Array.prototype.sort is STABLE, so cells sharing the top bucket kept insertion order —
  // day-major, ascending hour. The earliest hour to reach the bucket therefore displaced the real
  // maximum: on Mejri's two days, 16h/17h/18h took the three fort slots and the true 20h peak was
  // named nowhere. Ranking by value does not contradict S02: S02 colours by level, so tied cells
  // look identical there and naming the biggest of them is a refinement of the same lit-up cell.
  const byLevelDesc = [...open].sort((a, b) => b.value - a.value || b.level - a.level);
  // R3.1 — the two lists are DISJOINT: a slot never reads as both fort and faible (the old
  // slice(-3) reused fort cells below 6 open slots and the model echoed the contradiction).
  // Fewer/empty plusFaibles beats a contradiction when the grid is nearly empty.
  return {
    plusForts: byLevelDesc.slice(0, 3).map((s) => s.label),
    plusFaibles: byLevelDesc
      .slice(3)
      .slice(-3)
      .reverse()
      .map((s) => s.label),
  };
};

/** ReportData → the minimized wire payload. Pure; exported for the payload-pinning tests. */
export function buildRecommendationInput(data: ReportData): RecommendationInput {
  return {
    commerce: data.venueName,
    categorie: data.category,
    periode: { du: data.range.from, au: data.range.to },
    audience: data.hostHasData
      ? {
          globale: data.kpis.global,
          moyenneParJour: data.kpis.perDay,
          moyenneParHeure: data.kpis.perHour,
          pic: data.kpis.peak ? { valeur: data.kpis.peak.value, date: data.kpis.peak.date } : null,
        }
      : { globale: null, moyenneParJour: null, moyenneParHeure: null, pic: null },
    creneaux: heatmapSlots(data.heatLevels, data.heatKinds, data.heatValues),
    campagnes: {
      nombre: data.castHasData ? data.campaignsBlock.count : 0,
      revenuTotalTnd: data.castHasData ? data.revenue.totalLabel : '0',
    },
    demographie: data.breakdown
      ? {
          femmes: data.breakdown.femmes,
          hommes: data.breakdown.hommes,
          tranchesAge: data.breakdown.ages.map((band) => ({
            tranche: band.label,
            personnes: band.count,
          })),
        }
      : null,
  };
}

/** Frozen path (month-end job + regeneration script) — same digest cache as the page. */
export async function pistesForReport(venueId: string, data: ReportData): Promise<string | null> {
  return pistesForReportCached(venueId, data);
}

/** On-demand path (GET /:id/report, GET /:id/pistes): cache-wrapped per venue × input digest. */
export async function pistesForReportCached(
  venueId: string,
  data: ReportData,
): Promise<string | null> {
  try {
    if (!data.hostHasData && !data.castHasData) {
      log.debug('recommendations skipped — venue has neither HOST nor CAST data');
      return null;
    }
    return await generateRecommendationsCached(venueId, buildRecommendationInput(data));
  } catch {
    return null; // the module contract, restated at the seam: NEVER throw into a report path
  }
}

/** Test hook — drops the lazy client and the cache (mirrors closeReportBrowser). */
export function resetRecommendationsForTests(): void {
  client = null;
  cache.clear();
}
