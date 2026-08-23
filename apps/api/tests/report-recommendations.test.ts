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
  recommendationCacheKey,
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

// R3.1 — the module child logger is mocked so the observable-fallback contract is assertable:
// every fallback warns ONCE with a machine-greppable reason, and NEVER logs bodies/payloads.
const { warnSpy, debugSpy } = vi.hoisted(() => ({ warnSpy: vi.fn(), debugSpy: vi.fn() }));
vi.mock('../src/logger.js', () => ({
  buildLoggerConfig: () => false,
  logger: { child: () => ({ warn: warnSpy, debug: debugSpy }) },
}));

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
  warnSpy.mockClear();
  debugSpy.mockClear();
  envState.key = TEST_KEY;
});

/** An n-word French-ish body (deterministic) — for cap/retry fixtures. */
const bodyOfWords = (n: number): string => Array.from({ length: n }, (_, i) => `mot${i}`).join(' ');
const okWith = (body: string) => ({ stop_reason: 'end_turn', parsed_output: { body } });
// The exact acceptance boundary (R3.1 ruling): 40 words AND 210 chars — 39 two-char words
// (+38 joiners = 116) + one 93-char word = 210.
const capBoundaryBody = `${Array.from({ length: 39 }, () => 'ab').join(' ')} ${'x'.repeat(93)}`;

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
    // R3 task: the weak-slot analysis, ONE titleless paragraph — never the old 3-piste ask.
    // R3.1: ask LOW (30 in the prompt AND the schema description); enforcement stays 40.
    expect(params.system).toContain('les créneaux faibles et les périodes creuses');
    expect(params.system).toContain('UN SEUL paragraphe de 30 mots maximum, sans titre');
    expect(params.system).not.toContain('40 mots');
    expect(params.system).not.toContain('exactement 3 pistes');
    expect(JSON.stringify(params.output_config)).toContain('Un paragraphe de 30 mots maximum');
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

describe('generateRecommendations — hard fallback matrix (every failure → null, ONE warn)', () => {
  it('no key → null without constructing a client, calling the SDK, or warning', async () => {
    envState.key = undefined;
    await expect(generateRecommendations(input())).resolves.toBeNull();
    expect(ctorSpy).not.toHaveBeenCalled();
    expect(parseSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled(); // unprovisioned is a config state, not a failure
    expect(isRecommendationsEnabled()).toBe(false);
  });

  it("parse failure (parsed_output null) → null + warn {reason: 'parse_failure'}", async () => {
    parseSpy.mockResolvedValue({ stop_reason: 'end_turn', parsed_output: null });
    await expect(generateRecommendations(input())).resolves.toBeNull();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toEqual({ reason: 'parse_failure' });
  });

  it('the retired R2 3-piste shape → null (contract pinned to ONE body, revalidated locally)', async () => {
    parseSpy.mockResolvedValue({
      stop_reason: 'end_turn',
      parsed_output: { pistes: [{ title: 'Titre', body: 'Corps.' }] },
    });
    await expect(generateRecommendations(input())).resolves.toBeNull();
    expect(warnSpy.mock.calls[0]?.[0]).toEqual({ reason: 'parse_failure' });
  });

  it("both drafts over cap → null + ONE warn {reason: 'over_cap', words, chars} (never the body)", async () => {
    parseSpy.mockResolvedValue(okWith(bodyOfWords(41)));
    await expect(generateRecommendations(input())).resolves.toBeNull();
    expect(parseSpy).toHaveBeenCalledTimes(2); // the compress-retry ran, then gave up
    expect(warnSpy).toHaveBeenCalledTimes(1);
    // BOTH counts ride the warn so forensics can see which guard fired (ruling pin 1)
    expect(warnSpy.mock.calls[0]?.[0]).toEqual({
      reason: 'over_cap',
      words: 41,
      chars: bodyOfWords(41).trim().length,
    });
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain('mot0'); // body never logged
  });

  it('the 210-char guard fires INDEPENDENTLY of the word cap (38 long words → over_cap)', async () => {
    const wide = Array.from({ length: 38 }, () => 'abcdefg').join(' '); // 38 words, 303 chars
    parseSpy.mockResolvedValue(okWith(wide));
    await expect(generateRecommendations(input())).resolves.toBeNull();
    expect(parseSpy).toHaveBeenCalledTimes(2); // retried, still too wide
    expect(warnSpy.mock.calls[0]?.[0]).toEqual({ reason: 'over_cap', words: 38, chars: 303 });
  });

  it('a non-string body → null (shape revalidated locally)', async () => {
    parseSpy.mockResolvedValue({
      stop_reason: 'end_turn',
      parsed_output: { body: 42 },
    });
    await expect(generateRecommendations(input())).resolves.toBeNull();
  });

  it("refusal stop_reason → null + warn {reason: 'refusal'}, no retry", async () => {
    parseSpy.mockResolvedValue({ stop_reason: 'refusal', parsed_output: null });
    await expect(generateRecommendations(input())).resolves.toBeNull();
    expect(parseSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toEqual({ reason: 'refusal' });
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

// ── R3.1 — the compress-retry: ONE follow-up turn when the first draft busts the 40-word cap ──
describe('generateRecommendations — compress-retry', () => {
  it('a first draft AT the exact acceptance boundary (40 words, 210 chars) returns immediately', async () => {
    expect(capBoundaryBody.trim().split(/\s+/)).toHaveLength(40);
    expect(capBoundaryBody.trim().length).toBe(210);
    parseSpy.mockResolvedValue(okWith(capBoundaryBody));
    await expect(generateRecommendations(input())).resolves.toBe(capBoundaryBody);
    expect(parseSpy).toHaveBeenCalledTimes(1); // no retry turn
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('40 words but 211 chars → retried (the char guard alone trips acceptance)', async () => {
    const oneOver = `${capBoundaryBody}x`; // 40 words, 211 chars
    parseSpy.mockResolvedValueOnce(okWith(oneOver));
    parseSpy.mockResolvedValueOnce(okWith(validBody));
    await expect(generateRecommendations(input())).resolves.toBe(validBody);
    expect(parseSpy).toHaveBeenCalledTimes(2);
  });

  it('over-cap first draft (probe-real 56 words) → ONE retry turn carrying the draft + the compress ask', async () => {
    const overLong = bodyOfWords(56);
    parseSpy.mockResolvedValueOnce(okWith(overLong));
    parseSpy.mockResolvedValueOnce(okWith(validBody));
    await expect(generateRecommendations(input())).resolves.toBe(validBody);
    expect(parseSpy).toHaveBeenCalledTimes(2);
    expect(warnSpy).not.toHaveBeenCalled(); // the retry SUCCEEDED — nothing fell back
    // the retry transcript: original ask, the over-long draft as assistant, the compress ask
    const retryMessages = parseSpy.mock.calls[1]?.[0]?.messages as {
      role: string;
      content: string;
    }[];
    expect(retryMessages).toHaveLength(3);
    expect(retryMessages[0]).toEqual({ role: 'user', content: JSON.stringify(input()) });
    expect(retryMessages[1]).toEqual({ role: 'assistant', content: overLong });
    expect(retryMessages[2]).toEqual({
      role: 'user',
      content: 'Réécris ce paragraphe en 30 mots maximum, sans rien ajouter.',
    });
    // the retry call keeps the SAME options (10s timeout, 1 SDK retry) and structured output
    expect(parseSpy.mock.calls[1]?.[1]).toEqual({ timeout: 10_000, maxRetries: 1 });
    expect(parseSpy.mock.calls[1]?.[0]?.output_config?.format).toBeDefined();
  });

  it('a refusal on the retry turn → null + warn, and NO third call', async () => {
    parseSpy.mockResolvedValueOnce(okWith(bodyOfWords(41)));
    parseSpy.mockResolvedValueOnce({ stop_reason: 'refusal', parsed_output: null });
    await expect(generateRecommendations(input())).resolves.toBeNull();
    expect(parseSpy).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toEqual({ reason: 'refusal' });
  });

  it('an API error on the retry turn → null via the catch path (never throws)', async () => {
    parseSpy.mockResolvedValueOnce(okWith(bodyOfWords(41)));
    parseSpy.mockRejectedValueOnce(new Error('Request timed out.'));
    await expect(generateRecommendations(input())).resolves.toBeNull();
    expect(warnSpy).toHaveBeenCalledTimes(1); // the existing catch-path warn
  });
});

describe('generateRecommendationsCached (venue × input digest — PERF-QA2)', () => {
  it('a second identical call does NOT hit the SDK', async () => {
    parseSpy.mockResolvedValue(okMessage);
    const first = await generateRecommendationsCached('venue-1', input());
    const second = await generateRecommendationsCached('venue-1', input());
    expect(first).toBe(validBody);
    expect(second).toBe(validBody);
    expect(parseSpy).toHaveBeenCalledTimes(1);
  });

  it('IDENTICAL inputs yield an IDENTICAL body even across DIFFERENT periods (the QA2 fix)', async () => {
    parseSpy.mockResolvedValue(okMessage);
    const june = input();
    const may = { ...input(), periode: { du: '2026-05-01', au: '2026-05-31' } };
    // Same payload → one generation, shared by both callers.
    expect(await generateRecommendationsCached('venue-1', june)).toBe(validBody);
    expect(await generateRecommendationsCached('venue-1', { ...june })).toBe(validBody);
    expect(parseSpy).toHaveBeenCalledTimes(1);
    // A payload that genuinely differs (its période) is a different digest → a new generation.
    expect(await generateRecommendationsCached('venue-1', may)).toBe(validBody);
    expect(parseSpy).toHaveBeenCalledTimes(2);
  });

  it('a different venue is a different cache key (no cross-venue body sharing)', async () => {
    parseSpy.mockResolvedValue(okMessage);
    await generateRecommendationsCached('venue-1', input());
    await generateRecommendationsCached('venue-2', input());
    expect(parseSpy).toHaveBeenCalledTimes(2);
  });

  it('the key is venue + a sha256 of the payload', () => {
    const key = recommendationCacheKey('venue-1', input());
    expect(key.startsWith('venue-1|')).toBe(true);
    expect(key.slice('venue-1|'.length)).toMatch(/^[0-9a-f]{64}$/);
    expect(recommendationCacheKey('venue-1', input())).toBe(key); // stable
    expect(recommendationCacheKey('venue-1', { ...input(), commerce: 'Autre lieu' })).not.toBe(key);
  });

  it('failures are not cached — the next call retries', async () => {
    parseSpy.mockRejectedValueOnce(new Error('boom'));
    await expect(generateRecommendationsCached('venue-1', input())).resolves.toBeNull();
    parseSpy.mockResolvedValueOnce(okMessage);
    await expect(generateRecommendationsCached('venue-1', input())).resolves.toBe(validBody);
    expect(parseSpy).toHaveBeenCalledTimes(2);
  });

  it('evicts the oldest entry past the ~500 cap', async () => {
    parseSpy.mockResolvedValue(okMessage);
    for (let i = 0; i < 501; i += 1) {
      await generateRecommendationsCached(`venue-${i}`, input());
    }
    expect(parseSpy).toHaveBeenCalledTimes(501);
    // venue-0 was evicted → a repeat call re-fetches; venue-1 is still cached.
    await generateRecommendationsCached('venue-0', input());
    expect(parseSpy).toHaveBeenCalledTimes(502);
    await generateRecommendationsCached('venue-500', input());
    expect(parseSpy).toHaveBeenCalledTimes(502);
  });
});

// ── the report seam (Commit 2) ────────────────────────────────────────────────────────────────

const reportData = (over: Partial<ReportData> = {}): ReportData => ({
  venueName: 'Café Le Palmier',
  category: 'Café · Salon de thé',
  sps: null,
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
  upcomingEvents: null,
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
    // R3.1 — only 3 open cells: all are forts, and faibles stays EMPTY rather than echoing them
    expect(built.creneaux.plusFaibles).toEqual([]);
    expect(built.campagnes).toEqual({ nombre: 3, revenuTotalTnd: '1 065' });
    expect(built.demographie?.femmes).toBe(11128);
    expect(built.demographie?.tranchesAge[0]).toEqual({ tranche: '17 – 30 ans', personnes: 7276 });
  });

  it('closed/hachured cells (level 0) are never créneaux', () => {
    const built = buildRecommendationInput(reportData());
    // only 3 open cells exist in the fixture — all become forts; nothing hachured leaks in
    expect(built.creneaux.plusForts).toHaveLength(3);
    expect(built.creneaux.plusFaibles).toHaveLength(0);
  });

  // ── R3.1 — forts/faibles are DISJOINT (the old slice(-3) echoed fort cells below 6 slots and
  // the model repeated the contradiction). Fewer/empty faibles beats a contradiction. ───────────
  describe('heatmap slot dedupe matrix', () => {
    const gridWith = (cells: [number, number, number][]): number[][] => {
      const grid = Array.from({ length: 7 }, () => Array.from({ length: 14 }, () => 0));
      for (const [day, hourIdx, level] of cells) {
        const row = grid[day];
        if (row) row[hourIdx] = level;
      }
      return grid;
    };
    const creneauxOf = (cells: [number, number, number][]) =>
      buildRecommendationInput(reportData({ heatLevels: gridWith(cells) })).creneaux;

    it('0 open cells → both lists empty', () => {
      expect(creneauxOf([])).toEqual({ plusForts: [], plusFaibles: [] });
    });

    it('2 open cells → both become forts, faibles empty (never echoed back)', () => {
      const c = creneauxOf([
        [4, 10, 5], // Ven 18h
        [1, 1, 1], // Mar 9h
      ]);
      expect(c.plusForts).toEqual(['Ven 18h', 'Mar 9h']);
      expect(c.plusFaibles).toEqual([]);
    });

    it('4 open cells → 3 forts + the single remaining faible (fewer beats contradiction)', () => {
      const c = creneauxOf([
        [4, 10, 5], // Ven 18h
        [5, 9, 4], // Sam 17h
        [0, 4, 3], // Lun 12h
        [1, 1, 1], // Mar 9h
      ]);
      expect(c.plusForts).toEqual(['Ven 18h', 'Sam 17h', 'Lun 12h']);
      expect(c.plusFaibles).toEqual(['Mar 9h']);
    });

    it('6 open cells → two full DISJOINT lists, faibles weakest-first', () => {
      const c = creneauxOf([
        [4, 10, 5], // Ven 18h
        [5, 9, 5], // Sam 17h
        [4, 11, 4], // Ven 19h
        [2, 6, 3], // Mer 14h
        [3, 7, 2], // Jeu 15h
        [1, 1, 1], // Mar 9h
      ]);
      expect(c.plusForts).toEqual(['Ven 18h', 'Sam 17h', 'Ven 19h']);
      expect(c.plusFaibles).toEqual(['Mar 9h', 'Jeu 15h', 'Mer 14h']);
      expect(c.plusForts.filter((s) => c.plusFaibles.includes(s))).toEqual([]);
    });

    it('a full 28-cell grid → 3 forts, the 3 TRUE weakest as faibles, disjoint', () => {
      // 2 full days open (Lun+Mar, 14 hours each): levels ramp so the extremes are unambiguous.
      const cells: [number, number, number][] = [];
      for (let h = 0; h < 14; h += 1) {
        cells.push([0, h, h < 3 ? 5 : 3]); // Lun: three level-5 peaks, the rest level 3
        cells.push([1, h, h < 3 ? 1 : 2]); // Mar: three level-1 troughs, the rest level 2
      }
      const c = creneauxOf(cells);
      expect(c.plusForts).toEqual(['Lun 8h', 'Lun 9h', 'Lun 10h']);
      // the three level-1 troughs, tied → stable-sort order reversed (deterministic)
      expect(c.plusFaibles).toEqual(['Mar 10h', 'Mar 9h', 'Mar 8h']);
      expect(c.plusForts.filter((s) => c.plusFaibles.includes(s))).toEqual([]);
    });
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
    await expect(pistesForReport('venue-x', empty)).resolves.toBeNull();
    await expect(pistesForReportCached('venue-x', empty)).resolves.toBeNull();
    expect(parseSpy).not.toHaveBeenCalled();
  });

  it('the FROZEN path and the PAGE path share ONE generation for the same venue × inputs', async () => {
    parseSpy.mockResolvedValue(okMessage);
    // The month-end job freezes a body into the stored PDF…
    await expect(pistesForReport('venue-1', reportData())).resolves.toBe(validBody);
    // …and the page, later, reads THAT body instead of resampling the model (the QA2 fix: the
    // two used to diverge because the frozen path was uncached).
    await expect(pistesForReportCached('venue-1', reportData())).resolves.toBe(validBody);
    await expect(pistesForReportCached('venue-1', reportData())).resolves.toBe(validBody);
    expect(parseSpy).toHaveBeenCalledTimes(1);
  });
});
