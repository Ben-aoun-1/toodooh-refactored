import { crc32, deflateSync } from 'node:zlib';

// UPL-2 — media bytes built in code for the upload-format tests: the sniffer reads magic bytes
// only, so a minimal valid PNG and bare JPEG / WebP headers are exactly what prod saw (a « .png »
// holding JPEG or WebP bytes) without another binary fixture in tests/fixtures.

const pngChunk = (type: string, data: Buffer): Buffer => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
};

/** A minimal VALID 1×1 truecolour PNG: signature, IHDR, zlib-deflated IDAT, IEND (real CRCs). */
export const minimalPng = (): Buffer => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0); // width
  ihdr.writeUInt32BE(1, 4); // height
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(2, 9); // colour type 2 = truecolour; compression/filter/interlace stay 0
  const scanline = Buffer.from([0, 255, 255, 255]); // filter byte 0 + one white pixel
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(scanline)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
};

/** A JPEG's magic (SOI + APP0 « JFIF ») then filler and EOI — a photo saved as JPEG. */
export const jpegBytes = (): Buffer =>
  Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
    Buffer.from('JFIF\0', 'latin1'),
    Buffer.alloc(64, 0x11),
    Buffer.from([0xff, 0xd9]),
  ]);

/** A WebP's RIFF header (« RIFF » size « WEBP » + a VP8L chunk tag) then filler. */
export const webpBytes = (): Buffer => {
  const payload = Buffer.concat([Buffer.from('WEBPVP8L', 'latin1'), Buffer.alloc(32, 0)]);
  const size = Buffer.alloc(4);
  size.writeUInt32LE(payload.length);
  return Buffer.concat([Buffer.from('RIFF', 'latin1'), size, payload]);
};

/** A PDF's magic then filler — a document, never a creative. */
export const pdfBytes = (): Buffer =>
  Buffer.concat([Buffer.from('%PDF-1.7\n', 'latin1'), Buffer.alloc(32, 0x20)]);
