import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import { businessSectors, governorates, users } from '../src/db/schema.js';
import { meRoutes } from '../src/routes/me.js';
import { profileRoutes } from '../src/routes/profile.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// Integration suite — requires a real Postgres (DATABASE_URL). The session-guard's
// auth.api.getSession is mocked (its own behavior is covered by require-auth.test.ts);
// here we exercise the endpoint logic against real rows + the seeded business_sectors.
type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;

const buildApp = () => Fastify({ logger: false });

const mockSession = (userId: string): void => {
  vi.spyOn(auth.api, 'getSession').mockResolvedValue({
    session: {},
    user: { id: userId, role: 'advertiser', status: 'pending' },
  } as unknown as GetSessionResult);
};

describe('PATCH /api/profile/business', () => {
  let app: ReturnType<typeof buildApp>;
  let userId: string;
  let sectorId: string;

  beforeEach(async () => {
    await resetAuthTables();
    const [u] = await db
      .insert(users)
      .values({ email: 'biz@example.com', contactName: 'Biz Owner' })
      .returning();
    userId = u?.id ?? '';
    const [sector] = await db.select({ id: businessSectors.id }).from(businessSectors).limit(1);
    sectorId = sector?.id ?? '';
    app = buildApp();
    await app.register(profileRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  const patch = (payload: Record<string, unknown>) =>
    app.inject({ method: 'PATCH', url: '/api/profile/business', payload });

  it('authenticated → updates supplied fields', async () => {
    mockSession(userId);
    const res = await patch({ business_name: 'New Biz', business_type: 'agency' });
    expect(res.statusCode).toBe(200);
    const [row] = await db.select().from(users).where(eq(users.id, userId));
    expect(row?.businessName).toBe('New Biz');
    expect(row?.businessType).toBe('agency');
  });

  it('partial: only supplied fields change', async () => {
    await db
      .update(users)
      .set({ businessName: 'Original', businessType: 'local' })
      .where(eq(users.id, userId));
    mockSession(userId);
    await patch({ business_name: 'Renamed' });
    const [row] = await db.select().from(users).where(eq(users.id, userId));
    expect(row?.businessName).toBe('Renamed');
    expect(row?.businessType).toBe('local'); // untouched
  });

  it('unauthenticated → 401', async () => {
    vi.spyOn(auth.api, 'getSession').mockResolvedValue(null);
    const res = await patch({ business_name: 'X' });
    expect(res.statusCode).toBe(401);
  });

  it('empty body → 400', async () => {
    mockSession(userId);
    const res = await patch({});
    expect(res.statusCode).toBe(400);
  });

  it('unknown business_sector_id → 400 (FK pre-check)', async () => {
    mockSession(userId);
    const res = await patch({ business_sector_id: '00000000-0000-0000-0000-000000000000' });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ fields: { field: string }[] }>().fields[0]?.field).toBe('business_sector_id');
  });

  it('valid business_sector_id → stored', async () => {
    mockSession(userId);
    const res = await patch({ business_sector_id: sectorId });
    expect(res.statusCode).toBe(200);
    const [row] = await db.select().from(users).where(eq(users.id, userId));
    expect(row?.businessSectorId).toBe(sectorId);
  });

  it('tax_number: valid stored, null clears, bad format → 400', async () => {
    mockSession(userId);
    expect((await patch({ tax_number: '1234567ABC' })).statusCode).toBe(200);
    expect((await db.select().from(users).where(eq(users.id, userId)))[0]?.taxNumber).toBe(
      '1234567ABC',
    );
    expect((await patch({ tax_number: null })).statusCode).toBe(200);
    expect((await db.select().from(users).where(eq(users.id, userId)))[0]?.taxNumber).toBeNull();
    expect((await patch({ tax_number: 'ab' })).statusCode).toBe(400);
  });

  it('deferred owner-extras → ignored (stripped), not errored, not stored', async () => {
    mockSession(userId);
    const res = await patch({
      business_name: 'Owner Biz',
      number_of_screens: 5,
      number_of_rooms: 3,
      company_size: '10 - 50',
    });
    expect(res.statusCode).toBe(200);
    const [row] = await db.select().from(users).where(eq(users.id, userId));
    expect(row?.businessName).toBe('Owner Biz');
  });

  it('role/status in body → not applied (not in schema)', async () => {
    mockSession(userId);
    await patch({ business_name: 'Y', role: 'superadmin', status: 'approved' });
    const [row] = await db.select().from(users).where(eq(users.id, userId));
    expect(row?.role).toBe('advertiser');
    expect(row?.status).toBe('pending');
  });
});

describe('PATCH /api/profile/contact', () => {
  let app: ReturnType<typeof buildApp>;
  let userId: string;

  beforeEach(async () => {
    await resetAuthTables();
    const [u] = await db
      .insert(users)
      .values({ email: 'contact@example.com', contactName: 'Original Name' })
      .returning();
    userId = u?.id ?? '';
    app = buildApp();
    await app.register(profileRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  const patch = (payload: Record<string, unknown>) =>
    app.inject({ method: 'PATCH', url: '/api/profile/contact', payload });

  it('authenticated → updates supplied fields', async () => {
    mockSession(userId);
    const res = await patch({
      contact_name: 'New Name',
      contact_phone: '+21612345678',
      fonction: 'CTO',
    });
    expect(res.statusCode).toBe(200);
    const [row] = await db.select().from(users).where(eq(users.id, userId));
    expect(row?.contactName).toBe('New Name');
    expect(row?.contactPhone).toBe('+21612345678');
    expect(row?.fonction).toBe('CTO');
  });

  it('partial: only supplied fields change', async () => {
    await db
      .update(users)
      .set({ contactPhone: '+21611111111', fonction: 'CEO' })
      .where(eq(users.id, userId));
    mockSession(userId);
    await patch({ fonction: 'CFO' });
    const [row] = await db.select().from(users).where(eq(users.id, userId));
    expect(row?.fonction).toBe('CFO');
    expect(row?.contactPhone).toBe('+21611111111'); // untouched
  });

  it('fonction: null clears', async () => {
    await db.update(users).set({ fonction: 'CTO' }).where(eq(users.id, userId));
    mockSession(userId);
    const res = await patch({ fonction: null });
    expect(res.statusCode).toBe(200);
    const [row] = await db.select().from(users).where(eq(users.id, userId));
    expect(row?.fonction).toBeNull();
  });

  it('bad phone (un-normalized) → 400', async () => {
    mockSession(userId);
    const res = await patch({ contact_phone: '12 34' });
    expect(res.statusCode).toBe(400);
  });

  it('unauthenticated → 401', async () => {
    vi.spyOn(auth.api, 'getSession').mockResolvedValue(null);
    const res = await patch({ contact_name: 'X' });
    expect(res.statusCode).toBe(401);
  });

  it('empty body → 400', async () => {
    mockSession(userId);
    const res = await patch({});
    expect(res.statusCode).toBe(400);
  });
});

describe('PATCH /api/profile/address', () => {
  let app: ReturnType<typeof buildApp>;
  let userId: string;
  let governorateId: string;

  beforeEach(async () => {
    await resetAuthTables();
    const [u] = await db
      .insert(users)
      .values({ email: 'addr@example.com', contactName: 'Addr Owner' })
      .returning();
    userId = u?.id ?? '';
    const [gov] = await db.select({ id: governorates.id }).from(governorates).limit(1);
    governorateId = gov?.id ?? '';
    app = buildApp();
    await app.register(profileRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  const patch = (payload: Record<string, unknown>) =>
    app.inject({ method: 'PATCH', url: '/api/profile/address', payload });

  it('authenticated → updates supplied fields', async () => {
    mockSession(userId);
    const res = await patch({
      street_address: '12 Rue de Tunis',
      city: 'Tunis',
      postal_code: '1000',
      governorate_id: governorateId,
      zone: 'Centre-ville',
    });
    expect(res.statusCode).toBe(200);
    const [row] = await db.select().from(users).where(eq(users.id, userId));
    expect(row?.streetAddress).toBe('12 Rue de Tunis');
    expect(row?.city).toBe('Tunis');
    expect(row?.postalCode).toBe('1000');
    expect(row?.governorateId).toBe(governorateId);
    expect(row?.zone).toBe('Centre-ville');
  });

  it('partial: only supplied fields change', async () => {
    await db.update(users).set({ city: 'Sfax', postalCode: '3000' }).where(eq(users.id, userId));
    mockSession(userId);
    await patch({ city: 'Sousse' });
    const [row] = await db.select().from(users).where(eq(users.id, userId));
    expect(row?.city).toBe('Sousse');
    expect(row?.postalCode).toBe('3000'); // untouched
  });

  it('zone: null clears', async () => {
    await db.update(users).set({ zone: 'Lac 2' }).where(eq(users.id, userId));
    mockSession(userId);
    const res = await patch({ zone: null });
    expect(res.statusCode).toBe(200);
    const [row] = await db.select().from(users).where(eq(users.id, userId));
    expect(row?.zone).toBeNull();
  });

  it('bad postal_code (not 4 digits) → 400', async () => {
    mockSession(userId);
    const res = await patch({ postal_code: '12345' });
    expect(res.statusCode).toBe(400);
  });

  it('unknown governorate_id → 400 (FK pre-check)', async () => {
    mockSession(userId);
    const res = await patch({ governorate_id: '00000000-0000-0000-0000-000000000000' });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ fields: { field: string }[] }>().fields[0]?.field).toBe('governorate_id');
  });

  it('valid governorate_id → stored', async () => {
    mockSession(userId);
    const res = await patch({ governorate_id: governorateId });
    expect(res.statusCode).toBe(200);
    const [row] = await db.select().from(users).where(eq(users.id, userId));
    expect(row?.governorateId).toBe(governorateId);
  });

  it('unauthenticated → 401', async () => {
    vi.spyOn(auth.api, 'getSession').mockResolvedValue(null);
    const res = await patch({ city: 'X' });
    expect(res.statusCode).toBe(401);
  });

  it('empty body → 400', async () => {
    mockSession(userId);
    const res = await patch({});
    expect(res.statusCode).toBe(400);
  });
});

describe('PATCH /api/profile/notifications', () => {
  let app: ReturnType<typeof buildApp>;
  let userId: string;

  beforeEach(async () => {
    await resetAuthTables();
    const [u] = await db
      .insert(users)
      .values({ email: 'notif@example.com', contactName: 'Notif Owner' })
      .returning();
    userId = u?.id ?? '';
    app = buildApp();
    await app.register(profileRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  const patch = (payload: Record<string, unknown>) =>
    app.inject({ method: 'PATCH', url: '/api/profile/notifications', payload });

  it('authenticated → toggles supplied booleans', async () => {
    mockSession(userId);
    // schema defaults: news=false, reminders=true, promotions=false (Commit 3).
    const res = await patch({
      notify_news_updates: true,
      notify_reminders_events: false,
      notify_promotions_offers: true,
    });
    expect(res.statusCode).toBe(200);
    const [row] = await db.select().from(users).where(eq(users.id, userId));
    expect(row?.notifyNewsUpdates).toBe(true);
    expect(row?.notifyRemindersEvents).toBe(false);
    expect(row?.notifyPromotionsOffers).toBe(true);
  });

  it('partial: only supplied flags change', async () => {
    mockSession(userId);
    await patch({ notify_news_updates: true });
    const [row] = await db.select().from(users).where(eq(users.id, userId));
    expect(row?.notifyNewsUpdates).toBe(true);
    expect(row?.notifyRemindersEvents).toBe(true); // default untouched
  });

  it('unauthenticated → 401', async () => {
    vi.spyOn(auth.api, 'getSession').mockResolvedValue(null);
    const res = await patch({ notify_news_updates: true });
    expect(res.statusCode).toBe(401);
  });

  it('empty body → 400', async () => {
    mockSession(userId);
    const res = await patch({});
    expect(res.statusCode).toBe(400);
  });
});

describe('PATCH /api/profile/bank', () => {
  let app: ReturnType<typeof buildApp>;
  let userId: string;

  beforeEach(async () => {
    await resetAuthTables();
    const [u] = await db
      .insert(users)
      .values({ email: 'bank@example.com', contactName: 'Bank Owner' })
      .returning();
    userId = u?.id ?? '';
    app = buildApp();
    await app.register(profileRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  const patch = (payload: Record<string, unknown>) =>
    app.inject({ method: 'PATCH', url: '/api/profile/bank', payload });

  it('authenticated → stores fields + server-stamps bank_details_updated_at', async () => {
    mockSession(userId);
    const res = await patch({
      bank_account_holder: 'Foulen Ben Foulen',
      bank_rib: '12345678901234567890',
      bank_iban: 'TN5912345678901234567890',
    });
    expect(res.statusCode).toBe(200);
    const [row] = await db.select().from(users).where(eq(users.id, userId));
    expect(row?.bankAccountHolder).toBe('Foulen Ben Foulen');
    expect(row?.bankRib).toBe('12345678901234567890');
    expect(row?.bankIban).toBe('TN5912345678901234567890');
    expect(row?.bankDetailsUpdatedAt).toBeInstanceOf(Date);
  });

  it('partial: only supplied fields change', async () => {
    await db
      .update(users)
      .set({ bankAccountHolder: 'Original Holder', bankRib: '11111111111111111111' })
      .where(eq(users.id, userId));
    mockSession(userId);
    await patch({ bank_rib: '22222222222222222222' });
    const [row] = await db.select().from(users).where(eq(users.id, userId));
    expect(row?.bankRib).toBe('22222222222222222222');
    expect(row?.bankAccountHolder).toBe('Original Holder'); // untouched
  });

  it('empty-string field → 400 (min 1)', async () => {
    mockSession(userId);
    expect((await patch({ bank_account_holder: '' })).statusCode).toBe(400);
  });

  it('bank_rib format: exactly 20 digits (commit-1 ruling)', async () => {
    mockSession(userId);
    expect((await patch({ bank_rib: '1234567890123456789' })).statusCode).toBe(400); // 19
    expect((await patch({ bank_rib: '123456789012345678901' })).statusCode).toBe(400); // 21
    expect((await patch({ bank_rib: '1234567890123456789X' })).statusCode).toBe(400); // letter
    expect((await patch({ bank_rib: '12345678901234567890' })).statusCode).toBe(200);
  });

  it('bank_iban format: TN + 22 digits, check digits not pinned', async () => {
    mockSession(userId);
    expect((await patch({ bank_iban: 'TN591234567890123456789' })).statusCode).toBe(400); // 23 chars
    expect((await patch({ bank_iban: 'FR5912345678901234567890' })).statusCode).toBe(400); // not TN
    expect((await patch({ bank_iban: 'tn5912345678901234567890' })).statusCode).toBe(400); // lowercase
    expect((await patch({ bank_iban: 'TN0012345678901234567890' })).statusCode).toBe(200); // any check digits
    expect((await patch({ bank_iban: 'TN5912345678901234567890' })).statusCode).toBe(200);
  });

  it('unauthenticated → 401', async () => {
    vi.spyOn(auth.api, 'getSession').mockResolvedValue(null);
    expect((await patch({ bank_rib: 'X' })).statusCode).toBe(401);
  });

  it('empty body → 400', async () => {
    mockSession(userId);
    expect((await patch({})).statusCode).toBe(400);
  });
});

describe('POST /api/profile/resubmit', () => {
  let app: ReturnType<typeof buildApp>;

  // A rejected account with a full validation context (an admin validator + notes + topics) so the
  // "trio cleared" assertions are meaningful (not vacuously null).
  const seedRejected = async (): Promise<string> => {
    const [admin] = await db
      .insert(users)
      .values({
        email: 'validator@example.com',
        contactName: 'Validator',
        role: 'superadmin',
        status: 'approved',
      })
      .returning();
    const [u] = await db
      .insert(users)
      .values({
        email: 'rejected-resubmit@example.com',
        contactName: 'Rejected User',
        status: 'rejected',
        validatedBy: admin?.id ?? null,
        validatedAt: new Date('2026-06-01T00:00:00Z'),
        validationNotes: 'CIN illisible.',
        rejectionTopics: ['legal'],
      })
      .returning();
    return u?.id ?? '';
  };

  const seed = async (status: 'pending' | 'approved'): Promise<string> => {
    const [u] = await db
      .insert(users)
      .values({ email: `${status}-resubmit@example.com`, contactName: 'User', status })
      .returning();
    return u?.id ?? '';
  };

  beforeEach(async () => {
    await resetAuthTables();
    app = buildApp();
    await app.register(profileRoutes);
    await app.register(meRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  const resubmit = () => app.inject({ method: 'POST', url: '/api/profile/resubmit' });

  it('rejected → 200, status pending, whole validation trio + topics cleared', async () => {
    const userId = await seedRejected();
    mockSession(userId);
    const res = await resubmit();
    expect(res.statusCode).toBe(200);
    expect(res.json<{ status: string }>().status).toBe('pending');
    const [row] = await db.select().from(users).where(eq(users.id, userId));
    expect(row?.status).toBe('pending');
    expect(row?.validatedBy).toBeNull();
    expect(row?.validatedAt).toBeNull();
    expect(row?.validationNotes).toBeNull();
    expect(row?.rejectionTopics).toBeNull();
  });

  it('after resubmit, GET /api/me reflects pending (notes + topics null)', async () => {
    const userId = await seedRejected();
    mockSession(userId);
    await resubmit();
    const meRes = await app.inject({ method: 'GET', url: '/api/me' });
    const { user } = meRes.json<{
      user: { status: string; validation_notes: string | null; rejection_topics: string[] | null };
    }>();
    expect(user.status).toBe('pending');
    expect(user.validation_notes).toBeNull();
    expect(user.rejection_topics).toBeNull();
  });

  it('pending caller → 409 (only a rejected account can resubmit)', async () => {
    const userId = await seed('pending');
    mockSession(userId);
    const res = await resubmit();
    expect(res.statusCode).toBe(409);
    expect(res.json<{ currentStatus: string }>().currentStatus).toBe('pending');
  });

  it('approved caller → 409 no-op', async () => {
    const userId = await seed('approved');
    mockSession(userId);
    expect((await resubmit()).statusCode).toBe(409);
  });

  it('unauthenticated → 401', async () => {
    vi.spyOn(auth.api, 'getSession').mockResolvedValue(null);
    expect((await resubmit()).statusCode).toBe(401);
  });
});

// Single file-level teardown — the pool is shared across all describes above
// (sql.end() must run once, after the last suite, not per-describe).
afterAll(async () => {
  await sql.end();
});
