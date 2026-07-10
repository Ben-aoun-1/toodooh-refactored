import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type RecommendationInput,
  generateRecommendations,
  generateRecommendationsCached,
  isRecommendationsEnabled,
  resetRecommendationsForTests,
} from '../src/lib/report/recommendations.js';

// R2 — the SDK is mocked at the module root (no key, no network in CI); the zod output-format
// helper stays REAL. The contract under test is the HARD FALLBACK matrix: every failure mode
// resolves to null, and only the minimized aggregate payload ever crosses the wire.
const parseSpy = vi.hoisted(() => vi.fn());
const ctorSpy = vi.hoisted(() => vi.fn());
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
    constructor(opts: unknown) {
      ctorSpy(opts);
    }
  }
  return { default: FakeAnthropic };
});

// The key is toggled per test through the env seam (the module reads env.ANTHROPIC_API_KEY on
// every getClient() call, so a Proxy keeps the no-key path deterministic).
const envState = vi.hoisted(() => ({ key: undefined as string | undefined }));
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

const TEST_KEY = 'sk-ant-test-0123456789abcdef';

const input = (): RecommendationInput => ({
  commerce: 'Café Le Palmier',
  categorie: 'Café · Salon de thé',
  periode: { du: '2026-06-01', au: '2026-06-30' },
  audience: {
    globale: 21400,
    moyenneParJour: 764,
    moyenneParHeure: 76.4,
    pic: { valeur: 1180, date: '2026-06-14' },
  },
  creneaux: { plusForts: ['Ven 18h', 'Sam 17h', 'Ven 19h'], plusFaibles: ['Mar 9h', 'Jeu 15h'] },
  campagnes: { nombre: 3, revenuTotalTnd: '1 065' },
  demographie: {
    femmes: 11128,
    hommes: 10272,
    tranchesAge: [
      { tranche: '17 – 30 ans', personnes: 7276 },
      { tranche: '31 – 45 ans', personnes: 6206 },
    ],
  },
});

const validPistes = [
  { title: 'Valorisez vos vendredis soirs', body: 'Le créneau Ven 18h est votre plus fort.' },
  { title: 'Comblez le creux du mardi matin', body: 'Mar 9h est votre créneau le plus faible.' },
  { title: 'Capitalisez sur les 17 – 30 ans', body: 'Votre première tranche d’âge mesurée.' },
];
const okMessage = { stop_reason: 'end_turn', parsed_output: { pistes: validPistes } };

beforeEach(() => {
  resetRecommendationsForTests();
  parseSpy.mockReset();
  ctorSpy.mockClear();
  envState.key = TEST_KEY;
});

describe('generateRecommendations — happy path', () => {
  it('returns the 3 schema-valid pistes', async () => {
    parseSpy.mockResolvedValue(okMessage);
    await expect(generateRecommendations(input())).resolves.toEqual(validPistes);
  });

  it('pins the request shape: model, max_tokens, structured output, timeout/retries', async () => {
    parseSpy.mockResolvedValue(okMessage);
    await generateRecommendations(input());
    const [params, options] = parseSpy.mock.calls[0] ?? [];
    expect(params.model).toBe('claude-haiku-4-5');
    expect(params.max_tokens).toBe(1024);
    expect(params.output_config?.format).toBeDefined();
    expect(params.system).toContain('exactement 3 pistes');
    expect(options).toEqual({ timeout: 10_000, maxRetries: 1 });
  });

  it('sends ONLY the minimized aggregates — the payload IS the input, nothing more', async () => {
    parseSpy.mockResolvedValue(okMessage);
    const payload = input();
    await generateRecommendations(payload);
    const [params] = parseSpy.mock.calls[0] ?? [];
    const wire = params.messages[0].content as string;
    expect(JSON.parse(wire)).toEqual(payload); // exact — no extra fields can leak
    for (const forbidden of ['email', 'phone', 'owner', 'Id"', 'id"']) {
      expect(wire).not.toContain(forbidden);
    }
  });

  it('constructs the client with the explicit env key, once (lazy singleton)', async () => {
    parseSpy.mockResolvedValue(okMessage);
    await generateRecommendations(input());
    await generateRecommendations(input());
    expect(ctorSpy).toHaveBeenCalledTimes(1);
    expect(ctorSpy).toHaveBeenCalledWith(expect.objectContaining({ apiKey: TEST_KEY }));
  });
});

describe('generateRecommendations — hard fallback matrix (every failure → null)', () => {
  it('no key → null without constructing a client or calling the SDK', async () => {
    envState.key = undefined;
    await expect(generateRecommendations(input())).resolves.toBeNull();
    expect(ctorSpy).not.toHaveBeenCalled();
    expect(parseSpy).not.toHaveBeenCalled();
    expect(isRecommendationsEnabled()).toBe(false);
  });

  it('parse failure (parsed_output null) → null', async () => {
    parseSpy.mockResolvedValue({ stop_reason: 'end_turn', parsed_output: null });
    await expect(generateRecommendations(input())).resolves.toBeNull();
  });

  it('a 2-piste response → null (shape revalidated locally)', async () => {
    parseSpy.mockResolvedValue({
      stop_reason: 'end_turn',
      parsed_output: { pistes: validPistes.slice(0, 2) },
    });
    await expect(generateRecommendations(input())).resolves.toBeNull();
  });

  it('over-cap body (41 words) → null', async () => {
    const longBody = Array.from({ length: 41 }, (_, i) => `mot${i}`).join(' ');
    parseSpy.mockResolvedValue({
      stop_reason: 'end_turn',
      parsed_output: { pistes: [validPistes[0], validPistes[1], { title: 'Ok', body: longBody }] },
    });
    await expect(generateRecommendations(input())).resolves.toBeNull();
  });

  it('over-cap title (61 chars) → null', async () => {
    parseSpy.mockResolvedValue({
      stop_reason: 'end_turn',
      parsed_output: {
        pistes: [{ title: 'x'.repeat(61), body: 'Court.' }, validPistes[1], validPistes[2]],
      },
    });
    await expect(generateRecommendations(input())).resolves.toBeNull();
  });

  it('refusal stop_reason → null, silently (no retry)', async () => {
    parseSpy.mockResolvedValue({ stop_reason: 'refusal', parsed_output: null });
    await expect(generateRecommendations(input())).resolves.toBeNull();
    expect(parseSpy).toHaveBeenCalledTimes(1);
  });

  it('typed API error → null; plain timeout error → null (never throws)', async () => {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    // The mock's APIError takes (message, status) — the real SDK type signature differs, hence
    // the double cast; instanceof against Anthropic.APIError is what the module branches on.
    const MockApiError = Anthropic.APIError as unknown as new (
      msg: string,
      status?: number,
    ) => Error;
    parseSpy.mockRejectedValueOnce(new MockApiError('overloaded', 529));
    await expect(generateRecommendations(input())).resolves.toBeNull();
    parseSpy.mockRejectedValueOnce(new Error('Request timed out.'));
    await expect(generateRecommendations(input())).resolves.toBeNull();
  });
});

describe('generateRecommendationsCached (on-demand path)', () => {
  const range = { from: '2026-06-01', to: '2026-06-30' };

  it('a second identical call does NOT hit the SDK', async () => {
    parseSpy.mockResolvedValue(okMessage);
    const first = await generateRecommendationsCached('venue-1', range, input());
    const second = await generateRecommendationsCached('venue-1', range, input());
    expect(first).toEqual(validPistes);
    expect(second).toEqual(validPistes);
    expect(parseSpy).toHaveBeenCalledTimes(1);
  });

  it('a different venue or period is a different cache key', async () => {
    parseSpy.mockResolvedValue(okMessage);
    await generateRecommendationsCached('venue-1', range, input());
    await generateRecommendationsCached('venue-2', range, input());
    await generateRecommendationsCached(
      'venue-1',
      { from: '2026-05-01', to: '2026-05-31' },
      input(),
    );
    expect(parseSpy).toHaveBeenCalledTimes(3);
  });

  it('failures are not cached — the next call retries', async () => {
    parseSpy.mockRejectedValueOnce(new Error('boom'));
    await expect(generateRecommendationsCached('venue-1', range, input())).resolves.toBeNull();
    parseSpy.mockResolvedValueOnce(okMessage);
    await expect(generateRecommendationsCached('venue-1', range, input())).resolves.toEqual(
      validPistes,
    );
    expect(parseSpy).toHaveBeenCalledTimes(2);
  });

  it('evicts the oldest entry past the ~500 cap', async () => {
    parseSpy.mockResolvedValue(okMessage);
    for (let i = 0; i < 501; i += 1) {
      await generateRecommendationsCached(`venue-${i}`, range, input());
    }
    expect(parseSpy).toHaveBeenCalledTimes(501);
    // venue-0 was evicted → a repeat call re-fetches; venue-1 is still cached.
    await generateRecommendationsCached('venue-0', range, input());
    expect(parseSpy).toHaveBeenCalledTimes(502);
    await generateRecommendationsCached('venue-500', range, input());
    expect(parseSpy).toHaveBeenCalledTimes(502);
  });
});
