import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { db, sql } from '../src/db/client.js';
import { agentReferrals, agents, businessSectors, screenhosts, users } from '../src/db/schema.js';
import {
  isSyncEnabled,
  pushAgentToHub,
  pushApprovedOwnerLocations,
} from '../src/lib/wedooh-sync.js';
import { encryptWifiPassword } from '../src/lib/wifi-crypto.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// Edge B2 push (toodooh → wedooh). The sync env is UNSET in tests, so the config is passed as an
// override (mirroring requireSyncKey) and global fetch is mocked — no real wedooh call.

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

describe('Edge B2 — pushApprovedOwnerLocations', () => {
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
    expect(payload.agent_code).toBeNull(); // this owner has no referral
    // Sectorless venue → the key is PRESENT with an explicit null (never omitted — wedooh's
    // receiver is .strict() with all keys required).
    expect(payload).toHaveProperty('business_sector');
    expect(payload.business_sector).toBeNull();

    const [row] = await db.select().from(screenhosts).where(eq(screenhosts.id, hostId));
    expect(row?.exportStatus).toBe('exported');
    expect(row?.exportedAt).not.toBeNull();
  });

  it('carries the venue business_sector NAME when the venue has a sector (Lane B)', async () => {
    const [sector] = await db
      .select({ id: businessSectors.id, name: businessSectors.name })
      .from(businessSectors)
      .where(eq(businessSectors.audience, 'owner'))
      .limit(1);
    expect(sector).toBeDefined();
    const { hostId, ownerId } = await seedOwnerWithScreenhost(sector!.id);
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 200 }));

    await pushApprovedOwnerLocations(ownerId, logger, CFG);

    const payload = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
    expect(payload.location_id).toBe(hostId);
    // The NAME rides the wire (hub taxonomy = the same canonical 5 strings — identity mapping).
    expect(payload.business_sector).toBe(sector!.name);
  });

  it('carries the referring agent code when the owner has a referral (HB3 assignment)', async () => {
    const { ownerId, hostId } = await seedOwnerWithScreenhost();
    // A referring screenhost_agent: user + issued code + the (UNIQUE) referral link to the owner.
    const [agentUser] = await db
      .insert(users)
      .values({
        email: 'agent@example.com',
        contactName: 'Agent',
        role: 'screenhost_agent',
        status: 'approved',
      })
      .returning({ id: users.id });
    await db.insert(agents).values({ userId: agentUser!.id, code: 'SH424242' });
    await db.insert(agentReferrals).values({
      agentUserId: agentUser!.id,
      referredUserId: ownerId,
      agentCodeUsed: 'sh424242', // raw entered value; the payload carries the canonical agents.code
    });
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 200 }));

    await pushApprovedOwnerLocations(ownerId, logger, CFG);

    const payload = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
    expect(payload.location_id).toBe(hostId);
    expect(payload.agent_code).toBe('SH424242');
  });

  it('a non-2xx response stamps failed (the sweep will retry); never throws', async () => {
    const { ownerId, hostId } = await seedOwnerWithScreenhost();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 502 }));

    await expect(pushApprovedOwnerLocations(ownerId, logger, CFG)).resolves.toBeUndefined();

    const [row] = await db.select().from(screenhosts).where(eq(screenhosts.id, hostId));
    expect(row?.exportStatus).toBe('failed');
    expect(logger.warn).toHaveBeenCalled();
  });

  describe('pushAgentToHub (agent provisioning)', () => {
    const AGENT = {
      toodooh_user_id: 'u1',
      code: 'SH123456',
      email: 'agent@example.com',
      password: 'tempPlaintextPw',
      role: 'screenhost_agent',
    };

    it('POSTs the agent to /api/sync/agents with x-api-key + the exact payload; no leak', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response(null, { status: 200 }));

      await pushAgentToHub(AGENT, logger, CFG);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, opts] = fetchSpy.mock.calls[0]!;
      expect(url).toBe('https://hub.example/api/sync/agents');
      expect((opts as RequestInit).method).toBe('POST');
      expect((opts as RequestInit).headers).toMatchObject({ 'x-api-key': CFG.syncKey });
      // role is normalized to the hub-accepted 'agent' on the wire; everything else verbatim.
      expect(JSON.parse((opts as RequestInit).body as string)).toEqual({ ...AGENT, role: 'agent' });
      // The plaintext password rides the body but is NEVER logged.
      const logged = [
        ...logger.info.mock.calls,
        ...logger.warn.mock.calls,
        ...logger.error.mock.calls,
      ]
        .flat()
        .join(' ');
      expect(logged).not.toContain(AGENT.password);
    });

    it('no-op (no fetch) + logs "disabled" when the sync env is unset', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      expect(isSyncEnabled()).toBe(false);
      await pushAgentToHub(AGENT, logger); // no override → unset env
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalled();
    });

    it('never rejects on a non-2xx hub response (non-blocking); logs at ERROR', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 502 }));
      await expect(pushAgentToHub(AGENT, logger, CFG)).resolves.toBeUndefined();
      expect(logger.error).toHaveBeenCalled(); // a silent 400/5xx here kills login-by-code
    });

    // CROSS-BOUNDARY contract guard. Mirrors the hub's agentSyncSchema for POST /api/sync/agents
    // (the receiver — separate repo): it accepts ONLY role 'agent' (the SH/SC subtype is carried by
    // the code prefix). MUST stay in sync with the hub. This is the test that catches a role-contract
    // drift — with the raw user_role on the wire the hub 400s and the agent is never created.
    const hubAgentSyncSchema = z.object({
      toodooh_user_id: z.string(),
      code: z.string(),
      email: z.string(),
      password: z.string(),
      role: z.enum(['agent']),
    });

    // Only screenhost agents reach the wire now (screencast is skipped at the source — R4 below), so
    // the normalization contract guard runs on screenhost_agent.
    it('normalizes role to the hub-accepted "agent" for a screenhost_agent', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response(null, { status: 200 }));
      await pushAgentToHub(
        {
          toodooh_user_id: 'u1',
          code: 'SH123456',
          email: 'a@b.com',
          password: 'pw',
          role: 'screenhost_agent',
        },
        logger,
        CFG,
      );
      const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
      expect(body.role).toBe('agent'); // NOT the raw user_role — that 400s on the hub
      expect(() => hubAgentSyncSchema.parse(body)).not.toThrow();
      expect(body).toMatchObject({
        toodooh_user_id: 'u1',
        code: 'SH123456',
        email: 'a@b.com',
        password: 'pw',
        role: 'agent',
      });
    });

    // FX3 visibility: the push stamps agents.export_status so a hub-down is never silent. The stamp
    // is awaited inside pushAgentToHub, so the DB reflects it right after the call (deterministic).
    const seedAgent = async (email: string, code: string): Promise<string> => {
      const [u] = await db
        .insert(users)
        .values({ email, contactName: 'Agent', role: 'screenhost_agent', status: 'approved' })
        .returning({ id: users.id });
      await db.insert(agents).values({ userId: u!.id, code });
      return u!.id;
    };

    it('stamps export_status "exported" on a successful push', async () => {
      const userId = await seedAgent('exp@example.com', 'SH909090');
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));
      await pushAgentToHub(
        {
          toodooh_user_id: userId,
          code: 'SH909090',
          email: 'exp@example.com',
          password: 'pw',
          role: 'screenhost_agent',
        },
        logger,
        CFG,
      );
      const [a] = await db.select().from(agents).where(eq(agents.userId, userId));
      expect(a?.exportStatus).toBe('exported');
    });

    it('stamps export_status "failed" on a non-2xx push (visibility, not silent)', async () => {
      const userId = await seedAgent('fail@example.com', 'SH808080');
      // a freshly-seeded agent starts at the column default
      const [before] = await db.select().from(agents).where(eq(agents.userId, userId));
      expect(before?.exportStatus).toBe('pending');
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 502 }));
      await pushAgentToHub(
        {
          toodooh_user_id: userId,
          code: 'SH808080',
          email: 'fail@example.com',
          password: 'pw',
          role: 'screenhost_agent',
        },
        logger,
        CFG,
      );
      const [a] = await db.select().from(agents).where(eq(agents.userId, userId));
      expect(a?.exportStatus).toBe('failed');
    });

    // R4 — screencast agents must NEVER be provisioned to the hub. pushAgentToHub short-circuits on
    // the raw role BEFORE any POST, and leaves export_status untouched (no 'exported'/'failed').
    it('does NOT POST a screencast agent and does not stamp "exported" (R4)', async () => {
      const userId = await seedAgent('cast@example.com', 'SC123456');
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      await pushAgentToHub(
        {
          toodooh_user_id: userId,
          code: 'SC123456',
          email: 'cast@example.com',
          password: 'pw',
          role: 'screencast_agent',
        },
        logger,
        CFG,
      );
      // The hub is never called from the source.
      expect(fetchSpy).not.toHaveBeenCalled();
      const [a] = await db.select().from(agents).where(eq(agents.userId, userId));
      // Never provisioned → export_status stays at its default; not stamped 'exported'.
      expect(a?.exportStatus).toBe('pending');
      expect(a?.exportStatus).not.toBe('exported');
    });

    it('still POSTs a screenhost agent and stamps "exported" (R4 regression)', async () => {
      const userId = await seedAgent('host@example.com', 'SH123456');
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response(null, { status: 200 }));
      await pushAgentToHub(
        {
          toodooh_user_id: userId,
          code: 'SH123456',
          email: 'host@example.com',
          password: 'pw',
          role: 'screenhost_agent',
        },
        logger,
        CFG,
      );
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [a] = await db.select().from(agents).where(eq(agents.userId, userId));
      expect(a?.exportStatus).toBe('exported');
    });
  });
});
