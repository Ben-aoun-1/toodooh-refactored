import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { authPlugin } from '../src/auth/plugin.js';
import { db, sql } from '../src/db/client.js';
import { governorates, screenhosts, users } from '../src/db/schema.js';
import { decryptWifiPassword } from '../src/lib/wifi-crypto.js';
import { apiRoutes } from '../src/routes/index.js';

import { resetAuthTables } from './helpers/db-test-setup.js';
import { signupMultipart } from './helpers/signup-multipart.js';

// nodemailer mocked → the verification hook "sends" without a real SMTP connection.
const { sendMailMock } = vi.hoisted(() => ({
  sendMailMock: vi.fn().mockResolvedValue({ messageId: 'test-msg-id' }),
}));
vi.mock('nodemailer', () => ({
  default: { createTransport: vi.fn(() => ({ sendMail: sendMailMock })) },
}));

// Integration suite — exercises the P3 screenhost persistence in POST /api/signup.
// Requires a real Postgres (DATABASE_URL). resetAuthTables TRUNCATE ... CASCADE wipes
// screenhosts too (it FK-references users), giving per-test isolation.

const buildApp = () => Fastify({ logger: false });

const ownerBase = {
  email: 'host@example.com',
  password: 'a-strong-passw0rd',
  contact_name: 'Test Host',
  business_name: 'Host Biz',
  contact_phone: '+21612345678',
  terms_accepted: true as const,
};

describe('POST /api/signup — screenhost location persistence (P3)', () => {
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

  const aGovernorate = async (): Promise<string> => {
    const [gov] = await db.select({ id: governorates.id }).from(governorates).limit(1);
    return gov?.id ?? '';
  };

  const userIdByEmail = async (email: string): Promise<string> => {
    const [u] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
    return u?.id ?? '';
  };

  it('individual_owner → persists exactly ONE screenhost with mapped fields, encrypted WiFi, owner_id', async () => {
    const governorateId = await aGovernorate();
    const wifiPassword = 'wifi-secret-pw';
    const res = await app.inject({
      method: 'POST',
      url: '/api/signup',
      ...signupMultipart({
        ...ownerBase,
        profile_type: 'individual_owner',
        street_address: '12 Rue de Test',
        city: 'Tunis',
        postal_code: '1000',
        governorate_id: governorateId,
        zone: 'Centre Ville',
        latitude: 36.8065,
        longitude: 10.1815,
        wifi_ssid: 'TOODOOH-NET',
        wifi_password: wifiPassword,
      }),
    });
    expect(res.statusCode).toBe(201);

    const ownerId = await userIdByEmail(ownerBase.email);
    const rows = await db.select().from(screenhosts).where(eq(screenhosts.ownerId, ownerId));
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row?.name).toBe('Host Biz'); // from business_name
    expect(row?.address).toBe('12 Rue de Test');
    expect(row?.city).toBe('Tunis');
    expect(row?.postalCode).toBe('1000');
    expect(row?.governorateId).toBe(governorateId);
    expect(row?.zone).toBe('Centre Ville');
    expect(Number(row?.latitude)).toBeCloseTo(36.8065, 4);
    expect(Number(row?.longitude)).toBeCloseTo(10.1815, 4);
    expect(row?.wifiSsid).toBe('TOODOOH-NET');
    expect(row?.ownerId).toBe(ownerId); // app-enforced not-null
    // export_status keeps its 'pending' default — no export wired this lane.
    expect(row?.exportStatus).toBe('pending');
    expect(row?.exportedAt).toBeNull();
    // WiFi password is encrypted at rest (recoverable), never stored in plaintext.
    expect(row?.wifiPasswordEncrypted).toBeTruthy();
    expect(row?.wifiPasswordEncrypted).not.toBe(wifiPassword);
    expect(decryptWifiPassword(row?.wifiPasswordEncrypted ?? '')).toBe(wifiPassword);
  });

  it('individual_owner without coordinates/WiFi → row created with those columns NULL ("add later")', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/signup',
      ...signupMultipart({ ...ownerBase, profile_type: 'individual_owner', city: 'Sfax' }),
    });
    expect(res.statusCode).toBe(201);

    const ownerId = await userIdByEmail(ownerBase.email);
    const rows = await db.select().from(screenhosts).where(eq(screenhosts.ownerId, ownerId));
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row?.city).toBe('Sfax');
    expect(row?.latitude).toBeNull();
    expect(row?.longitude).toBeNull();
    expect(row?.wifiSsid).toBeNull();
    expect(row?.wifiPasswordEncrypted).toBeNull();
    expect(row?.ownerId).toBe(ownerId);
    expect(row?.exportStatus).toBe('pending');
  });

  it('fleet_owner → persists ONE screenhost per fleet establishment, each with owner_id + encrypted WiFi', async () => {
    const governorateId = await aGovernorate();
    const res = await app.inject({
      method: 'POST',
      url: '/api/signup',
      ...signupMultipart({
        ...ownerBase,
        profile_type: 'fleet_owner',
        fleet_establishments: [
          {
            name: 'Café du Lac',
            screen_count: 3,
            address: '1 Av. du Lac',
            city: 'Tunis',
            zone: 'Lac 2',
            governorate_id: governorateId,
            postal_code: '1053',
            latitude: 36.8329,
            longitude: 10.2316,
            wifi_ssid: 'CAFE-LAC',
            wifi_password: 'lac-wifi-pw',
            room_count: 2, // accepted on the wire, stripped (no column)
          },
          {
            name: 'Resto Centre',
            screen_count: 1,
            city: 'Sousse',
            // no coordinates / WiFi → "add later" → NULLs
          },
        ],
      }),
    });
    expect(res.statusCode).toBe(201);

    const ownerId = await userIdByEmail(ownerBase.email);
    const rows = await db.select().from(screenhosts).where(eq(screenhosts.ownerId, ownerId));
    expect(rows).toHaveLength(2);

    const cafe = rows.find((r) => r.name === 'Café du Lac');
    expect(cafe?.screenCount).toBe(3);
    expect(cafe?.city).toBe('Tunis');
    expect(cafe?.governorateId).toBe(governorateId);
    expect(cafe?.postalCode).toBe('1053');
    expect(Number(cafe?.latitude)).toBeCloseTo(36.8329, 4);
    expect(cafe?.wifiSsid).toBe('CAFE-LAC');
    expect(cafe?.wifiPasswordEncrypted).not.toBe('lac-wifi-pw');
    expect(decryptWifiPassword(cafe?.wifiPasswordEncrypted ?? '')).toBe('lac-wifi-pw');
    expect(cafe?.ownerId).toBe(ownerId);
    expect(cafe?.exportStatus).toBe('pending');

    const resto = rows.find((r) => r.name === 'Resto Centre');
    expect(resto?.screenCount).toBe(1);
    expect(resto?.city).toBe('Sousse');
    expect(resto?.latitude).toBeNull();
    expect(resto?.wifiSsid).toBeNull();
    expect(resto?.wifiPasswordEncrypted).toBeNull();
    expect(resto?.ownerId).toBe(ownerId);
  });

  it('advertiser signup → no screenhost rows (only owners get locations)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/signup',
      payload: { ...ownerBase, profile_type: 'advertiser', latitude: 36.8, longitude: 10.1 },
    });
    expect(res.statusCode).toBe(201);
    const all = await db.select().from(screenhosts);
    expect(all).toHaveLength(0);
  });

  it('duplicate-email signup (synthetic-id) → persists NO additional screenhost', async () => {
    // First: a real individual_owner signup → one screenhost.
    await app.inject({
      method: 'POST',
      url: '/api/signup',
      ...signupMultipart({ ...ownerBase, profile_type: 'individual_owner', city: 'Tunis' }),
    });
    const ownerId = await userIdByEmail(ownerBase.email);
    expect(
      await db.select().from(screenhosts).where(eq(screenhosts.ownerId, ownerId)),
    ).toHaveLength(1);

    // Then: a duplicate-email attempt (anti-enumeration synthetic id) trying to add a fleet.
    const res2 = await app.inject({
      method: 'POST',
      url: '/api/signup',
      ...signupMultipart({
        ...ownerBase,
        profile_type: 'fleet_owner',
        fleet_establishments: [{ name: 'Sneaky Location' }],
      }),
    });
    expect(res2.statusCode).toBe(201); // generic, anti-enumeration
    // Still exactly one screenhost total — the synthetic-id guard skipped the insert.
    const all = await db.select().from(screenhosts);
    expect(all).toHaveLength(1);
    expect(all[0]?.ownerId).toBe(ownerId);
  });
});
