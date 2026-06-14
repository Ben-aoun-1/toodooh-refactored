import { TransactionRollbackError } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { db, sql } from '../src/db/client.js';
import * as schema from '../src/db/schema.js';
import {
  accounts,
  businessSectors,
  deviceSessions,
  documentCategory,
  governorates,
  predefinedZones,
  screenhostExportStatus,
  screenhosts,
  screens,
  sessions,
  userDocuments,
  userRole,
  users,
  userStatus,
  verifications,
} from '../src/db/schema.js';

describe('db schema', () => {
  it('imports without opening a connection', () => {
    expect(schema).toBeDefined();
  });

  it('user_role enum has exactly the seven locked values', () => {
    expect(userRole.enumValues).toEqual([
      'advertiser',
      'individual_owner',
      'fleet_owner',
      'admin',
      'superadmin',
      // slice-2 A — admin-created agent roles (screenhost_agent = E inventory path)
      'screenhost_agent',
      'screencast_agent',
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

  it('users exposes agent_code + terms_accepted_at columns (Phase 1e signup-grows)', () => {
    expect(users.agentCode).toBeDefined();
    expect(users.termsAcceptedAt).toBeDefined();
  });

  it('device_sessions exposes the token-auth columns (MAP M1)', () => {
    expect(deviceSessions.userId).toBeDefined();
    expect(deviceSessions.accessTokenHash).toBeDefined();
    expect(deviceSessions.refreshTokenHash).toBeDefined();
    expect(deviceSessions.accessExpiresAt).toBeDefined();
    expect(deviceSessions.refreshExpiresAt).toBeDefined();
    expect(deviceSessions.deviceType).toBeDefined();
    expect(deviceSessions.revokedAt).toBeDefined();
    expect(deviceSessions.lastUsedAt).toBeDefined();
  });

  it('screens exposes the pair/liveness columns (MAP M1)', () => {
    expect(screens.screenhostId).toBeDefined();
    expect(screens.name).toBeDefined();
    expect(screens.isActive).toBeDefined();
    expect(screens.pairedAt).toBeDefined();
    expect(screens.lastSeenAt).toBeDefined();
  });

  it('user_documents exposes the multi-doc columns + category enum (F-docs Commit 1)', () => {
    expect(documentCategory.enumValues).toEqual(['cin', 'rne', 'complementaire', 'bank']);
    expect(userDocuments.userId).toBeDefined();
    expect(userDocuments.category).toBeDefined();
    expect(userDocuments.position).toBeDefined();
    expect(userDocuments.storageKey).toBeDefined();
    expect(userDocuments.originalFilename).toBeDefined();
    expect(userDocuments.mimeType).toBeDefined();
    expect(userDocuments.sizeBytes).toBeDefined();
    expect(userDocuments.uploadedAt).toBeDefined();
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

  it('screenhost_export_status enum mirrors the status convention (pending → exported)', () => {
    expect(screenhostExportStatus.enumValues).toEqual(['pending', 'exported']);
  });

  it('screenhosts exposes coordinate + metadata + ownership + wifi/export columns (Slice-2 E)', () => {
    expect(screenhosts.name).toBeDefined();
    expect(screenhosts.latitude).toBeDefined();
    expect(screenhosts.longitude).toBeDefined();
    expect(screenhosts.screenCount).toBeDefined();
    expect(screenhosts.address).toBeDefined();
    expect(screenhosts.city).toBeDefined();
    expect(screenhosts.postalCode).toBeDefined();
    expect(screenhosts.governorateId).toBeDefined();
    expect(screenhosts.zone).toBeDefined();
    expect(screenhosts.isActive).toBeDefined();
    expect(screenhosts.ownerId).toBeDefined();
    expect(screenhosts.wifiSsid).toBeDefined();
    expect(screenhosts.wifiPasswordEncrypted).toBeDefined();
    expect(screenhosts.exportStatus).toBeDefined();
    expect(screenhosts.exportedAt).toBeDefined();
    // CF-19 P0 rework: the agent-create column is gone; owner_id replaces screenhost_id.
    const cols = screenhosts as unknown as Record<string, unknown>;
    expect(cols['createdBy']).toBeUndefined();
    expect(cols['screenhostId']).toBeUndefined();
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

  it('predefined_zones seed = 1 row (0012 collapsed the 0003 eight into GRAND TUNIS)', async () => {
    expect(await db.$count(predefinedZones)).toBe(1);
    const [zone] = await db.select({ name: predefinedZones.name }).from(predefinedZones);
    expect(zone?.name).toBe('GRAND TUNIS');
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
