import { and, asc, eq, isNotNull, or, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';

import { db } from '../db/client.js';
import { campaigns, creatives } from '../db/schema.js';
import { env } from '../env.js';
import { storage } from '../storage/s3-storage.js';

import { pushPlaylistToCampaignVenues } from './playout/push.js';
import { CtaBurnError, type CtaBurner, burnCtaIntoSpot } from './spot-cta-burn.js';
import { ctaDrawnLabel, ctaScanUrl } from './spot-cta.js';

// QR-CTA1 — makes the QR copies. A campaign needs one when it has a link and a creative, and its
// copy is pending or was made from another creative (the screencaster changed the spot). ONE burn
// at a time in this process (ffmpeg re-encodes are CPU-heavy on the VPS): a save kicks the queue
// (kickCtaBurns) and a 30 s sweep picks up anything left (a restart mid-burn, a kick while busy).
// A failure is stamped `failed` for THAT creative and is not retried on its own — the screencaster
// re-saves the link or changes the spot; the cart refuses the campaign meanwhile (SPOT_QR_FAILED).

const needsBurnSql = () =>
  and(
    isNotNull(campaigns.ctaUrl),
    isNotNull(campaigns.ctaCode),
    isNotNull(campaigns.creativeId),
    or(
      eq(campaigns.ctaStatus, 'pending'),
      sql`${campaigns.ctaSourceCreativeId} IS DISTINCT FROM ${campaigns.creativeId}`,
    ),
  );

/** Burns ONE pending copy; returns its campaign id, or null when nothing is pending. */
export const burnNextCta = async (
  burn: CtaBurner = burnCtaIntoSpot,
  log?: FastifyBaseLogger,
): Promise<string | null> => {
  const [next] = await db
    .select({
      id: campaigns.id,
      advertiserId: campaigns.advertiserId,
      status: campaigns.status,
      ctaUrl: campaigns.ctaUrl,
      ctaLabel: campaigns.ctaLabel,
      ctaCode: campaigns.ctaCode,
      oldKey: campaigns.ctaStorageKey,
      creativeId: creatives.id,
      storageKey: creatives.storageKey,
      creativeType: creatives.creativeType,
      mimeType: creatives.mimeType,
    })
    .from(campaigns)
    .innerJoin(creatives, eq(creatives.id, campaigns.creativeId))
    .where(needsBurnSql())
    .orderBy(asc(campaigns.updatedAt))
    .limit(1);
  if (!next?.ctaCode || !next.ctaUrl) return null;

  const fail = async (reason: string) => {
    log?.warn({ campaignId: next.id, reason }, 'spot QR burn failed');
    await db
      .update(campaigns)
      .set({
        ctaStatus: 'failed',
        ctaError: reason.slice(0, 500),
        ctaSourceCreativeId: next.creativeId,
      })
      .where(and(eq(campaigns.id, next.id), eq(campaigns.creativeId, next.creativeId)));
  };

  const source = await storage.download({ key: next.storageKey });
  if ('error' in source) {
    await fail(`SPOT_DOWNLOAD_FAILED ${source.error}`);
    return next.id;
  }
  let burned;
  try {
    burned = await burn({
      bytes: source.body,
      kind: next.creativeType === 'photo' ? 'photo' : 'video',
      mimeType: next.mimeType,
      qrUrl: ctaScanUrl(env.CTA_PUBLIC_BASE_URL, next.ctaCode),
      label: ctaDrawnLabel(next.ctaLabel),
    });
  } catch (err) {
    await fail(err instanceof CtaBurnError ? err.message : 'BURN_FAILED');
    return next.id;
  }
  const key = `creatives/${next.advertiserId}/${next.creativeId}-qr-${next.id}-${Date.now()}.${burned.extension}`;
  const uploaded = await storage.upload({
    key,
    body: burned.bytes,
    contentType: burned.contentType,
  });
  if ('error' in uploaded) {
    await fail(`COPY_UPLOAD_FAILED ${uploaded.error}`);
    return next.id;
  }
  // Only if the campaign still links the same creative and the same link (an edit during the burn
  // re-queues it instead of landing a stale copy).
  const done = await db
    .update(campaigns)
    .set({
      ctaStatus: 'ready',
      ctaStorageKey: key,
      ctaSourceCreativeId: next.creativeId,
      ctaError: null,
    })
    .where(
      and(
        eq(campaigns.id, next.id),
        eq(campaigns.creativeId, next.creativeId),
        eq(campaigns.ctaUrl, next.ctaUrl),
        eq(campaigns.ctaCode, next.ctaCode),
        sql`${campaigns.ctaLabel} IS NOT DISTINCT FROM ${next.ctaLabel}`,
      ),
    )
    .returning({ id: campaigns.id });
  if (done.length === 0) {
    await storage.delete({ key });
    return next.id;
  }
  if (next.oldKey && next.oldKey !== key) await storage.delete({ key: next.oldKey });
  // A campaign already on air (a copy re-made while active) reaches the TVs now.
  if (next.status === 'active') await pushPlaylistToCampaignVenues(next.id, log);
  log?.info({ campaignId: next.id }, 'spot QR copy ready');
  return next.id;
};

/** Burns every pending copy, one after another. Returns how many were processed. */
export const runCtaBurnTick = async (
  burn: CtaBurner = burnCtaIntoSpot,
  log?: FastifyBaseLogger,
  max = 20,
): Promise<number> => {
  let n = 0;
  while (n < max && (await burnNextCta(burn, log)) !== null) n += 1;
  return n;
};

let running = false;
let again = false;

/** Fire-and-forget: start burning now (a save of a link); a kick while busy runs once more after. */
export function kickCtaBurns(log?: FastifyBaseLogger): void {
  // No ffmpeg (a dev machine, the test suite): copies stay pending — server.ts warns once at boot.
  if (!env.FFMPEG_PATH) return;
  if (running) {
    again = true;
    return;
  }
  running = true;
  void (async () => {
    try {
      do {
        again = false;
        await runCtaBurnTick(burnCtaIntoSpot, log);
      } while (again);
    } catch (err) {
      log?.warn({ err }, 'spot QR burn tick failed');
    } finally {
      running = false;
    }
  })();
}

/** Boot + 30 s unref'd sweep. */
export function startCtaBurnJob(log: FastifyBaseLogger): void {
  kickCtaBurns(log);
  const timer = setInterval(() => kickCtaBurns(log), 30_000);
  timer.unref();
}
