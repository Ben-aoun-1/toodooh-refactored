import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import { type NewUser, screenhosts, users } from '../src/db/schema.js';
import { screenhostsRoutes } from '../src/routes/screenhosts.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// GET /api/screenhosts/:id/report?from&to — the on-demand PERIOD report (R1). Chromium is mocked
// at the render seam (renderPdf) so the suite runs machine-independent; the real render is
// covered by report-render.test.ts (guarded) + the docker image.
const renderSpy = vi.hoisted(() =>
  vi.fn(async (html: string) => {
    void html;
    return Buffer.from('%PDF-period-fake');
  }),
);
vi.mock('../src/lib/report/render.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/report/render.js')>();
  return { ...actual, renderPdf: renderSpy };
});

// R3 — the endpoint must use the CACHE-WRAPPED pistes seam (per venue × period, now yielding the
// single Piste 02 body); mocked at the module boundary so the suite needs no key/SDK. Default:
// null → generic Piste 02 body.
const pistesCachedSpy = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/report/recommendations.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/report/recommendations.js')>();
  return { ...actual, pistesForReportCached: pistesCachedSpy };
});

type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;

const buildApp = () => Fastify({ logger: false });

const mockSession = (userId: string, role = 'individual_owner', status = 'approved'): void => {
  vi.spyOn(auth.api, 'getSession').mockResolvedValue({
    session: {},
    user: { id: userId, role, status },
  } as unknown as GetSessionResult);
};

const mockNoSession = (): void => {
  vi.spyOn(auth.api, 'getSession').mockResolvedValue(null as unknown as GetSessionResult);
};

let seq = 0;
const seedUser = async (values: Partial<NewUser> = {}): Promise<string> => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `repep${seq}@example.com`,
      contactName: `User ${seq}`,
      role: 'individual_owner',
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

const seedScreenhost = async (ownerId: string): Promise<string> => {
  const [s] = await db.insert(screenhosts).values({ name: 'Café Période', ownerId }).returning();
  return s?.id ?? '';
};

afterAll(async () => {
  await sql.end();
});

describe('GET /api/screenhosts/:id/report (period report, real Postgres)', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    await resetAuthTables();
    renderSpy.mockClear();
    renderSpy.mockImplementation(async (html: string) => {
      void html;
      return Buffer.from('%PDF-period-fake');
    });
    pistesCachedSpy.mockReset();
    pistesCachedSpy.mockResolvedValue(null);
    app = buildApp();
    await app.register(screenhostsRoutes);
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  const report = (id: string, qs: string) =>
    app.inject({ method: 'GET', url: `/api/screenhosts/${id}/report?${qs}` });

  it('requires authentication (401)', async () => {
    mockNoSession();
    const res = await report(
      '11111111-1111-4111-8111-111111111111',
      'from=2026-06-01&to=2026-06-30',
    );
    expect(res.statusCode).toBe(401);
  });

  it("404 on a FOREIGN screenhost (someone else's venue is indistinguishable from a missing one)", async () => {
    const me = await seedUser();
    const other = await seedUser();
    const foreign = await seedScreenhost(other);
    mockSession(me);
    expect((await report(foreign, 'from=2026-06-01&to=2026-06-30')).statusCode).toBe(404);
  });

  it('400 INVALID_INPUT on malformed or reversed ranges', async () => {
    const me = await seedUser();
    const sh = await seedScreenhost(me);
    mockSession(me);
    const malformed = await report(sh, 'from=juin&to=2026-06-30');
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json<{ error: string }>().error).toBe('INVALID_INPUT');
    const reversed = await report(sh, 'from=2026-06-30&to=2026-06-01');
    expect(reversed.statusCode).toBe(400);
    expect(reversed.json<{ error: string }>().error).toBe('INVALID_INPUT');
  });

  // PERF-QA1 R4 — the CONFIRMED Mejri repro: « Depuis le début » resolves from 2020-01-01, blows
  // the 400-day bound, and the old client showed the generic « Échec du téléchargement ». The
  // too-wide class now has its OWN code so the web can say what actually happened.
  it('an over-400-day range (« Depuis le début » repro) is a DISTINCT 400 RANGE_TOO_WIDE', async () => {
    const me = await seedUser();
    const sh = await seedScreenhost(me);
    mockSession(me);
    const res = await report(sh, 'from=2020-01-01&to=2026-08-05');
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toBe('RANGE_TOO_WIDE');
  });

  it('streams the rendered PDF for the owner (live render, ephemeral)', async () => {
    const me = await seedUser();
    const sh = await seedScreenhost(me);
    mockSession(me);
    const res = await report(sh, 'from=2026-06-01&to=2026-06-30');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    // PERF-QA1 R3 — the filename carries the venue slug ('Café Période' → 'cafe-periode').
    expect(res.headers['content-disposition']).toContain(
      'rapport-cafe-periode-2026-06-01_2026-06-30.pdf',
    );
    expect(res.rawPayload.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(renderSpy).toHaveBeenCalledTimes(1);
    // The rendered HTML is the report template over THIS venue's data.
    const html = renderSpy.mock.calls[0]?.[0] ?? '';
    expect(html).toContain('Café Période');
    expect(html).toContain('Section 01');
  });

  it('503 REPORT_RENDER_FAILED when chromium rendering fails (clear error, api keeps serving)', async () => {
    const me = await seedUser();
    const sh = await seedScreenhost(me);
    mockSession(me);
    renderSpy.mockRejectedValueOnce(new Error('chromium crashed'));
    const res = await report(sh, 'from=2026-06-01&to=2026-06-30');
    expect(res.statusCode).toBe(503);
    expect(res.json<{ error: string }>().error).toBe('REPORT_RENDER_FAILED');
  });

  it('goes through the CACHE-WRAPPED pistes seam and renders the AI Piste 02 body it returns (R3)', async () => {
    const me = await seedUser();
    const sh = await seedScreenhost(me);
    mockSession(me);
    pistesCachedSpy.mockResolvedValue('Corps IA du créneau faible.');
    const res = await report(sh, 'from=2026-06-01&to=2026-06-30');
    expect(res.statusCode).toBe(200);
    // the cached variant, keyed by THIS venue (the period rides in data.range)
    expect(pistesCachedSpy).toHaveBeenCalledTimes(1);
    expect(pistesCachedSpy.mock.calls[0]?.[0]).toBe(sh);
    expect(pistesCachedSpy.mock.calls[0]?.[1]?.range).toEqual({
      from: '2026-06-01',
      to: '2026-06-30',
    });
    const html = renderSpy.mock.calls[0]?.[0] ?? '';
    expect(html).toContain('Corps IA du créneau faible.');
    expect(html).toContain('Repérez vos angles morts'); // the FIXED title stays either way
    expect(html).not.toContain('<div class="piste-body wait">À venir</div>'); // the wait state is displaced
  });

  it('a pistes-seam failure never fails the render — 200 with Piste 02 « À venir » (US-P.10)', async () => {
    const me = await seedUser();
    const sh = await seedScreenhost(me);
    mockSession(me);
    pistesCachedSpy.mockRejectedValue(new Error('anthropic exploded'));
    const res = await report(sh, 'from=2026-06-01&to=2026-06-30');
    expect(res.statusCode).toBe(200);
    const html = renderSpy.mock.calls[0]?.[0] ?? '';
    // US-P.10 — the fallback is an explicit wait state, never generic prose.
    expect(html).toContain('<div class="piste-body wait">À venir</div>');
    expect(html).not.toContain('Comparez vos créneaux les plus forts');
  });
});
