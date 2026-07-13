import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';

import { env } from '../../env.js';
import { logger } from '../../logger.js';

import type { ReportData } from './assemble.js';
import type { DateRange } from './derive.js';

const log = logger.child({ module: 'report-recommendations' });

// R3 — Claude-powered body for the report's S07 Piste 02 ONLY. S07 is a FIXED 3-theme structure
// (titles pinned in the template; Pistes 01/03 fully static) — the model authors nothing but the
// « Repérez vos angles morts » paragraph. HARD FALLBACK CONTRACT unchanged from R2: this module
// NEVER throws into a report path — missing key, timeout, API error, refusal, schema-parse
// failure or cap violation ALL resolve to null, and the template keeps the generic Piste 02 body.
// Logging carries the error message ONLY: never the key, never the prompt or response bodies.

const PisteBodySchema = z.object({
  body: z.string(),
});

/** Post-parse cap (the schema pins shape; size is checked here): body ≤40 words. */
const BODY_MAX_WORDS = 40;
const withinCap = (body: string): boolean => body.trim().split(/\s+/).length <= BODY_MAX_WORDS;

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
  /** Busiest / quietest open slots from the heatmap, e.g. "Ven 18h". */
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

const SYSTEM_PROMPT = `Tu es le conseiller data d'un commerçant partenaire de TOODOOH, un réseau d'affichage publicitaire DOOH en Tunisie : des écrans installés dans son lieu diffusent des campagnes d'annonceurs, et le commerçant touche un revenu sur les impressions servies.

À partir des chiffres fournis en entrée — et UNIQUEMENT de ces chiffres — analyse les créneaux faibles et les périodes creuses du lieu, puis propose comment les redynamiser pour développer l'audience et les revenus publicitaires.

Règles strictes :
- Chaque affirmation chiffrée doit provenir des données fournies. N'invente aucune donnée, aucun événement, aucune tendance extérieure.
- Aucune promesse ni garantie de revenus : formule des pistes d'action, jamais des engagements de résultat.
- UN SEUL paragraphe de 40 mots maximum, sans titre.
- Rédige en français, en vouvoiement (« vous », « votre lieu »), dans le ton de conseil concret du rapport.
- Si une donnée est absente ou nulle, ne la mentionne pas.`;

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

/**
 * Generate the Piste 02 body for one report, or null for "keep the generic body". Uncached — the
 * month-end job and the regeneration script freeze the result into the stored PDF.
 */
export async function generateRecommendations(input: RecommendationInput): Promise<string | null> {
  const anthropic = getClient();
  if (!anthropic) return null;
  try {
    const message = await anthropic.messages.parse(
      {
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: JSON.stringify(input) }],
        output_config: { format: zodOutputFormat(PisteBodySchema) },
      },
      { timeout: REQUEST_TIMEOUT_MS, maxRetries: 1 },
    );
    // Refusal → silent fallback, no retry (the report must never surface a refusal).
    if (message.stop_reason === 'refusal') return null;
    // parsed_output is null on parse failure; re-validate through the schema so a drifting SDK
    // (or a partial parse) can never hand the template a malformed body.
    const revalidated = PisteBodySchema.safeParse(message.parsed_output);
    if (!revalidated.success) return null;
    const body = revalidated.data.body;
    if (!withinCap(body)) return null;
    return body;
  } catch (err) {
    // Typed SDK errors first (status is the useful signal), then anything else — message ONLY.
    const reason =
      err instanceof Anthropic.APIError
        ? `api ${String(err.status ?? 'error')}: ${err.message}`
        : err instanceof Error
          ? err.message
          : String(err);
    log.warn({ reason }, 'AI recommendations failed — reports keep the generic Piste 02 body');
    return null;
  }
}

// In-memory cache for the ON-DEMAND path only (per venue × period, 24h TTL, ~500 entries with
// oldest-first eviction — Map preserves insertion order). Failures are NOT cached: the next
// request retries.
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 500;
interface CacheEntry {
  body: string;
  expiresAt: number;
}
const cache = new Map<string, CacheEntry>();

export async function generateRecommendationsCached(
  venueId: string,
  range: DateRange,
  input: RecommendationInput,
): Promise<string | null> {
  const key = `${venueId}|${range.from}|${range.to}`;
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

const DAY_LABELS_FR = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'] as const;
const FIRST_HEATMAP_HOUR = 8; // the grid's 14 columns span 8h–21h (the page's visible hours)

/** Top/bottom OPEN slots from the 7×14 ramp levels (0 = closed/no-data, never a créneau). */
const heatmapSlots = (levels: number[][]): { plusForts: string[]; plusFaibles: string[] } => {
  const open: { label: string; level: number }[] = [];
  levels.forEach((row, day) => {
    row.forEach((level, hourIdx) => {
      if (level > 0) {
        open.push({
          label: `${DAY_LABELS_FR[day] ?? '—'} ${FIRST_HEATMAP_HOUR + hourIdx}h`,
          level,
        });
      }
    });
  });
  const byLevelDesc = [...open].sort((a, b) => b.level - a.level);
  return {
    plusForts: byLevelDesc.slice(0, 3).map((s) => s.label),
    plusFaibles: byLevelDesc
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
    creneaux: heatmapSlots(data.heatLevels),
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

/** Frozen path (month-end job + regeneration script): one uncached generation per stored PDF. */
export async function pistesForReport(data: ReportData): Promise<string | null> {
  try {
    if (!data.hostHasData && !data.castHasData) return null;
    return await generateRecommendations(buildRecommendationInput(data));
  } catch {
    return null; // the module contract, restated at the seam: NEVER throw into a report path
  }
}

/** On-demand path (GET /:id/report): cache-wrapped per venue × period. */
export async function pistesForReportCached(
  venueId: string,
  data: ReportData,
): Promise<string | null> {
  try {
    if (!data.hostHasData && !data.castHasData) return null;
    return await generateRecommendationsCached(venueId, data.range, buildRecommendationInput(data));
  } catch {
    return null;
  }
}

/** Test hook — drops the lazy client and the cache (mirrors closeReportBrowser). */
export function resetRecommendationsForTests(): void {
  client = null;
  cache.clear();
}
