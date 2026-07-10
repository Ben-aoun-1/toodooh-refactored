import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';

import { env } from '../../env.js';
import { logger } from '../../logger.js';

import type { DateRange } from './derive.js';

const log = logger.child({ module: 'report-recommendations' });

// R2 — Claude-powered pistes for the report's S07. HARD FALLBACK CONTRACT: this module NEVER
// throws into a report path — missing key, timeout, API error, refusal, schema-parse failure or
// cap violation ALL resolve to null, and the template keeps its generic pistes. Logging carries
// the error message ONLY: never the key, never the prompt or response bodies.

/** One S07 recommendation card, as the template renders it. */
export interface Piste {
  title: string;
  body: string;
}

const PistesSchema = z.object({
  pistes: z.array(z.object({ title: z.string(), body: z.string() })).length(3),
});

/** Post-parse caps (the schema pins shape; sizes are checked here): title ≤60 chars, body ≤40 words. */
const TITLE_MAX_CHARS = 60;
const BODY_MAX_WORDS = 40;
const withinCaps = (piste: Piste): boolean =>
  piste.title.length <= TITLE_MAX_CHARS && piste.body.trim().split(/\s+/).length <= BODY_MAX_WORDS;

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

À partir des chiffres fournis en entrée — et UNIQUEMENT de ces chiffres — propose exactement 3 pistes concrètes pour développer l'audience de son lieu et ses revenus publicitaires.

Règles strictes :
- Chaque affirmation chiffrée doit provenir des données fournies. N'invente aucune donnée, aucun événement, aucune tendance extérieure.
- Aucune promesse ni garantie de revenus : formule des pistes d'action, jamais des engagements de résultat.
- Exactement 3 pistes : un titre court (60 caractères maximum) et un corps de 40 mots maximum.
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
 * Generate the 3 pistes for one report, or null for "keep the generic pistes". Uncached — the
 * month-end job and the regeneration script freeze the result into the stored PDF.
 */
export async function generateRecommendations(input: RecommendationInput): Promise<Piste[] | null> {
  const anthropic = getClient();
  if (!anthropic) return null;
  try {
    const message = await anthropic.messages.parse(
      {
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: JSON.stringify(input) }],
        output_config: { format: zodOutputFormat(PistesSchema) },
      },
      { timeout: REQUEST_TIMEOUT_MS, maxRetries: 1 },
    );
    // Refusal → silent fallback, no retry (the report must never surface a refusal).
    if (message.stop_reason === 'refusal') return null;
    // parsed_output is null on parse failure; re-validate through the schema so a drifting SDK
    // (or a partial parse) can never hand the template a malformed pistes block.
    const revalidated = PistesSchema.safeParse(message.parsed_output);
    if (!revalidated.success) return null;
    const pistes = revalidated.data.pistes;
    if (!pistes.every(withinCaps)) return null;
    return pistes;
  } catch (err) {
    // Typed SDK errors first (status is the useful signal), then anything else — message ONLY.
    const reason =
      err instanceof Anthropic.APIError
        ? `api ${String(err.status ?? 'error')}: ${err.message}`
        : err instanceof Error
          ? err.message
          : String(err);
    log.warn({ reason }, 'AI recommendations failed — reports keep the generic pistes');
    return null;
  }
}

// In-memory cache for the ON-DEMAND path only (per venue × period, 24h TTL, ~500 entries with
// oldest-first eviction — Map preserves insertion order). Failures are NOT cached: the next
// request retries.
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 500;
interface CacheEntry {
  pistes: Piste[];
  expiresAt: number;
}
const cache = new Map<string, CacheEntry>();

export async function generateRecommendationsCached(
  venueId: string,
  range: DateRange,
  input: RecommendationInput,
): Promise<Piste[] | null> {
  const key = `${venueId}|${range.from}|${range.to}`;
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.pistes;
  if (hit) cache.delete(key);

  const pistes = await generateRecommendations(input);
  if (pistes) {
    if (cache.size >= CACHE_MAX_ENTRIES) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(key, { pistes, expiresAt: Date.now() + CACHE_TTL_MS });
  }
  return pistes;
}

/** Test hook — drops the lazy client and the cache (mirrors closeReportBrowser). */
export function resetRecommendationsForTests(): void {
  client = null;
  cache.clear();
}
