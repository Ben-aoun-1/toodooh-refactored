import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { db, sql } from '../src/db/client.js';
import { screenhosts, users } from '../src/db/schema.js';
import { listResyncTargets, resyncAllLocations } from '../src/lib/wedooh-sync.js';
import { encryptWifiPassword } from '../src/lib/wifi-crypto.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// LEARN-1 T1 — the ONE full re-sync after the deploy that added the hours: the sweep never
// re-pushes an already-exported venue, so without this the hub would learn with no hours at all.
//
// Split out of wedooh-sync.test.ts (controller ruling P1, 2026-09-21): that file was already ~373
// lines and the brief's Task 6 tests would push it past the repo's 400-line cap. Setup below (CFG,
// logger, seedOwnerWithScreenhost, beforeEach/afterEach/afterAll) is copied verbatim from
// wedooh-sync.test.ts. The sync env is UNSET in tests, so config is passed as an override and
// global fetch is mocked — no real wedooh call.

const CFG = { ingestUrl: 'https://hub.example', syncKey: 'k'.repeat(16) };
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

const seedOwnerWithScreenhost = async (businessSectorId: string | null = null) => {
  const [owner] = await db
    .insert(users)
    .values({
      email: 'o@example.com',
      contactName: 'Owner',
      role: 'individual_owner',
      status: 'approved',
    })
    .returning({ id: users.id });
  const [host] = await db
    .insert(screenhosts)
    .values({
      name: 'Place A',
      ownerId: owner!.id,
      wifiSsid: 'Net',
      wifiPasswordEncrypted: encryptWifiPassword('pw'),
      businessSectorId,
    })
    .returning({ id: screenhosts.id });
  return { ownerId: owner!.id, hostId: host!.id };
};

describe('LEARN-1 T1 — resyncAllLocations (the one-time full re-sync)', () => {
  beforeEach(async () => {
    await resetAuthTables();
    logger.info.mockClear();
    logger.warn.mockClear();
    logger.error.mockClear();
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await sql.end();
  });

  it('pushes EVERY approved owner’s venue whatever its export_status; never an unapproved one', async () => {
    const { hostId } = await seedOwnerWithScreenhost();
    await db
      .update(screenhosts)
      .set({ exportStatus: 'exported', openingHour: 10, closingHour: 2 })
      .where(eq(screenhosts.id, hostId));
    const [pendingOwner] = await db
      .insert(users)
      .values({
        email: 'pending@example.com',
        contactName: 'Pending',
        role: 'individual_owner',
        status: 'pending',
      })
      .returning({ id: users.id });
    const [unapproved] = await db
      .insert(screenhosts)
      .values({ name: 'Place P', ownerId: pendingOwner!.id })
      .returning({ id: screenhosts.id });
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 200 }));

    expect((await listResyncTargets()).map((t) => t.id)).toEqual([hostId]);
    expect(await resyncAllLocations(logger, CFG)).toEqual({ exported: 1, failed: 0, skipped: 0 });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
    expect(payload).toMatchObject({ location_id: hostId, opening_hour: 10, closing_hour: 2 });
    const [row] = await db.select().from(screenhosts).where(eq(screenhosts.id, unapproved!.id));
    expect(row?.exportStatus).toBe('pending'); // never pushed
  });

  it('a hub refusal is COUNTED and stamped failed (the sweep retries), never thrown', async () => {
    const { hostId } = await seedOwnerWithScreenhost();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 400 }));
    expect(await resyncAllLocations(logger, CFG)).toEqual({ exported: 0, failed: 1, skipped: 0 });
    const [row] = await db.select().from(screenhosts).where(eq(screenhosts.id, hostId));
    expect(row?.exportStatus).toBe('failed');
  });

  it('null and no fetch when the sync env is unset', async () => {
    await seedOwnerWithScreenhost();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    expect(await resyncAllLocations(logger)).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
