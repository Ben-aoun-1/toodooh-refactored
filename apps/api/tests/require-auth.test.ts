import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db } from '../src/db/client.js';
import { requireAuth } from '../src/middleware/require-auth.js';

type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;

const buildApp = () => {
  const app = Fastify({ logger: false });
  app.get('/guarded', { preHandler: requireAuth }, (request) => ({ user: request.user }));
  return app;
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('requireAuth guard', () => {
  it('valid session → attaches request.user (id/role/status) and proceeds', async () => {
    vi.spyOn(auth.api, 'getSession').mockResolvedValue({
      session: {},
      user: { id: 'u-1', role: 'individual_owner', status: 'approved' },
    } as unknown as GetSessionResult);
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/guarded' });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ user: { id: string; role: string; status: string } }>().user).toEqual({
      id: 'u-1',
      role: 'individual_owner',
      status: 'approved',
    });
    await app.close();
  });

  it('no session → shaped 401, handler never runs', async () => {
    vi.spyOn(auth.api, 'getSession').mockResolvedValue(null);
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/guarded' });
    expect(res.statusCode).toBe(401);
    const body = res.json<{ error: string; message: string; statusCode: number }>();
    expect(body.error).toBe('UNAUTHENTICATED');
    expect(body.statusCode).toBe(401);
    await app.close();
  });

  it('defaults role/status when the session user omits them and NO users row exists', async () => {
    vi.spyOn(auth.api, 'getSession').mockResolvedValue({
      session: {},
      // A valid uuid with no users row — the MISSING-row data state keeps the defaults.
      user: { id: '00000000-0000-4000-8000-00000000a001' },
    } as unknown as GetSessionResult);
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/guarded' });
    expect(res.json<{ user: { role: string; status: string } }>().user).toMatchObject({
      role: 'advertiser',
      status: 'pending',
    });
    await app.close();
  });

  // AUTH1 force-throw pin — a DB failure during auth resolution is a LOUD 500, never a silently
  // degraded role (the old catch{} resolved owners/admins to 'advertiser'/'pending' on infra
  // failure — silent authz drift).
  it('a FAILING role/status resolution query is a 500 — never a silent advertiser/pending', async () => {
    vi.spyOn(auth.api, 'getSession').mockResolvedValue({
      session: {},
      user: { id: '00000000-0000-4000-8000-00000000a002' },
    } as unknown as GetSessionResult);
    vi.spyOn(db, 'select').mockImplementation(() => {
      throw new Error('auth1: users lookup lost its connection');
    });
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/guarded' });
    expect(res.statusCode).toBe(500);
    expect(res.json<{ user?: unknown }>().user).toBeUndefined(); // the handler never ran
    await app.close();
  });
});
