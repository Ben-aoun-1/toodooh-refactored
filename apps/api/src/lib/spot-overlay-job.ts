import { and, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';

import { db } from '../db/client.js';
import { campaigns, creatives } from '../db/schema.js';
import { env } from '../env.js';
import { storage } from '../storage/s3-storage.js';

import { pushPlaylistToCampaignVenues } from './playout/push.js';
import { airedCreativeTypeSql, airedStorageKeySql, ctaAirableSql } from './spot-cta.js';
import {
  OverlayTranscodeError,
  type OverlayTranscoder,
  overlayKeyFor,
  overlayRegistry,
  transcodeOverlay,
} from './spot-overlay.js';

// OVL-LIGHT — makes the light surimpression copies (lib/spot-overlay.ts) of every spot that can air
// soon: upcoming or active campaigns, approved creative, aired as a VIDEO (a photo is cheap to show
// and needs none). ONE transcode at a time (CPU on the VPS, like the QR burns); a 30 s sweep. A copy
// found in storage (after a restart) is known without re-encoding. Once a copy exists the
// campaign's venues are re-pushed so their TVs learn the overlay_url.

const AIRING_STATUSES = ['upcoming', 'active'] as const;

/** The aired sources that could need a light copy, one row per distinct key. */
const airingSources = async () =>
  db
    .selectDistinctOn([airedStorageKeySql()], {
      campaignId: campaigns.id,
      airedKey: airedStorageKeySql(),
    })
    .from(campaigns)
    .innerJoin(creatives, eq(creatives.id, campaigns.creativeId))
    .where(
      and(
        inArray(campaigns.status, [...AIRING_STATUSES]),
        eq(creatives.validationStatus, 'approved'),
        ctaAirableSql(),
        sql`${airedCreativeTypeSql()} = 'video'`,
      ),
    );

/**
 * One pass: learns the copies already stored, then makes at most ONE missing copy. Returns the
 * campaign id whose copy was made (or found new), or null when nothing was missing.
 */
export const makeNextOverlay = async (
  transcode: OverlayTranscoder = transcodeOverlay,
  log?: FastifyBaseLogger,
): Promise<string | null> => {
  for (const source of await airingSources()) {
    const key = overlayKeyFor(source.airedKey);
    if (overlayRegistry.isReady(key) || overlayRegistry.isFailed(key)) continue;
    const stored = await storage.exists({ key });
    if (stored === null) continue; // storage hiccup: next sweep
    if (stored) {
      overlayRegistry.markReady(key);
      continue;
    }
    try {
      const src = await storage.download({ key: source.airedKey });
      if ('error' in src) throw new OverlayTranscodeError(`download: ${src.error}`);
      const light = await transcode(src.body);
      const up = await storage.upload({ key, body: light, contentType: 'video/mp4' });
      if ('error' in up) throw new OverlayTranscodeError(`upload: ${up.error}`);
      overlayRegistry.markReady(key);
      log?.info(
        { campaignId: source.campaignId, key, bytes: light.length },
        'light overlay copy made',
      );
      await pushPlaylistToCampaignVenues(source.campaignId, log).catch((err: unknown) =>
        log?.warn({ err }, 'overlay playlist push failed'),
      );
      return source.campaignId;
    } catch (err) {
      overlayRegistry.markFailed(key);
      log?.warn(
        { err, campaignId: source.campaignId },
        'light overlay copy failed — the full spot still airs',
      );
      return source.campaignId;
    }
  }
  return null;
};

let running = false;

/** One sweep: makes the missing copies one after the other (bounded). */
export const runOverlayTick = async (
  transcode: OverlayTranscoder = transcodeOverlay,
  log?: FastifyBaseLogger,
  max = 10,
): Promise<number> => {
  let n = 0;
  while (n < max && (await makeNextOverlay(transcode, log)) !== null) n += 1;
  return n;
};

/** Boot + 30 s unref'd sweep. Without ffmpeg (dev, tests) nothing runs: TVs play the full spot. */
export function startOverlayJob(log: FastifyBaseLogger): void {
  if (!env.FFMPEG_PATH) return;
  const tick = () => {
    if (running) return;
    running = true;
    void runOverlayTick(transcodeOverlay, log)
      .catch((err: unknown) => log.warn({ err }, 'overlay sweep failed'))
      .finally(() => {
        running = false;
      });
  };
  tick();
  const timer = setInterval(tick, 30_000);
  timer.unref();
}
