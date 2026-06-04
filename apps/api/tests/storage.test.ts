import {
  CreateBucketCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Env } from '../src/env.js';
import { S3Storage } from '../src/storage/s3-storage.js';

// getSignedUrl is a free function (not a client method), so it's module-mocked here.
// The S3 client itself is injected as a fake (DI constructor) — no module mock needed,
// which keeps the integration suite (storage.integration.test.ts) free to use the real SDK.
vi.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: vi.fn() }));

const fakeClient = (send: ReturnType<typeof vi.fn>): S3Client => ({ send }) as unknown as S3Client;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('S3Storage (unit)', () => {
  it('fromEnv builds an S3Client with forcePathStyle enabled', () => {
    const s = S3Storage.fromEnv({
      STORAGE_ENDPOINT: 'http://localhost:9000',
      STORAGE_ACCESS_KEY: 'k',
      STORAGE_SECRET_KEY: 's',
      STORAGE_BUCKET: 'toodooh-documents',
      STORAGE_REGION: 'us-east-1',
    } as unknown as Env);
    const client = (s as unknown as { client: S3Client }).client;
    expect(client.config.forcePathStyle).toBe(true);
  });

  it('upload returns { key } on success', async () => {
    const send = vi.fn().mockResolvedValue({}); // HeadBucket ok, PutObject ok
    const s = new S3Storage(fakeClient(send), 'toodooh-documents');
    const res = await s.upload({
      key: 'rne/u1',
      body: Buffer.from('pdf'),
      contentType: 'application/pdf',
    });
    expect(res).toEqual({ key: 'rne/u1' });
    const cmds = send.mock.calls.map((c) => c[0]);
    expect(cmds.some((c) => c instanceof PutObjectCommand)).toBe(true);
  });

  it('upload returns { error } when the SDK throws', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({}) // HeadBucket ok
      .mockRejectedValueOnce(new Error('disk full')); // PutObject fails
    const s = new S3Storage(fakeClient(send), 'toodooh-documents');
    const res = await s.upload({
      key: 'rne/u1',
      body: Buffer.from('x'),
      contentType: 'application/pdf',
    });
    expect(res).toEqual({ error: 'disk full' });
  });

  it('getPresignedUrl returns { url } on success', async () => {
    vi.mocked(getSignedUrl).mockResolvedValueOnce('http://localhost:9000/signed');
    const s = new S3Storage(fakeClient(vi.fn()), 'toodooh-documents');
    const res = await s.getPresignedUrl({ key: 'rne/u1' });
    expect(res).toEqual({ url: 'http://localhost:9000/signed' });
  });

  it('getPresignedUrl returns { error } when signing throws', async () => {
    vi.mocked(getSignedUrl).mockRejectedValueOnce(new Error('sign failed'));
    const s = new S3Storage(fakeClient(vi.fn()), 'toodooh-documents');
    const res = await s.getPresignedUrl({ key: 'rne/u1' });
    expect(res).toEqual({ error: 'sign failed' });
  });

  it('delete returns { deleted: true } on success', async () => {
    const send = vi.fn().mockResolvedValue({});
    const s = new S3Storage(fakeClient(send), 'toodooh-documents');
    const res = await s.delete({ key: 'rne/u1' });
    expect(res).toEqual({ deleted: true });
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(DeleteObjectCommand);
  });

  it('delete returns { error } when the SDK throws', async () => {
    const send = vi.fn().mockRejectedValue(new Error('no such key'));
    const s = new S3Storage(fakeClient(send), 'toodooh-documents');
    const res = await s.delete({ key: 'rne/u1' });
    expect(res).toEqual({ error: 'no such key' });
  });

  it('ensureBucket: HeadBucket NotFound → CreateBucket, memoized across uploads', async () => {
    const notFound = Object.assign(new Error('NotFound'), { name: 'NotFound' });
    const send = vi
      .fn()
      .mockRejectedValueOnce(notFound) // HeadBucket → missing
      .mockResolvedValue({}); // CreateBucket + both PutObjects
    const s = new S3Storage(fakeClient(send), 'toodooh-documents');
    await s.upload({ key: 'k1', body: Buffer.from('a'), contentType: 't' });
    await s.upload({ key: 'k2', body: Buffer.from('b'), contentType: 't' });
    const cmds = send.mock.calls.map((c) => c[0]);
    expect(cmds.filter((c) => c instanceof HeadBucketCommand)).toHaveLength(1);
    expect(cmds.filter((c) => c instanceof CreateBucketCommand)).toHaveLength(1);
    expect(cmds.filter((c) => c instanceof PutObjectCommand)).toHaveLength(2);
  });
});

// C1 (slice-1 hotfix): the api's server-side SDK calls go to the INTERNAL endpoint
// (STORAGE_ENDPOINT) while presigned GET URLs are signed against the PUBLIC endpoint
// (STORAGE_PUBLIC_ENDPOINT). The host-split can't be shown by the integration round-trip
// (CI runs a single MinIO), so it's pinned deterministically here.
describe('S3Storage endpoint split (C1)', () => {
  const baseEnv = {
    STORAGE_ENDPOINT: 'http://minio:9000',
    STORAGE_ACCESS_KEY: 'k',
    STORAGE_SECRET_KEY: 's',
    STORAGE_BUCKET: 'storage',
    STORAGE_REGION: 'us-east-1',
  };
  const hostOf = async (c: S3Client): Promise<string> => {
    const resolve = c.config.endpoint;
    if (!resolve) return '';
    return (await resolve()).hostname;
  };
  const split = (s: S3Storage): { client: S3Client; presignClient: S3Client } =>
    s as unknown as { client: S3Client; presignClient: S3Client };

  it('fromEnv: server-side client → STORAGE_ENDPOINT, presign client → STORAGE_PUBLIC_ENDPOINT', async () => {
    const s = S3Storage.fromEnv({
      ...baseEnv,
      STORAGE_PUBLIC_ENDPOINT: 'http://too-dooh.com',
    } as unknown as Env);
    const { client, presignClient } = split(s);
    expect(client).not.toBe(presignClient);
    expect(await hostOf(client)).toBe('minio');
    expect(await hostOf(presignClient)).toBe('too-dooh.com');
  });

  it('fromEnv: presign falls back to the server-side client when STORAGE_PUBLIC_ENDPOINT is unset', () => {
    const { client, presignClient } = split(S3Storage.fromEnv(baseEnv as unknown as Env));
    expect(presignClient).toBe(client);
  });

  it('getPresignedUrl signs with the presign client, never the server-side client', async () => {
    vi.mocked(getSignedUrl).mockResolvedValueOnce('http://too-dooh.com/signed');
    const serverClient = fakeClient(vi.fn());
    const presignClient = fakeClient(vi.fn());
    const s = new S3Storage(serverClient, 'storage', presignClient);
    await s.getPresignedUrl({ key: 'rne/u1' });
    // lastCall, not calls[0]: getSignedUrl is module-mocked and its call history
    // accumulates across this file's tests (restoreAllMocks doesn't clear it).
    expect(vi.mocked(getSignedUrl).mock.lastCall?.[0]).toBe(presignClient);
    expect(vi.mocked(getSignedUrl).mock.lastCall?.[0]).not.toBe(serverClient);
  });

  it('ensureReady is idempotent: second call no-ops (one Head/Create), no throw', async () => {
    const notFound = Object.assign(new Error('NotFound'), { name: 'NotFound' });
    const send = vi.fn().mockRejectedValueOnce(notFound).mockResolvedValue({});
    const s = new S3Storage(fakeClient(send), 'storage');
    await expect(s.ensureReady()).resolves.toBeUndefined();
    await expect(s.ensureReady()).resolves.toBeUndefined();
    const cmds = send.mock.calls.map((c) => c[0]);
    expect(cmds.filter((c) => c instanceof HeadBucketCommand)).toHaveLength(1);
    expect(cmds.filter((c) => c instanceof CreateBucketCommand)).toHaveLength(1);
  });

  it('ensureReady clears the memo on failure so the next call retries', async () => {
    const boom = new Error('connection refused');
    const send = vi
      .fn()
      .mockRejectedValueOnce(boom) // HeadBucket fails
      .mockRejectedValueOnce(boom) // CreateBucket fails → first ensureReady rejects
      .mockResolvedValue({}); // retry: HeadBucket ok
    const s = new S3Storage(fakeClient(send), 'storage');
    await expect(s.ensureReady()).rejects.toThrow('connection refused');
    await expect(s.ensureReady()).resolves.toBeUndefined();
    expect(send.mock.calls).toHaveLength(3);
  });
});
