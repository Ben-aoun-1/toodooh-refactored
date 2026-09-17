import { randomUUID } from 'node:crypto';

import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';

import { authPlugin } from './auth/plugin.js';
import { db, sql } from './db/client.js';
import { env } from './env.js';
import { buildErrorHandler, buildNotFoundHandler } from './error-handler.js';
import { startCampaignLifecycleJob } from './lib/campaign-lifecycle.js';
import { startCampaignRedispatchJob } from './lib/campaign-redispatch.js';
import { startBlocPushJob } from './lib/event-playout/bloc-pusher.js';
import { startEventSettlementJob } from './lib/event-playout/settlement.js';
import { isMediaProbeEnabled } from './lib/media-probe.js';
import { startMonthlyBillingJob } from './lib/monthly-billing.js';
import { startMonthlyReportJob } from './lib/report/monthly-job.js';
import { isRecommendationsEnabled } from './lib/report/recommendations.js';
import { startSpsRecomputeJob } from './lib/sps-score.js';
import { isSyncEnabled, sweepUnexported } from './lib/wedooh-sync.js';
import { buildLoggerConfig } from './logger.js';
import { healthRoute } from './routes/health.js';
import { apiRoutes } from './routes/index.js';
import { screenWsRoutes } from './routes/screen-ws.js';
import { closeAllSandboxes, evictIdleSandboxes } from './simulator/pools.js';
import { sweepOrphans } from './simulator/provisioning.js';
import { upgradeReadySandboxes } from './simulator/upgrade.js';
import { storage } from './storage/s3-storage.js';

const app: FastifyInstance = Fastify({
  logger: buildLoggerConfig(env),
  genReqId: () => randomUUID(),
  requestIdHeader: 'x-request-id',
  requestIdLogLabel: 'requestId',
});

app.decorate('db', db);
app.addHook('onClose', async () => {
  await closeAllSandboxes();
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
    // CF-S1 — upcoming→active→completed transitions (+ the J-3 draft reminder rides this tick).
    startCampaignLifecycleJob(app.log);
    // E6 — the rattrapage tick (detect manquements on ACTIVE campaigns → re-place forward while
    // the total ≥ S_min). AFTER the lifecycle job: a campaign flipped active this hour gets its
    // first redispatch look in the same boot sequence.
    startCampaignRedispatchJob(app.log);
    // FCT2 — month-end billing: the monthly consolidated invoices (proof-verified consumption)
    // + the venue relevés de reversement, previous CLOSED Tunis month, UNIQUE-idempotent.
    startMonthlyBillingJob(app.log);
    // E4 — the SPS daily sweep (boot run + 24 h interval): every active venue's score computed
    // from the four ruled variables and written to screenhosts.sps (the value dispatch ordering
    // reads). The flat-50 era ends on the first boot after this deploys.
    startSpsRecomputeJob(app.log);
    // EV5 — the event bloc pusher (per-minute): an event spot must appear on the venue's playlist
    // AT its bloc start and disappear at its bloc end, without waiting for a reconnect.
    startBlocPushJob(app.log);
    // EV5 — the event settlement sweep (boot + hourly): once a diffusion window closes, measure
    // every (venue, bloc) on the dual proof and refund the undelivered chargeable value. AFTER
    // the pusher so a window that closed during downtime settles in the same boot sequence.
    startEventSettlementJob(app.log);

    // SIM-0 — the admin Simulateur. Enabled: drop orphan sandbox databases once at boot and
    // evict idle sandbox pools every 5 min (unref'd). Disabled: ONE boot line, nothing else.
    // CPM-1 — after the sweep, migrate every ready sandbox to this deploy's schema (a sweep
    // failure does not skip it; a route opening a sandbox first awaits the same upgrade).
    if (env.SIMULATOR_ENABLED) {
      app.log.info({ max: env.SIMULATOR_MAX_SANDBOXES }, 'simulator enabled');
      void sweepOrphans(app.log)
        .catch((err: unknown) => app.log.warn({ err }, 'simulator: boot orphan sweep failed'))
        .then(() => upgradeReadySandboxes(app.log))
        .catch((err: unknown) => app.log.warn({ err }, 'simulator: boot sandbox upgrade failed'));
      const evictTimer = setInterval(
        () => {
          void evictIdleSandboxes().catch((err: unknown) =>
            app.log.warn({ err }, 'simulator: idle eviction failed'),
          );
        },
        5 * 60 * 1000,
      );
      evictTimer.unref();
    } else {
      app.log.info('simulator disabled (SIMULATOR_ENABLED unset)');
    }

    // R2 — AI report recommendations: ONE boot warning when the key is unprovisioned (the
    // wedooh-sync degradation pattern); every report gracefully keeps the generic pistes.
    if (!isRecommendationsEnabled()) {
      app.log.warn('AI report recommendations disabled (ANTHROPIC_API_KEY unset) — generic pistes');
    }

    // CF-SH1 — ONE boot warning when ffprobe is unprovisioned (dev without ffmpeg): byte-sniffing
    // still applies, but the measured codec/ratio/duration checks skip. The docker image always
    // sets FFPROBE_PATH — degradation is a dev-only posture, never a silent prod skip.
    if (!isMediaProbeEnabled()) {
      app.log.warn(
        'media probe disabled (FFPROBE_PATH unset) — upload codec/ratio/duration checks skip; byte-sniffing still applies',
      );
    }
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

void start();
