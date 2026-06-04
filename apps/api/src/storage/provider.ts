// StorageProvider mirrors EmailSender (shaped results, not throws) for consistent,
// explicit caller handling. NOTE: unlike EmailSender's never-throw (a throw there
// cascaded to signup orphan-rollback), storage has no downstream cascade — shaped
// results here are ergonomics, not a safety lock.
export type UploadResult = { key: string } | { error: string };
export type PresignResult = { url: string } | { error: string };
export type DeleteResult = { deleted: boolean } | { error: string };

export interface StorageProvider {
  upload(params: { key: string; body: Buffer; contentType: string }): Promise<UploadResult>;
  getPresignedUrl(params: { key: string; expiresInSeconds?: number }): Promise<PresignResult>;
  delete(params: { key: string }): Promise<DeleteResult>;
  // Z2 (Option 1): idempotently grant ANONYMOUS s3:GetObject to the `zones/*` prefix only, so the
  // public catalog imagery renders via a durable /storage/<key> URL while private prefixes
  // (rne/, cin/) stay deny-by-default. Merges into any pre-existing bucket policy (full-replace API).
  ensureZonesPublicRead(): Promise<void>;
  // Idempotent: ensure the bucket exists. Called once at boot (slice-1 hotfix C1) so the
  // first upload doesn't pay the head-then-create round-trip; safe to call repeatedly.
  ensureReady(): Promise<void>;
}
