import { sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

const responseSchema = {
  type: 'object',
  required: ['status', 'uptime', 'timestamp', 'checks'],
  properties: {
    status: { type: 'string', enum: ['ok', 'degraded'] },
    uptime: { type: 'number' },
    timestamp: { type: 'string', format: 'date-time' },
    checks: {
      type: 'object',
      required: ['db'],
      properties: { db: { type: 'string', enum: ['ok', 'error'] } },
    },
  },
} as const;

export const healthRoute: FastifyPluginAsync = async (app) => {
  app.get('/health', { schema: { response: { 200: responseSchema } } }, async (request) => {
    let dbStatus: 'ok' | 'error' = 'ok';
    try {
      await app.db.execute(sql`select 1`);
    } catch (err) {
      dbStatus = 'error';
      request.log.error({ err }, 'health: db ping failed');
    }
    return {
      status: dbStatus === 'ok' ? ('ok' as const) : ('degraded' as const),
      uptime: Math.round(process.uptime() * 10) / 10,
      timestamp: new Date().toISOString(),
      checks: { db: dbStatus },
    };
  });
};
