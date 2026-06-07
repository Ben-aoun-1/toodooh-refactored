import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { env } from '../env.js';

// App-layer AES-256-GCM for screenhost WiFi passwords. These must be RECOVERABLE
// (decryptable for a future TOODOOH Internal export), so we encrypt — never hash.
// The plaintext and the key are NEVER logged or echoed anywhere in this module.

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // 96-bit nonce, the GCM-recommended size
const VERSION = 'v1'; // envelope version prefix, reserved for future key rotation

// Decoded at module load; env.WIFI_ENC_KEY is validated to be base64 → exactly
// 32 bytes at boot (src/env.ts), so this is a 256-bit key by construction.
const KEY = Buffer.from(env.WIFI_ENC_KEY, 'base64');

/**
 * Encrypt a WiFi password for at-rest storage.
 *
 * Returns a self-describing envelope: `v1.<iv>.<authTag>.<ciphertext>` where each
 * segment is base64url. A fresh random 12-byte IV is generated per call, so the
 * same plaintext encrypts to a different envelope every time.
 */
export const encryptWifiPassword = (plain: string): string => {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString('base64url'),
    authTag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
};

/**
 * Decrypt an envelope produced by {@link encryptWifiPassword}.
 *
 * Throws if the envelope is malformed, the version is unrecognised, or the GCM
 * auth tag fails to verify (tampered ciphertext/tag or wrong key).
 */
export const decryptWifiPassword = (envelope: string): string => {
  const parts = envelope.split('.');
  if (parts.length !== 4) {
    throw new Error('Invalid WiFi password envelope: expected 4 segments');
  }
  const [version, ivB64, authTagB64, ciphertextB64] = parts;
  if (version !== VERSION) {
    throw new Error(`Invalid WiFi password envelope: unsupported version "${version}"`);
  }
  const iv = Buffer.from(ivB64 ?? '', 'base64url');
  const authTag = Buffer.from(authTagB64 ?? '', 'base64url');
  const ciphertext = Buffer.from(ciphertextB64 ?? '', 'base64url');
  const decipher = createDecipheriv(ALGORITHM, KEY, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
};
