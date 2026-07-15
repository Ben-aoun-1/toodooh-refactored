import { describe, expect, it } from 'vitest';

import {
  PHOTO_ACCEPT,
  VIDEO_ACCEPT,
  creativeUploadErrorMessage,
  readVideoDurationSeconds,
} from './creative-media';

// CF-SH1 (spec §1.6) — client alignment with the server's spec-strict upload hardening,
// pinned at helper level (node env, no render harness).

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
      'Format non conforme : vidéo MP4/MOV en 16:9, H.264, 30 s max.',
    );
    expect(creativeUploadErrorMessage({ code: 'MEDIA_RATIO_INVALID', message: 'x' })).toBe(
      'Format non conforme : la vidéo doit être au ratio 16:9 (±2%).',
    );
    expect(creativeUploadErrorMessage({ code: 'MEDIA_DURATION_INVALID', message: 'x' })).toBe(
      'Format non conforme : la vidéo ne doit pas dépasser 30 secondes.',
    );
    expect(creativeUploadErrorMessage({ code: 'MEDIA_UNREADABLE', message: 'x' })).toBe(
      'Fichier illisible — réessayez avec une vidéo MP4 (H.264).',
    );
  });

  it('unmapped codes and non-coded errors fall through to the generic handling (null)', () => {
    expect(creativeUploadErrorMessage({ code: 'STORAGE_ERROR', message: 'x' })).toBeNull();
    expect(creativeUploadErrorMessage(new Error('boom'))).toBeNull();
    expect(creativeUploadErrorMessage('nope')).toBeNull();
    expect(creativeUploadErrorMessage(null)).toBeNull();
  });
});

describe('readVideoDurationSeconds (the client UX pre-check — unchanged by CF-SH1)', () => {
  it('stays a browser-only probe: resolves null without a DOM (the server measure is authoritative)', async () => {
    expect(await readVideoDurationSeconds(new File([], 'clip.mp4'))).toBeNull();
  });
});
