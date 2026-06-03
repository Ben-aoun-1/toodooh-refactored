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

// Z2 C1 — the public-read prefix + its isolation invariant, proven with ANONYMOUS (no-SigV4) GETs
// against the SAME bucket. This is the whole reason Option 1 (prefix in `storage`) is acceptable over
// a separate public bucket: zones/* is anonymously readable, every other prefix stays private.
describe('S3Storage zones public-read (Option 1 prefix isolation, real MinIO)', () => {
  const zoneKey = `zones/itest-${Date.now()}`;
  const privKey = `rne/itest-${Date.now()}`;
  const imageBytes = Buffer.from('public zone image bytes');

  afterAll(async () => {
    await storage.delete({ key: zoneKey }).catch(() => undefined);
    await storage.delete({ key: privKey }).catch(() => undefined);
  });

  it('anonymous GET: zones/* → 200 (bytes match); a private prefix → 403 (isolation invariant)', async () => {
    await storage.ensureZonesPublicRead();
    await storage.upload({ key: zoneKey, body: imageBytes, contentType: 'image/png' });
    await storage.upload({
      key: privKey,
      body: Buffer.from('private legal doc'),
      contentType: 'application/pdf',
    });

    // Path-style base, exactly what nginx /storage/ proxies to (bucket = first path segment).
    const base = `${env.STORAGE_ENDPOINT.replace(/\/$/, '')}/${env.STORAGE_BUCKET}`;

    // UNSIGNED fetch (no SigV4 headers/query) — the public catalog read path.
    const pub = await fetch(`${base}/${zoneKey}`);
    expect(pub.status).toBe(200);
    const fetched = Buffer.from(await pub.arrayBuffer());
    expect(fetched.equals(imageBytes)).toBe(true);

    // UNSIGNED fetch of a NON-zones key in the SAME bucket → denied. This is the load-bearing
    // isolation assertion: the anonymous policy is scoped to zones/* and does not leak rne/cin.
    const priv = await fetch(`${base}/${privKey}`);
    expect(priv.status).toBe(403);
  });
});
