import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
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
