import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ApiError } from '@/lib/api-client';

import {
  PHOTO_ACCEPT,
  VIDEO_ACCEPT,
  creativeUploadErrorMessage,
  readVideoDurationSeconds,
} from './creative-media';

// CF-SH1 (spec §1.6) — client alignment with the server's spec-strict upload hardening,
// pinned at helper level (node env, no render harness). UPL-1/UPL-2 (operator 2026-09-16):
// no aspect-ratio rule; the server reads the format from the bytes and names refused kinds.

/** The refusal exactly as api-client builds it: code from `error`, the raw body kept. */
const refusal = (body: Record<string, unknown>): ApiError =>
  new ApiError({
    status: 400,
    code: String(body['error']),
    message: typeof body['message'] === 'string' ? body['message'] : 'x',
    body,
  });

describe('accept lists (spec-strict — webm/webp are out)', () => {
  it('video: MP4 + MOV only, by mime and by extension in both cases', () => {
    expect(VIDEO_ACCEPT).toBe('video/mp4,video/quicktime,.mp4,.mov,.MP4,.MOV');
    expect(VIDEO_ACCEPT.toLowerCase()).not.toContain('webm');
  });

  it('photo: JPEG + PNG only, by mime and by extension in both cases (a « .PNG » is never hidden)', () => {
    expect(PHOTO_ACCEPT).toBe('image/jpeg,image/png,.jpg,.jpeg,.png,.JPG,.JPEG,.PNG');
    expect(PHOTO_ACCEPT.split(',')).toEqual(expect.arrayContaining(['.png', '.PNG']));
    expect(PHOTO_ACCEPT.toLowerCase()).not.toContain('webp');
  });
});

describe('creativeUploadErrorMessage (server hardening codes → French toasts)', () => {
  it('maps each CF-SH1 code to its pinned French copy', () => {
    expect(creativeUploadErrorMessage({ code: 'MEDIA_TYPE_MISMATCH', message: 'x' })).toBe(
      'Format de fichier non reconnu. Envoyez une image PNG ou JPEG, ou une vidéo MP4 ou MOV (H.264).',
    );
    expect(creativeUploadErrorMessage({ code: 'MEDIA_KIND_UNSUPPORTED', message: 'x' })).toBe(
      'Format de fichier non accepté. Envoyez une image PNG ou JPEG, ou une vidéo MP4 ou MOV (H.264).',
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
      'MEDIA_KIND_UNSUPPORTED',
      'MEDIA_FORMAT_UNSUPPORTED',
      'MEDIA_DURATION_INVALID',
      'MEDIA_UNREADABLE',
    ]) {
      expect(creativeUploadErrorMessage({ code, message: 'x' })).not.toContain('16:9');
    }
  });

  it('UPL-2 — unrecognised bytes: the copy names the formats of the chosen creative type', () => {
    expect(
      creativeUploadErrorMessage(
        refusal({ error: 'MEDIA_TYPE_MISMATCH', creative_type: 'photo', detected: null }),
      ),
    ).toBe('Format de fichier non reconnu. Choisissez une image PNG ou JPEG.');
    expect(
      creativeUploadErrorMessage(
        refusal({ error: 'MEDIA_TYPE_MISMATCH', creative_type: 'video', detected: null }),
      ),
    ).toBe('Format de fichier non reconnu. Choisissez une vidéo MP4 ou MOV (H.264).');
  });

  it.each([
    [
      'photo',
      'webp',
      'Cette image est au format WebP (même si son nom finit par .png ou .jpg). Enregistrez-la en PNG ou JPEG puis réessayez.',
    ],
    [
      'photo',
      'pdf',
      'Ce fichier est un PDF, pas une image. Enregistrez votre visuel en PNG ou JPEG puis réessayez.',
    ],
    ['photo', 'mp4', 'Ce fichier est une vidéo. Choisissez le type « Vidéo » pour la téléverser.'],
    ['photo', 'mov', 'Ce fichier est une vidéo. Choisissez le type « Vidéo » pour la téléverser.'],
    [
      'photo',
      'webm',
      'Ce fichier est une vidéo WebM. Choisissez le type « Vidéo » et envoyez-la en MP4 ou MOV (H.264).',
    ],
    ['video', 'jpeg', 'Ce fichier est une image. Choisissez le type « Photo » pour la téléverser.'],
    ['video', 'png', 'Ce fichier est une image. Choisissez le type « Photo » pour la téléverser.'],
    [
      'video',
      'webp',
      'Ce fichier est une image WebP. Choisissez le type « Photo » et enregistrez-la en PNG ou JPEG.',
    ],
    [
      'video',
      'webm',
      'Cette vidéo est au format WebM (même si son nom finit par .mp4). Exportez-la en MP4 ou MOV (H.264) puis réessayez.',
    ],
    [
      'video',
      'pdf',
      'Ce fichier est un PDF, pas une vidéo. Exportez votre spot en MP4 ou MOV (H.264) puis réessayez.',
    ],
  ])(
    'UPL-2 — MEDIA_KIND_UNSUPPORTED for a %s upload whose bytes are %s → its pinned copy',
    (creativeType, detected, expected) => {
      expect(
        creativeUploadErrorMessage(
          refusal({
            error: 'MEDIA_KIND_UNSUPPORTED',
            message: 'Ce fichier est au format X : il ne peut pas être téléversé comme photo.',
            creative_type: creativeType,
            detected,
          }),
        ),
      ).toBe(expected);
    },
  );

  it('UPL-2 — a MEDIA_KIND_UNSUPPORTED with an unmapped detected kind keeps the generic copy', () => {
    expect(
      creativeUploadErrorMessage(
        refusal({ error: 'MEDIA_KIND_UNSUPPORTED', creative_type: 'photo', detected: 'png' }),
      ),
    ).toBe(
      'Format de fichier non accepté. Envoyez une image PNG ou JPEG, ou une vidéo MP4 ou MOV (H.264).',
    );
    expect(
      creativeUploadErrorMessage(
        refusal({ error: 'MEDIA_KIND_UNSUPPORTED', creative_type: 'banner', detected: 'webp' }),
      ),
    ).toBe(
      'Format de fichier non accepté. Envoyez une image PNG ou JPEG, ou une vidéo MP4 ou MOV (H.264).',
    );
  });

  it('unmapped codes and non-coded errors fall through to the generic handling (null)', () => {
    expect(creativeUploadErrorMessage({ code: 'STORAGE_ERROR', message: 'x' })).toBeNull();
    expect(
      creativeUploadErrorMessage(refusal({ error: 'STORAGE_ERROR', creative_type: 'photo' })),
    ).toBeNull();
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

  it('the file picker takes its filter from the pinned accept lists', () => {
    expect(step).toContain("const accept = uploadType === 'video' ? VIDEO_ACCEPT : PHOTO_ACCEPT;");
    expect(step).toContain('accept={accept}');
  });
});

describe('readVideoDurationSeconds (the client UX pre-check — unchanged by CF-SH1)', () => {
  it('stays a browser-only probe: resolves null without a DOM (the server measure is authoritative)', async () => {
    expect(await readVideoDurationSeconds(new File([], 'clip.mp4'))).toBeNull();
  });
});
