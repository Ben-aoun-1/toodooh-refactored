import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetBucketPolicyCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutBucketPolicyCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { env, type Env } from '../env.js';
import { logger } from '../logger.js';

import type { DeleteResult, PresignResult, StorageProvider, UploadResult } from './provider.js';

const log = logger.child({ module: 's3-storage' });

// S3-generic (AWS SDK v3 speaks S3 to any S3-compatible backend). forcePathStyle:true
// is mandatory for MinIO (path-style endpoint/bucket, not virtual-hosted bucket.endpoint).
export class S3Storage implements StorageProvider {
  // `client` is the INTERNAL/server-side client (upload, ensure-bucket, delete) → STORAGE_ENDPOINT.
  // `presignClient` signs presigned GET URLs → STORAGE_PUBLIC_ENDPOINT (the browser-facing host).
  // Signing is offline (no network), so the public client never connects from the api. The two
  // collapse to one when STORAGE_PUBLIC_ENDPOINT is unset (dev single-host).
  private readonly client: S3Client;
  private readonly presignClient: S3Client;
  private readonly bucket: string;
  // Memoized ensure-bucket: runs once (at boot, or on first upload). Sync constructor → no
  // import-time network. On failure the memo is cleared so the next call retries (a poisoned
  // rejected promise would otherwise fail every subsequent upload forever).
  private bucketReady: Promise<void> | undefined;
  // Memoized zones-public-read policy (Z2). Same lazy pattern as bucketReady.
  private zonesPublicReadReady: Promise<void> | undefined;

  constructor(client: S3Client, bucket: string, presignClient: S3Client = client) {
    this.client = client;
    this.bucket = bucket;
    this.presignClient = presignClient;
  }

  static fromEnv(env: Env): S3Storage {
    const credentials = {
      accessKeyId: env.STORAGE_ACCESS_KEY,
      secretAccessKey: env.STORAGE_SECRET_KEY,
    };
    const client = new S3Client({
      endpoint: env.STORAGE_ENDPOINT,
      region: env.STORAGE_REGION,
      credentials,
      forcePathStyle: true,
    });
    // Reuse the internal client when no distinct public endpoint is configured (fallback);
    // otherwise a second client whose only job is to sign URLs against the public host.
    const presignClient =
      env.STORAGE_PUBLIC_ENDPOINT === undefined
        ? client
        : new S3Client({
            endpoint: env.STORAGE_PUBLIC_ENDPOINT,
            region: env.STORAGE_REGION,
            credentials,
            forcePathStyle: true,
          });
    return new S3Storage(client, env.STORAGE_BUCKET, presignClient);
  }

  // Idempotent + retry-safe: HeadBucket → on miss CreateBucket; memoized so concurrent/repeat
  // callers share one round-trip. A failed attempt clears the memo so the next call retries.
  ensureReady(): Promise<void> {
    if (!this.bucketReady) {
      this.bucketReady = (async () => {
        try {
          await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
        } catch {
          await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
        }
      })().catch((err: unknown) => {
        this.bucketReady = undefined;
        throw err;
      });
    }
    return this.bucketReady;
  }

  // The single anonymous-read statement scoped to the zones/* prefix. Sid lets us detect our own
  // statement for idempotency + merge.
  private zonesStatement(): Record<string, unknown> {
    return {
      Sid: 'PublicReadZonesPrefix',
      Effect: 'Allow',
      Principal: { AWS: ['*'] },
      Action: ['s3:GetObject'],
      Resource: [`arn:aws:s3:::${this.bucket}/zones/*`],
    };
  }

  // Z2 (Option 1): grant anonymous GET to zones/* ONLY. PutBucketPolicy is FULL-REPLACE, so we read
  // the current policy first and MERGE our statement in — never clobbering a policy the bucket may
  // already carry. Idempotent (skips if our Sid is already present) + memoized (runs once).
  // Private prefixes (rne/, cin/) are untouched: deny-by-default holds, and presigned reads are
  // signature-based, independent of this bucket policy.
  async ensureZonesPublicRead(): Promise<void> {
    if (!this.zonesPublicReadReady) {
      this.zonesPublicReadReady = (async () => {
        await this.ensureReady();
        const statement = this.zonesStatement();

        let statements: Record<string, unknown>[] = [];
        let version = '2012-10-17';
        let hadPolicy = false;
        try {
          const current = await this.client.send(
            new GetBucketPolicyCommand({ Bucket: this.bucket }),
          );
          hadPolicy = true;
          const parsed = JSON.parse(current.Policy ?? '{}') as {
            Version?: string;
            Statement?: Record<string, unknown>[];
          };
          version = parsed.Version ?? version;
          statements = Array.isArray(parsed.Statement) ? parsed.Statement : [];
          if (statements.some((s) => s['Sid'] === statement['Sid'])) {
            log.info({ bucket: this.bucket }, 'zones public-read policy already present (no-op)');
            return;
          }
        } catch (err) {
          // NoSuchBucketPolicy → no prior policy; ship zones/* as the sole statement. Any OTHER
          // error is ambiguous → rethrow rather than risk clobbering an existing policy.
          if (err instanceof Error && err.name !== 'NoSuchBucketPolicy') throw err;
        }

        const policy = { Version: version, Statement: [...statements, statement] };
        await this.client.send(
          new PutBucketPolicyCommand({ Bucket: this.bucket, Policy: JSON.stringify(policy) }),
        );
        log.info(
          { bucket: this.bucket, mergedIntoExisting: hadPolicy },
          hadPolicy
            ? 'zones public-read statement merged into existing bucket policy'
            : 'zones public-read policy set (no prior bucket policy)',
        );
      })();
    }
    return this.zonesPublicReadReady;
  }

  async upload(params: { key: string; body: Buffer; contentType: string }): Promise<UploadResult> {
    try {
      await this.ensureReady();
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: params.key,
          Body: params.body,
          ContentType: params.contentType,
        }),
      );
      return { key: params.key };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'unknown storage error';
      log.error({ key: params.key, error }, 'storage upload failed');
      return { error };
    }
  }

  async getPresignedUrl(params: {
    key: string;
    expiresInSeconds?: number;
  }): Promise<PresignResult> {
    try {
      const url = await getSignedUrl(
        this.presignClient,
        new GetObjectCommand({ Bucket: this.bucket, Key: params.key }),
        { expiresIn: params.expiresInSeconds ?? 3600 },
      );
      return { url };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'unknown storage error';
      log.error({ key: params.key, error }, 'storage presign failed');
      return { error };
    }
  }

  async delete(params: { key: string }): Promise<DeleteResult> {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: params.key }));
      return { deleted: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'unknown storage error';
      log.error({ key: params.key, error }, 'storage delete failed');
      return { error };
    }
  }
}

// Singleton from env at module load, like emailSender (auth/auth.ts:16). Lazy: no
// network on import (S3Client connects lazily; ensureReady runs at boot / first upload).
export const storage: StorageProvider = S3Storage.fromEnv(env);
