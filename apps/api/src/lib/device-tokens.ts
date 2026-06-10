import { createHash, randomBytes } from 'node:crypto';

// Device-session token plumbing (MAP M1). Tokens are OPAQUE 32-byte random values (no JWT,
// no embedded claims — the row is the session). Only sha-256 digests are stored; the raw
// token exists exactly once, in the login/refresh response. sha-256 (not scrypt) is right
// here: the input is 256 bits of entropy, not a guessable password, so a fast hash is safe
// and keeps the per-request guard cheap.
export const ACCESS_TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12h
export const REFRESH_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90d

export const generateDeviceToken = (): string => randomBytes(32).toString('base64url');

export const hashDeviceToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

export const newTokenPair = (now: Date) => {
  const accessToken = generateDeviceToken();
  const refreshToken = generateDeviceToken();
  return {
    accessToken,
    refreshToken,
    accessTokenHash: hashDeviceToken(accessToken),
    refreshTokenHash: hashDeviceToken(refreshToken),
    accessExpiresAt: new Date(now.getTime() + ACCESS_TOKEN_TTL_MS),
    refreshExpiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL_MS),
  };
};
