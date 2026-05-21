import { describe, expect, it } from 'vitest';

import * as schema from '../src/db/schema.js';
import { accounts, sessions, userRole, userStatus, verifications } from '../src/db/schema.js';

describe('db schema', () => {
  it('imports without opening a connection', () => {
    expect(schema).toBeDefined();
  });

  it('user_role enum has exactly the five locked values', () => {
    expect(userRole.enumValues).toEqual([
      'advertiser',
      'individual_owner',
      'fleet_owner',
      'admin',
      'superadmin',
    ]);
  });

  it('user_status enum has exactly the three locked values', () => {
    expect(userStatus.enumValues).toEqual(['pending', 'approved', 'rejected']);
  });

  it('accounts table exposes its credential + provider + FK columns', () => {
    expect(accounts.accountId).toBeDefined();
    expect(accounts.providerId).toBeDefined();
    expect(accounts.userId).toBeDefined();
    expect(accounts.password).toBeDefined();
  });

  it('sessions table exposes token + userId + expiresAt', () => {
    expect(sessions.token).toBeDefined();
    expect(sessions.userId).toBeDefined();
    expect(sessions.expiresAt).toBeDefined();
  });

  it('verifications table exposes identifier + value + expiresAt', () => {
    expect(verifications.identifier).toBeDefined();
    expect(verifications.value).toBeDefined();
    expect(verifications.expiresAt).toBeDefined();
  });
});
