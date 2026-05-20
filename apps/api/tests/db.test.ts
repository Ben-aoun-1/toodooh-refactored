import { describe, expect, it } from 'vitest';

import * as schema from '../src/db/schema.js';
import { userRole, userStatus } from '../src/db/schema.js';

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
});
