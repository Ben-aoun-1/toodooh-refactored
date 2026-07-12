import { randomUUID } from 'node:crypto';

import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';

import { authPlugin } from './auth/plugin.js';
import { db, sql } from './db/client.js';
import { env } from './env.js';
import { buildErrorHandler, buildNotFoundHandler } from './error-handler.js';
import { startMonthlyReportJob } from './lib/report/monthly-job.js';
import { isRecommendationsEnabled } from './lib/report/recommendations.js';
import { isSyncEnabled, sweepUnexported } from './lib/wedooh-sync.js';
import { buildLoggerConfig } from './logger.js';
import { healthRoute } from './routes/health.js';
import { apiRoutes } from './routes/index.js';
import { screenWsRoutes } from './routes/screen-ws.js';
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
    // L-playout — raw screen WebSocket (/ws/screen). Self-registers @fastify/websocket.
    await app.register(screenWsRoutes);
    // Pre-create the storage bucket so the first document upload doesn't pay the
    // head-then-create round-trip. Non-fatal: if storage is briefly unreachable at boot,
    // the api still serves; the retry-safe lazy path re-attempts on the first upload.
    await storage.ensureReady().catch((err: unknown) => {
      app.log.warn({ err }, 'storage ensure-bucket at boot failed; will retry on first upload');
    });
    await app.listen({ port: env.PORT, host: env.HOST });

    // S-T1 B2 — re-push any pending/failed approved screenhosts to wedooh at boot, then every
    // 10 min (unref'd so it never holds the process open). No-op + a single warn when unset.
    if (isSyncEnabled()) {
      void sweepUnexported(app.log).catch((err: unknown) =>
        app.log.warn({ err }, 'wedooh B2 boot sweep failed'),
      );
      const sweepTimer = setInterval(
        () => {
          void sweepUnexported(app.log).catch((err: unknown) =>
            app.log.warn({ err }, 'wedooh B2 sweep failed'),
          );
        },
        10 * 60 * 1000,
      );
      sweepTimer.unref();
    } else {
      app.log.warn('wedooh B2 sync disabled (WEDOOH_INGEST_URL / TOODOOH_SYNC_KEY unset)');
    }

    // R1 — month-end report job: boot sweep + hourly unref'd interval (the sweepUnexported
    // pattern, no cron dependency). Generates + stores the previous CLOSED month's PDF per venue
    // with data, once (UNIQUE lock), and notifies the owner. No chromium → warns and no-ops.
    startMonthlyReportJob(app.log);

    // R2 — AI report recommendations: ONE boot warning when the key is unprovisioned (the
    // wedooh-sync degradation pattern); every report gracefully keeps the generic pistes.
    if (!isRecommendationsEnabled()) {
      app.log.warn('AI report recommendations disabled (ANTHROPIC_API_KEY unset) — generic pistes');
    }
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

void start();
