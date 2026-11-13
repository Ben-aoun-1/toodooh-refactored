import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { db, sql } from '../src/db/client.js';
import {
  type NewUser,
  campaignReconciliation,
  campaigns,
  creatives,
  eventAllocations,
  events,
  screenhosts,
  users,
} from '../src/db/schema.js';
import { executeCleanup, planCleanup } from '../src/lib/cleanup-screencasters.js';
import { storage } from '../src/storage/s3-storage.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// Mariem 05/11 — the screencaster cleanup (lib/cleanup-screencasters), real Postgres. Operator
// ruling 3A: an account that never aired goes completely (DEL-1); one whose campaigns aired keeps
// them (the Hosts' money history), its live / draft / never-aired rest goes and it is deactivated.

let seq = 0;
const seedUser = async (values: Partial<NewUser> = {}): Promise<string> => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `cleanup-${seq}@example.com`,
      contactName: `Cleanup ${seq}`,
      businessName: `Cast ${seq}`,
      role: 'advertiser',
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

const seedCampaign = async (
  advertiserId: string,
  values: Partial<typeof campaigns.$inferInsert> = {},
): Promise<string> => {
  seq += 1;
  const [c] = await db
    .insert(campaigns)
    .values({
      advertiserId,
      name: `Campagne ${seq}`,
      campaignType: 'standard',
      status: 'draft',
      startDate: '2027-06-01',
      endDate: '2027-06-05',
      requestedBudget: '100.00',
      ...values,
    })
    .returning();
  return c?.id ?? '';
};

const userOf = async (id: string) => (await db.select().from(users).where(eq(users.id, id)))[0];
const campaignOf = async (id: string) =>
  (await db.select().from(campaigns).where(eq(campaigns.id, id)))[0];

describe('the screencaster cleanup (Mariem 05/11)', () => {
  beforeEach(async () => {
    await resetAuthTables();
    vi.spyOn(storage, 'upload').mockImplementation(async ({ key }) => ({ key }));
    vi.spyOn(storage, 'download').mockResolvedValue({
      body: Buffer.from('pdf'),
      contentType: 'application/pdf',
    });
    vi.spyOn(storage, 'delete').mockResolvedValue({ deleted: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await sql.end();
  });

  const world = async () => {
    const superadmin = await seedUser({ role: 'superadmin', businessName: null });
    // A — nothing ever aired: a draft and a pending campaign.
    const never = await seedUser();
    const neverDraft = await seedCampaign(never);
    await seedCampaign(never, { status: 'pending' });
    // B — an aired, settled campaign (the Hosts' history), a live positioning, a draft.
    const aired = await seedUser();
    const airedDone = await seedCampaign(aired, { status: 'completed' });
    await db.insert(campaignReconciliation).values({
      campaignId: airedDone,
      expectedImp: 1000,
      deliveredImp: 1000,
      manquementImp: 0,
      pPerteTnd: '0',
      refundTnd: '0',
      spendTnd: '40',
      status: 'reussie',
      reconciledBy: null,
    });
    const [event] = await db
      .insert(events)
      .values({
        name: 'Match de test',
        type: 'sport',
        kickoffAt: new Date('2027-06-10T20:00:00+01:00'),
        endsAt: new Date('2027-06-10T22:00:00+01:00'),
        source: 'official',
        seatMinutes: 1,
      })
      .returning();
    const [creative] = await db
      .insert(creatives)
      .values({
        advertiserId: aired,
        creativeType: 'video',
        storageKey: `c/${seq}`,
        durationSeconds: 15,
      })
      .returning();
    const positioning = await seedCampaign(aired, {
      campaignType: 'event',
      status: 'upcoming',
      eventId: event?.id ?? null,
      eventMinutes: 2,
      creativeId: creative?.id ?? null,
      startDate: '2027-06-10',
      endDate: '2027-06-10',
    });
    const owner = await seedUser({ role: 'individual_owner' });
    const [venue] = await db
      .insert(screenhosts)
      .values({ name: 'Café', ownerId: owner })
      .returning();
    await db.insert(eventAllocations).values({
      campaignId: positioning,
      screenhostId: venue?.id ?? '',
      blocs: [],
      impressionsTotal: 0,
      montantTnd: '60.000',
      statut: 'EN_ATTENTE',
    });
    const airedDraft = await seedCampaign(aired);
    // C — a demo account, left alone unless asked.
    const demo = await seedUser({ isDemo: true });
    const demoDraft = await seedCampaign(demo);
    return {
      superadmin,
      never,
      neverDraft,
      aired,
      airedDone,
      positioning,
      airedDraft,
      demo,
      demoDraft,
      eventId: event?.id ?? '',
    };
  };

  it('plans: delete what never aired, keep and deactivate the rest; demo accounts only on request', async () => {
    const w = await world();
    const plans = await planCleanup({ includeDemo: false, protectedMarkers: [] });
    expect(plans.map((p) => [p.userId, p.kind])).toEqual([
      [w.never, 'delete'],
      [w.aired, 'keep'],
    ]);
    const kept = plans.find((p) => p.userId === w.aired);
    expect(kept).toMatchObject({ live: [w.positioning], kept: 1 });
    expect(kept?.purge).toEqual([w.airedDraft]);
    const withDemo = await planCleanup({ includeDemo: true, protectedMarkers: [] });
    expect(withDemo.map((p) => p.userId)).toContain(w.demo);
  });

  it('a protected account refuses the whole run', async () => {
    await world();
    await expect(planCleanup({ includeDemo: false, protectedMarkers: ['cast'] })).rejects.toThrow(
      /protected/,
    );
  });

  it('executes: the never-aired account is gone, the aired one keeps its history only', async () => {
    const w = await world();
    const plans = await planCleanup({ includeDemo: false, protectedMarkers: [] });
    const report = await executeCleanup(plans, { adminId: w.superadmin });

    expect(report).toMatchObject({ stopped: 1, matchesReleased: 1 });
    expect(await userOf(w.never)).toBeUndefined();
    expect(await campaignOf(w.neverDraft)).toBeUndefined();

    expect((await userOf(w.aired))?.status).toBe('deactivated');
    expect(await campaignOf(w.airedDone)).toBeDefined(); // the Hosts' money history stays
    expect(await campaignOf(w.positioning)).toBeUndefined(); // stopped, never aired → deleted
    expect(await campaignOf(w.airedDraft)).toBeUndefined();
    const [event] = await db
      .select({ seatMinutes: events.seatMinutes })
      .from(events)
      .where(eq(events.id, w.eventId));
    expect(event?.seatMinutes).toBeNull(); // the match takes the 2-minute rule again

    expect((await userOf(w.demo))?.status).toBe('approved'); // not asked
    expect(await campaignOf(w.demoDraft)).toBeDefined();
  });
});
