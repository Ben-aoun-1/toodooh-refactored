/**
 * Client-side media helpers for the creative upload step (L-spot). The upload route requires an
 * integer `duration_seconds`; for a video we read it from an offscreen <video> element's metadata
 * — a UX PRE-CHECK only since CF-SH1: the server measures the real duration via ffprobe and its
 * value wins. For a photo the advertiser picks a diffusion slot. Self-contained so the new REST
 * creative path does not depend on the legacy video service.
 *
 * CF-SH1 (spec §1.6) — the accept lists are SPEC-STRICT (MP4/MOV video, JPEG/PNG image; webm/webp
 * out) and the server's hardening error codes map to French toasts here, pinned by unit test.
 * UPL-1 (operator 2026-09-16) — no aspect-ratio rule any more: every ratio uploads.
 */

/** File-input accept lists — aligned with the server's spec-strict allowlists (CF-SH1). */
export const VIDEO_ACCEPT = 'video/mp4,video/quicktime';
export const PHOTO_ACCEPT = 'image/jpeg,image/png';

// The server's CF-SH1 hardening codes → the app's French toast copy. Anything unmapped falls back
// to the caller's generic error handling.
const UPLOAD_ERROR_MESSAGES: Record<string, string> = {
  MEDIA_TYPE_MISMATCH:
    'Le fichier ne correspond pas au format annoncé — vérifiez le type du fichier.',
  MEDIA_FORMAT_UNSUPPORTED:
    'Format non conforme : la vidéo doit être encodée en H.264 (MP4 ou MOV, 30 secondes maximum).',
  MEDIA_DURATION_INVALID: 'Format non conforme : la vidéo ne doit pas dépasser 30 secondes.',
  MEDIA_UNREADABLE: 'Fichier illisible — réessayez avec une vidéo MP4 (H.264).',
};

/** French toast for a CF-SH1 upload rejection, or null when the error carries no mapped code. */
export function creativeUploadErrorMessage(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const code = (error as { code?: unknown }).code;
  if (typeof code !== 'string') return null;
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
