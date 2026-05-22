import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
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

  it('defaults role/status when the session user omits them', async () => {
    vi.spyOn(auth.api, 'getSession').mockResolvedValue({
      session: {},
      user: { id: 'u-2' },
    } as unknown as GetSessionResult);
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/guarded' });
    expect(res.json<{ user: { role: string; status: string } }>().user).toMatchObject({
      role: 'advertiser',
      status: 'pending',
    });
    await app.close();
  });
});
