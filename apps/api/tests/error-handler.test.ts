import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { buildErrorHandler, buildNotFoundHandler } from '../src/error-handler.js';

const buildApp = (nodeEnv: 'development' | 'production') => {
  const app = Fastify({ logger: false });
  app.setErrorHandler(
    buildErrorHandler({
      NODE_ENV: nodeEnv,
      PORT: 4000,
      HOST: '0.0.0.0',
      LOG_LEVEL: 'error',
      DATABASE_URL: 'postgresql://test:test@localhost:5432/test_db',
      AUTH_SECRET: 'test-auth-secret-at-least-32-characters-long',
    }),
  );
  app.setNotFoundHandler(buildNotFoundHandler());
  app.get('/boom', async () => {
    throw new Error('boom detail');
  });
  return app;
};

describe('error handler', () => {
  let app: ReturnType<typeof buildApp> | undefined;

  afterEach(async () => {
    if (app) await app.close();
    app = undefined;
  });

  it('returns shaped JSON with x-request-id header in dev', async () => {
    app = buildApp('development');
    const response = await app.inject({ method: 'GET', url: '/boom' });
    expect(response.statusCode).toBe(500);
    expect(response.headers['x-request-id']).toBeTruthy();
    const body = response.json<{
      error: string;
      message: string;
      statusCode: number;
      requestId: string;
    }>();
    expect(body.statusCode).toBe(500);
    expect(body.message).toBe('boom detail');
    expect(body.requestId).toBe(response.headers['x-request-id']);
  });

  it('scrubs 5xx message in production', async () => {
    app = buildApp('production');
    const response = await app.inject({ method: 'GET', url: '/boom' });
    expect(response.statusCode).toBe(500);
    const body = response.json<{ message: string }>();
    expect(body.message).toBe('Internal Server Error');
    expect(body.message).not.toContain('boom detail');
  });

  it('routes 404 through the not-found handler with shaped JSON', async () => {
    app = buildApp('development');
    const response = await app.inject({ method: 'GET', url: '/no-such-route' });
    expect(response.statusCode).toBe(404);
    expect(response.headers['x-request-id']).toBeTruthy();
    const body = response.json<{
      error: string;
      message: string;
      statusCode: number;
      requestId: string;
    }>();
    expect(body.error).toBe('Not Found');
    expect(body.message).toContain('/no-such-route');
    expect(body.statusCode).toBe(404);
    expect(body.requestId).toBe(response.headers['x-request-id']);
  });
});
