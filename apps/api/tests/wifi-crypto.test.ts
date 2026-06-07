import { describe, expect, it } from 'vitest';

import { decryptWifiPassword, encryptWifiPassword } from '../src/lib/wifi-crypto.js';

// The key comes from env.WIFI_ENC_KEY, provided as a fixed 32-byte test key by
// vitest.config.ts. These tests never assert on the key or print plaintext.

describe('wifi-crypto', () => {
  it('round-trips: decrypt(encrypt(x)) === x', () => {
    const secret = 'hunter2-café-€-🔒';
    expect(decryptWifiPassword(encryptWifiPassword(secret))).toBe(secret);
  });

  it('round-trips an empty string', () => {
    expect(decryptWifiPassword(encryptWifiPassword(''))).toBe('');
  });

  it('produces an envelope that does not contain the plaintext', () => {
    const secret = 'super-secret-wifi-pw';
    const envelope = encryptWifiPassword(secret);
    expect(envelope).not.toContain(secret);
  });

  it('emits the versioned 4-segment envelope shape', () => {
    const envelope = encryptWifiPassword('pw');
    const parts = envelope.split('.');
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe('v1');
  });

  it('uses a fresh IV so the same plaintext encrypts differently each time', () => {
    const secret = 'same-input';
    expect(encryptWifiPassword(secret)).not.toBe(encryptWifiPassword(secret));
  });

  it('throws when the auth tag is tampered with', () => {
    const envelope = encryptWifiPassword('tamper-me');
    const [version, iv, authTag, ciphertext] = envelope.split('.');
    // Flip the first base64url char of the auth tag to a different valid char.
    const flipped = authTag?.startsWith('A')
      ? `B${authTag.slice(1)}`
      : `A${(authTag ?? '').slice(1)}`;
    const tampered = [version, iv, flipped, ciphertext].join('.');
    expect(() => decryptWifiPassword(tampered)).toThrow();
  });

  it('throws when the ciphertext is tampered with', () => {
    const envelope = encryptWifiPassword('tamper-me');
    const [version, iv, authTag, ciphertext] = envelope.split('.');
    const flipped = ciphertext?.startsWith('A')
      ? `B${ciphertext.slice(1)}`
      : `A${(ciphertext ?? '').slice(1)}`;
    const tampered = [version, iv, authTag, flipped].join('.');
    expect(() => decryptWifiPassword(tampered)).toThrow();
  });

  it('rejects a malformed envelope (wrong segment count)', () => {
    expect(() => decryptWifiPassword('v1.only.three')).toThrow(/expected 4 segments/);
  });

  it('rejects an unsupported envelope version', () => {
    const envelope = encryptWifiPassword('pw');
    const [, iv, authTag, ciphertext] = envelope.split('.');
    const wrongVersion = ['v2', iv, authTag, ciphertext].join('.');
    expect(() => decryptWifiPassword(wrongVersion)).toThrow(/unsupported version/);
  });
});
