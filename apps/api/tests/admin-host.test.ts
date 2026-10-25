import { addDays, format } from 'date-fns';
import { and, eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import {
  type NewUser,
  businessSectors,
  governorates,
  hostAdminEdits,
  screenhosts,
  screenhostUnavailability,
  users,
} from '../src/db/schema.js';
import { tunisDateOf } from '../src/lib/campaign-dates.js';
import { adminHostRoutes } from '../src/routes/admin-host.js';
import { internalRoutes } from '../src/routes/internal.js';
import { screenhostDeclarationRoutes } from '../src/routes/screenhost-declaration.js';
import { screenhostsRoutes } from '../src/routes/screenhosts.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// HOST-EDIT1 — the admin « Fiche Host » (real Postgres): venue + owner edits, the admin trail
// (ruling Q3 A), the hub lock (ruling Q5 B) and the admin unavailability twin. The wedooh re-push
// is mocked, as in the hours / WiFi suites. Seeded reference rows (governorates, owner sectors) are
// READ, never written.
const pushSpy = vi.hoisted(() =>
  vi.fn<(ownerId: string, logger: unknown) => Promise<void>>(() => Promise.resolve()),
);
vi.mock('../src/lib/wedooh-sync.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/wedooh-sync.js')>();
  return { ...actual, pushApprovedOwnerLocations: pushSpy };
});

type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;
const SYNC_KEY = 'test-sync-key-0123456789';

const buildApp = () => {
  const app = Fastify({ logger: false });
  app.register(adminHostRoutes);
  app.register(screenhostsRoutes);
  app.register(screenhostDeclarationRoutes);
  app.register(internalRoutes, { syncKey: SYNC_KEY });
  return app;
};

const mockSession = (userId: string, role = 'admin'): void => {
  vi.spyOn(auth.api, 'getSession').mockResolvedValue({
    session: {},
    user: { id: userId, role, status: 'approved' },
  } as unknown as GetSessionResult);
};

let seq = 0;
const seedUser = async (values: Partial<NewUser> = {}): Promise<string> => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `host-edit${seq}@example.com`,
      contactName: `User ${seq}`,
      status: 'approved',
      ...values,
    })
    .returning({ id: users.id });
  return u?.id ?? '';
};

const seedVenue = async (ownerId: string | null): Promise<string> => {
  const [s] = await db
    .insert(screenhosts)
    .values({ name: 'Café Test', ownerId, address: '1 rue X', city: 'Tunis' })
    .returning({ id: screenhosts.id });
  return s?.id ?? '';
};

const firstGovernorate = async (): Promise<string> => {
  const [g] = await db.select({ id: governorates.id }).from(governorates).limit(1);
  return g?.id ?? '';
};

const ownerSectors = async () =>
  db
    .select({ id: businessSectors.id, name: businessSectors.name })
    .from(businessSectors)
    .where(eq(businessSectors.audience, 'owner'))
    .limit(2);

const trail = (venueId: string) =>
  db.select().from(hostAdminEdits).where(eq(hostAdminEdits.screenhostId, venueId));

const flush = () => new Promise((r) => setTimeout(r, 20));

describe('HOST-EDIT1 admin « Fiche Host » (real Postgres)', () => {
  let app: ReturnType<typeof buildApp>;
  let admin: string;

  beforeEach(async () => {
    await resetAuthTables();
    pushSpy.mockClear();
    app = buildApp();
    await app.ready();
    admin = await seedUser({ role: 'admin', contactName: 'Admin Un' });
    mockSession(admin);
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await sql.end();
  });

  const patchVenue = (id: string, payload: Record<string, unknown>) =>
    app.inject({ method: 'PATCH', url: `/api/admin/screenhosts/${id}`, payload });
  const patchOwner = (id: string, payload: Record<string, unknown>) =>
    app.inject({ method: 'PATCH', url: `/api/admin/screenhosts/${id}/owner`, payload });

  it('GET serves the venue and its owner account; 404 on a missing venue; 403 for a non-admin', async () => {
    const owner = await seedUser({ role: 'individual_owner', businessName: 'Chez Ali' });
    const venue = await seedVenue(owner);

    const res = await app.inject({ method: 'GET', url: `/api/admin/screenhosts/${venue}` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      venue: { name: string; locked_fields: string[] };
      owner: { business_name: string; venues_count: number };
    };
    expect(body.venue.name).toBe('Café Test');
    expect(body.venue.locked_fields).toEqual([]);
    expect(body.owner.business_name).toBe('Chez Ali');
    expect(body.owner.venues_count).toBe(1);
    // The WiFi password is reported as present / absent only — the cipher never reaches the wire.
    await app.inject({
      method: 'PATCH',
      url: `/api/admin/screenhosts/${venue}/wifi`,
      payload: { wifi_ssid: 'CafeNet', wifi_password: 'super-secret-pw' },
    });
    const withWifi = await app.inject({ method: 'GET', url: `/api/admin/screenhosts/${venue}` });
    expect(withWifi.json()).toMatchObject({
      venue: { wifi_ssid: 'CafeNet', wifi_password_set: true },
    });
    expect(withWifi.body).not.toContain('super-secret-pw');
    expect(withWifi.body).not.toMatch(/password_encrypted|wifiPasswordEncrypted/);

    const missing = await app.inject({
      method: 'GET',
      url: '/api/admin/screenhosts/00000000-0000-4000-8000-000000000000',
    });
    expect(missing.statusCode).toBe(404);

    vi.restoreAllMocks();
    mockSession(owner, 'individual_owner');
    const forbidden = await app.inject({ method: 'GET', url: `/api/admin/screenhosts/${venue}` });
    expect(forbidden.statusCode).toBe(403);
  });

  it('PATCH venue writes the fields, records ONLY the changed keys and re-pushes an approved owner', async () => {
    const owner = await seedUser({ role: 'individual_owner' });
    const venue = await seedVenue(owner);
    const gov = await firstGovernorate();

    const res = await patchVenue(venue, {
      name: '  Café Neuf ',
      city: 'Tunis',
      governorate_id: gov,
      latitude: 36.8,
      longitude: 10.18,
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { venue: { name: string; latitude: number } }).venue).toMatchObject({
      name: 'Café Neuf',
      latitude: 36.8,
      longitude: 10.18,
    });
    await flush();
    expect(pushSpy).toHaveBeenCalledWith(owner, expect.anything());

    const rows = await trail(venue);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ section: 'venue', changedBy: admin });
    // city was re-sent unchanged → not in the trail.
    expect(rows[0]?.before).toEqual({
      name: 'Café Test',
      governorate_id: null,
      latitude: null,
      longitude: null,
    });
    expect(rows[0]?.after).toEqual({
      name: 'Café Neuf',
      governorate_id: gov,
      latitude: 36.8,
      longitude: 10.18,
    });

    // A no-op save writes no trail row and pushes nothing.
    pushSpy.mockClear();
    expect((await patchVenue(venue, { city: 'Tunis' })).statusCode).toBe(200);
    await flush();
    expect(await trail(venue)).toHaveLength(1);
    expect(pushSpy).not.toHaveBeenCalled();
  });

  it('PATCH venue does not push a pending owner, and refuses incoherent input', async () => {
    const owner = await seedUser({ role: 'individual_owner', status: 'pending' });
    const venue = await seedVenue(owner);
    expect((await patchVenue(venue, { name: 'Autre' })).statusCode).toBe(200);
    await flush();
    expect(pushSpy).not.toHaveBeenCalled();

    expect((await patchVenue(venue, {})).statusCode).toBe(400);
    expect((await patchVenue(venue, { name: '   ' })).statusCode).toBe(400);
    expect((await patchVenue(venue, { postal_code: '123' })).statusCode).toBe(400);
    expect((await patchVenue(venue, { latitude: 36.8 })).statusCode).toBe(400);
    expect(
      (await patchVenue(venue, { governorate_id: '00000000-0000-4000-8000-000000000000' }))
        .statusCode,
    ).toBe(400);
  });

  it('PATCH owner writes the account, normalises the matricule, refuses a taken one', async () => {
    const owner = await seedUser({ role: 'fleet_owner', businessName: 'Groupe A' });
    const venue = await seedVenue(owner);
    await seedVenue(owner);
    await seedUser({ role: 'individual_owner', taxNumber: '7654321BMM000' });

    const res = await patchOwner(venue, {
      business_name: 'Groupe B',
      tax_number: '1234567/a/m/m/000',
      fonction: 'Gérant',
    });
    expect(res.statusCode).toBe(200);
    const [row] = await db
      .select({ businessName: users.businessName, taxNumber: users.taxNumber })
      .from(users)
      .where(eq(users.id, owner));
    expect(row).toEqual({ businessName: 'Groupe B', taxNumber: '1234567AMM000' });
    await flush();
    expect(pushSpy).toHaveBeenCalledWith(owner, expect.anything());
    expect((await trail(venue))[0]).toMatchObject({ section: 'owner' });

    const taken = await patchOwner(venue, { tax_number: '7654321BMM000' });
    expect(taken.statusCode).toBe(409);
    expect((taken.json() as { error: string }).error).toBe('TAX_NUMBER_TAKEN');

    // A field the hub does not carry re-pushes nothing.
    pushSpy.mockClear();
    expect((await patchOwner(venue, { fonction: 'Directeur' })).statusCode).toBe(200);
    await flush();
    expect(pushSpy).not.toHaveBeenCalled();

    expect((await patchOwner(venue, { contact_phone: '12345' })).statusCode).toBe(400);
  });

  it('PATCH owner on an ownerless venue is a 409 NO_OWNER', async () => {
    const venue = await seedVenue(null);
    const res = await patchOwner(venue, { business_name: 'X' });
    expect(res.statusCode).toBe(409);
  });

  it('an admin eligibility edit LOCKS the changed fields: the hub ingest skips them until « Rendre au hub »', async () => {
    const owner = await seedUser({ role: 'individual_owner' });
    const venue = await seedVenue(owner);
    const [hubSector, adminSector] = await ownerSectors();

    const edit = await app.inject({
      method: 'PATCH',
      url: `/api/admin/screenhosts/${venue}/eligibility`,
      payload: { opening_hour: 9, closing_hour: 22, business_sector_id: adminSector?.id },
    });
    expect(edit.statusCode).toBe(200);
    const fiche = await app.inject({ method: 'GET', url: `/api/admin/screenhosts/${venue}` });
    expect((fiche.json() as { venue: { locked_fields: string[] } }).venue.locked_fields).toEqual([
      'business_sector',
      'hours',
    ]);
    const [audit] = await trail(venue);
    expect(audit).toMatchObject({ section: 'eligibility' });
    expect(audit?.after).toEqual({
      business_sector_id: adminSector?.id,
      opening_hour: 9,
      closing_hour: 22,
    });

    const hubPush = () =>
      app.inject({
        method: 'POST',
        url: '/api/internal/screenhost-eligibility',
        headers: { authorization: `Bearer ${SYNC_KEY}` },
        payload: {
          items: [
            {
              location_id: venue,
              business_sector: hubSector?.name,
              class: 'premium',
              opening_hour: 6,
              closing_hour: 18,
            },
          ],
        },
      });
    expect((await hubPush()).statusCode).toBe(200);
    const read = async () =>
      (
        await db
          .select({
            sector: screenhosts.businessSectorId,
            cls: screenhosts.class,
            open: screenhosts.openingHour,
            close: screenhosts.closingHour,
          })
          .from(screenhosts)
          .where(eq(screenhosts.id, venue))
      )[0];
    // The admin's sector and hours stand; the unlocked class is the hub's.
    expect(await read()).toEqual({ sector: adminSector?.id, cls: 'premium', open: 9, close: 22 });

    const unlock = await app.inject({
      method: 'DELETE',
      url: `/api/admin/screenhosts/${venue}/locks/hours`,
    });
    expect(unlock.statusCode).toBe(200);
    expect((unlock.json() as { locked_fields: string[] }).locked_fields).toEqual([
      'business_sector',
    ]);
    await hubPush();
    expect(await read()).toEqual({ sector: adminSector?.id, cls: 'premium', open: 6, close: 18 });

    expect(
      (await app.inject({ method: 'DELETE', url: `/api/admin/screenhosts/${venue}/locks/nope` }))
        .statusCode,
    ).toBe(400);
  });

  it('the WiFi trail records that the password moved, never the password', async () => {
    const venue = await seedVenue(null);
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/screenhosts/${venue}/wifi`,
      payload: { wifi_ssid: 'CafeNet', wifi_password: 'super-secret-pw' },
    });
    expect(res.statusCode).toBe(200);
    const [row] = await trail(venue);
    expect(row?.after).toEqual({ wifi_ssid: 'CafeNet', wifi_password_changed: true });
    expect(JSON.stringify(row)).not.toContain('super-secret-pw');
  });

  it('the admin screen declaration joins the trail', async () => {
    const venue = await seedVenue(null);
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/screenhosts/${venue}/declaration`,
      payload: { room_count: 3 },
    });
    expect(res.statusCode).toBe(200);
    const [row] = await trail(venue);
    expect(row).toMatchObject({
      section: 'declaration',
      before: { room_count: null },
      after: { room_count: 3 },
    });
  });

  it('the admin unavailability twin declares a future day, refuses today, and is audited', async () => {
    const venue = await seedVenue(null);
    const today = tunisDateOf(new Date());
    const future = format(addDays(new Date(`${today}T12:00:00Z`), 3), 'yyyy-MM-dd');

    const put = await app.inject({
      method: 'PUT',
      url: `/api/admin/screenhosts/${venue}/unavailability`,
      payload: { day: future, unavailable: true },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toMatchObject({ day: future, unavailable: true, redispatched: [] });
    const stored = await db
      .select()
      .from(screenhostUnavailability)
      .where(
        and(
          eq(screenhostUnavailability.screenhostId, venue),
          eq(screenhostUnavailability.day, future),
        ),
      );
    expect(stored).toHaveLength(1);

    const got = await app.inject({
      method: 'GET',
      url: `/api/admin/screenhosts/${venue}/unavailability?from=${today}&to=${future}`,
    });
    expect((got.json() as { days: string[] }).days).toEqual([future]);

    const past = await app.inject({
      method: 'PUT',
      url: `/api/admin/screenhosts/${venue}/unavailability`,
      payload: { day: today, unavailable: true },
    });
    expect(past.statusCode).toBe(400);

    const history = await app.inject({
      method: 'GET',
      url: `/api/admin/screenhosts/${venue}/history`,
    });
    const entries = (
      history.json() as {
        entries: {
          section: string;
          after: Record<string, boolean>;
          changed_by: { label: string };
        }[];
      }
    ).entries;
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      section: 'unavailability',
      after: { [future]: true },
      changed_by: { label: 'Admin Un' },
    });
  });
});
