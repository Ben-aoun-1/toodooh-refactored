import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  PISTE_02_MODEL,
  generatePiste02,
  isPiste02Enabled,
  resetPiste02ClientForTests,
} from '../src/lib/report/piste02/generate.js';
import {
  INSUFFICIENT_BODY,
  type Piste02Plan,
  planPiste02,
} from '../src/lib/report/piste02/input.js';
import { PISTE_02_SYSTEM_PROMPT } from '../src/lib/report/piste02/prompt.js';

// PISTES-V2 — the model call of the Piste 02 generator, against a fake SDK: the request shape
// (model, no temperature, structured output, the spec's prompt), the retry-with-reasons loop
// (1 + 2 retries), the « insuffisant » fallback after the last failure, and « store nothing » on
// an API failure or a missing key.

const parseSpy = vi.hoisted(() => vi.fn());
vi.mock('@anthropic-ai/sdk', () => {
  class FakeAPIError extends Error {
    status: number | undefined;
    constructor(message: string, status?: number) {
      super(message);
      this.status = status;
    }
  }
  class FakeAnthropic {
    static APIError = FakeAPIError;
    messages = { parse: parseSpy };
  }
  return { default: FakeAnthropic };
});

vi.mock('../src/logger.js', () => ({
  buildLoggerConfig: () => false,
  logger: {
    child: () => ({ warn: () => undefined, debug: () => undefined, info: () => undefined }),
  },
}));

const envState = vi.hoisted(() => ({ key: 'sk-ant-test-0123456789abcdef' as string | undefined }));
vi.mock('../src/env.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/env.js')>();
  return {
    ...actual,
    env: new Proxy(actual.env, {
      get: (target, prop) =>
        prop === 'ANTHROPIC_API_KEY' ? envState.key : Reflect.get(target, prop),
    }),
  };
});

const SLOTS = [20, 21, 22, 23, 24, 25];
const plan = (): Extract<Piste02Plan, { kind: 'generate' }> => {
  const p = planPiste02({
    month: '2026-06',
    data: {
      range: { from: '2026-06-01', to: '2026-06-30' },
      kpis: {
        global: 1100,
        perDay: 40,
        perHour: 13,
        peak: null,
        measuredDays: 28,
        estimatedPct: 6,
      },
      heatSlots: SLOTS,
      heatValues: Array.from({ length: 7 }, () => [10, 20, 40, 40, 5, 5]),
      heatKinds: Array.from({ length: 7 }, () => SLOTS.map(() => 'measured' as const)),
    },
    facts: {
      venueName: 'Café Le Palmier',
      sectorName: 'Café',
      venueClass: 'moyen',
      zoneName: null,
      city: 'Ariana',
      governorateName: 'Ariana',
      openingHour: 10,
      closingHour: 13,
      closures: [],
    },
    previousGlobal: null,
    history: { familles: ['B'], titres: [], creneaux: [] },
    firstReport: false,
  });
  if (p.kind !== 'generate') throw new Error('expected generate');
  return p;
};

const GOOD = {
  statut: 'genere',
  titre: 'Le creux du midi',
  corps:
    'Vos lundis à 12h tournent à 33 % de votre niveau habituel, alors que la fin de matinée reste bien remplie à 11h. Ce creux suggère probablement une offre peu adaptée au moment du déjeuner pour le public présent. Une formule courte annoncée la veille sur vos réseaux sociaux se teste sans engagement et peut ramener une clientèle régulière.',
  famille_levier: 'C',
  creneaux_cites: ['lundi 12h-13h'],
  hypothese_formulee: 'Offre inadaptée au déjeuner',
  confiance: 'haute',
};

const answer = (parsed: unknown, stop_reason = 'end_turn') => ({
  stop_reason,
  parsed_output: parsed,
});

beforeEach(() => {
  parseSpy.mockReset();
  envState.key = 'sk-ant-test-0123456789abcdef';
  resetPiste02ClientForTests();
});

describe('generatePiste02', () => {
  it('sends the spec prompt to claude-sonnet-5-5 with structured output and NO temperature', async () => {
    parseSpy.mockResolvedValueOnce(answer(GOOD));
    const result = await generatePiste02(plan());
    expect(result).toMatchObject({
      statut: 'genere',
      corps: GOOD.corps,
      familleLevier: 'C',
      creneauxCites: ['lundi 12h-13h'],
      confiance: 'haute',
      model: PISTE_02_MODEL,
    });
    const [params] = parseSpy.mock.calls[0] ?? [];
    expect(params.model).toBe('claude-sonnet-5-5');
    expect(params.system).toBe(PISTE_02_SYSTEM_PROMPT);
    expect(params).not.toHaveProperty('temperature');
    expect(params.output_config.effort).toBe('medium');
    expect(params.output_config.format).toBeDefined();
    expect(params.messages).toHaveLength(1); // single-turn, every attempt
    expect(params.messages[0].content).toContain('« Cafés »');
  });

  it('retries a draft that fails the post-checks, naming the failures, as a FRESH request', async () => {
    parseSpy
      .mockResolvedValueOnce(answer({ ...GOOD, corps: `${GOOD.corps}!` }))
      .mockResolvedValueOnce(answer(GOOD));
    const result = await generatePiste02(plan());
    expect(result?.corps).toBe(GOOD.corps);
    expect(parseSpy).toHaveBeenCalledTimes(2);
    const retry = parseSpy.mock.calls[1]?.[0];
    expect(retry.messages).toHaveLength(1);
    expect(retry.messages[0].content).toContain("- point d'exclamation");
  });

  it('after three failed attempts, the fixed « insuffisant » text is the result', async () => {
    parseSpy.mockResolvedValue(answer({ ...GOOD, famille_levier: 'B' })); // B is in the history
    const result = await generatePiste02(plan());
    expect(parseSpy).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({ statut: 'insuffisant', corps: INSUFFICIENT_BODY, model: null });
  });

  it('a refusal or an unparseable answer counts as a failed attempt', async () => {
    parseSpy
      .mockResolvedValueOnce(answer(null, 'refusal'))
      .mockResolvedValueOnce(answer({ nope: true }))
      .mockResolvedValueOnce(answer(GOOD));
    expect((await generatePiste02(plan()))?.corps).toBe(GOOD.corps);
    expect(parseSpy).toHaveBeenCalledTimes(3);
  });

  it('an API failure stores NOTHING (null) — the next run retries', async () => {
    parseSpy.mockRejectedValue(new Error('network down'));
    await expect(generatePiste02(plan())).resolves.toBeNull();
  });

  it('no key → null without a call; the « insuffisant » plan → the fixed text without a call', async () => {
    envState.key = undefined;
    resetPiste02ClientForTests();
    expect(isPiste02Enabled()).toBe(false);
    await expect(generatePiste02(plan())).resolves.toBeNull();
    await expect(
      generatePiste02({ kind: 'insufficient', reason: 'few_measured_days' }),
    ).resolves.toMatchObject({ statut: 'insuffisant', corps: INSUFFICIENT_BODY });
    expect(parseSpy).not.toHaveBeenCalled();
  });
});
