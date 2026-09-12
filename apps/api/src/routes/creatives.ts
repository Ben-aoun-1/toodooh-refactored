import { randomUUID } from 'node:crypto';

import multipart from '@fastify/multipart';
import { and, desc, eq } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';

import { db } from '../db/client.js';
import { creatives } from '../db/schema.js';
import { accountLabel, notifyAdmins } from '../lib/admin-notifications.js';
import {
  findInheritableApproval,
  hashCreativeBytes,
  inheritedApprovalNote,
} from '../lib/creative-identity.js';
import {
  MAX_CREATIVE_BYTES,
  MAX_VIDEO_DURATION_SECONDS,
  creativeView,
  isValidDuration,
  mimeAllowedForKind,
} from '../lib/creatives.js';
import { validateEventSpot } from '../lib/event-pricing/spot.js';
import {
  MediaProbeError,
  REQUIRED_VIDEO_CODEC,
  declaredMatchesSniffed,
  isMediaProbeEnabled,
  isRatioConforming,
  probeMedia,
  sniffContainer,
} from '../lib/media-probe.js';
import { requireAdvertiser } from '../middleware/require-advertiser.js';
import { requireAuth } from '../middleware/require-auth.js';
import { storage } from '../storage/s3-storage.js';

// Advertiser creative library (L-spot) — greenfield. An advertiser uploads a VIDEO or PHOTO
// creative; the object lands in MinIO under creatives/<advertiserId>/<creativeId> (the KEY is
// persisted, presigned on read — never a stored URL). storage-first / no-orphan: the row is written
// ONLY on a genuine storage success. Every read is owner-scoped to the authenticated advertiser
// (a foreign id is indistinguishable from a missing one → 404, never a leak). Admin moderation +
// the campaign's DERIVED content-gate live in routes/admin-creatives.ts + routes/campaigns.ts.

const idParamSchema = z.object({ id: z.uuid() });

// Scalars ride the querystring (the multipart body stays file-only, fields:0 — the house pattern
// from profile-documents). type + duration_seconds are required; title is optional.
const uploadQuerySchema = z.object({
  type: z.enum(['video', 'photo']),
  duration_seconds: z.coerce.number().int(),
  title: z.string().min(1).max(200).optional(),
  // EV3 — the parcours declares an event upload: the 15-second spot cap applies at upload time
  // (in addition to the attach-time guard — a refused spot never even stores).
  for_event: z.enum(['1', 'true']).optional(),
});

const sendUnauthenticated = (reply: FastifyReply) =>
  reply.status(401).send({ error: 'UNAUTHENTICATED', message: 'Authentification requise.' });

const invalidField = (reply: FastifyReply, field: string, reason: string) =>
  reply
    .status(400)
    .send({ error: 'INVALID_INPUT', message: 'Validation échouée', fields: [{ field, reason }] });

export const creativesRoutes: FastifyPluginAsync = async (app) => {
  // Framework-level guard: busboy stops at fileSize, so an oversized upload is never fully buffered.
  await app.register(multipart, {
    limits: { fileSize: MAX_CREATIVE_BYTES, files: 1, fields: 0 },
  });

  const advertiserGuard = { preHandler: [requireAuth, requireAdvertiser] };

  // POST /api/creatives?type=video&duration_seconds=25[&title=] — single-file multipart upload.
  // The row is written ONLY on a genuine storage success (no orphan key references).
  app.post('/api/creatives', advertiserGuard, async (request, reply) => {
    const parsedQuery = uploadQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation échouée',
        fields: parsedQuery.error.issues.map((i) => ({
          field: i.path.join('.'),
          reason: i.message,
        })),
      });
    }
    const { type, duration_seconds: durationSeconds, title } = parsedQuery.data;

    // Duration bound (server-side, on the stored value): video ≤ 30s; photo ∈ {10,20,30}.
    if (!isValidDuration(type, durationSeconds)) {
      return invalidField(
        reply,
        'duration_seconds',
        type === 'video'
          ? 'a video creative must be 1-30 seconds'
          : 'a photo creative duration must be 10, 20 or 30 seconds',
      );
    }

    const userId = request.user?.id;
    if (!userId) return sendUnauthenticated(reply);

    const data = await request.file();
    if (!data) return invalidField(reply, 'file', 'a file is required');

    // Drain the stream BEFORE MIME validation — avoids a hung request. The fileSize limit makes
    // toBuffer throw (throwFileSizeLimit default) on oversize → 413.
    let body: Buffer;
    try {
      body = await data.toBuffer();
    } catch {
      return reply.status(413).send({
        error: 'PAYLOAD_TOO_LARGE',
        message: `Le fichier dépasse la limite de ${MAX_CREATIVE_BYTES} octets.`,
      });
    }
    if (data.file.truncated) {
      return reply.status(413).send({
        error: 'PAYLOAD_TOO_LARGE',
        message: `Le fichier dépasse la limite de ${MAX_CREATIVE_BYTES} octets.`,
      });
    }
    if (!mimeAllowedForKind(type, data.mimetype)) {
      return invalidField(
        reply,
        'file',
        `unsupported content type for a ${type} creative: ${data.mimetype}`,
      );
    }

    // ── CF-SH1 (spec §1.6) — authoritative validation for NEW uploads only ──────────────────────
    // Existing rows are GRANDFATHERED: none of this runs anywhere but here.
    // Layer 1 (always on): the declared mimetype must match what the bytes actually are.
    const sniffed = sniffContainer(body);
    if (!declaredMatchesSniffed(data.mimetype, sniffed)) {
      return reply.status(400).send({
        error: 'MEDIA_TYPE_MISMATCH',
        message: `The file's bytes do not match the declared content type (declared ${data.mimetype}, detected ${sniffed ?? 'unrecognized'}).`,
        declared: data.mimetype,
        detected: sniffed,
      });
    }
    // Layer 2 (FFPROBE_PATH-gated, the chromium-smoke posture): measured codec/ratio/duration.
    // The SERVER-measured duration becomes the stored value; the client param is advisory.
    let storedDurationSeconds = durationSeconds;
    if (type === 'video' && isMediaProbeEnabled()) {
      let probed;
      try {
        probed = await probeMedia(body);
      } catch (err) {
        if (err instanceof MediaProbeError) {
          return reply.status(400).send({
            error: 'MEDIA_UNREADABLE',
            message: 'The video stream could not be read. Upload a valid MP4/MOV (H.264).',
          });
        }
        throw err;
      }
      if (probed.codec !== REQUIRED_VIDEO_CODEC) {
        return reply.status(400).send({
          error: 'MEDIA_FORMAT_UNSUPPORTED',
          message: `A video creative must be H.264 (measured codec: ${probed.codec ?? 'none'}).`,
          measured_codec: probed.codec,
        });
      }
      if (
        probed.width === null ||
        probed.height === null ||
        !isRatioConforming(probed.width, probed.height)
      ) {
        const measured =
          probed.width !== null && probed.height !== null && probed.height > 0
            ? Number((probed.width / probed.height).toFixed(3))
            : null;
        return reply.status(400).send({
          error: 'MEDIA_RATIO_INVALID',
          message: `A video creative must be 16:9 within ±2% (measured: ${measured ?? 'unknown'}${probed.width !== null && probed.height !== null ? ` — ${probed.width}×${probed.height}` : ''}).`,
          measured_ratio: measured,
          width: probed.width,
          height: probed.height,
        });
      }
      if (probed.durationSeconds === null) {
        return reply.status(400).send({
          error: 'MEDIA_UNREADABLE',
          message: 'The video duration could not be measured. Upload a valid MP4/MOV (H.264).',
        });
      }
      const measuredDuration = Math.max(1, Math.ceil(probed.durationSeconds));
      if (measuredDuration > MAX_VIDEO_DURATION_SECONDS) {
        return reply.status(400).send({
          error: 'MEDIA_DURATION_INVALID',
          message: `A video creative must be at most ${MAX_VIDEO_DURATION_SECONDS} seconds (measured: ${measuredDuration}s).`,
          measured_duration_seconds: measuredDuration,
        });
      }
      storedDurationSeconds = measuredDuration;
    }

    // EV3 — the event-spot cap (EV2's seam), enforced at upload when the positioning parcours
    // declares it (?for_event=1): a video longer than 15 s can never air in a bloc, so refuse
    // BEFORE storing anything. Judged on the stored value (the server-measured duration when the
    // probe is on). Photos pass — their duration is a display cadence, not a media length.
    if (parsedQuery.data.for_event !== undefined) {
      const verdict = validateEventSpot({
        creativeType: type,
        durationSeconds: storedDurationSeconds,
      });
      if (!verdict.ok) {
        return reply.status(400).send({ error: 'EVENT_SPOT_TOO_LONG', message: verdict.reason });
      }
    }

    const creativeId = randomUUID();
    const key = `creatives/${userId}/${creativeId}`;

    const result = await storage.upload({ key, body, contentType: data.mimetype });
    if ('error' in result) {
      // Storage failed → do NOT touch the table. Advertiser retries; no orphan key reference.
      return reply.status(502).send({
        error: 'STORAGE_ERROR',
        message: 'Le stockage de la créative a échoué. Veuillez réessayer.',
      });
    }

    // CF-SK1 (ruling #9) — the spot's identity: same bytes + same owner + a prior APPROVED
    // creative ⇒ born approved (the admin already reviewed these exact frames), with the
    // inheritance recorded in the moderation trail. Anything else stays 'pending' as today.
    const fileHash = hashCreativeBytes(body);
    const inherited = await findInheritableApproval(userId, fileHash);

    const [row] = await db
      .insert(creatives)
      .values({
        id: creativeId,
        advertiserId: userId,
        creativeType: type,
        title: title ?? null,
        storageKey: key,
        durationSeconds: storedDurationSeconds,
        mimeType: data.mimetype,
        originalFilename: data.filename,
        sizeBytes: body.length,
        fileHash,
        ...(inherited
          ? {
              validationStatus: 'approved' as const,
              validatedAt: new Date(),
              validationNotes: inheritedApprovalNote(inherited.sourceCreativeId),
            }
          : {}),
      })
      .returning();
    if (!row) {
      return reply
        .status(500)
        .send({ error: 'INTERNAL_ERROR', message: "L'enregistrement de la créative a échoué." });
    }
    // ADM-BELL1 — a fresh (non-inherited) creative waits for moderation.
    if (!inherited) {
      await notifyAdmins(db, {
        type: 'admin_creative_pending',
        title: 'Nouveau contenu à modérer',
        body: `Un contenu ${type === 'video' ? 'vidéo' : 'photo'} de ${await accountLabel(userId)}${
          storedDurationSeconds ? ` (${storedDurationSeconds} s)` : ''
        } attend votre modération.`,
      }).catch((err: unknown) => request.log.warn({ err }, 'admin notice failed (creative)'));
    }
    return reply.status(201).send(creativeView(row));
  });

  // GET /api/creatives/mine — the caller's own creatives, newest first.
  app.get('/api/creatives/mine', advertiserGuard, async (request, reply) => {
    const userId = request.user?.id;
    if (!userId) return sendUnauthenticated(reply);
    const rows = await db
      .select()
      .from(creatives)
      .where(eq(creatives.advertiserId, userId))
      .orderBy(desc(creatives.createdAt));
    return reply.status(200).send(rows.map(creativeView));
  });

  // GET /api/creatives/:id — owner-scoped read (404 on a foreign or missing id).
  app.get('/api/creatives/:id', advertiserGuard, async (request, reply) => {
    const parsed = idParamSchema.safeParse(request.params);
    if (!parsed.success) return invalidField(reply, 'id', 'must be a uuid');
    const userId = request.user?.id;
    if (!userId) return sendUnauthenticated(reply);
    const [row] = await db
      .select()
      .from(creatives)
      .where(and(eq(creatives.id, parsed.data.id), eq(creatives.advertiserId, userId)))
      .limit(1);
    if (!row)
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Créative introuvable.' });
    return reply.status(200).send(creativeView(row));
  });

  // GET /api/creatives/:id/url — presign the object on demand (owner-scoped, 404 on foreign).
  app.get('/api/creatives/:id/url', advertiserGuard, async (request, reply) => {
    const parsed = idParamSchema.safeParse(request.params);
    if (!parsed.success) return invalidField(reply, 'id', 'must be a uuid');
    const userId = request.user?.id;
    if (!userId) return sendUnauthenticated(reply);
    const [row] = await db
      .select({ storageKey: creatives.storageKey })
      .from(creatives)
      .where(and(eq(creatives.id, parsed.data.id), eq(creatives.advertiserId, userId)))
      .limit(1);
    if (!row)
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Créative introuvable.' });
    const result = await storage.getPresignedUrl({ key: row.storageKey });
    if ('error' in result) {
      return reply.status(502).send({
        error: 'STORAGE_ERROR',
        message: "Impossible de générer l'URL de la créative. Veuillez réessayer.",
      });
    }
    return reply.status(200).send({ url: result.url });
  });
};
