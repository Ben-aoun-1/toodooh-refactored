import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { db, sql } from '../src/db/client.js';
import { screenhosts, users } from '../src/db/schema.js';
import { isSyncEnabled, pushApprovedOwnerLocations } from '../src/lib/wedooh-sync.js';
import { encryptWifiPassword } from '../src/lib/wifi-crypto.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// Edge B2 push (toodooh → wedooh). The sync env is UNSET in tests, so the config is passed as an
// override (mirroring requireSyncKey) and global fetch is mocked — no real wedooh call.

const CFG = { ingestUrl: 'https://hub.example', syncKey: 'k'.repeat(16) };
const logger = { info: vi.fn(), warn: vi.fn() };

const seedOwnerWithScreenhost = async () => {
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
    })
    .returning({ id: screenhosts.id });
  return { ownerId: owner!.id, hostId: host!.id };
};

describe('Edge B2 — pushApprovedOwnerLocations', () => {
  beforeEach(async () => {
    await resetAuthTables();
    logger.warn.mockClear();
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await sql.end();
  });

  it('no-op when the sync env is unset (no fetch, status stays pending)', async () => {
    const { ownerId, hostId } = await seedOwnerWithScreenhost();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    expect(isSyncEnabled()).toBe(false);
    await pushApprovedOwnerLocations(ownerId, logger); // no override → uses unset env
    expect(fetchSpy).not.toHaveBeenCalled();
    const [row] = await db.select().from(screenhosts).where(eq(screenhosts.id, hostId));
    expect(row?.exportStatus).toBe('pending');
  });

  it('pushes each location with decrypted WiFi + x-api-key, then stamps exported', async () => {
    const { ownerId, hostId } = await seedOwnerWithScreenhost();
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 200 }));

    await pushApprovedOwnerLocations(ownerId, logger, CFG);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('https://hub.example/api/sync/locations');
    expect((opts as RequestInit).method).toBe('POST');
    expect((opts as RequestInit).headers).toMatchObject({ 'x-api-key': CFG.syncKey });
    const payload = JSON.parse((opts as RequestInit).body as string);
    expect(payload.location_id).toBe(hostId);
    expect(payload.wifi_password).toBe('pw'); // decrypted on the wire (privileged transfer)
    expect(payload.owner.email).toBe('o@example.com');

    const [row] = await db.select().from(screenhosts).where(eq(screenhosts.id, hostId));
    expect(row?.exportStatus).toBe('exported');
    expect(row?.exportedAt).not.toBeNull();
  });

  it('a non-2xx response stamps failed (the sweep will retry); never throws', async () => {
    const { ownerId, hostId } = await seedOwnerWithScreenhost();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 502 }));

    await expect(pushApprovedOwnerLocations(ownerId, logger, CFG)).resolves.toBeUndefined();

    const [row] = await db.select().from(screenhosts).where(eq(screenhosts.id, hostId));
    expect(row?.exportStatus).toBe('failed');
    expect(logger.warn).toHaveBeenCalled();
  });
});
