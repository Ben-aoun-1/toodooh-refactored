import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';

import { env } from '../../../env.js';
import { logger } from '../../../logger.js';

import { type Piste02Output, checkPiste02 } from './checks.js';
import { INSUFFICIENT_BODY, type Piste02Plan } from './input.js';
import { PISTE_02_SYSTEM_PROMPT, piste02UserMessage } from './prompt.js';
import { referentielBlock } from './referentiel.js';

const log = logger.child({ module: 'piste02-generate' });

/**
 * PISTES-V2 — one Piste 02 generation (docs/specs/piste-02-angles-morts.md §3–§9).
 *
 * Model: claude-sonnet-5-5 (the spec's « Claude Sonnet »). The spec's `temperature: 0.8` is NOT
 * sent — Sonnet 5.5 rejects non-default sampling with a 400; the month-to-month variability comes
 * from the history rotation the input carries. Adaptive thinking is the model's default and is
 * left on; effort `medium` (a short, method-driven paragraph). max_tokens covers the thinking.
 *
 * Up to MAX_ATTEMPTS calls (1 + 2 retries, spec §5). Each retry is a FRESH single-turn request
 * naming the failed checks (no replayed assistant turn: thinking blocks are bound to their
 * conversation, and a stripped replay is a history edit). After the last failure the fixed
 * « insuffisant » text is the result (§9). An API failure or a missing key returns null: nothing
 * is stored and the next run retries — a transient outage never freezes the fallback text.
 */
export const PISTE_02_MODEL = 'claude-sonnet-5-5';
const MAX_ATTEMPTS = 3;
const MAX_TOKENS = 16_000;
const REQUEST_TIMEOUT_MS = 120_000;

const OutputSchema = z.object({
  statut: z.enum(['genere', 'degrade', 'insuffisant']),
  titre: z.string(),
  corps: z.string(),
  famille_levier: z.string(),
  creneaux_cites: z.array(z.string()),
  hypothese_formulee: z.string(),
  confiance: z.enum(['haute', 'moyenne', 'faible']),
});

export interface Piste02Result {
  statut: 'genere' | 'degrade' | 'insuffisant';
  titre: string | null;
  corps: string;
  familleLevier: string | null;
  creneauxCites: string[];
  hypotheseFormulee: string | null;
  confiance: 'haute' | 'moyenne' | 'faible' | null;
  model: string | null;
}

/** The stored « insuffisant » row (spec §8 no-call mode, and the §9 fallback). */
export const insufficientResult = (): Piste02Result => ({
  statut: 'insuffisant',
  titre: null,
  corps: INSUFFICIENT_BODY,
  familleLevier: null,
  creneauxCites: [],
  hypotheseFormulee: null,
  confiance: null,
  model: null,
});

let client: Anthropic | null = null;
const getClient = (): Anthropic | null => {
  if (!env.ANTHROPIC_API_KEY) return null;
  if (!client) client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1 });
  return client;
};

/** Whether the feature is on — the boot warning seam. */
export const isPiste02Enabled = (): boolean => Boolean(env.ANTHROPIC_API_KEY);

type Attempt =
  | { kind: 'ok'; output: Piste02Output }
  | { kind: 'refusal' }
  | { kind: 'parse_failure' };

async function callOnce(anthropic: Anthropic, userMessage: string): Promise<Attempt> {
  const message = await anthropic.messages.parse(
    {
      model: PISTE_02_MODEL,
      max_tokens: MAX_TOKENS,
      system: PISTE_02_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
      output_config: { effort: 'medium', format: zodOutputFormat(OutputSchema) },
    },
    { timeout: REQUEST_TIMEOUT_MS, maxRetries: 1 },
  );
  if (message.stop_reason === 'refusal') return { kind: 'refusal' };
  const parsed = OutputSchema.safeParse(message.parsed_output);
  return parsed.success ? { kind: 'ok', output: parsed.data } : { kind: 'parse_failure' };
}

/**
 * Generate the month's Piste 02 for a plan. 'insufficient' resolves without a call; 'skip' never
 * reaches here. null = no result to store (no key, or the API failed).
 */
export async function generatePiste02(
  plan: Extract<Piste02Plan, { kind: 'generate' | 'insufficient' }>,
): Promise<Piste02Result | null> {
  if (plan.kind === 'insufficient') return insufficientResult();
  const anthropic = getClient();
  if (!anthropic) return null;
  const base = {
    inputJson: JSON.stringify(plan.input, null, 2),
    categorie: plan.input.etablissement.categorie,
    referentiel: referentielBlock(plan.input.etablissement.categorie),
    consignes: plan.consignes,
  };
  let failures: string[] = [];
  try {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const outcome = await callOnce(
        anthropic,
        piste02UserMessage({ ...base, previousFailures: failures }),
      );
      if (outcome.kind !== 'ok') {
        failures = [outcome.kind === 'refusal' ? 'réponse refusée' : 'JSON invalide'];
        log.warn({ attempt, reason: outcome.kind }, 'piste 02 attempt rejected');
        continue;
      }
      failures = checkPiste02(outcome.output, {
        input: plan.input,
        noPreciseHour: plan.noPreciseHour,
      });
      if (failures.length === 0) {
        const out = outcome.output;
        return {
          statut: plan.statut,
          titre: out.titre.trim(),
          corps: out.corps.trim(),
          familleLevier: out.famille_levier,
          creneauxCites: out.creneaux_cites,
          hypotheseFormulee: out.hypothese_formulee.trim(),
          confiance: out.confiance,
          model: PISTE_02_MODEL,
        };
      }
      // The reasons only — never the body or the input (data minimization holds in the logs).
      log.warn({ attempt, failures }, 'piste 02 attempt failed the post-checks');
    }
    log.warn('piste 02 failed every attempt — the « insuffisant » text is stored instead');
    return insufficientResult();
  } catch (err) {
    const reason =
      err instanceof Anthropic.APIError
        ? `api ${String(err.status ?? 'error')}: ${err.message}`
        : err instanceof Error
          ? err.message
          : String(err);
    log.warn({ reason }, 'piste 02 generation failed — nothing stored, the next run retries');
    return null;
  }
}

/** Test hook — drops the lazy client. */
export function resetPiste02ClientForTests(): void {
  client = null;
}
