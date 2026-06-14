import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import {
  type NewUser,
  agentReferrals,
  screenhosts,
  userDocuments,
  users,
} from '../src/db/schema.js';
import { agentRoutes } from '../src/routes/agent.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// Integration suite — real Postgres (DATABASE_URL). auth.api.getSession is mocked (its behavior
// lives in require-auth.test.ts); endpoint logic runs against real rows. Mirrors admin.test.ts.
type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;

const buildApp = () => Fastify({ logger: false });

const mockSession = (userId: string, role: string, status = 'approved'): void => {
  vi.spyOn(auth.api, 'getSession').mockResolvedValue({
    session: {},
    user: { id: userId, role, status },
  } as unknown as GetSessionResult);
};

let seq = 0;
const seedUser = async (values: Partial<NewUser> = {}): Promise<string> => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({ email: `u${seq}@example.com`, contactName: `User ${seq}`, ...values })
    .returning();
  return u?.id ?? '';
};

const seedReferral = async (
  agentUserId: string,
  referredUserId: string,
  agentCodeUsed = 'CODE1234',
): Promise<void> => {
  await db.insert(agentReferrals).values({ agentUserId, referredUserId, agentCodeUsed });
};

const seedScreenhost = async (ownerId: string, name = 'Loc'): Promise<string> => {
  const [s] = await db
    .insert(screenhosts)
    .values({ name, ownerId, wifiSsid: 'agent-net', wifiPasswordEncrypted: 'SECRET-CIPHERTEXT' })
    .returning();
  return s?.id ?? '';
};

interface ClientView {
  id: string;
  profile_type: string | null;
  tax_number: string | null;
  screenhosts: { id: string; name: string }[];
}

describe('GET /api/agent/clients (real Postgres)', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    await resetAuthTables();
    app = buildApp();
    await app.register(agentRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await sql.end();
  });

  const get = () => app.inject({ method: 'GET', url: '/api/agent/clients' });

  describe('guard (requireAuth + requireRole)', () => {
    it('no session → 401', async () => {
      vi.spyOn(auth.api, 'getSession').mockResolvedValue(null);
      expect((await get()).statusCode).toBe(401);
    });

    it('non-agent role (advertiser) → 403', async () => {
      const id = await seedUser({ role: 'advertiser' });
      mockSession(id, 'advertiser');
      const res = await get();
      expect(res.statusCode).toBe(403);
      expect(res.json<{ error: string }>().error).toBe('FORBIDDEN');
    });

    it('admin role → 403 (not an agent)', async () => {
      const id = await seedUser({ role: 'admin' });
      mockSession(id, 'admin');
      expect((await get()).statusCode).toBe(403);
    });

    it('screenhost_agent → 200', async () => {
      const id = await seedUser({ role: 'screenhost_agent' });
      mockSession(id, 'screenhost_agent');
      expect((await get()).statusCode).toBe(200);
    });

    it('screencast_agent → 200', async () => {
      const id = await seedUser({ role: 'screencast_agent' });
      mockSession(id, 'screencast_agent');
      expect((await get()).statusCode).toBe(200);
    });
  });

  it('no referrals → empty array', async () => {
    const agentId = await seedUser({ role: 'screenhost_agent' });
    mockSession(agentId, 'screenhost_agent');
    const res = await get();
    expect(res.statusCode).toBe(200);
    expect(res.json<{ clients: ClientView[] }>().clients).toEqual([]);
  });

  it('screenhost_agent sees only its individual_owner/fleet_owner referrals', async () => {
    const agentId = await seedUser({ role: 'screenhost_agent' });
    const owner1 = await seedUser({ role: 'individual_owner' });
    const owner2 = await seedUser({ role: 'fleet_owner' });
    // A mis-seeded incompatible edge (advertiser) — the defensive filter must drop it.
    const advertiser = await seedUser({ role: 'advertiser' });
    await seedReferral(agentId, owner1);
    await seedReferral(agentId, owner2);
    await seedReferral(agentId, advertiser);

    mockSession(agentId, 'screenhost_agent');
    const body = (await get()).json<{ clients: ClientView[] }>();
    const ids = body.clients.map((c) => c.id).sort();
    expect(ids).toEqual([owner1, owner2].sort());
    expect(
      body.clients.every(
        (c) => c.profile_type === 'individual_owner' || c.profile_type === 'fleet_owner',
      ),
    ).toBe(true);
  });

  it('screencast_agent sees only its advertiser/agency referrals', async () => {
    const agentId = await seedUser({ role: 'screencast_agent' });
    const advertiser = await seedUser({ role: 'advertiser', businessType: 'local' });
    // agency = role advertiser + business_type 'agency' (classified by toProfileType, not role).
    const agency = await seedUser({ role: 'advertiser', businessType: 'agency' });
    // A mis-seeded incompatible edge (individual_owner) — must be dropped.
    const owner = await seedUser({ role: 'individual_owner' });
    await seedReferral(agentId, advertiser);
    await seedReferral(agentId, agency);
    await seedReferral(agentId, owner);

    mockSession(agentId, 'screencast_agent');
    const body = (await get()).json<{ clients: ClientView[] }>();
    const ids = body.clients.map((c) => c.id).sort();
    expect(ids).toEqual([advertiser, agency].sort());
    const types = body.clients.map((c) => c.profile_type).sort();
    expect(types).toEqual(['advertiser', 'agency']);
  });

  it('one agent never sees another agent’s referrals', async () => {
    const agentA = await seedUser({ role: 'screencast_agent' });
    const agentB = await seedUser({ role: 'screencast_agent' });
    const clientA = await seedUser({ role: 'advertiser' });
    const clientB = await seedUser({ role: 'advertiser' });
    await seedReferral(agentA, clientA);
    await seedReferral(agentB, clientB);

    mockSession(agentA, 'screencast_agent');
    const body = (await get()).json<{ clients: ClientView[] }>();
    expect(body.clients.map((c) => c.id)).toEqual([clientA]);
  });

  it('NEVER exposes a document field or doc URL (the hard divergence from the admin view)', async () => {
    const agentId = await seedUser({ role: 'screenhost_agent' });
    // Both document sources seeded: the frozen legacy columns AND user_documents rows
    // (F-docs Commit 1) — the invariant must hold against the table-backed model too.
    const owner = await seedUser({
      role: 'individual_owner',
      registrationDocUrl: 'rne/secret-key',
      cinDocUrl: 'cin/secret-key',
    });
    await db.insert(userDocuments).values([
      { userId: owner, category: 'rne', position: 1, storageKey: 'rne/secret-table-key' },
      { userId: owner, category: 'cin', position: 1, storageKey: 'cin/secret-table-key' },
      {
        userId: owner,
        category: 'complementaire',
        position: 1,
        storageKey: `complementaire/${owner}/secret-doc-id`,
        originalFilename: 'piece-secrete.pdf',
      },
    ]);
    await seedReferral(agentId, owner);

    mockSession(agentId, 'screenhost_agent');
    const res = await get();
    const raw = res.body; // raw JSON string — assert no doc artifact leaks anywhere
    expect(raw).not.toContain('documents');
    expect(raw).not.toContain('registration');
    expect(raw).not.toContain('rne/secret-key');
    expect(raw).not.toContain('cin/secret-key');
    expect(raw).not.toContain('secret-table-key');
    expect(raw).not.toContain('secret-doc-id');
    expect(raw).not.toContain('piece-secrete');
    expect(raw).not.toContain('complementaire');
    const [client] = res.json<{ clients: Record<string, unknown>[] }>().clients;
    expect(client).toBeDefined();
    expect(client?.['documents']).toBeUndefined();
    expect(client?.['registration_doc_url']).toBeUndefined();
    expect(client?.['cin_doc_url']).toBeUndefined();
  });

  it('screenhost-owner client includes its locations; never the wifi secret or export fields', async () => {
    const agentId = await seedUser({ role: 'screenhost_agent' });
    const owner = await seedUser({ role: 'individual_owner' });
    await seedScreenhost(owner, 'Cafe One');
    await seedScreenhost(owner, 'Cafe Two');
    await seedReferral(agentId, owner);

    mockSession(agentId, 'screenhost_agent');
    const res = await get();
    const [client] = res.json<{ clients: ClientView[] }>().clients;
    expect(client?.screenhosts).toHaveLength(2);
    expect(client?.screenhosts.map((s) => s.name).sort()).toEqual(['Cafe One', 'Cafe Two']);
    // The wifi password ciphertext + export-pipeline fields must never appear.
    expect(res.body).not.toContain('SECRET-CIPHERTEXT');
    expect(res.body).not.toContain('wifi_password');
    expect(res.body).not.toContain('export_status');
  });
});
