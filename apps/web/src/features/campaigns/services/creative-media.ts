/**
 * Client-side media probing for the creative upload step (L-spot). The upload route requires an
 * integer `duration_seconds`; for a video we read it from an offscreen <video> element's metadata
 * (authoritative ffprobe is a server-side follow-up), for a photo the advertiser picks a diffusion
 * slot. Self-contained so the new REST creative path does not depend on the legacy video service.
 */

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
