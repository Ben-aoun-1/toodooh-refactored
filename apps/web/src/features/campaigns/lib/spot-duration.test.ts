import { describe, expect, it } from 'vitest';

import {
  VIDEO_DURATION_MESSAGE,
  VIDEO_DROPZONE_HINT,
  isClassicVideoDurationValid,
} from './spot-duration';

describe('classic video duration (Mariem 27/10 point 2)', () => {
  it('accepts 10 to 30 s inclusive', () => {
    expect(isClassicVideoDurationValid(10)).toBe(true);
    expect(isClassicVideoDurationValid(30)).toBe(true);
  });

  it('refuses under 10 s and over 30 s', () => {
    expect(isClassicVideoDurationValid(9)).toBe(false);
    expect(isClassicVideoDurationValid(1)).toBe(false);
    expect(isClassicVideoDurationValid(31)).toBe(false);
  });

  it('says the range in French', () => {
    expect(VIDEO_DURATION_MESSAGE).toBe('La vidéo doit durer entre 10 et 30 secondes.');
    expect(VIDEO_DROPZONE_HINT).toBe('MP4 ou MOV (H.264) · 10 à 30 secondes');
  });
});
