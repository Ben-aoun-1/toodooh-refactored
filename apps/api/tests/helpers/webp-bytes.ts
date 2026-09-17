// UPL-4 — WebP containers built chunk by chunk, for the header walk (webpDimensions) and the
// pixel-budget gate. Only the headers are real: the image data is filler, which is all a header
// reader looks at (the real-ffmpeg test is the one place a decoder sees these bytes).

/** One RIFF chunk: FourCC, little-endian payload size, payload, and a pad byte when the size is odd. */
export const webpChunk = (fourCc: string, payload: Buffer): Buffer => {
  if (fourCc.length !== 4) throw new Error(`a FourCC is 4 characters, got « ${fourCc} »`);
  const size = Buffer.alloc(4);
  size.writeUInt32LE(payload.length);
  const pad = payload.length % 2 === 1 ? Buffer.alloc(1) : Buffer.alloc(0);
  return Buffer.concat([Buffer.from(fourCc, 'latin1'), size, payload, pad]);
};

/** « RIFF » size « WEBP » around the given chunks — the size covers exactly what follows it. */
export const webpContainer = (chunks: readonly Buffer[]): Buffer => {
  const body = Buffer.concat([Buffer.from('WEBP', 'latin1'), ...chunks]);
  const size = Buffer.alloc(4);
  size.writeUInt32LE(body.length);
  return Buffer.concat([Buffer.from('RIFF', 'latin1'), size, body]);
};

/**
 * A lossless « VP8L » chunk: signature 0x2F, then width-1 and height-1 as two 14-bit fields packed
 * little-endian (alpha and version bits 0), then `filler` bytes of image data.
 */
export const vp8lChunk = (
  width: number,
  height: number,
  filler: Buffer = Buffer.alloc(0),
): Buffer => {
  const header = Buffer.alloc(5);
  header.writeUInt8(0x2f, 0);
  header.writeUInt32LE((((height - 1) & 0x3fff) << 14) | ((width - 1) & 0x3fff), 1);
  return webpChunk('VP8L', Buffer.concat([header, filler]));
};

/**
 * A lossy « VP8 » chunk: a 3-byte frame tag (bit 0 clear = key frame), the key-frame start code
 * 9D 01 2A, then width and height as 16-bit little-endian (low 14 bits = size, top 2 = scale).
 */
export const vp8Chunk = (
  width: number,
  height: number,
  options: { keyFrame?: boolean; startCode?: readonly number[]; filler?: Buffer } = {},
): Buffer => {
  const header = Buffer.alloc(10);
  header.writeUInt8(options.keyFrame === false ? 0x11 : 0x10, 0);
  Buffer.from(options.startCode ?? [0x9d, 0x01, 0x2a]).copy(header, 3);
  header.writeUInt16LE(width, 6);
  header.writeUInt16LE(height, 8);
  return webpChunk('VP8 ', Buffer.concat([header, options.filler ?? Buffer.alloc(8)]));
};

/** An extended-format « VP8X » chunk: flags, 3 reserved bytes, canvas width-1 and height-1 (24-bit LE). */
export const vp8xChunk = (flags: number, width: number, height: number): Buffer => {
  const payload = Buffer.alloc(10);
  payload.writeUInt8(flags, 0);
  payload.writeUIntLE(width - 1, 4, 3);
  payload.writeUIntLE(height - 1, 7, 3);
  return webpChunk('VP8X', payload);
};

/** A well-formed still lossless WebP header of the given size (a simple-format file). */
export const vp8lWebpBytes = (width: number, height: number, filler?: Buffer): Buffer =>
  webpContainer([vp8lChunk(width, height, filler)]);
