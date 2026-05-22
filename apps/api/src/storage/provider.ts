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
}
