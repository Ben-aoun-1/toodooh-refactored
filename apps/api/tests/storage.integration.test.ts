import { afterAll, describe, expect, it } from 'vitest';

import { env } from '../src/env.js';
import { S3Storage } from '../src/storage/s3-storage.js';

// Integration suite — requires a REAL MinIO (STORAGE_* env). Mirrors signup.test.ts's
// real-Postgres dependency. No module mocks here, so the genuine AWS SDK round-trip
// (incl. forcePathStyle path-style addressing) is exercised. Self-cleaning: the test
// deletes its own key, and afterAll guards against a mid-test failure leaking state.
const storage = S3Storage.fromEnv(env);
const key = `rne/itest-${Date.now()}`;
const bytes = Buffer.from('integration round-trip payload');

describe('S3Storage integration (real MinIO)', () => {
  afterAll(async () => {
    await storage.delete({ key }).catch(() => undefined);
  });

  it('round-trips: ensure-bucket → upload → presign → fetch → bytes match → delete → gone', async () => {
    const up = await storage.upload({
      key,
      body: bytes,
      contentType: 'application/octet-stream',
    });
    expect(up).toEqual({ key }); // ensure-bucket (memoized-lazy) fired on this first upload

    const presign = await storage.getPresignedUrl({ key, expiresInSeconds: 120 });
    expect('url' in presign).toBe(true);
    if (!('url' in presign)) return;
    const res = await fetch(presign.url);
    expect(res.status).toBe(200); // proves forcePathStyle path-style addressing works
    const fetched = Buffer.from(await res.arrayBuffer());
    expect(fetched.equals(bytes)).toBe(true);

    const del = await storage.delete({ key });
    expect(del).toEqual({ deleted: true });

    const presign2 = await storage.getPresignedUrl({ key, expiresInSeconds: 120 });
    if (!('url' in presign2)) return;
    const res2 = await fetch(presign2.url);
    expect(res2.status).toBe(404); // gone after delete
  });
});
