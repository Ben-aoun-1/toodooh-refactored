import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  PHOTO_ACCEPT,
  VIDEO_ACCEPT,
  creativeUploadErrorMessage,
  readVideoDurationSeconds,
} from './creative-media';

// CF-SH1 (spec §1.6) — client alignment with the server's spec-strict upload hardening,
// pinned at helper level (node env, no render harness). UPL-1 (operator 2026-09-16): no
// aspect-ratio rule.

describe('accept lists (spec-strict — webm/webp are out)', () => {
  it('video: MP4 + MOV only', () => {
    expect(VIDEO_ACCEPT).toBe('video/mp4,video/quicktime');
    expect(VIDEO_ACCEPT).not.toContain('webm');
  });

  it('photo: JPEG + PNG only', () => {
    expect(PHOTO_ACCEPT).toBe('image/jpeg,image/png');
    expect(PHOTO_ACCEPT).not.toContain('webp');
  });
});

describe('creativeUploadErrorMessage (server hardening codes → French toasts)', () => {
  it('maps each CF-SH1 code to its pinned French copy', () => {
    expect(creativeUploadErrorMessage({ code: 'MEDIA_TYPE_MISMATCH', message: 'x' })).toBe(
      'Le fichier ne correspond pas au format annoncé — vérifiez le type du fichier.',
    );
    expect(creativeUploadErrorMessage({ code: 'MEDIA_FORMAT_UNSUPPORTED', message: 'x' })).toBe(
      'Format non conforme : la vidéo doit être encodée en H.264 (MP4 ou MOV, 30 secondes maximum).',
    );
    expect(creativeUploadErrorMessage({ code: 'MEDIA_DURATION_INVALID', message: 'x' })).toBe(
      'Format non conforme : la vidéo ne doit pas dépasser 30 secondes.',
    );
    expect(creativeUploadErrorMessage({ code: 'MEDIA_UNREADABLE', message: 'x' })).toBe(
      'Fichier illisible — réessayez avec une vidéo MP4 (H.264).',
    );
  });

  it('UPL-1 — no copy promises a 16:9 ratio and the ratio refusal is no longer mapped', () => {
    expect(creativeUploadErrorMessage({ code: 'MEDIA_RATIO_INVALID', message: 'x' })).toBeNull();
    for (const code of [
      'MEDIA_TYPE_MISMATCH',
      'MEDIA_FORMAT_UNSUPPORTED',
      'MEDIA_DURATION_INVALID',
      'MEDIA_UNREADABLE',
    ]) {
      expect(creativeUploadErrorMessage({ code, message: 'x' })).not.toContain('16:9');
    }
  });

  it('unmapped codes and non-coded errors fall through to the generic handling (null)', () => {
    expect(creativeUploadErrorMessage({ code: 'STORAGE_ERROR', message: 'x' })).toBeNull();
    expect(creativeUploadErrorMessage(new Error('boom'))).toBeNull();
    expect(creativeUploadErrorMessage('nope')).toBeNull();
    expect(creativeUploadErrorMessage(null)).toBeNull();
  });
});

describe('StepCreative hint copy (source pins — UPL-1: no ratio promised)', () => {
  const step = readFileSync(
    fileURLToPath(new URL('../pages/new-campaign/StepCreative.tsx', import.meta.url)),
    'utf8',
  );

  it('names the formats and the length cap, never a 16:9 ratio', () => {
    expect(step).not.toContain('16:9');
    expect(step).toContain('`MP4 ou MOV (H.264) · ${');
    expect(step).toContain("'Vidéo : 30 secondes maximum (MP4 / MOV, H.264)'");
    expect(step).toContain("'JPEG ou PNG'");
  });
});

describe('readVideoDurationSeconds (the client UX pre-check — unchanged by CF-SH1)', () => {
  it('stays a browser-only probe: resolves null without a DOM (the server measure is authoritative)', async () => {
    expect(await readVideoDurationSeconds(new File([], 'clip.mp4'))).toBeNull();
  });
});
