import { describe, expect, it } from 'vitest';

import { imageDims } from '../src/lib/image-dims.js';

const png = (w: number, h: number) => {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'ascii');
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
};

const jpeg = (w: number, h: number) =>
  Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    // an APP0 segment first (length 16), then SOF0
    Buffer.from([0xff, 0xe0, 0x00, 0x10]),
    Buffer.alloc(14),
    Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 0xff, w >> 8, w & 0xff, 0x03]),
    Buffer.alloc(16),
  ]);

describe('imageDims — PNG / JPEG size from the header', () => {
  it('reads a PNG IHDR', () => {
    expect(imageDims(png(640, 480))).toEqual({ format: 'png', width: 640, height: 480 });
  });
  it('reads a JPEG SOF0 after an APP0 segment', () => {
    expect(imageDims(jpeg(800, 600))).toEqual({ format: 'jpeg', width: 800, height: 600 });
  });
  it('null for anything else or a truncated header', () => {
    expect(imageDims(Buffer.from('%PDF-1.4'))).toBeNull();
    expect(imageDims(png(1, 1).subarray(0, 20))).toBeNull();
  });
});
