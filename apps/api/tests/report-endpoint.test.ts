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

  it('400 on malformed, reversed or over-400-day ranges', async () => {
    const me = await seedUser();
    const sh = await seedScreenhost(me);
    mockSession(me);
    expect((await report(sh, 'from=juin&to=2026-06-30')).statusCode).toBe(400);
    expect((await report(sh, 'from=2026-06-30&to=2026-06-01')).statusCode).toBe(400);
    expect((await report(sh, 'from=2025-01-01&to=2026-06-30')).statusCode).toBe(400);
  });

  it('streams the rendered PDF for the owner (live render, ephemeral)', async () => {
    const me = await seedUser();
    const sh = await seedScreenhost(me);
    mockSession(me);
    const res = await report(sh, 'from=2026-06-01&to=2026-06-30');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['content-disposition']).toContain('rapport-2026-06-01_2026-06-30.pdf');
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
});
