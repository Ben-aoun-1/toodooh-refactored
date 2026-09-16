import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ApiError } from '@/lib/api-client';

import {
  PHOTO_ACCEPT,
  VIDEO_ACCEPT,
  creativeUploadErrorMessage,
  kindUnsupportedMessage,
  readVideoDurationSeconds,
  sniffRefusedVideoKind,
  unreadableVideoMessage,
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
      'Format non conforme : la vidéo doit être encodée en H.264 (MP4 ou MOV).',
    );
    expect(creativeUploadErrorMessage({ code: 'MEDIA_DURATION_INVALID', message: 'x' })).toBe(
      'Format non conforme : la vidéo ne doit pas dépasser 30 secondes.',
    );
    expect(creativeUploadErrorMessage({ code: 'MEDIA_UNREADABLE', message: 'x' })).toBe(
      'Fichier illisible — réessayez avec une vidéo MP4 (H.264).',
    );
  });

  it('the codec refusal names no length (the event flow caps at 15 s, the classic one at 30 s)', () => {
    expect(
      creativeUploadErrorMessage({ code: 'MEDIA_FORMAT_UNSUPPORTED', message: 'x' }),
    ).not.toMatch(/seconde/);
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

describe('kindUnsupportedMessage (UPL-2 — the per-kind copy, by creative type)', () => {
  it('returns the same copy the server refusal maps to', () => {
    expect(kindUnsupportedMessage('video', 'png')).toBe(
      'Ce fichier est une image. Choisissez le type « Photo » pour la téléverser.',
    );
    expect(kindUnsupportedMessage('photo', 'mp4')).toBe(
      'Ce fichier est une vidéo. Choisissez le type « Vidéo » pour la téléverser.',
    );
  });

  it('is null for a kind the creative type accepts or does not map', () => {
    expect(kindUnsupportedMessage('video', 'mp4')).toBeNull();
    expect(kindUnsupportedMessage('photo', 'png')).toBeNull();
    expect(kindUnsupportedMessage('photo', 'gif')).toBeNull();
  });
});

// First bytes of each kind — the magic numbers the api's sniffContainer reads.
const ascii = (text: string): number[] => Array.from(text, (c) => c.charCodeAt(0));
const pad = (bytes: number[]): Uint8Array<ArrayBuffer> =>
  Uint8Array.from([...bytes, ...new Array<number>(Math.max(0, 16 - bytes.length)).fill(0)]);
const HEADS = {
  png: pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  jpeg: pad([0xff, 0xd8, 0xff, 0xe0]),
  webp: pad([...ascii('RIFF'), 0x24, 0, 0, 0, ...ascii('WEBPVP8 ')]),
  webm: pad([0x1a, 0x45, 0xdf, 0xa3]),
  pdf: pad(ascii('%PDF-1.7')),
  mp4: pad([0, 0, 0, 0x18, ...ascii('ftypisom')]),
  mov: pad([0, 0, 0, 0x14, ...ascii('ftypqt  ')]),
  unknown: pad(ascii('hello, world')),
} as const;

describe('sniffRefusedVideoKind (UPL-2 — the server magic numbers, client side)', () => {
  it.each(['png', 'jpeg', 'webp', 'webm', 'pdf'] as const)('%s bytes → %s', (kind) => {
    expect(sniffRefusedVideoKind(HEADS[kind])).toBe(kind);
  });

  it('MP4 / MOV containers, unknown bytes and short or empty heads → null', () => {
    expect(sniffRefusedVideoKind(HEADS.mp4)).toBeNull();
    expect(sniffRefusedVideoKind(HEADS.mov)).toBeNull();
    expect(sniffRefusedVideoKind(HEADS.unknown)).toBeNull();
    expect(sniffRefusedVideoKind(Uint8Array.from([0xff, 0xd8]))).toBeNull();
    expect(sniffRefusedVideoKind(new Uint8Array(0))).toBeNull();
  });
});

describe('unreadableVideoMessage (UPL-2 — a file the video pre-check could not read)', () => {
  const fileOf = (head: Uint8Array<ArrayBuffer>, name: string): File =>
    new File([head, new Uint8Array(64)], name);
  const PRE_CHECK = 'Impossible de lire la durée de la vidéo. Réessayez avec un fichier MP4.';

  it.each([
    [
      'png',
      'visuel.png',
      'Ce fichier est une image. Choisissez le type « Photo » pour la téléverser.',
    ],
    [
      'jpeg',
      'photo.JPG',
      'Ce fichier est une image. Choisissez le type « Photo » pour la téléverser.',
    ],
    [
      'webp',
      'visuel.png',
      'Ce fichier est une image WebP. Choisissez le type « Photo » et enregistrez-la en PNG ou JPEG.',
    ],
    [
      'pdf',
      'maquette.pdf',
      'Ce fichier est un PDF, pas une vidéo. Exportez votre spot en MP4 ou MOV (H.264) puis réessayez.',
    ],
    [
      'webm',
      'spot.mp4',
      'Cette vidéo est au format WebM (même si son nom finit par .mp4). Exportez-la en MP4 ou MOV (H.264) puis réessayez.',
    ],
  ] as const)('%s bytes (%s) → the video-side per-kind copy', async (kind, name, expected) => {
    expect(await unreadableVideoMessage(fileOf(HEADS[kind], name))).toBe(expected);
  });

  it('MP4 / MOV / unknown / empty files keep the pre-check copy (the server decides those)', async () => {
    expect(await unreadableVideoMessage(fileOf(HEADS.mp4, 'spot.mp4'))).toBe(PRE_CHECK);
    expect(await unreadableVideoMessage(fileOf(HEADS.mov, 'spot.mov'))).toBe(PRE_CHECK);
    expect(await unreadableVideoMessage(fileOf(HEADS.unknown, 'spot.mp4'))).toBe(PRE_CHECK);
    expect(await unreadableVideoMessage(new File([], 'vide.mp4'))).toBe(PRE_CHECK);
  });

  it('a file that cannot be read keeps the pre-check copy', async () => {
    const broken = new File([], 'spot.mp4');
    broken.slice = () => {
      throw new Error('NotReadableError');
    };
    expect(await unreadableVideoMessage(broken)).toBe(PRE_CHECK);
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

  it('UPL-2 — an unreadable video takes its toast from the bytes (a photo picked as « Vidéo »)', () => {
    expect(step).toContain('toast.error(await unreadableVideoMessage(file));');
    expect(step).not.toContain('Impossible de lire la durée');
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
