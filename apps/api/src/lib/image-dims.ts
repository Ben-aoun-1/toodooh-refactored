// AGT-1b — the pixel size of a PNG or JPEG from its bytes (no decoder): the agent photo must be
// at least 400 × 400 px (agent specs v1.0 §2). Returns null when the bytes are neither format or
// the header is truncated — the caller refuses the upload then.

export interface ImageDims {
  format: 'png' | 'jpeg';
  width: number;
  height: number;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const pngDims = (b: Buffer): ImageDims | null => {
  if (b.length < 24 || !PNG_SIGNATURE.every((v, i) => b[i] === v)) return null;
  if (b.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { format: 'png', width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
};

// The SOFn markers that carry the frame size (C0–CF except DHT C4, JPG C8 and DAC CC).
const isSof = (m: number) => m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;

const jpegDims = (b: Buffer): ImageDims | null => {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1] ?? 0;
    if (marker === 0xff) {
      i += 1;
      continue;
    }
    const len = b.readUInt16BE(i + 2);
    if (isSof(marker)) {
      return { format: 'jpeg', height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
    }
    i += 2 + len;
  }
  return null;
};

export const imageDims = (bytes: Buffer): ImageDims | null => pngDims(bytes) ?? jpegDims(bytes);
