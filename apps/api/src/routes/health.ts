import type { FastifyPluginAsync } from 'fastify';

const responseSchema = {
  type: 'object',
  required: ['status', 'uptime', 'timestamp'],
  properties: {
    status: { type: 'string', enum: ['ok'] },
    uptime: { type: 'number' },
    timestamp: { type: 'string', format: 'date-time' },
  },
} as const;

export const healthRoute: FastifyPluginAsync = async (app) => {
  app.get('/health', { schema: { response: { 200: responseSchema } } }, async () => ({
    status: 'ok' as const,
    uptime: Math.round(process.uptime() * 10) / 10,
    timestamp: new Date().toISOString(),
  }));
};
