import { sql } from 'drizzle-orm';

import { type Creative, creatives } from '../db/schema.js';

// Creative upload helpers (L-spot) shared by the advertiser upload route (routes/creatives.ts) and
// the admin moderation surface (routes/admin-creatives.ts). A creative is VIDEO or PHOTO; the
// duration rule comes from the screencaster WF spec: a VIDEO's length ≤ 30s, a PHOTO's chosen
// diffusion duration ∈ {10,20,30}s. Single source of truth so the two surfaces can't drift.

export type CreativeKind = 'video' | 'photo';

// MIME allowlists per kind — the uploaded file's content type must match the asserted creative_type.
// CF-SH1 (spec §1.6) — SPEC-STRICT for new uploads: video is MP4/MOV only (webm out), image is
// JPEG/PNG only (webp out). Existing rows with the old types are GRANDFATHERED — these lists gate
// the UPLOAD route only; reads/linking/moderation/playout of stored creatives never re-validate.
export const ALLOWED_VIDEO_MIME = new Set(['video/mp4', 'video/quicktime']);
export const ALLOWED_IMAGE_MIME = new Set(['image/jpeg', 'image/png']);

export const mimeAllowedForKind = (kind: CreativeKind, mime: string): boolean =>
  kind === 'video' ? ALLOWED_VIDEO_MIME.has(mime) : ALLOWED_IMAGE_MIME.has(mime);

// Size cap (multipart fileSize limit). 50 MB covers a ≤30s clip at a modest bitrate; photos sit far
// under it. One cap for both kinds (judgment call — flag if video needs a higher ceiling).
export const MAX_CREATIVE_BYTES = 50 * 1024 * 1024;

// Duration rule. VIDEO: 1..30 inclusive — CF-SH1: when FFPROBE_PATH is set (the docker image), the
// SERVER-measured duration is authoritative and is what gets stored; the client param is advisory.
// Without ffprobe (dev) the param remains the stored value, as before. PHOTO: exactly one of the
// discrete diffusion slots (no probe involved).
export const MAX_VIDEO_DURATION_SECONDS = 30;
export const PHOTO_DURATION_SECONDS = [10, 20, 30] as const;

export const isValidDuration = (kind: CreativeKind, durationSeconds: number): boolean => {
  if (!Number.isInteger(durationSeconds)) return false;
  return kind === 'video'
    ? durationSeconds >= 1 && durationSeconds <= MAX_VIDEO_DURATION_SECONDS
    : (PHOTO_DURATION_SECONDS as readonly number[]).includes(durationSeconds);
};

// Advertiser-facing projection. validation_status + validation_notes ARE surfaced (an advertiser
// must see WHY a creative was rejected); storage_key and validated_by stay internal.
export const creativeView = (row: Creative) => ({
  id: row.id,
  creative_type: row.creativeType,
  title: row.title,
  duration_seconds: row.durationSeconds,
  validation_status: row.validationStatus,
  validation_notes: row.validationNotes,
  validated_at: row.validatedAt,
  original_filename: row.originalFilename,
  mime_type: row.mimeType,
  size_bytes: row.sizeBytes,
  created_at: row.createdAt,
  updated_at: row.updatedAt,
});

export type CreativeView = ReturnType<typeof creativeView>;

/**
 * CF-HF4 — the moderation queue's « submitted » predicate, ONE home (ADM-DSH2). Validation
 * happens at PANIER-ADD, not upload: a `pending` creative is in the queue only once SOME campaign
 * linking it has reached the cart (or gone beyond draft — a submitted campaign's spot stays
 * reviewable after the cart clears). Approved/rejected rows list unconditionally (history stays
 * visible). The dashboard tile « Créatives à valider » COUNTS through this same predicate: it used
 * to count every `pending` row, so it read 4 while the queue it links to was empty — the four
 * were uploads nobody had carted yet, exactly the rows this gate keeps out of the queue.
 */
export const submittedCreativeGate = sql`(
  ${creatives.validationStatus} <> 'pending'
  OR EXISTS (
    SELECT 1 FROM campaigns c
    LEFT JOIN cart_items ci ON ci.campaign_id = c.id
    WHERE c.creative_id = ${creatives.id}
      AND (ci.id IS NOT NULL OR c.status <> 'draft')
  )
)`;
