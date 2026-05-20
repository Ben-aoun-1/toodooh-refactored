import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { healthRoute } from '../src/routes/health.js';

const app = Fastify({ logger: false });

beforeAll(async () => {
  await app.register(healthRoute);
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('GET /health', () => {
  it('returns 200 with status/uptime/timestamp', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ status: string; uptime: number; timestamp: string }>();
    expect(body.status).toBe('ok');
    expect(typeof body.uptime).toBe('number');
    expect(body.uptime).toBeGreaterThanOrEqual(0);
    expect(() => new Date(body.timestamp).toISOString()).not.toThrow();
  });
});
