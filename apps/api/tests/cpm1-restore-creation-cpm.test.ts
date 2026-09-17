import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  applyCpmRestore,
  collectCpmRestoreInventory,
  parseRestoreArgs,
} from '../scripts/cpm1-restore-creation-cpm.js';
import { db, sql } from '../src/db/client.js';
import { campaignDispatchPlan, campaigns, events, users } from '../src/db/schema.js';

import { type CpmConfigSnapshot, pinCpmConfig, restoreCpmConfig } from './helpers/cpm-config.js';
import { resetAuthTables } from './helpers/db-test-setup.js';

// CPM-1 ruling 1A — the one-off restore: never-dispatched classic campaigns created before the
// cutoff get the operator-confirmed standard CPM back; nothing else moves. The config is pinned at
// the NEW rate (10) so every fixture captures 10 at insert, exactly like prod after 0074.

const CUTOFF = new Date('2026-09-17T11:08:46Z');
const BEFORE = new Date('2026-09-10T09:00:00Z');
const AFTER = new Date('2026-09-17T12:00:00Z');
const UPDATED = new Date('2026-09-11T08:30:00Z');

describe('CPM-1 restore — the creation-time standard CPM for never-dispatched campaigns', () => {
  let pinned: CpmConfigSnapshot;
  let advertiserId = '';
  const ids: Record<string, string> = {};

  const seedCampaign = async (
    key: string,
    values: Partial<typeof campaigns.$inferInsert>,
  ): Promise<void> => {
    const [row] = await db
      .insert(campaigns)
      .values({
        advertiserId,
        name: key,
        campaignType: 'standard',
        createdAt: BEFORE,
        updatedAt: UPDATED,
        ...values,
      })
      .returning({ id: campaigns.id });
    ids[key] = row?.id ?? '';
  };
  const seedPlan = async (key: string): Promise<void> => {
    await db.insert(campaignDispatchPlan).values({
      campaignId: ids[key] ?? '',
      iCible: 20000,
      cpm: '15.000',
      sSpotSeconds: 10,
      tTierCoef: '0.600',
      seuilDiffusable: 1334,
      sMin: '20',
      gJour: '3.3333',
      fMaxSeconds: 300,
      rMinEfficace: 2,
      couvert: 1,
      nMin: 1,
      nMax: 1,
      nRetenus: 1,
    });
  };
  const rowOf = async (key: string) => {
    const [row] = await db
      .select({
        standard: campaigns.standardCpmTnd,
        event: campaigns.eventCpmTnd,
        updatedAt: campaigns.updatedAt,
      })
      .from(campaigns)
      .where(eq(campaigns.id, ids[key] ?? ''));
    return row;
  };

  beforeEach(async () => {
    await resetAuthTables();
    pinned = await pinCpmConfig('10.000', '15.000');
    const [adv] = await db
      .insert(users)
      .values({ email: 'cpm1-restore@example.com', contactName: 'CPM1 restore' })
      .returning({ id: users.id });
    advertiserId = adv?.id ?? '';

    await seedCampaign('draftBefore', { status: 'draft' });
    await seedCampaign('pendingBefore', { status: 'pending' });
    await seedCampaign('rejectedBefore', { status: 'rejected' });
    await seedCampaign('draftAfter', { status: 'draft', createdAt: AFTER });
    await seedCampaign('dispatchedBefore', { status: 'completed' });
    await seedPlan('dispatchedBefore');
    const [ev] = await db
      .insert(events)
      .values({
        name: 'CPM1 restore match',
        kickoffAt: new Date('2026-10-01T19:00:00Z'),
        endsAt: new Date('2026-10-01T21:00:00Z'),
      })
      .returning({ id: events.id });
    await seedCampaign('positioningBefore', {
      status: 'pending',
      campaignType: 'event',
      eventId: ev?.id ?? null,
    });
    await seedCampaign('alreadyAt15', { status: 'draft', standardCpmTnd: '15.000' });
  });

  afterEach(async () => {
    await restoreCpmConfig(pinned);
  });

  afterAll(async () => {
    await resetAuthTables();
    await sql.end();
  });

  it('the dry-run lists exactly the never-dispatched classic campaigns created before the cutoff, and writes nothing', async () => {
    const inventory = await collectCpmRestoreInventory(CUTOFF, '15.000');
    expect(inventory.rows.map((row) => row.name).sort()).toEqual([
      'draftBefore',
      'pendingBefore',
      'rejectedBefore',
    ]);
    expect(inventory.rows.every((row) => row.currentStandardCpmTnd === '10.000')).toBe(true);
    expect(inventory.alreadyAtTarget).toBe(1);
    expect((await rowOf('draftBefore'))?.standard).toBe('10.000');
  });

  it('--execute sets the standard CPM on those rows only, keeps updated_at and the event rate, and a re-run changes nothing', async () => {
    const changed = await applyCpmRestore(await collectCpmRestoreInventory(CUTOFF, '15.000'));
    expect(changed.sort()).toEqual(
      [ids['draftBefore'], ids['pendingBefore'], ids['rejectedBefore']].sort(),
    );
    for (const key of ['draftBefore', 'pendingBefore', 'rejectedBefore']) {
      const row = await rowOf(key);
      expect(row?.standard).toBe('15.000');
      expect(row?.event).toBe('15.000');
      expect(row?.updatedAt.toISOString()).toBe(UPDATED.toISOString());
    }
    // Out of scope: created after the change, already dispatched, an event positioning.
    expect((await rowOf('draftAfter'))?.standard).toBe('10.000');
    expect((await rowOf('dispatchedBefore'))?.standard).toBe('10.000');
    expect((await rowOf('positioningBefore'))?.standard).toBe('10.000');

    const again = await collectCpmRestoreInventory(CUTOFF, '15.000');
    expect(again.rows).toEqual([]);
    expect(again.alreadyAtTarget).toBe(4);
    expect(await applyCpmRestore(again)).toEqual([]);
  });

  it('a campaign dispatched between the dry-run and --execute is skipped', async () => {
    const inventory = await collectCpmRestoreInventory(CUTOFF, '15.000');
    await seedPlan('pendingBefore');
    const changed = await applyCpmRestore(inventory);
    expect(changed.sort()).toEqual([ids['draftBefore'], ids['rejectedBefore']].sort());
    expect((await rowOf('pendingBefore'))?.standard).toBe('10.000');
  });

  it('parses its arguments strictly: both are required, the cutoff needs a zone, the rate is numeric(10, 3)', () => {
    expect(
      parseRestoreArgs(['--created-before', '2026-09-17T11:08:46Z', '--standard-cpm', '15']),
    ).toEqual({
      ok: true,
      args: { createdBefore: CUTOFF, standardCpmTnd: '15.000', execute: false },
    });
    const withExecute = parseRestoreArgs([
      '--created-before',
      '2026-09-17T12:08:46+01:00',
      '--standard-cpm',
      '12.5',
      '--execute',
    ]);
    expect(withExecute).toEqual({
      ok: true,
      args: { createdBefore: CUTOFF, standardCpmTnd: '12.500', execute: true },
    });
    for (const argv of [
      [],
      ['--standard-cpm', '15'],
      ['--created-before', '2026-09-17T11:08:46Z'],
      ['--created-before', '2026-09-17T11:08:46', '--standard-cpm', '15'],
      ['--created-before', '17/09/2026', '--standard-cpm', '15'],
      ['--created-before', '2026-09-17T11:08:46Z', '--standard-cpm', '0'],
      ['--created-before', '2026-09-17T11:08:46Z', '--standard-cpm', '-3'],
      ['--created-before', '2026-09-17T11:08:46Z', '--standard-cpm', '15.0001'],
      ['--created-before', '2026-09-17T11:08:46Z', '--standard-cpm', 'abc'],
    ]) {
      expect(parseRestoreArgs(argv).ok).toBe(false);
    }
  });
});
