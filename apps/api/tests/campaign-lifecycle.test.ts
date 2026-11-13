import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { db, sql } from '../src/db/client.js';
import {
  type NewUser,
  businessSectors,
  campaignTargeting,
  campaignZones,
  campaigns,
  cartItems,
  notifications,
  users,
  zones,
} from '../src/db/schema.js';
import { expiryNotice } from '../src/lib/campaign-expiry.js';
import { runCampaignLifecycleTick } from '../src/lib/campaign-lifecycle.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// CF-S1 — the stored-status lifecycle job: upcoming→active on start day, active→completed the
// day after end. Set-based + idempotent. NOW is injected; dates pin the Tunis calendar rule.

const silentLog = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
  fatal: () => undefined,
  trace: () => undefined,
  child: () => silentLog,
  level: 'silent',
} as never;

let seq = 0;
const seedUser = async (values: Partial<NewUser> = {}): Promise<string> => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `lc${seq}@example.com`,
      contactName: `User ${seq}`,
      role: 'advertiser',
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

// A Tunis wall-clock instant (UTC+1, no DST).
const tunis = (local: string): Date => new Date(`${local}+01:00`);

const seedCampaign = async (
  advertiserId: string,
  status: 'draft' | 'pending' | 'upcoming' | 'active' | 'rejected' | 'completed',
  window: { start?: string | null; end?: string | null } = {},
  // DISP-TOURS — the advertiser's last save (the expiry clock): a week before NOW by default.
  lastSavedAt: Date = tunis('2026-07-08T11:00:00'),
): Promise<string> => {
  const [c] = await db
    .insert(campaigns)
    .values({
      advertiserId,
      name: `LC ${status}`,
      campaignType: 'standard',
      status,
      startDate: window.start ?? null,
      endDate: window.end ?? null,
      lastSavedAt,
    })
    .returning();
  return c?.id ?? '';
};

const statusOf = async (id: string): Promise<string> => {
  const [c] = await db
    .select({ status: campaigns.status })
    .from(campaigns)
    .where(eq(campaigns.id, id));
  return c?.status ?? '';
};

// 2026-07-15 (mercredi) 10:00 UTC = 11:00 Africa/Tunis → Tunis date 2026-07-15.
const NOW = new Date('2026-07-15T10:00:00Z');

afterAll(async () => {
  await sql.end();
});

describe('campaign lifecycle tick (real Postgres)', () => {
  beforeEach(async () => {
    await resetAuthTables();
    vi.restoreAllMocks();
  });

  it('upcoming→active when start_date ≤ today; not before', async () => {
    const adv = await seedUser();
    const dueToday = await seedCampaign(adv, 'upcoming', {
      start: '2026-07-15',
      end: '2026-08-01',
    });
    const duePast = await seedCampaign(adv, 'upcoming', { start: '2026-07-10', end: '2026-08-01' });
    const notDue = await seedCampaign(adv, 'upcoming', { start: '2026-07-16', end: '2026-08-01' });

    const result = await runCampaignLifecycleTick(silentLog, NOW);
    expect(result.activated).toBe(2);
    expect(await statusOf(dueToday)).toBe('active');
    expect(await statusOf(duePast)).toBe('active');
    expect(await statusOf(notDue)).toBe('upcoming');
  });

  it('active→completed when end_date < today; an end_date OF today stays active', async () => {
    const adv = await seedUser();
    const ended = await seedCampaign(adv, 'active', { start: '2026-07-01', end: '2026-07-14' });
    const endsToday = await seedCampaign(adv, 'active', { start: '2026-07-01', end: '2026-07-15' });
    const endless = await seedCampaign(adv, 'active', { start: '2026-07-01', end: null });

    const result = await runCampaignLifecycleTick(silentLog, NOW);
    expect(result.completed).toBe(1);
    expect(await statusOf(ended)).toBe('completed');
    expect(await statusOf(endsToday)).toBe('active');
    expect(await statusOf(endless)).toBe('active'); // no window end → the job never touches it
  });

  it('an over-slept upcoming whose whole window passed completes in ONE tick', async () => {
    const adv = await seedUser();
    const slept = await seedCampaign(adv, 'upcoming', { start: '2026-07-01', end: '2026-07-10' });
    const result = await runCampaignLifecycleTick(silentLog, NOW);
    expect(result).toEqual({ activated: 1, completed: 1, reminded: 0, deleted: 0 });
    expect(await statusOf(slept)).toBe('completed');
  });

  it('is IDEMPOTENT — a second tick applies zero transitions', async () => {
    const adv = await seedUser();
    await seedCampaign(adv, 'upcoming', { start: '2026-07-15', end: '2026-08-01' });
    await seedCampaign(adv, 'active', { start: '2026-07-01', end: '2026-07-10' });
    await runCampaignLifecycleTick(silentLog, NOW);
    const second = await runCampaignLifecycleTick(silentLog, NOW);
    expect(second).toEqual({ activated: 0, completed: 0, reminded: 0, deleted: 0 });
  });

  it('transitions never touch draft/pending/rejected/completed rows', async () => {
    const adv = await seedUser();
    const rows = await Promise.all([
      // CF-S2 — a FUTURE-dated draft (a past-start draft is now deleted by design; that path
      // has its own matrix below).
      seedCampaign(adv, 'draft', { start: '2026-08-01', end: '2026-08-10' }),
      seedCampaign(adv, 'pending', { start: '2026-07-01', end: '2026-07-10' }),
      seedCampaign(adv, 'rejected', { start: '2026-07-01', end: '2026-07-10' }),
      seedCampaign(adv, 'completed', { start: '2026-07-01', end: '2026-07-10' }),
    ]);
    await runCampaignLifecycleTick(silentLog, NOW);
    expect(await Promise.all(rows.map(statusOf))).toEqual([
      'draft',
      'pending',
      'rejected',
      'completed',
    ]);
  });

  it('calls the onCampaignCompleted SEAM once per completed campaign (SETTLE2: armed — id + log)', async () => {
    const seam = vi.fn(async (campaignId: string) => {
      void campaignId;
    });
    const adv = await seedUser();
    const a = await seedCampaign(adv, 'active', { start: '2026-07-01', end: '2026-07-10' });
    const b = await seedCampaign(adv, 'active', { start: '2026-07-01', end: '2026-07-12' });
    await runCampaignLifecycleTick(silentLog, NOW, seam);
    expect(seam).toHaveBeenCalledTimes(2);
    expect(new Set(seam.mock.calls.map((c) => c[0]))).toEqual(new Set([a, b]));
  });
});

// ── DISP-TOURS §3.1/3.2 — a classic campaign never launched: two notices, then deleted ─────────
// (lib/campaign-expiry.ts pins the clock itself; here the tick that applies it, on Postgres.)
describe('never-launched campaign expiry (real Postgres)', () => {
  beforeEach(async () => {
    await resetAuthTables();
  });

  const notificationsFor = async (userId: string) =>
    db.select().from(notifications).where(eq(notifications.userId, userId));
  const exists = async (id: string): Promise<boolean> =>
    (await db.select({ id: campaigns.id }).from(campaigns).where(eq(campaigns.id, id))).length > 0;

  it('a cart campaign starting 17/07: 48 h notice on 15/07, 24 h on 16/07, gone on 17/07', async () => {
    const adv = await seedUser();
    const id = await seedCampaign(adv, 'draft', { start: '2026-07-17', end: '2026-08-01' });
    await db.insert(cartItems).values({ userId: adv, campaignId: id });

    const first = await runCampaignLifecycleTick(silentLog, NOW); // 15/07 11 h
    expect(first.reminded).toBe(1);
    const told = await notificationsFor(adv);
    expect(told).toHaveLength(1);
    expect(told[0]?.type).toBe('campaign_cart_expiry');
    expect(told[0]?.title).toBe(expiryNotice('LC draft', true, 48).text);
    expect(told[0]?.body).toBe(
      'Votre campagne « LC draft » sera retirée de votre panier dans 48 h. Lancez-la avant cette échéance pour la conserver.',
    );
    expect(told[0]?.campaignId).toBe(id);
    // The stamp makes the pass idempotent.
    expect((await runCampaignLifecycleTick(silentLog, NOW)).reminded).toBe(0);

    await runCampaignLifecycleTick(silentLog, tunis('2026-07-16T00:30:00'));
    const both = await notificationsFor(adv);
    expect(both.map((n) => n.title)).toContain(expiryNotice('LC draft', true, 24).text);
    expect(await exists(id)).toBe(true);

    const last = await runCampaignLifecycleTick(silentLog, tunis('2026-07-17T00:30:00'));
    expect(last.deleted).toBe(1);
    expect(await exists(id)).toBe(false);
    expect(await db.select().from(cartItems).where(eq(cartItems.campaignId, id))).toHaveLength(0);
  });

  it('a draft gets the draft wording; nothing is sent before its 48 h window (no J-3 any more)', async () => {
    const adv = await seedUser();
    await seedCampaign(adv, 'draft', { start: '2026-07-17', end: '2026-08-01' });
    await seedCampaign(adv, 'draft', { start: '2026-07-18', end: '2026-08-01' }); // window: 16/07
    await seedCampaign(adv, 'pending', { start: '2026-07-17', end: '2026-08-01' }); // launched

    const result = await runCampaignLifecycleTick(silentLog, NOW);
    expect(result.reminded).toBe(1);
    const rows = await notificationsFor(adv);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.type).toBe('campaign_draft_expiry');
    expect(rows[0]?.title).toBe(
      'Votre brouillon « LC draft » sera supprimé dans 48 h. Reprenez sa saisie pour le conserver.',
    );
  });

  it('an undated draft goes 7 days after its last save, told 48 h before', async () => {
    const adv = await seedUser();
    const old = await seedCampaign(adv, 'draft', {}, tunis('2026-07-08T09:00:00')); // due 15/07 9 h
    const recent = await seedCampaign(adv, 'draft', {}, tunis('2026-07-10T09:00:00')); // 17/07 9 h
    const fresh = await seedCampaign(adv, 'draft', {}, tunis('2026-07-14T09:00:00'));

    const result = await runCampaignLifecycleTick(silentLog, NOW);
    expect(result.deleted).toBe(1);
    expect(result.reminded).toBe(1);
    expect(await exists(old)).toBe(false);
    expect(await exists(recent)).toBe(true);
    expect(await exists(fresh)).toBe(true);
    const rows = await notificationsFor(adv);
    expect(rows.map((n) => n.campaignId)).toEqual([recent]);
  });

  it('deletion matrix: start reached → gone (cart included); saved today, future, launched → kept', async () => {
    const adv = await seedUser();
    const pastDraft = await seedCampaign(adv, 'draft', { start: '2026-07-14', end: '2026-08-01' });
    const pastCarted = await seedCampaign(adv, 'draft', { start: '2026-07-14', end: '2026-08-01' });
    await db.insert(cartItems).values({ userId: adv, campaignId: pastCarted });
    // « à la date de début » — a draft starting today goes at the day's first tick…
    const todayDraft = await seedCampaign(adv, 'draft', { start: '2026-07-15', end: '2026-08-01' });
    // …unless it was saved today: made to start today, it keeps its day.
    const todayFresh = await seedCampaign(
      adv,
      'draft',
      { start: '2026-07-15', end: '2026-08-01' },
      tunis('2026-07-15T09:30:00'),
    );
    const futureDraft = await seedCampaign(adv, 'draft', {
      start: '2026-07-25',
      end: '2026-08-01',
    });
    // Every other status with a past start is NEVER deletion-eligible. ('upcoming' transitions
    // to active in the same tick — a status change, never a deletion.)
    const pending = await seedCampaign(adv, 'pending', { start: '2026-07-01', end: '2026-08-01' });
    const upcoming = await seedCampaign(adv, 'upcoming', {
      start: '2026-07-01',
      end: '2026-08-01',
    });
    const rejected = await seedCampaign(adv, 'rejected', {
      start: '2026-07-01',
      end: '2026-08-01',
    });
    const completedRow = await seedCampaign(adv, 'completed', {
      start: '2026-06-01',
      end: '2026-06-20',
    });

    const result = await runCampaignLifecycleTick(silentLog, NOW);
    expect(result.deleted).toBe(3);

    expect(await exists(pastDraft)).toBe(false);
    expect(await exists(pastCarted)).toBe(false);
    expect(await exists(todayDraft)).toBe(false);
    expect(await exists(todayFresh)).toBe(true);
    expect(await exists(futureDraft)).toBe(true);
    expect(await statusOf(pending)).toBe('pending');
    expect(await statusOf(upcoming)).toBe('active'); // transitioned, NOT deleted
    expect(await statusOf(rejected)).toBe('rejected');
    expect(await statusOf(completedRow)).toBe('completed');
    // A second tick deletes nothing more.
    expect((await runCampaignLifecycleTick(silentLog, NOW)).deleted).toBe(0);
  });

  it('cascade integrity: targeting + zone rows go with the draft; its notice survives with campaign_id nulled', async () => {
    const adv = await seedUser();
    const id = await seedCampaign(adv, 'draft', { start: '2026-07-10', end: '2026-08-01' });
    // Reference rows are READ from the pre-seeded data — nothing inserted into
    // business_sectors/zones (the exact-seed-count footgun).
    const [sector] = await db
      .select({ id: businessSectors.id })
      .from(businessSectors)
      .where(eq(businessSectors.audience, 'owner'))
      .orderBy(asc(businessSectors.displayOrder))
      .limit(1);
    const [gt] = await db.select({ id: zones.id }).from(zones).where(eq(zones.name, 'Grand Tunis'));
    await db
      .insert(campaignTargeting)
      .values({ campaignId: id, categoryId: sector?.id ?? null, class: null });
    await db.insert(campaignZones).values({ campaignId: id, zoneId: gt?.id ?? '' });
    // The draft HAD been warned.
    const notice = expiryNotice('LC draft', false, 24);
    await db.insert(notifications).values({
      userId: adv,
      type: notice.type,
      title: notice.text,
      body: notice.text,
      campaignId: id,
    });

    const result = await runCampaignLifecycleTick(silentLog, NOW);
    expect(result.deleted).toBe(1);

    expect(await exists(id)).toBe(false);
    expect(
      await db.select().from(campaignTargeting).where(eq(campaignTargeting.campaignId, id)),
    ).toHaveLength(0);
    expect(
      await db.select().from(campaignZones).where(eq(campaignZones.campaignId, id)),
    ).toHaveLength(0);
    // The warning trail outlives the draft — the notification stays, its reference nulled.
    const [notif] = await db.select().from(notifications).where(eq(notifications.userId, adv));
    expect(notif?.type).toBe('campaign_draft_expiry');
    expect(notif?.campaignId).toBeNull();
  });

  it('one tick warns one campaign and deletes another', async () => {
    const adv = await seedUser();
    const soon = await seedCampaign(adv, 'draft', { start: '2026-07-17', end: '2026-08-01' });
    const past = await seedCampaign(adv, 'draft', { start: '2026-07-14', end: '2026-08-01' });

    const result = await runCampaignLifecycleTick(silentLog, NOW);
    expect(result).toEqual({ activated: 0, completed: 0, reminded: 1, deleted: 1 });

    expect(await exists(soon)).toBe(true); // warned, kept
    expect(await exists(past)).toBe(false);
    const rows = await db.select().from(notifications).where(eq(notifications.userId, adv));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.campaignId).toBe(soon);
  });
});
