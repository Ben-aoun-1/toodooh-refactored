import { randomUUID } from 'node:crypto';

import Fastify, { type FastifyInstance } from 'fastify';

import { env } from './env.js';
import { buildErrorHandler, buildNotFoundHandler } from './error-handler.js';
import { buildLoggerConfig } from './logger.js';
import { healthRoute } from './routes/health.js';

const app: FastifyInstance = Fastify({
  logger: buildLoggerConfig(env),
  genReqId: () => randomUUID(),
  requestIdHeader: 'x-request-id',
  requestIdLogLabel: 'requestId',
});

app.setErrorHandler(buildErrorHandler(env));
app.setNotFoundHandler(buildNotFoundHandler());

const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
  app.log.info({ signal }, 'shutdown signal received');
  try {
    await app.close();
    process.exit(0);
  } catch {
    process.exit(1);
  }
};

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});
process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});

const start = async (): Promise<void> => {
  try {
    await app.register(healthRoute);
    await app.listen({ port: env.PORT, host: env.HOST });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

void start();
