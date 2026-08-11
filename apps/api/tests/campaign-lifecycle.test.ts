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
import {
  DRAFT_REMINDER_TITLE,
  draftReminderBody,
  runCampaignLifecycleTick,
} from '../src/lib/campaign-lifecycle.js';

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

const seedCampaign = async (
  advertiserId: string,
  status: 'draft' | 'pending' | 'upcoming' | 'active' | 'rejected' | 'completed',
  window: { start?: string | null; end?: string | null } = {},
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

// ── CF-S1 Commit 2 — the J-3 draft reminder (folded into the same tick) ────────────────────────
describe('J-3 draft reminder (real Postgres)', () => {
  beforeEach(async () => {
    await resetAuthTables();
  });

  const notificationsFor = async (userId: string) =>
    db.select().from(notifications).where(eq(notifications.userId, userId));

  it('reminds EXACTLY the drafts starting in 3 days — window edges excluded', async () => {
    const adv = await seedUser();
    const j3 = await seedCampaign(adv, 'draft', { start: '2026-07-18', end: '2026-08-01' });
    await seedCampaign(adv, 'draft', { start: '2026-07-17', end: '2026-08-01' }); // J-2: no
    await seedCampaign(adv, 'draft', { start: '2026-07-19', end: '2026-08-01' }); // J-4: no
    await seedCampaign(adv, 'pending', { start: '2026-07-18', end: '2026-08-01' }); // not a draft

    const result = await runCampaignLifecycleTick(silentLog, NOW);
    expect(result.reminded).toBe(1);

    const rows = await notificationsFor(adv);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.type).toBe('campaign_draft_reminder');
    expect(rows[0]?.campaignId).toBe(j3);
    expect(rows[0]?.title).toBe(DRAFT_REMINDER_TITLE);
    // CF-C1 — the cart exists: the CTA speaks the panier language (spec §3.2 restored).
    expect(rows[0]?.body).toBe(
      'Votre campagne LC draft doit commencer dans 3 jours. Terminez le processus et ajoutez-la au panier pour la lancer — sans quoi elle sera supprimée automatiquement à sa date de début.',
    );
    expect(rows[0]?.body).toBe(draftReminderBody('LC draft'));

    const [stamped] = await db
      .select({ at: campaigns.draftReminderSentAt })
      .from(campaigns)
      .where(eq(campaigns.id, j3));
    expect(stamped?.at).not.toBeNull();
  });

  it('is IDEMPOTENT via the stamp — a second tick sends nothing new', async () => {
    const adv = await seedUser();
    await seedCampaign(adv, 'draft', { start: '2026-07-18', end: '2026-08-01' });
    await runCampaignLifecycleTick(silentLog, NOW);
    const second = await runCampaignLifecycleTick(silentLog, NOW);
    expect(second.reminded).toBe(0);
    expect(await notificationsFor(adv)).toHaveLength(1);
  });

  it('NEVER targets date-less drafts — not reminded, not deleted', async () => {
    const adv = await seedUser();
    const dateless = await seedCampaign(adv, 'draft', {});
    const result = await runCampaignLifecycleTick(silentLog, NOW);
    expect(result.reminded).toBe(0);
    expect(result.deleted).toBe(0);
    expect(await notificationsFor(adv)).toHaveLength(0);
    expect(await statusOf(dateless)).toBe('draft'); // still there, untouched
  });
});

// ── CF-S2 — past-start draft auto-deletion (spec §1.14, operator-accepted veto) ─────────────────
describe('draft auto-deletion at start date (real Postgres)', () => {
  beforeEach(async () => {
    await resetAuthTables();
  });

  const exists = async (id: string): Promise<boolean> =>
    (await db.select({ id: campaigns.id }).from(campaigns).where(eq(campaigns.id, id))).length > 0;

  it('CF-C1 — a CARTED past-start draft SURVIVES the tick; un-carting re-exposes it', async () => {
    const adv = await seedUser();
    const carted = await seedCampaign(adv, 'draft', { start: '2026-07-01', end: '2026-08-01' });
    const uncarted = await seedCampaign(adv, 'draft', { start: '2026-07-01', end: '2026-08-01' });
    await db.insert(cartItems).values({ userId: adv, campaignId: carted });

    await runCampaignLifecycleTick(silentLog, NOW);
    expect(await exists(carted)).toBe(true); // the panier is explicit launch intent
    expect(await exists(uncarted)).toBe(false); // same shape, no cart row → deleted

    // « Conserver en brouillon » removes the item — the NEXT tick deletes the draft.
    await db.delete(cartItems).where(eq(cartItems.campaignId, carted));
    await runCampaignLifecycleTick(silentLog, NOW);
    expect(await exists(carted)).toBe(false);
  });

  it('deletion matrix: strictly-past draft deleted; today-start / date-less / non-draft never', async () => {
    const adv = await seedUser();
    const pastDraft = await seedCampaign(adv, 'draft', { start: '2026-07-14', end: '2026-08-01' });
    const longPastDraft = await seedCampaign(adv, 'draft', { start: '2026-01-05', end: null });
    // « dépassée » is STRICTLY past — a draft starting today keeps its whole start day.
    const todayDraft = await seedCampaign(adv, 'draft', { start: '2026-07-15', end: '2026-08-01' });
    const futureDraft = await seedCampaign(adv, 'draft', {
      start: '2026-07-20',
      end: '2026-08-01',
    });
    const dateless = await seedCampaign(adv, 'draft', {});
    // Every other status with a past start is NEVER deletion-eligible. ('upcoming' transitions
    // to active in the same tick — a status change, never a deletion.)
    const pending = await seedCampaign(adv, 'pending', { start: '2026-07-01', end: '2026-08-01' });
    const upcoming = await seedCampaign(adv, 'upcoming', {
      start: '2026-07-01',
      end: '2026-08-01',
    });
    const active = await seedCampaign(adv, 'active', { start: '2026-07-01', end: '2026-08-01' });
    const rejected = await seedCampaign(adv, 'rejected', {
      start: '2026-07-01',
      end: '2026-08-01',
    });
    const completedRow = await seedCampaign(adv, 'completed', {
      start: '2026-06-01',
      end: '2026-06-20',
    });

    const result = await runCampaignLifecycleTick(silentLog, NOW);
    expect(result.deleted).toBe(2);

    expect(await exists(pastDraft)).toBe(false);
    expect(await exists(longPastDraft)).toBe(false);
    expect(await exists(todayDraft)).toBe(true);
    expect(await exists(futureDraft)).toBe(true);
    expect(await exists(dateless)).toBe(true);
    expect(await statusOf(pending)).toBe('pending');
    expect(await statusOf(upcoming)).toBe('active'); // transitioned, NOT deleted
    expect(await statusOf(active)).toBe('active');
    expect(await statusOf(rejected)).toBe('rejected');
    expect(await statusOf(completedRow)).toBe('completed');
  });

  it('cascade integrity: targeting + zone rows go with the draft; the reminder notification survives with campaign_id nulled', async () => {
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
    // The draft HAD been warned: a J-3 notification row referencing it.
    await db.insert(notifications).values({
      userId: adv,
      type: 'campaign_draft_reminder',
      title: DRAFT_REMINDER_TITLE,
      body: draftReminderBody('LC draft'),
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
    expect(notif?.type).toBe('campaign_draft_reminder');
    expect(notif?.campaignId).toBeNull();
  });

  it('is IDEMPOTENT — a second tick deletes nothing', async () => {
    const adv = await seedUser();
    await seedCampaign(adv, 'draft', { start: '2026-07-14', end: '2026-08-01' });
    const first = await runCampaignLifecycleTick(silentLog, NOW);
    expect(first.deleted).toBe(1);
    const second = await runCampaignLifecycleTick(silentLog, NOW);
    expect(second.deleted).toBe(0);
  });

  it('reminders run BEFORE deletions: one tick warns the J-3 draft AND deletes the past one', async () => {
    const adv = await seedUser();
    const j3 = await seedCampaign(adv, 'draft', { start: '2026-07-18', end: '2026-08-01' });
    const past = await seedCampaign(adv, 'draft', { start: '2026-07-14', end: '2026-08-01' });

    const result = await runCampaignLifecycleTick(silentLog, NOW);
    expect(result).toEqual({ activated: 0, completed: 0, reminded: 1, deleted: 1 });

    expect(await exists(j3)).toBe(true); // warned, kept
    expect(await exists(past)).toBe(false); // deleted regardless of any reminder state
    const rows = await db.select().from(notifications).where(eq(notifications.userId, adv));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.campaignId).toBe(j3);
  });
});
