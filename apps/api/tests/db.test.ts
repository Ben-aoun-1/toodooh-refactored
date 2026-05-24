import { TransactionRollbackError } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { db, sql } from '../src/db/client.js';
import * as schema from '../src/db/schema.js';
import {
  accounts,
  businessSectors,
  governorates,
  predefinedZones,
  sessions,
  userRole,
  users,
  userStatus,
  verifications,
} from '../src/db/schema.js';

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

  it('users exposes the nine onboarding columns (Phase 1c)', () => {
    expect(users.businessSectorId).toBeDefined();
    expect(users.businessType).toBeDefined();
    expect(users.streetAddress).toBeDefined();
    expect(users.city).toBeDefined();
    expect(users.postalCode).toBeDefined();
    expect(users.governorateId).toBeDefined();
    expect(users.registrationDocUrl).toBeDefined();
    expect(users.cinDocUrl).toBeDefined();
    expect(users.onboardingCompleted).toBeDefined();
  });

  it('users exposes contact_name (renamed from name) + notify_* columns (Commit 3)', () => {
    expect(users.contactName).toBeDefined();
    expect((users as unknown as Record<string, unknown>)['name']).toBeUndefined(); // renamed away
    expect(users.notifyNewsUpdates).toBeDefined();
    expect(users.notifyRemindersEvents).toBeDefined();
    expect(users.notifyPromotionsOffers).toBeDefined();
  });

  it('users exposes fonction + zone columns (Commit 4)', () => {
    expect(users.fonction).toBeDefined();
    expect(users.zone).toBeDefined();
  });

  it('reference tables export their key columns', () => {
    expect(governorates.name).toBeDefined();
    expect(businessSectors.name).toBeDefined();
    expect(businessSectors.audience).toBeDefined();
    expect(businessSectors.displayOrder).toBeDefined();
    expect(predefinedZones.name).toBeDefined();
    expect(predefinedZones.latitude).toBeDefined();
    expect(predefinedZones.longitude).toBeDefined();
    expect(predefinedZones.radius).toBeDefined();
  });
});

// Integration suite — requires a real Postgres (DATABASE_URL env). Read-only
// against the reference tables (which signup.test.ts never touches), so it is
// race-safe under vitest file parallelism; the FK probe inserts inside a
// transaction that rolls back, leaving no row to collide with signup's
// per-test TRUNCATE users.
describe('reference-table seeds (Postgres)', () => {
  afterAll(async () => {
    await sql.end();
  });

  it('governorates seed = 24 rows', async () => {
    expect(await db.$count(governorates)).toBe(24);
  });

  it('predefined_zones seed = 8 rows', async () => {
    expect(await db.$count(predefinedZones)).toBe(8);
  });

  it('business_sectors seed = 29 rows (25 advertiser + 4 owner)', async () => {
    const rows = await db.select({ audience: businessSectors.audience }).from(businessSectors);
    expect(rows).toHaveLength(29);
    expect(rows.filter((r) => r.audience === 'advertiser')).toHaveLength(25);
    expect(rows.filter((r) => r.audience === 'owner')).toHaveLength(4);
    expect(rows.every((r) => r.audience === 'advertiser' || r.audience === 'owner')).toBe(true);
  });

  it('users FK resolves against a seeded governorate + business_sector', async () => {
    const [gov] = await db.select().from(governorates).limit(1);
    const [sector] = await db.select().from(businessSectors).limit(1);
    expect(gov).toBeDefined();
    expect(sector).toBeDefined();

    let probed: { governorateId: string | null; businessSectorId: string | null } | undefined;
    try {
      await db.transaction(async (tx) => {
        const inserted = await tx
          .insert(users)
          .values({
            email: `fk-probe-${Date.now()}@example.com`,
            contactName: 'FK Probe',
            governorateId: gov?.id,
            businessSectorId: sector?.id,
          })
          .returning();
        probed = {
          governorateId: inserted[0]?.governorateId ?? null,
          businessSectorId: inserted[0]?.businessSectorId ?? null,
        };
        tx.rollback();
      });
    } catch (err) {
      // drizzle's tx.rollback() throws by design to abort — swallow only that.
      if (!(err instanceof TransactionRollbackError)) throw err;
    }

    expect(probed?.governorateId).toBe(gov?.id);
    expect(probed?.businessSectorId).toBe(sector?.id);
  });
});
