import { TransactionRollbackError } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { db, sql } from '../src/db/client.js';
import * as schema from '../src/db/schema.js';
import {
  accounts,
  businessSectors,
  campaignDispatchAllocation,
  campaignDispatchPlan,
  campaignStatus,
  campaignTargeting,
  campaigns,
  creativeType,
  creativeValidationStatus,
  creatives,
  deviceSessions,
  dispatchAcceptation,
  dispatchConfig,
  documentCategory,
  governorates,
  predefinedZones,
  screenhostExportStatus,
  screenhosts,
  proofOfPlay,
  proofOfPlayEvent,
  screens,
  sessions,
  targetingClass,
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

  it('user_status enum has exactly the four locked values (banned added — N3 Scenario 2)', () => {
    expect(userStatus.enumValues).toEqual(['pending', 'approved', 'rejected', 'banned']);
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

  it('screenhost_export_status enum mirrors the status convention (pending → exported → failed)', () => {
    // 'failed' added by S-T1 (0016): a B2 push that errored; the sweep re-pushes pending+failed.
    expect(screenhostExportStatus.enumValues).toEqual(['pending', 'exported', 'failed']);
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

  it('screenhosts exposes the L-inv eligibility columns (per-venue dispatch inputs)', () => {
    expect(screenhosts.businessSectorId).toBeDefined(); // per-venue category
    expect(screenhosts.class).toBeDefined(); // venue tier (targeting_class)
    expect(screenhosts.openingHour).toBeDefined();
    expect(screenhosts.closingHour).toBeDefined();
    expect(screenhosts.broadcastCapacity).toBeDefined();
    expect(screenhosts.sps).toBeDefined(); // neutral default 50; computation deferred
  });

  it('campaign_status enum mirrors the status convention (draft → pending → active → rejected)', () => {
    expect(campaignStatus.enumValues).toEqual(['draft', 'pending', 'active', 'rejected']);
  });

  it('campaigns exposes the draft-lifecycle + approval-audit columns (C1)', () => {
    expect(campaigns.advertiserId).toBeDefined();
    expect(campaigns.name).toBeDefined();
    expect(campaigns.campaignType).toBeDefined();
    expect(campaigns.status).toBeDefined();
    expect(campaigns.startDate).toBeDefined();
    expect(campaigns.endDate).toBeDefined();
    expect(campaigns.description).toBeDefined();
    expect(campaigns.submittedAt).toBeDefined();
    expect(campaigns.createdAt).toBeDefined();
    expect(campaigns.updatedAt).toBeDefined();
    // Links to ONE creative (L-spot rename of video_id → creative_id).
    expect(campaigns.creativeId).toBeDefined();
    // Bifurcated approval (C1 Commit 3): the campaign-level validation trio was removed — an admin
    // validates the CREATIVE (creatives table) and owners approve via campaign_owner_approvals, so
    // a campaign's activation is derived, not a single campaign-level admin validation.
    const cols = campaigns as unknown as Record<string, unknown>;
    expect(cols['validatedBy']).toBeUndefined();
    expect(cols['validatedAt']).toBeUndefined();
    expect(cols['validationNotes']).toBeUndefined();
    // The #54 column was renamed; the old name must be gone.
    expect(cols['videoId']).toBeUndefined();
  });

  it('creative_type + creative_validation_status enums mirror the spec (video|photo; pending→approved→rejected)', () => {
    expect(creativeType.enumValues).toEqual(['video', 'photo']);
    expect(creativeValidationStatus.enumValues).toEqual(['pending', 'approved', 'rejected']);
  });

  it('creatives exposes the media + admin-moderation columns (L-spot, renamed from videos)', () => {
    expect(creatives.advertiserId).toBeDefined();
    expect(creatives.creativeType).toBeDefined();
    expect(creatives.title).toBeDefined();
    expect(creatives.storageKey).toBeDefined();
    expect(creatives.durationSeconds).toBeDefined();
    expect(creatives.validationStatus).toBeDefined();
    // Admin-validation audit trio lives HERE (the bifurcated content gate).
    expect(creatives.validatedBy).toBeDefined();
    expect(creatives.validatedAt).toBeDefined();
    expect(creatives.validationNotes).toBeDefined();
    expect(creatives.originalFilename).toBeDefined();
    expect(creatives.mimeType).toBeDefined();
    expect(creatives.sizeBytes).toBeDefined();
  });

  it('targeting_class enum mirrors the spec (populaire → moyen → premium)', () => {
    expect(targetingClass.enumValues).toEqual(['populaire', 'moyen', 'premium']);
  });

  it('campaign_targeting exposes category × class line columns (L-target)', () => {
    expect(campaignTargeting.campaignId).toBeDefined();
    // category_id + class are NULLABLE — null = "toutes" (ALL); the null/null line = whole network.
    expect(campaignTargeting.categoryId).toBeDefined();
    expect(campaignTargeting.class).toBeDefined();
    expect(campaignTargeting.createdAt).toBeDefined();
  });

  it('dispatch_config exposes the calibratable thresholds (S_min/G_jour are NOT stored)', () => {
    expect(dispatchConfig.seuilDiffusable).toBeDefined();
    expect(dispatchConfig.gMois).toBeDefined();
    expect(dispatchConfig.joursActifs).toBeDefined();
    expect(dispatchConfig.rMinEfficace).toBeDefined();
    expect(dispatchConfig.fMaxSeconds).toBeDefined();
    const cols = dispatchConfig as unknown as Record<string, unknown>;
    expect(cols['sMin']).toBeUndefined(); // derived, never stored
    expect(cols['gJour']).toBeUndefined();
  });

  it('dispatch_acceptation enum + the frozen-plan tables expose their columns (L-disp A.7)', () => {
    expect(dispatchAcceptation.enumValues).toEqual(['EN_ATTENTE', 'ACCEPTE', 'REFUSE']);
    expect(campaignDispatchPlan.campaignId).toBeDefined();
    expect(campaignDispatchPlan.iCible).toBeDefined();
    expect(campaignDispatchPlan.seuilDiffusable).toBeDefined();
    expect(campaignDispatchPlan.sMin).toBeDefined();
    expect(campaignDispatchPlan.gJour).toBeDefined();
    expect(campaignDispatchPlan.couvert).toBeDefined();
    expect(campaignDispatchPlan.isPartial).toBeDefined();
    expect(campaignDispatchPlan.isTooThin).toBeDefined();
    expect(campaignDispatchAllocation.iiPotentiel).toBeDefined();
    expect(campaignDispatchAllocation.rI).toBeDefined();
    expect(campaignDispatchAllocation.revenuPrevisionnel).toBeDefined();
    expect(campaignDispatchAllocation.statutAcceptation).toBeDefined();
    expect(campaignDispatchAllocation.creneaux).toBeDefined();
  });

  it('proof_of_play exposes the proof columns + event enum (L-playout substrate)', () => {
    expect(proofOfPlayEvent.enumValues).toEqual(['VIDEO_STARTED', 'VIDEO_ENDED']);
    expect(proofOfPlay.screenId).toBeDefined();
    expect(proofOfPlay.screenhostId).toBeDefined();
    expect(proofOfPlay.campaignId).toBeDefined();
    expect(proofOfPlay.creativeId).toBeDefined();
    expect(proofOfPlay.videoIdAsSent).toBeDefined();
    expect(proofOfPlay.eventType).toBeDefined();
    expect(proofOfPlay.playedDurationMs).toBeDefined();
    expect(proofOfPlay.eventTs).toBeDefined();
    expect(proofOfPlay.receivedAt).toBeDefined();
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

  it('business_sectors seed = 30 rows (25 advertiser + 5 owner after 0036)', async () => {
    const rows = await db.select({ audience: businessSectors.audience }).from(businessSectors);
    expect(rows).toHaveLength(30);
    expect(rows.filter((r) => r.audience === 'advertiser')).toHaveLength(25);
    expect(rows.filter((r) => r.audience === 'owner')).toHaveLength(5);
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
