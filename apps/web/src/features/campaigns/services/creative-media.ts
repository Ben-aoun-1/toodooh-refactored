/**
 * Client-side media helpers for the creative upload step (L-spot). The upload route requires an
 * integer `duration_seconds`; for a video we read it from an offscreen <video> element's metadata
 * — a UX PRE-CHECK only since CF-SH1: the server measures the real duration via ffprobe and its
 * value wins. For a photo the advertiser picks a diffusion slot. Self-contained so the new REST
 * creative path does not depend on the legacy video service.
 *
 * CF-SH1 (spec §1.6) — the accept lists are SPEC-STRICT (MP4/MOV video, JPEG/PNG image; webm out)
 * and the server's hardening error codes map to French toasts here, pinned by unit test. UPL-4 —
 * WebP photos are offered too: the server converts a static WebP to PNG on upload.
 * UPL-1 (operator 2026-09-16) — no aspect-ratio rule any more: every ratio uploads. UPL-2 — the
 * server reads the format from the file's BYTES (the browser's declared type is advisory), and a
 * recognised-but-refused format comes back as MEDIA_KIND_UNSUPPORTED with `detected`, which picks
 * the copy below.
 */

import type { CreativeType } from '@/features/campaigns/services/creatives.api';

/**
 * File-input accept lists — the server's spec-strict formats (CF-SH1), by mime AND by extension in
 * both cases (UPL-2): some pickers filter on one or the other only, and hid « .PNG » photos. UPL-4:
 * a WebP photo is accepted — the server stores it as PNG.
 */
export const VIDEO_ACCEPT = 'video/mp4,video/quicktime,.mp4,.mov,.MP4,.MOV';
export const PHOTO_ACCEPT =
  'image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp,.JPG,.JPEG,.PNG,.WEBP';

// The server's CF-SH1 hardening codes → the app's French toast copy. Anything unmapped falls back
// to the caller's generic error handling.
const UPLOAD_ERROR_MESSAGES: Record<string, string> = {
  MEDIA_TYPE_MISMATCH:
    'Format de fichier non reconnu. Envoyez une image PNG ou JPEG, ou une vidéo MP4 ou MOV (H.264).',
  MEDIA_KIND_UNSUPPORTED:
    'Format de fichier non accepté. Envoyez une image PNG ou JPEG, ou une vidéo MP4 ou MOV (H.264).',
  // The server sends this code for the codec refusal only — the length rules have their own codes
  // (MEDIA_DURATION_INVALID, EVENT_SPOT_TOO_LONG), so no length is named here (15 s in events).
  MEDIA_FORMAT_UNSUPPORTED:
    'Format non conforme : la vidéo doit être encodée en H.264 (MP4 ou MOV).',
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
// UPL-4 — the server converts a static WebP photo to PNG, so a photo refused as webp is one it
// could not convert (an animation, or unreadable bytes).
const KIND_UNSUPPORTED_BY_TYPE: Record<CreativeType, Partial<Record<string, string>>> = {
  photo: {
    webp: "Cette image WebP n'a pas pu être convertie (image animée ou illisible). Enregistrez-la en PNG ou JPEG puis réessayez.",
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

/** UPL-2 — the copy for a recognised kind the creative type refuses, or null when none is mapped. */
export function kindUnsupportedMessage(type: CreativeType, detected: string): string | null {
  return KIND_UNSUPPORTED_BY_TYPE[type][detected] ?? null;
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
      const perKind = kindUnsupportedMessage(creativeType, detected);
      if (perKind !== null) return perKind;
    }
  }
  return UPLOAD_ERROR_MESSAGES[code] ?? null;
}

/** The kinds a VIDEO creative refuses that the byte sniff below can name. */
export type RefusedVideoKind = 'jpeg' | 'png' | 'webp' | 'webm' | 'pdf';

// Magic numbers of the api's sniffContainer (apps/api/src/lib/media-probe.ts) — keep them in step.
const FTYP = [0x66, 0x74, 0x79, 0x70]; // 'ftyp' at offset 4: ISO BMFF (MP4/MOV)
const RIFF = [0x52, 0x49, 0x46, 0x46]; // 'RIFF' …
const WEBP = [0x57, 0x45, 0x42, 0x50]; // … 'WEBP' at offset 8
const EBML = [0x1a, 0x45, 0xdf, 0xa3]; // WebM / MKV
const JPEG = [0xff, 0xd8, 0xff];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d]; // '%PDF-'

const hasBytesAt = (head: Uint8Array, magic: readonly number[], offset = 0): boolean =>
  head.length >= offset + magic.length && magic.every((byte, i) => head[offset + i] === byte);

/**
 * UPL-2 — the kind of a file's first bytes when the server would refuse them as a VIDEO (an image,
 * a PDF, a WebM), read with the server's own magic numbers. An MP4/MOV container or unknown bytes
 * give null: the server decides those.
 */
export function sniffRefusedVideoKind(head: Uint8Array): RefusedVideoKind | null {
  if (head.length >= 12) {
    if (hasBytesAt(head, FTYP, 4)) return null;
    if (hasBytesAt(head, RIFF) && hasBytesAt(head, WEBP, 8)) return 'webp';
  }
  if (hasBytesAt(head, EBML)) return 'webm';
  if (hasBytesAt(head, JPEG)) return 'jpeg';
  if (hasBytesAt(head, PNG)) return 'png';
  if (hasBytesAt(head, PDF)) return 'pdf';
  return null;
}

const VIDEO_DURATION_UNREADABLE_MESSAGE =
  'Impossible de lire la durée de la vidéo. Réessayez avec un fichier MP4.';

/**
 * UPL-2 — the toast when the video pre-check read no duration. An image or a PDF picked under
 * « Vidéo » fails the browser probe and never reaches the server, so its first bytes pick the
 * server's per-kind copy here (which type to choose, which format to export); anything else keeps
 * the pre-check's own message.
 */
export async function unreadableVideoMessage(file: Blob): Promise<string> {
  let head: Uint8Array;
  try {
    head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  } catch {
    return VIDEO_DURATION_UNREADABLE_MESSAGE;
  }
  const kind = sniffRefusedVideoKind(head);
  const perKind = kind === null ? null : kindUnsupportedMessage('video', kind);
  return perKind ?? VIDEO_DURATION_UNREADABLE_MESSAGE;
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
