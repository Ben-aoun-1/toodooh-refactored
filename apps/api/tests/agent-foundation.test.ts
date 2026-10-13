import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import {
  agentCgeAcceptances,
  agentCgeVersions,
  agentRibSubmissions,
  agents,
  governorates,
  notifications,
  sessions,
  users,
} from '../src/db/schema.js';
import { agentCodeVerdict } from '../src/lib/agent-lookup.js';
import { onboardingSteps } from '../src/lib/agent-sheet.js';
import { adminAccountsRoutes } from '../src/routes/admin-accounts.js';
import { adminAgentsRoutes } from '../src/routes/admin-agents.js';
import { agentAccountRoutes } from '../src/routes/agent-account.js';
import { agentRoutes } from '../src/routes/agent.js';
import { storage } from '../src/storage/s3-storage.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// AGT-1 — agent foundation (agent specs v1.0 §2, rulings 2026-10-13) on a real Postgres + MinIO:
// the full agent sheet at creation, the account lifecycle (code refused until 'actif', suspend /
// reactivate / close), the versioned CGE gate, the RIB validation queue, the onboarding card.

vi.mock('nodemailer', () => ({
  default: { createTransport: vi.fn(() => ({ sendMail: vi.fn().mockResolvedValue({}) })) },
}));
vi.mock('../src/lib/wedooh-sync.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/wedooh-sync.js')>();
  return { ...actual, pushAgentToHub: vi.fn(() => Promise.resolve()) };
});

type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;
const mockSession = (id: string, role: string, status = 'approved'): void => {
  vi.spyOn(auth.api, 'getSession').mockResolvedValue({
    session: {},
    user: { id, role, status },
  } as unknown as GetSessionResult);
};

const multipart = (filename: string, contentType: string, content: Buffer) => {
  const boundary = `----agt${Date.now()}${Math.random().toString(16).slice(2)}`;
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: ${contentType}\r\n\r\n`,
  );
  return {
    payload: Buffer.concat([head, content, Buffer.from(`\r\n--${boundary}--\r\n`)]),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
};
const PDF = Buffer.from('%PDF-1.4\n% agent test\n');

const buildApp = () => Fastify({ logger: false });

describe('AGT-1 — agent foundation (real Postgres)', () => {
  let app: ReturnType<typeof buildApp>;
  let adminId: string;
  let governorateId: string;

  beforeEach(async () => {
    await resetAuthTables();
    await db.delete(agentCgeAcceptances);
    await db.delete(agentCgeVersions);
    const [admin] = await db
      .insert(users)
      .values({
        email: 'admin@example.com',
        contactName: 'Admin',
        role: 'admin',
        status: 'approved',
      })
      .returning();
    adminId = admin?.id ?? '';
    const [gov] = await db.select({ id: governorates.id }).from(governorates).limit(1);
    governorateId = gov?.id ?? '';
    app = buildApp();
    await app.register(adminAccountsRoutes);
    await app.register(adminAgentsRoutes);
    await app.register(agentAccountRoutes);
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

  const sheet = (over: Record<string, unknown> = {}) => ({
    email: 'agent@example.com',
    role: 'screencast_agent',
    first_name: 'Sami',
    last_name: 'Ben Ali',
    phone: '+21612345678',
    tax_number: '1234567ABC000',
    street_address: '1 rue de Marseille',
    city: 'Tunis',
    postal_code: '1000',
    governorate_id: governorateId,
    covered_zone: 'Grand Tunis',
    certified_at: '2026-10-01',
    ...over,
  });

  const createAgent = async (over: Record<string, unknown> = {}) => {
    mockSession(adminId, 'admin');
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/accounts',
      payload: sheet(over),
    });
    vi.restoreAllMocks();
    return res;
  };

  const publishCge = async (role: string, version: string) => {
    mockSession(adminId, 'admin');
    const body = multipart('cge.pdf', 'application/pdf', PDF);
    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/agent-cge?role=${role}&version=${version}`,
      ...body,
    });
    vi.restoreAllMocks();
    return res;
  };

  it('creates an agent with its full sheet; the tax number is required for a Screencaster agent', async () => {
    const missing = await createAgent({ covered_zone: undefined });
    expect(missing.statusCode).toBe(400);
    const noTax = await createAgent({ tax_number: undefined });
    expect(noTax.statusCode).toBe(400);
    const shNoTax = await createAgent({ role: 'screenhost_agent', tax_number: undefined });
    expect(shNoTax.statusCode).toBe(201);
    const id = shNoTax.json<{ account: { id: string } }>().account.id;
    const [row] = await db.select().from(agents).where(eq(agents.userId, id));
    expect(row).toMatchObject({
      firstName: 'Sami',
      lastName: 'Ben Ali',
      coveredZone: 'Grand Tunis',
      accountStatus: 'actif', // no CGE published yet (ruling Q6)
      commissionPct: null,
    });
    const [u] = await db.select().from(users).where(eq(users.id, id));
    expect(u).toMatchObject({
      contactName: 'Sami Ben Ali',
      city: 'Tunis',
      contactPhone: '+21612345678',
    });
  });

  it('with a CGE in force: pending account, code refused, data gated until acceptance', async () => {
    expect((await publishCge('screencast_agent', 'v1')).statusCode).toBe(201);
    const created = await createAgent();
    const { id, code } = created.json<{ account: { id: string; code: string } }>().account;
    expect((await db.select().from(agents).where(eq(agents.userId, id)))[0]?.accountStatus).toBe(
      'en_attente',
    );
    expect(await agentCodeVerdict(code, 'advertiser')).toBe('unknown');

    mockSession(id, 'screencast_agent');
    const account = await app.inject({ method: 'GET', url: '/api/agent/account' });
    const body = account.json<{ cge_required: boolean; cge: { id: string } }>();
    expect(body.cge_required).toBe(true);
    expect((await app.inject({ method: 'GET', url: '/api/agent/clients' })).statusCode).toBe(403);

    const accept = await app.inject({
      method: 'POST',
      url: '/api/agent/cge/accept',
      payload: { cge_version_id: body.cge.id },
    });
    expect(accept.statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: '/api/agent/clients' })).statusCode).toBe(200);
    vi.restoreAllMocks();
    const [acc] = await db.select().from(agentCgeAcceptances);
    expect(acc?.ip).toBeTruthy();
    expect(await agentCodeVerdict(code, 'advertiser')).toBe('ok');

    // A new version brings the modal back (US-ASC-2.5).
    await publishCge('screencast_agent', 'v2');
    mockSession(id, 'screencast_agent');
    const again = await app.inject({ method: 'GET', url: '/api/agent/account' });
    expect(again.json<{ cge_required: boolean }>().cge_required).toBe(true);
  });

  it('the CGE must be a PDF and a version is published once', async () => {
    mockSession(adminId, 'admin');
    const notPdf = multipart('cge.png', 'image/png', Buffer.from('nope'));
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/agent-cge?role=screenhost_agent&version=v1',
      ...notPdf,
    });
    expect(res.statusCode).toBe(400);
    vi.restoreAllMocks();
    expect((await publishCge('screenhost_agent', 'v1')).statusCode).toBe(201);
    expect((await publishCge('screenhost_agent', 'v1')).statusCode).toBe(409);
  });

  it('RIB: deposit → pending → refused (notified) → new deposit → validated; onboarding follows', async () => {
    const id = (await createAgent()).json<{ account: { id: string } }>().account.id;
    mockSession(id, 'screencast_agent');
    const bad = multipart('rib.txt', 'text/plain', Buffer.from('x'));
    expect((await app.inject({ method: 'POST', url: '/api/agent/rib', ...bad })).statusCode).toBe(
      400,
    );
    const dep = await app.inject({
      method: 'POST',
      url: '/api/agent/rib',
      ...multipart('rib.pdf', 'application/pdf', PDF),
    });
    expect(dep.statusCode).toBe(201);
    let acc = (await app.inject({ method: 'GET', url: '/api/agent/account' })).json<{
      rib: { status: string };
      onboarding: { steps: { key: string; pending?: boolean }[]; complete: boolean };
    }>();
    expect(acc.rib.status).toBe('en_attente');
    expect(acc.onboarding.steps.find((s) => s.key === 'rib')?.pending).toBe(true);
    vi.restoreAllMocks();

    mockSession(adminId, 'admin');
    const queue = await app.inject({ method: 'GET', url: '/api/admin/agent-ribs' });
    const ribId = queue.json<{ ribs: { id: string }[] }>().ribs[0]?.id ?? '';
    const refused = await app.inject({
      method: 'POST',
      url: `/api/admin/agent-ribs/${ribId}/refuse`,
      payload: { reason: 'Document illisible' },
    });
    expect(refused.statusCode).toBe(200);
    vi.restoreAllMocks();
    const notes = await db.select().from(notifications).where(eq(notifications.userId, id));
    expect(notes.map((n) => n.type)).toEqual(['agent_rib_refused']);

    mockSession(id, 'screencast_agent');
    await app.inject({
      method: 'POST',
      url: '/api/agent/rib',
      ...multipart('rib2.pdf', 'application/pdf', PDF),
    });
    vi.restoreAllMocks();
    const [latest] = await db
      .select()
      .from(agentRibSubmissions)
      .where(eq(agentRibSubmissions.status, 'en_attente'));
    mockSession(adminId, 'admin');
    await app.inject({ method: 'POST', url: `/api/admin/agent-ribs/${latest?.id}/validate` });
    vi.restoreAllMocks();
    mockSession(id, 'screencast_agent');
    acc = (await app.inject({ method: 'GET', url: '/api/agent/account' })).json();
    expect(acc.rib.status).toBe('valide');
    expect(acc.onboarding.complete).toBe(false); // « Vérifier mes informations » still open

    const keys = (await db.select().from(agentRibSubmissions)).map((r) => r.storageKey);
    for (const key of keys) await storage.delete({ key }).catch(() => undefined);
  });

  it('suspend bans + revokes sessions + refuses the code; reactivate restores; closure is terminal', async () => {
    const { id, code } = (await createAgent()).json<{ account: { id: string; code: string } }>()
      .account;
    await db.insert(sessions).values({
      token: `tok-${id}`,
      userId: id,
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    mockSession(adminId, 'admin');
    const s = await app.inject({
      method: 'POST',
      url: `/api/admin/agents/${id}/status`,
      payload: { status: 'suspendu' },
    });
    expect(s.json<{ account_status: string }>().account_status).toBe('suspendu');
    expect((await db.select().from(users).where(eq(users.id, id)))[0]?.status).toBe('banned');
    expect(await db.select().from(sessions).where(eq(sessions.userId, id))).toEqual([]);
    expect(await agentCodeVerdict(code, 'advertiser')).toBe('unknown');

    await app.inject({
      method: 'POST',
      url: `/api/admin/agents/${id}/status`,
      payload: { status: 'actif' },
    });
    expect((await db.select().from(users).where(eq(users.id, id)))[0]?.status).toBe('approved');
    expect(await agentCodeVerdict(code, 'advertiser')).toBe('ok');

    await app.inject({
      method: 'POST',
      url: `/api/admin/agents/${id}/status`,
      payload: { status: 'cloture' },
    });
    const back = await app.inject({
      method: 'POST',
      url: `/api/admin/agents/${id}/status`,
      payload: { status: 'actif' },
    });
    expect(back.statusCode).toBe(409);
  });

  it('the agent rate: own rate when set, the engine default otherwise; the list shows onboarding', async () => {
    const id = (await createAgent({ commission_pct: 4.5 })).json<{ account: { id: string } }>()
      .account.id;
    mockSession(adminId, 'admin');
    const view = await app.inject({ method: 'GET', url: `/api/admin/agents/${id}` });
    expect(view.json<{ effective_commission_pct: number }>().effective_commission_pct).toBe(4.5);
    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/admin/agents/${id}`,
      payload: { commission_pct: null },
    });
    expect(patched.json<{ effective_commission_pct: number }>().effective_commission_pct).toBe(3);
    const list = await app.inject({ method: 'GET', url: '/api/admin/agents' });
    const row = list.json<{ agents: { id: string; onboarding: { done: number } }[] }>().agents[0];
    expect(row?.onboarding.done).toBe(1); // CGE (none in force)
  });

  it('onboardingSteps — four steps, three mandatory, RIB pending shown', () => {
    const r = onboardingSteps({
      cgeAccepted: true,
      hasPhoto: false,
      infoVerified: true,
      rib: 'en_attente',
    });
    expect(r.done).toBe(2);
    expect(r.complete).toBe(false);
    expect(r.steps.find((s) => s.key === 'rib')?.pending).toBe(true);
    const ok = onboardingSteps({
      cgeAccepted: true,
      hasPhoto: false,
      infoVerified: true,
      rib: 'valide',
    });
    expect(ok.complete).toBe(true); // the photo is optional
  });
});
