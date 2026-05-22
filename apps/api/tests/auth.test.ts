import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { authPlugin } from '../src/auth/plugin.js';

// All tests here are DB-free: better-auth construction, plugin registration, and
// get-session-without-cookie do not query the database (CI has no Postgres).

const buildAuthApp = () => {
  const app = Fastify({ logger: false });
  return app;
};

describe('better-auth integration', () => {
  let app: ReturnType<typeof buildAuthApp> | undefined;

  afterEach(async () => {
    if (app) await app.close();
    app = undefined;
    vi.restoreAllMocks();
  });

  it('constructs the auth instance with a request handler', () => {
    expect(auth).toBeDefined();
    expect(typeof auth.handler).toBe('function');
  });

  it('registers the auth plugin without throwing', async () => {
    app = buildAuthApp();
    await app.register(authPlugin);
    await expect(app.ready()).resolves.toBeDefined();
  });

  it('mounts GET /auth/get-session (route exists, not a 404)', async () => {
    app = buildAuthApp();
    await app.register(authPlugin);
    const response = await app.inject({ method: 'GET', url: '/auth/get-session' });
    expect(response.statusCode).not.toBe(404);
  });

  it('the /auth/* catch-all takes precedence over the Fastify 404 path', async () => {
    app = buildAuthApp();
    app.setNotFoundHandler((_request, reply) => {
      void reply.status(404).send({ marker: 'fastify-not-found' });
    });
    await app.register(authPlugin);
    const outside = await app.inject({ method: 'GET', url: '/nope' });
    const inAuth = await app.inject({ method: 'GET', url: '/auth/get-session' });
    // /nope falls through to the Fastify not-found handler …
    expect(outside.json()).toEqual({ marker: 'fastify-not-found' });
    // … but /auth/* is intercepted by the catch-all, not the 404 handler.
    expect(inAuth.json()).not.toEqual({ marker: 'fastify-not-found' });
  });
});
