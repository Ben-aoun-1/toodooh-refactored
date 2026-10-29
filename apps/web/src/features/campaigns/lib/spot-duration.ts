// SPOT-MIN1 (Mariem 27/10 point 2) — how long a CLASSIC campaign video may be: 10 to 30 s. Twin of
// the api's apps/api/src/lib/creatives.ts MIN/MAX_VIDEO_DURATION_SECONDS (the server refuses the
// upload on its own measure; this copy only answers before the bytes leave the browser). Event
// videos keep their own rule (features/events/lib/event-minutes.ts, also 10–30 s today).

export const VIDEO_MIN_SECONDS = 10;
export const VIDEO_MAX_SECONDS = 30;

export const VIDEO_DURATION_MESSAGE = `La vidéo doit durer entre ${VIDEO_MIN_SECONDS} et ${VIDEO_MAX_SECONDS} secondes.`;
export const VIDEO_DROPZONE_HINT = `MP4 ou MOV (H.264) · ${VIDEO_MIN_SECONDS} à ${VIDEO_MAX_SECONDS} secondes`;
export const VIDEO_SPEC_LABEL = `Vidéo : ${VIDEO_MIN_SECONDS} à ${VIDEO_MAX_SECONDS} secondes (MP4 / MOV, H.264)`;

/** Whole seconds (the browser probe rounds up, like the server's ffprobe). */
export const isClassicVideoDurationValid = (seconds: number): boolean =>
  seconds >= VIDEO_MIN_SECONDS && seconds <= VIDEO_MAX_SECONDS;
