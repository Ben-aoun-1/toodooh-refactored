import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import {
  type NewUser,
  campaigns,
  reversementLines,
  screenhostFactures,
  screenhosts,
  users,
} from '../src/db/schema.js';
import { adminFacturesRoutes } from '../src/routes/admin-factures.js';
import { ownerStatementsRoutes } from '../src/routes/owner-statements.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// OWN-REV1 + SH-TTC1 — the owner dashboard's « Revenus » (owed) and « Revenu encaissé » (paid).
// Real Postgres. The operator's arithmetic is the spec: validating a facture moves EXACTLY its
// amount from « Revenus » to « Revenu encaissé », and the share is TTC (nothing added on top).

type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;

const mockSession = (userId: string, role: string): void => {
  vi.spyOn(auth.api, 'getSession').mockResolvedValue({
    session: {},
    user: { id: userId, role, status: 'approved' },
  } as unknown as GetSessionResult);
};

let seq = 0;
const seedUser = async (values: Partial<NewUser>): Promise<string> => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `own-rev1-${seq}@example.com`,
      contactName: `User ${seq}`,
      role: 'advertiser',
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

const seedVenue = async (ownerId: string): Promise<string> => {
  const [sh] = await db
    .insert(screenhosts)
    .values({ name: `Venue ${seq}`, ownerId })
    .returning();
  return sh?.id ?? '';
};

const seedCampaign = async (): Promise<string> => {
  const advertiserId = await seedUser({ role: 'advertiser' });
  const [c] = await db
    .insert(campaigns)
    .values({ advertiserId, name: `C ${seq}`, campaignType: 'standard', status: 'completed' })
    .returning();
  return c?.id ?? '';
};

/** One settled share: `shTnd` is the owner's 50 % (TTC per SH-TTC1). */
const seedShare = async (
  screenhostId: string,
  campaignId: string,
  shTnd: string,
  source: 'campaign' | 'event' = 'campaign',
) => {
  await db.insert(reversementLines).values({
    source,
    campaignId,
    screenhostId,
    baseValueTnd: String(Number(shTnd) * 2),
    shAmountTnd: shTnd,
    toodoohAmountTnd: '0',
    agentShAmountTnd: '0',
    agentScAmountTnd: '0',
    settledAt: new Date('2026-07-15T10:00:00Z'),
  });
};

const seedFacture = async (screenhostId: string, month: string, totalSh: string) => {
  const [f] = await db
    .insert(screenhostFactures)
    .values({
      screenhostId,
      month,
      totalShTnd: totalSh,
      reference: `FS-R${String(seq).padStart(7, '0')}`,
      pdfKey: `statements/${screenhostId}/${month}.pdf`,
      status: 'en_verification',
      signedFileKey: `signed-factures/r-${seq}.pdf`,
      signedFileMime: 'application/pdf',
      depositedAt: new Date('2026-08-03T09:00:00Z'),
    })
    .returning();
  return f?.id ?? '';
};

describe('OWN-REV1 — GET /api/screenhosts/revenue-summary (real Postgres)', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    await resetAuthTables();
    app = Fastify({ logger: false });
    await app.register(adminFacturesRoutes);
    await app.register(ownerStatementsRoutes);
    await app.ready();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await app.close();
  });

  afterAll(async () => {
    await sql.end();
  });

  const summary = async (ownerId: string) => {
    mockSession(ownerId, 'individual_owner');
    const res = await app.inject({ method: 'GET', url: '/api/screenhosts/revenue-summary' });
    expect(res.statusCode).toBe(200);
    return res.json() as { a_encaisser_ttc: number; encaisse_ttc: number };
  };

  it('is zero / zero for an owner with nothing settled', async () => {
    const ownerId = await seedUser({ role: 'individual_owner' });
    expect(await summary(ownerId)).toEqual({ a_encaisser_ttc: 0, encaisse_ttc: 0 });
  });

  it('counts campaign AND event shares as owed, TTC as stored (10 000 HT → 5 000 TTC)', async () => {
    const ownerId = await seedUser({ role: 'individual_owner' });
    const venue = await seedVenue(ownerId);
    const campaignId = await seedCampaign();
    await seedShare(venue, campaignId, '5000.0000');
    await seedShare(venue, campaignId, '12.5000', 'event');
    expect(await summary(ownerId)).toEqual({ a_encaisser_ttc: 5012.5, encaisse_ttc: 0 });
  });

  it('valider moves exactly the facture amount from « Revenus » to « Revenu encaissé »', async () => {
    const ownerId = await seedUser({ role: 'individual_owner', bankRib: '12345678901234567890' });
    const adminId = await seedUser({ role: 'admin' });
    const venue = await seedVenue(ownerId);
    const campaignId = await seedCampaign();
    await seedShare(venue, campaignId, '5000.0000');
    const factureId = await seedFacture(venue, '2026-07', '5000.0000');

    expect(await summary(ownerId)).toEqual({ a_encaisser_ttc: 5000, encaisse_ttc: 0 });

    mockSession(adminId, 'admin');
    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/screenhost-factures/${factureId}/valider`,
      payload: {},
    });
    expect(res.statusCode).toBe(200);

    expect(await summary(ownerId)).toEqual({ a_encaisser_ttc: 0, encaisse_ttc: 5000 });
  });

  it('a later month keeps accruing after a validation (ruling 3A)', async () => {
    const ownerId = await seedUser({ role: 'individual_owner' });
    const adminId = await seedUser({ role: 'admin' });
    const venue = await seedVenue(ownerId);
    const campaignId = await seedCampaign();
    await seedShare(venue, campaignId, '100.0000');
    await seedShare(venue, campaignId, '40.0000');
    const factureId = await seedFacture(venue, '2026-07', '100.0000');
    mockSession(adminId, 'admin');
    await app.inject({
      method: 'POST',
      url: `/api/admin/screenhost-factures/${factureId}/valider`,
      payload: {},
    });
    expect(await summary(ownerId)).toEqual({ a_encaisser_ttc: 40, encaisse_ttc: 100 });
  });

  it('refuser pays nothing — both cards unchanged', async () => {
    const ownerId = await seedUser({ role: 'individual_owner' });
    const adminId = await seedUser({ role: 'admin' });
    const venue = await seedVenue(ownerId);
    const campaignId = await seedCampaign();
    await seedShare(venue, campaignId, '75.0000');
    const factureId = await seedFacture(venue, '2026-07', '75.0000');
    mockSession(adminId, 'admin');
    await app.inject({
      method: 'POST',
      url: `/api/admin/screenhost-factures/${factureId}/refuser`,
      payload: { motif: 'Cachet manquant.' },
    });
    expect(await summary(ownerId)).toEqual({ a_encaisser_ttc: 75, encaisse_ttc: 0 });
  });

  it('never reads another owner’s shares or payouts', async () => {
    const ownerA = await seedUser({ role: 'individual_owner' });
    const ownerB = await seedUser({ role: 'individual_owner' });
    const campaignId = await seedCampaign();
    await seedShare(await seedVenue(ownerA), campaignId, '10.0000');
    await seedShare(await seedVenue(ownerB), campaignId, '999.0000');
    expect(await summary(ownerA)).toEqual({ a_encaisser_ttc: 10, encaisse_ttc: 0 });
  });

  it('refuses an unauthenticated caller', async () => {
    vi.spyOn(auth.api, 'getSession').mockResolvedValue(null);
    const res = await app.inject({ method: 'GET', url: '/api/screenhosts/revenue-summary' });
    expect(res.statusCode).toBe(401);
  });
});
