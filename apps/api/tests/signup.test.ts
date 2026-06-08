import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth, emailSender } from '../src/auth/auth.js';
import { authPlugin } from '../src/auth/plugin.js';
import { db, sql } from '../src/db/client.js';
import {
  accounts,
  agentReferrals,
  agents,
  businessSectors,
  governorates,
  users,
} from '../src/db/schema.js';
import { env } from '../src/env.js';
import { apiRoutes } from '../src/routes/index.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// nodemailer mocked → the verification hook "sends" without a real SMTP
// connection (Q1: no external network in CI).
const { sendMailMock } = vi.hoisted(() => ({
  sendMailMock: vi.fn().mockResolvedValue({ messageId: 'test-msg-id' }),
}));
vi.mock('nodemailer', () => ({
  default: { createTransport: vi.fn(() => ({ sendMail: sendMailMock })) },
}));

// Integration suite — requires a real Postgres (DATABASE_URL env). The only
// DB-writing test file; beforeEach truncates for isolation.

const buildApp = () => Fastify({ logger: false });

const validPayload = {
  email: 'owner@example.com',
  password: 'a-strong-passw0rd',
  contact_name: 'Test Owner',
  business_name: 'Test Biz',
  contact_phone: '+21612345678',
  tax_number: '1234567ABC',
  terms_accepted: true,
};

describe('POST /api/signup', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    await resetAuthTables();
    app = buildApp();
    await app.register(authPlugin);
    await app.register(apiRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await sql.end();
  });

  it('valid payload → 201 with the expected body', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/signup', payload: validPayload });
    expect(res.statusCode).toBe(201);
    const body = res.json<{
      userId: string;
      email: string;
      verificationRequired: boolean;
      message: string;
    }>();
    expect(body.email).toBe('owner@example.com');
    expect(body.verificationRequired).toBe(true);
    expect(typeof body.userId).toBe('string');
    expect(body.message).toContain('verify');
  });

  it('valid payload → writes user (+business fields, defaults) + account', async () => {
    await app.inject({ method: 'POST', url: '/api/signup', payload: validPayload });
    const u = await db.select().from(users).where(eq(users.email, 'owner@example.com'));
    expect(u).toHaveLength(1);
    const created = u[0];
    expect(created?.businessName).toBe('Test Biz');
    expect(created?.taxNumber).toBe('1234567ABC');
    expect(created?.contactPhone).toBe('+21612345678');
    expect(created?.role).toBe('advertiser'); // input:false default
    expect(created?.status).toBe('pending'); // input:false default
    const a = await db
      .select()
      .from(accounts)
      .where(eq(accounts.userId, created?.id ?? ''));
    expect(a).toHaveLength(1);
    expect(a[0]?.providerId).toBe('credential');
  });

  it('(Q8) attempts a verification email with the well-formed JWT link', async () => {
    const sendSpy = vi.spyOn(emailSender, 'send');
    await app.inject({ method: 'POST', url: '/api/signup', payload: validPayload });
    await vi.waitFor(() => {
      expect(sendSpy).toHaveBeenCalled();
    });
    const arg = sendSpy.mock.calls[0]?.[0];
    expect(arg?.to).toBe('owner@example.com');
    expect(arg?.subject).toContain('Vérifiez');
    expect(arg?.html).toContain('http://localhost:4000/auth/verify-email?token=');
    // F3: the post-verify redirect target rides the link so better-auth redirects to the FE page.
    expect(arg?.html).toContain(
      `callbackURL=${encodeURIComponent(`${env.WEB_ORIGIN}/verify-email`)}`,
    );
  });

  it('signup still succeeds (201) when the email send fails (no orphan rollback)', async () => {
    vi.spyOn(emailSender, 'send').mockResolvedValueOnce({ error: 'smtp down' });
    const res = await app.inject({
      method: 'POST',
      url: '/api/signup',
      payload: { ...validPayload, email: 'failmail@example.com', tax_number: '5550001QQ' },
    });
    expect(res.statusCode).toBe(201);
    const u = await db.select().from(users).where(eq(users.email, 'failmail@example.com'));
    expect(u).toHaveLength(1); // user persisted; orphan rollback did NOT fire
  });

  it('duplicate email → 201 generic, no second user row (anti-enumeration)', async () => {
    await app.inject({ method: 'POST', url: '/api/signup', payload: validPayload });
    const res2 = await app.inject({
      method: 'POST',
      url: '/api/signup',
      payload: { ...validPayload, tax_number: '7654321XYZ' },
    });
    expect(res2.statusCode).toBe(201); // generic, NOT 409
    const u = await db.select().from(users).where(eq(users.email, 'owner@example.com'));
    expect(u).toHaveLength(1); // still exactly one
  });

  it('duplicate tax_number (new email) → 409 TAX_NUMBER_TAKEN', async () => {
    await app.inject({ method: 'POST', url: '/api/signup', payload: validPayload });
    const res2 = await app.inject({
      method: 'POST',
      url: '/api/signup',
      payload: { ...validPayload, email: 'other@example.com' },
    });
    expect(res2.statusCode).toBe(409);
    const body = res2.json<{ error: string; fields: { field: string }[] }>();
    expect(body.error).toBe('TAX_NUMBER_TAKEN');
    expect(body.fields[0]?.field).toBe('tax_number');
  });

  it('password < 10 → 400 with field detail', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/signup',
      payload: { ...validPayload, password: 'short' },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json<{ error: string; fields: { field: string }[] }>();
    expect(body.error).toBe('INVALID_INPUT');
    expect(body.fields.some((f) => f.field === 'password')).toBe(true);
  });

  it('invalid email format → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/signup',
      payload: { ...validPayload, email: 'not-an-email' },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json<{ fields: { field: string }[] }>();
    expect(body.fields.some((f) => f.field === 'email')).toBe(true);
  });

  it('invalid phone (no +) → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/signup',
      payload: { ...validPayload, contact_phone: '12345678' },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json<{ fields: { field: string }[] }>();
    expect(body.fields.some((f) => f.field === 'contact_phone')).toBe(true);
  });

  it('invalid tax_number (too short) → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/signup',
      payload: { ...validPayload, tax_number: 'ab' },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json<{ fields: { field: string }[] }>();
    expect(body.fields.some((f) => f.field === 'tax_number')).toBe(true);
  });

  it('role/status in payload are ignored — created user stays advertiser/pending', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/signup',
      payload: { ...validPayload, role: 'superadmin', status: 'approved' },
    });
    const u = await db.select().from(users).where(eq(users.email, 'owner@example.com'));
    expect(u[0]?.role).toBe('advertiser');
    expect(u[0]?.status).toBe('pending');
  });

  it('unexpected (non-APIError) failure → 500 generic', async () => {
    vi.spyOn(auth.api, 'signUpEmail').mockRejectedValueOnce(new Error('boom'));
    const res = await app.inject({
      method: 'POST',
      url: '/api/signup',
      payload: { ...validPayload, email: 'fresh@example.com', tax_number: '9999999ZZ' },
    });
    expect(res.statusCode).toBe(500);
    expect(res.json<{ error: string }>().error).toBe('INTERNAL_ERROR');
  });

  // ── signup-grows (Phase 1e Commit 2) ──

  // Seeded reference rows (not truncated by resetAuthTables) → valid FK ids for full-profile signups.
  const seedIds = async (): Promise<{ sectorId: string; governorateId: string }> => {
    const [sector] = await db.select({ id: businessSectors.id }).from(businessSectors).limit(1);
    const [gov] = await db.select({ id: governorates.id }).from(governorates).limit(1);
    return { sectorId: sector?.id ?? '', governorateId: gov?.id ?? '' };
  };

  const fullProfile = async (over: Record<string, unknown> = {}) => {
    const { sectorId, governorateId } = await seedIds();
    return {
      ...validPayload,
      profile_type: 'advertiser',
      business_type: 'local',
      business_sector_id: sectorId,
      street_address: '12 Rue de Test',
      city: 'Tunis',
      postal_code: '1000',
      governorate_id: governorateId,
      fonction: 'Gérant',
      agent_toodooh: 'AGENT-42',
      ...over,
    };
  };

  it('full advertiser signup → 201; profile + agent_code + terms_accepted_at stored', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/signup',
      payload: await fullProfile(),
    });
    expect(res.statusCode).toBe(201);
    const [u] = await db.select().from(users).where(eq(users.email, 'owner@example.com'));
    expect(u?.role).toBe('advertiser');
    expect(u?.businessType).toBe('local');
    expect(u?.streetAddress).toBe('12 Rue de Test');
    expect(u?.city).toBe('Tunis');
    expect(u?.postalCode).toBe('1000');
    expect(u?.fonction).toBe('Gérant');
    expect(u?.businessSectorId).toBeTruthy();
    expect(u?.governorateId).toBeTruthy();
    expect(u?.agentCode).toBe('AGENT-42'); // wire agent_toodooh → column agent_code
    expect(u?.termsAcceptedAt).toBeInstanceOf(Date); // server-stamped
  });

  it('full agency signup → role=advertiser + business_type=agency (the MAP override)', async () => {
    const payload = await fullProfile({ profile_type: 'agency', business_type: 'local' });
    await app.inject({ method: 'POST', url: '/api/signup', payload });
    const [u] = await db.select().from(users).where(eq(users.email, 'owner@example.com'));
    expect(u?.role).toBe('advertiser'); // agency is NOT a role
    expect(u?.businessType).toBe('agency'); // override wins over the sent 'local'
  });

  it('full individual_owner signup → role=individual_owner', async () => {
    const payload = await fullProfile({ profile_type: 'individual_owner' });
    await app.inject({ method: 'POST', url: '/api/signup', payload });
    const [u] = await db.select().from(users).where(eq(users.email, 'owner@example.com'));
    expect(u?.role).toBe('individual_owner');
  });

  it('full fleet_owner signup → role=fleet_owner', async () => {
    const payload = await fullProfile({ profile_type: 'fleet_owner' });
    await app.inject({ method: 'POST', url: '/api/signup', payload });
    const [u] = await db.select().from(users).where(eq(users.email, 'owner@example.com'));
    expect(u?.role).toBe('fleet_owner');
  });

  it('owner-extras in the body are stripped (no column, no error) → 201', async () => {
    const payload = await fullProfile({
      profile_type: 'individual_owner',
      cin: '12345678',
      formule: 'revenue_share',
      number_of_screens: 5,
      number_of_rooms: 3,
      company_size: '10-50',
      fleet_establishments: [{ name: 'X' }],
    });
    const res = await app.inject({ method: 'POST', url: '/api/signup', payload });
    expect(res.statusCode).toBe(201);
    const [u] = await db.select().from(users).where(eq(users.email, 'owner@example.com'));
    expect(u?.role).toBe('individual_owner'); // the known fields still applied
  });

  it('tax_number omitted (owner) → 201 (now optional)', async () => {
    const payload = await fullProfile({ profile_type: 'individual_owner' });
    delete (payload as { tax_number?: string }).tax_number;
    const res = await app.inject({ method: 'POST', url: '/api/signup', payload });
    expect(res.statusCode).toBe(201);
    const [u] = await db.select().from(users).where(eq(users.email, 'owner@example.com'));
    expect(u?.taxNumber).toBeNull();
  });

  it('terms not accepted → 400 (backend-enforced, not just the wizard)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/signup',
      payload: { ...validPayload, terms_accepted: false },
    });
    expect(res.statusCode).toBe(400);
    expect(
      res.json<{ fields: { field: string }[] }>().fields.some((f) => f.field === 'terms_accepted'),
    ).toBe(true);
  });

  it('terms omitted → 400', async () => {
    const payload = { ...validPayload };
    delete (payload as { terms_accepted?: boolean }).terms_accepted;
    const res = await app.inject({ method: 'POST', url: '/api/signup', payload });
    expect(res.statusCode).toBe(400);
  });

  it('duplicate email → 201 generic AND the existing user role/profile is UNCHANGED (synthetic-id no-op)', async () => {
    // First: a real owner signup that sets role=individual_owner + agent_code.
    await app.inject({
      method: 'POST',
      url: '/api/signup',
      payload: await fullProfile({ profile_type: 'individual_owner', agent_toodooh: 'FIRST' }),
    });
    // Then a duplicate-email signup trying to flip role=fleet_owner + a new agent_code.
    const res2 = await app.inject({
      method: 'POST',
      url: '/api/signup',
      payload: await fullProfile({
        profile_type: 'fleet_owner',
        agent_toodooh: 'ATTACKER',
        tax_number: '7654321XYZ',
      }),
    });
    expect(res2.statusCode).toBe(201); // generic
    const rows = await db.select().from(users).where(eq(users.email, 'owner@example.com'));
    expect(rows).toHaveLength(1); // still one
    expect(rows[0]?.role).toBe('individual_owner'); // NOT flipped to fleet_owner
    expect(rows[0]?.agentCode).toBe('FIRST'); // NOT overwritten by the duplicate
  });

  // ── agent referral linkage at signup (P1 Commit 3) ──

  // Seed an agent user (role implies the agent TYPE) + its issued code in `agents.code`.
  // resetAuthTables TRUNCATE ... CASCADE clears these between tests.
  const seedAgent = async (
    role: 'screenhost_agent' | 'screencast_agent',
    code: string,
  ): Promise<string> => {
    const [agentUser] = await db
      .insert(users)
      .values({ email: `agent-${code.toLowerCase()}@example.com`, contactName: 'Agent', role })
      .returning({ id: users.id });
    const id = agentUser?.id ?? '';
    await db.insert(agents).values({ userId: id, code });
    return id;
  };

  const referralsFor = async (email: string) => {
    const [u] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
    return db
      .select()
      .from(agentReferrals)
      .where(eq(agentReferrals.referredUserId, u?.id ?? ''));
  };

  it('compatible match (screenhost_agent ↔ individual_owner) → links the referral', async () => {
    const agentId = await seedAgent('screenhost_agent', 'HOSTCODE');
    // entered lowercase → resolves via trim+uppercase to the stored code.
    const res = await app.inject({
      method: 'POST',
      url: '/api/signup',
      payload: await fullProfile({ profile_type: 'individual_owner', agent_toodooh: ' hostcode ' }),
    });
    expect(res.statusCode).toBe(201);
    const refs = await referralsFor('owner@example.com');
    expect(refs).toHaveLength(1);
    expect(refs[0]?.agentUserId).toBe(agentId);
    expect(refs[0]?.agentCodeUsed).toBe(' hostcode '); // raw entered value preserved (audit)
    const [u] = await db.select().from(users).where(eq(users.email, 'owner@example.com'));
    expect(u?.agentCode).toBe(' hostcode '); // existing raw write still happens
  });

  it('compatible match (screenhost_agent ↔ fleet_owner) → links the referral', async () => {
    const agentId = await seedAgent('screenhost_agent', 'HOSTCODE');
    await app.inject({
      method: 'POST',
      url: '/api/signup',
      payload: await fullProfile({ profile_type: 'fleet_owner', agent_toodooh: 'HOSTCODE' }),
    });
    const refs = await referralsFor('owner@example.com');
    expect(refs).toHaveLength(1);
    expect(refs[0]?.agentUserId).toBe(agentId);
  });

  it('compatible match (screencast_agent ↔ advertiser) → links the referral', async () => {
    const agentId = await seedAgent('screencast_agent', 'CASTCODE');
    await app.inject({
      method: 'POST',
      url: '/api/signup',
      payload: await fullProfile({ profile_type: 'advertiser', agent_toodooh: 'CASTCODE' }),
    });
    const refs = await referralsFor('owner@example.com');
    expect(refs).toHaveLength(1);
    expect(refs[0]?.agentUserId).toBe(agentId);
  });

  it('compatible match (screencast_agent ↔ agency, which maps to advertiser) → links', async () => {
    const agentId = await seedAgent('screencast_agent', 'CASTCODE');
    await app.inject({
      method: 'POST',
      url: '/api/signup',
      payload: await fullProfile({ profile_type: 'agency', agent_toodooh: 'CASTCODE' }),
    });
    const refs = await referralsFor('owner@example.com');
    expect(refs).toHaveLength(1);
    expect(refs[0]?.agentUserId).toBe(agentId);
  });

  it('incompatible role (screenhost_agent ↔ advertiser) → 201, no link, agent_code stored', async () => {
    await seedAgent('screenhost_agent', 'HOSTONLY');
    const res = await app.inject({
      method: 'POST',
      url: '/api/signup',
      payload: await fullProfile({ profile_type: 'advertiser', agent_toodooh: 'HOSTONLY' }),
    });
    expect(res.statusCode).toBe(201);
    expect(await referralsFor('owner@example.com')).toHaveLength(0);
    const [u] = await db.select().from(users).where(eq(users.email, 'owner@example.com'));
    expect(u?.agentCode).toBe('HOSTONLY'); // raw entry still stored for admin follow-up
  });

  it('unknown code → 201, no link, agent_code stored', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/signup',
      payload: await fullProfile({ profile_type: 'individual_owner', agent_toodooh: 'NOSUCH99' }),
    });
    expect(res.statusCode).toBe(201);
    expect(await referralsFor('owner@example.com')).toHaveLength(0);
    const [u] = await db.select().from(users).where(eq(users.email, 'owner@example.com'));
    expect(u?.agentCode).toBe('NOSUCH99');
  });

  it('absent agent_toodooh → no lookup, no link', async () => {
    const payload = await fullProfile({ profile_type: 'individual_owner' });
    delete (payload as { agent_toodooh?: string }).agent_toodooh;
    const res = await app.inject({ method: 'POST', url: '/api/signup', payload });
    expect(res.statusCode).toBe(201);
    expect(await referralsFor('owner@example.com')).toHaveLength(0);
  });

  it('duplicate-email synthetic-id path inserts NO referral', async () => {
    await seedAgent('screenhost_agent', 'DUPCODE1');
    // First real signup establishes owner@example.com (no agent code → no referral).
    await app.inject({
      method: 'POST',
      url: '/api/signup',
      payload: await fullProfile({ profile_type: 'individual_owner' }),
    });
    // Duplicate-email signup with an OTHERWISE-compatible code: the synthetic-id guard
    // skips the whole post-create block, so no referral is written.
    const res2 = await app.inject({
      method: 'POST',
      url: '/api/signup',
      payload: await fullProfile({
        profile_type: 'individual_owner',
        agent_toodooh: 'DUPCODE1',
        tax_number: '7654321XYZ',
      }),
    });
    expect(res2.statusCode).toBe(201);
    expect(await referralsFor('owner@example.com')).toHaveLength(0);
  });
});
