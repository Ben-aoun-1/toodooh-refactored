import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import type { DrizzleDb } from '../src/db/client.js';
import { healthRoute } from '../src/routes/health.js';

const buildApp = (execute: () => Promise<unknown>) => {
  const app = Fastify({ logger: false });
  app.decorate('db', { execute } as unknown as DrizzleDb);
  return app;
};

describe('GET /health', () => {
  let app: ReturnType<typeof buildApp> | undefined;

  afterEach(async () => {
    if (app) await app.close();
    app = undefined;
  });

  it('returns 200 ok when db ping succeeds', async () => {
    app = buildApp(async () => [{ '?column?': 1 }]);
    await app.register(healthRoute);
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    const body = response.json<{
      status: string;
      uptime: number;
      timestamp: string;
      checks: { db: string };
    }>();
    expect(body.status).toBe('ok');
    expect(body.checks.db).toBe('ok');
    expect(typeof body.uptime).toBe('number');
  });

  it('returns 200 degraded when db ping fails', async () => {
    app = buildApp(async () => {
      throw new Error('db down');
    });
    await app.register(healthRoute);
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ status: string; checks: { db: string } }>();
    expect(body.status).toBe('degraded');
    expect(body.checks.db).toBe('error');
  });
});
