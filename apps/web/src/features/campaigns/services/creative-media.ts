/**
 * Client-side media helpers for the creative upload step (L-spot). The upload route requires an
 * integer `duration_seconds`; for a video we read it from an offscreen <video> element's metadata
 * — a UX PRE-CHECK only since CF-SH1: the server measures the real duration via ffprobe and its
 * value wins. For a photo the advertiser picks a diffusion slot. Self-contained so the new REST
 * creative path does not depend on the legacy video service.
 *
 * CF-SH1 (spec §1.6) — the accept lists are SPEC-STRICT (MP4/MOV video, JPEG/PNG image; webm/webp
 * out) and the server's hardening error codes map to French toasts here, pinned by unit test.
 * UPL-1 (operator 2026-09-16) — no aspect-ratio rule any more: every ratio uploads. UPL-2 — the
 * server reads the format from the file's BYTES (the browser's declared type is advisory), and a
 * recognised-but-refused format comes back as MEDIA_KIND_UNSUPPORTED with `detected`, which picks
 * the copy below.
 */

import type { CreativeType } from '@/features/campaigns/services/creatives.api';

/**
 * File-input accept lists — the server's spec-strict formats (CF-SH1), by mime AND by extension in
 * both cases (UPL-2): some pickers filter on one or the other only, and hid « .PNG » photos.
 */
export const VIDEO_ACCEPT = 'video/mp4,video/quicktime,.mp4,.mov,.MP4,.MOV';
export const PHOTO_ACCEPT = 'image/jpeg,image/png,.jpg,.jpeg,.png,.JPG,.JPEG,.PNG';

// The server's CF-SH1 hardening codes → the app's French toast copy. Anything unmapped falls back
// to the caller's generic error handling.
const UPLOAD_ERROR_MESSAGES: Record<string, string> = {
  MEDIA_TYPE_MISMATCH:
    'Format de fichier non reconnu. Envoyez une image PNG ou JPEG, ou une vidéo MP4 ou MOV (H.264).',
  MEDIA_KIND_UNSUPPORTED:
    'Format de fichier non accepté. Envoyez une image PNG ou JPEG, ou une vidéo MP4 ou MOV (H.264).',
  MEDIA_FORMAT_UNSUPPORTED:
    'Format non conforme : la vidéo doit être encodée en H.264 (MP4 ou MOV, 30 secondes maximum).',
  MEDIA_DURATION_INVALID: 'Format non conforme : la vidéo ne doit pas dépasser 30 secondes.',
  MEDIA_UNREADABLE: 'Fichier illisible — réessayez avec une vidéo MP4 (H.264).',
};

// UPL-2 — an unrecognised file, named for the creative type being uploaded.
const UNRECOGNISED_BY_TYPE: Record<CreativeType, string> = {
  photo: 'Format de fichier non reconnu. Choisissez une image PNG ou JPEG.',
  video: 'Format de fichier non reconnu. Choisissez une vidéo MP4 ou MOV (H.264).',
};

const VIDEO_AS_PHOTO = 'Ce fichier est une vidéo. Choisissez le type « Vidéo » pour la téléverser.';
const PHOTO_AS_VIDEO = 'Ce fichier est une image. Choisissez le type « Photo » pour la téléverser.';

// UPL-2 — a recognised format the creative type refuses, per (creative type, detected bytes).
const KIND_UNSUPPORTED_BY_TYPE: Record<CreativeType, Partial<Record<string, string>>> = {
  photo: {
    webp: 'Cette image est au format WebP (même si son nom finit par .png ou .jpg). Enregistrez-la en PNG ou JPEG puis réessayez.',
    pdf: 'Ce fichier est un PDF, pas une image. Enregistrez votre visuel en PNG ou JPEG puis réessayez.',
    mp4: VIDEO_AS_PHOTO,
    mov: VIDEO_AS_PHOTO,
    webm: 'Ce fichier est une vidéo WebM. Choisissez le type « Vidéo » et envoyez-la en MP4 ou MOV (H.264).',
  },
  video: {
    jpeg: PHOTO_AS_VIDEO,
    png: PHOTO_AS_VIDEO,
    webp: 'Ce fichier est une image WebP. Choisissez le type « Photo » et enregistrez-la en PNG ou JPEG.',
    webm: 'Cette vidéo est au format WebM (même si son nom finit par .mp4). Exportez-la en MP4 ou MOV (H.264) puis réessayez.',
    pdf: 'Ce fichier est un PDF, pas une vidéo. Exportez votre spot en MP4 ou MOV (H.264) puis réessayez.',
  },
};

const isCreativeType = (value: unknown): value is CreativeType =>
  value === 'photo' || value === 'video';

/** A field of the refusal's raw JSON body (ApiError.body), or undefined. */
function bodyField(error: object, key: string): unknown {
  const body = (error as { body?: unknown }).body;
  if (typeof body !== 'object' || body === null) return undefined;
  return (body as Record<string, unknown>)[key];
}

/** French toast for a CF-SH1 upload rejection, or null when the error carries no mapped code. */
export function creativeUploadErrorMessage(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const code = (error as { code?: unknown }).code;
  if (typeof code !== 'string') return null;
  const creativeType = bodyField(error, 'creative_type');
  if (isCreativeType(creativeType)) {
    if (code === 'MEDIA_TYPE_MISMATCH') return UNRECOGNISED_BY_TYPE[creativeType];
    const detected = bodyField(error, 'detected');
    if (code === 'MEDIA_KIND_UNSUPPORTED' && typeof detected === 'string') {
      const perKind = KIND_UNSUPPORTED_BY_TYPE[creativeType][detected];
      if (perKind !== undefined) return perKind;
    }
  }
  return UPLOAD_ERROR_MESSAGES[code] ?? null;
}

function tryReadDuration(video: HTMLVideoElement): number | null {
  const d = video.duration;
  if (typeof d === 'number' && Number.isFinite(d) && d > 0) return d;
  return null;
}

/** Read a video file's duration in seconds (rounded up to a whole second), or null if undetectable. */
export async function readVideoDurationSeconds(file: File): Promise<number | null> {
  if (typeof document === 'undefined') return null;
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.setAttribute('playsinline', '');
    let settled = false;
    const done = (n: number | null) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      video.removeAttribute('src');
      video.remove();
      resolve(n == null ? null : Math.ceil(n));
    };
    const tick = () => {
      const n = tryReadDuration(video);
      if (n != null) done(n);
    };
    video.onloadedmetadata = tick;
    video.onloadeddata = tick;
    video.ondurationchange = tick;
    video.oncanplay = tick;
    video.onerror = () => done(null);
    video.src = url;
    video.load();
    window.setTimeout(() => done(tryReadDuration(video)), 6000);
  });
}
