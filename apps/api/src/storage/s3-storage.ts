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
  private readonly client: S3Client;
  private readonly bucket: string;
  // Memoized ensure-bucket: runs once on first upload (sync constructor → no import-time
  // network). Faithful to "ensure before first use" without an async constructor.
  private bucketReady: Promise<void> | undefined;
  // Memoized zones-public-read policy (Z2). Same lazy pattern as bucketReady.
  private zonesPublicReadReady: Promise<void> | undefined;

  constructor(client: S3Client, bucket: string) {
    this.client = client;
    this.bucket = bucket;
  }

  static fromEnv(env: Env): S3Storage {
    const client = new S3Client({
      endpoint: env.STORAGE_ENDPOINT,
      region: env.STORAGE_REGION,
      credentials: {
        accessKeyId: env.STORAGE_ACCESS_KEY,
        secretAccessKey: env.STORAGE_SECRET_KEY,
      },
      forcePathStyle: true,
    });
    return new S3Storage(client, env.STORAGE_BUCKET);
  }

  private ensureBucket(): Promise<void> {
    if (!this.bucketReady) {
      this.bucketReady = (async () => {
        try {
          await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
        } catch {
          await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
        }
      })();
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
        await this.ensureBucket();
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
      await this.ensureBucket();
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
        this.client,
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
// network on import (S3Client connects lazily; ensureBucket runs on first upload).
export const storage: StorageProvider = S3Storage.fromEnv(env);
