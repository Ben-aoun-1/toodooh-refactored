import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReportData } from '../src/lib/report/assemble.js';
import {
  type RecommendationInput,
  buildRecommendationInput,
  generateRecommendations,
  generateRecommendationsCached,
  isRecommendationsEnabled,
  pistesForReport,
  pistesForReportCached,
  resetRecommendationsForTests,
} from '../src/lib/report/recommendations.js';

// R3 — the SDK is mocked at the module root (no key, no network in CI); the zod output-format
// helper stays REAL. The model authors ONLY the Piste 02 body (S07's titles are fixed in the
// template); the contract under test is the HARD FALLBACK matrix: every failure mode resolves
// to null, and only the minimized aggregate payload ever crosses the wire.
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

const validBody =
  'Mar 9h et Jeu 15h sont vos créneaux les plus faibles - proposez une offre matinale et communiquez-la sur vos réseaux pour redynamiser ces périodes creuses.';
const okMessage = { stop_reason: 'end_turn', parsed_output: { body: validBody } };

beforeEach(() => {
  resetRecommendationsForTests();
  parseSpy.mockReset();
  ctorSpy.mockClear();
  envState.key = TEST_KEY;
});

describe('generateRecommendations — happy path', () => {
  it('returns the schema-valid Piste 02 body', async () => {
    parseSpy.mockResolvedValue(okMessage);
    await expect(generateRecommendations(input())).resolves.toBe(validBody);
  });

  it('pins the request shape: model, max_tokens, structured output, timeout/retries', async () => {
    parseSpy.mockResolvedValue(okMessage);
    await generateRecommendations(input());
    const [params, options] = parseSpy.mock.calls[0] ?? [];
    expect(params.model).toBe('claude-haiku-4-5');
    expect(params.max_tokens).toBe(1024);
    expect(params.output_config?.format).toBeDefined();
    // R3 task: the weak-slot analysis, ONE titleless paragraph — never the old 3-piste ask
    expect(params.system).toContain('les créneaux faibles et les périodes creuses');
    expect(params.system).toContain('UN SEUL paragraphe de 40 mots maximum, sans titre');
    expect(params.system).not.toContain('exactement 3 pistes');
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

  it('the retired R2 3-piste shape → null (contract pinned to ONE body, revalidated locally)', async () => {
    parseSpy.mockResolvedValue({
      stop_reason: 'end_turn',
      parsed_output: { pistes: [{ title: 'Titre', body: 'Corps.' }] },
    });
    await expect(generateRecommendations(input())).resolves.toBeNull();
  });

  it('over-cap body (41 words) → null', async () => {
    const longBody = Array.from({ length: 41 }, (_, i) => `mot${i}`).join(' ');
    parseSpy.mockResolvedValue({
      stop_reason: 'end_turn',
      parsed_output: { body: longBody },
    });
    await expect(generateRecommendations(input())).resolves.toBeNull();
  });

  it('a non-string body → null (shape revalidated locally)', async () => {
    parseSpy.mockResolvedValue({
      stop_reason: 'end_turn',
      parsed_output: { body: 42 },
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
    expect(first).toBe(validBody);
    expect(second).toBe(validBody);
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
    await expect(generateRecommendationsCached('venue-1', range, input())).resolves.toBe(validBody);
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

// ── the report seam (Commit 2) ────────────────────────────────────────────────────────────────

const reportData = (over: Partial<ReportData> = {}): ReportData => ({
  venueName: 'Café Le Palmier',
  category: 'Café · Salon de thé',
  range: { from: '2026-06-01', to: '2026-06-30' },
  generatedLabel: '10/07/2026',
  hostHasData: true,
  castHasData: true,
  kpis: { global: 21400, perDay: 764, perHour: 76.4, peak: { value: 1180, date: '2026-06-14' } },
  // one hot cell (Ven idx4, 18h → hourIdx 10 = level 5), one warm, one weak, rest closed
  heatLevels: Array.from({ length: 7 }, (_, day) =>
    Array.from({ length: 14 }, (_, h) => {
      if (day === 4 && h === 10) return 5;
      if (day === 5 && h === 9) return 3;
      if (day === 1 && h === 1) return 1;
      return 0;
    }),
  ),
  days: [],
  breakdown: {
    femmes: 11128,
    hommes: 10272,
    ages: [
      { key: 'age_17_30_pct', label: '17 – 30 ans', count: 7276 },
      { key: 'age_31_45_pct', label: '31 – 45 ans', count: 6206 },
      { key: 'age_46_60_pct', label: '46 – 60 ans', count: 3852 },
      { key: 'age_60_plus_pct', label: '60 ans et plus', count: 2140 },
    ],
  },
  revenue: { totalLabel: '1 065', count: 3, rows: [] },
  campaignsBlock: { count: 3, cumulativeImpressions: 140300, top3: [], rows: [] },
  ...over,
});

describe('buildRecommendationInput (ReportData → minimized payload)', () => {
  it('maps the aggregates: identity, KPIs, top/bottom open slots, campaigns, demography', () => {
    const built = buildRecommendationInput(reportData());
    expect(built.commerce).toBe('Café Le Palmier');
    expect(built.categorie).toBe('Café · Salon de thé');
    expect(built.periode).toEqual({ du: '2026-06-01', au: '2026-06-30' });
    expect(built.audience).toEqual({
      globale: 21400,
      moyenneParJour: 764,
      moyenneParHeure: 76.4,
      pic: { valeur: 1180, date: '2026-06-14' },
    });
    expect(built.creneaux.plusForts[0]).toBe('Ven 18h'); // the level-5 cell leads
    expect(built.creneaux.plusFaibles[0]).toBe('Mar 9h'); // the level-1 cell trails
    expect(built.campagnes).toEqual({ nombre: 3, revenuTotalTnd: '1 065' });
    expect(built.demographie?.femmes).toBe(11128);
    expect(built.demographie?.tranchesAge[0]).toEqual({ tranche: '17 – 30 ans', personnes: 7276 });
  });

  it('closed/hachured cells (level 0) are never créneaux', () => {
    const built = buildRecommendationInput(reportData());
    expect(built.creneaux.plusForts).toHaveLength(3);
    expect(built.creneaux.plusFaibles).toHaveLength(3);
    // only 3 open cells exist in the fixture → forts and faibles are the same 3 slots, reordered
    expect(new Set([...built.creneaux.plusForts, ...built.creneaux.plusFaibles]).size).toBe(3);
  });

  it('a HOST-empty venue sends null audience; missing ratios send null demography', () => {
    const built = buildRecommendationInput(
      reportData({
        hostHasData: false,
        breakdown: null,
        kpis: { global: 0, perDay: null, perHour: null, peak: null },
      }),
    );
    expect(built.audience).toEqual({
      globale: null,
      moyenneParJour: null,
      moyenneParHeure: null,
      pic: null,
    });
    expect(built.demographie).toBeNull();
  });
});

describe('pistesForReport / pistesForReportCached (the report seam)', () => {
  it('a venue with NEITHER host nor cast data keeps the generic body without an API call', async () => {
    const empty = reportData({ hostHasData: false, castHasData: false });
    await expect(pistesForReport(empty)).resolves.toBeNull();
    await expect(pistesForReportCached('venue-x', empty)).resolves.toBeNull();
    expect(parseSpy).not.toHaveBeenCalled();
  });

  it('with data, the frozen path generates and the cached path caches per venue × period', async () => {
    parseSpy.mockResolvedValue(okMessage);
    await expect(pistesForReport(reportData())).resolves.toBe(validBody);
    expect(parseSpy).toHaveBeenCalledTimes(1); // uncached — every call hits the API
    await expect(pistesForReportCached('venue-1', reportData())).resolves.toBe(validBody);
    await expect(pistesForReportCached('venue-1', reportData())).resolves.toBe(validBody);
    expect(parseSpy).toHaveBeenCalledTimes(2); // one more for the first cached call only
  });
});
