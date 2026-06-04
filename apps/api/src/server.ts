import { randomUUID } from 'node:crypto';

import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';

import { authPlugin } from './auth/plugin.js';
import { db, sql } from './db/client.js';
import { env } from './env.js';
import { buildErrorHandler, buildNotFoundHandler } from './error-handler.js';
import { buildLoggerConfig } from './logger.js';
import { healthRoute } from './routes/health.js';
import { apiRoutes } from './routes/index.js';
import { storage } from './storage/s3-storage.js';

const app: FastifyInstance = Fastify({
  logger: buildLoggerConfig(env),
  genReqId: () => randomUUID(),
  requestIdHeader: 'x-request-id',
  requestIdLogLabel: 'requestId',
});

app.decorate('db', db);
app.addHook('onClose', async () => {
  await sql.end();
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
    // Registered first; fastify-plugin-wrapped so it applies app-wide. The same-origin
    // proxy makes this near-moot for the browser, but it future-proofs non-proxied
    // callers (player-api). Credentialed → explicit origin, never '*'.
    await app.register(cors, { origin: env.WEB_ORIGIN, credentials: true });
    await app.register(authPlugin);
    await app.register(apiRoutes);
    await app.register(healthRoute);
    // Pre-create the storage bucket so the first document upload doesn't pay the
    // head-then-create round-trip. Non-fatal: if storage is briefly unreachable at boot,
    // the api still serves; the retry-safe lazy path re-attempts on the first upload.
    await storage.ensureReady().catch((err: unknown) => {
      app.log.warn({ err }, 'storage ensure-bucket at boot failed; will retry on first upload');
    });
    await app.listen({ port: env.PORT, host: env.HOST });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

void start();
