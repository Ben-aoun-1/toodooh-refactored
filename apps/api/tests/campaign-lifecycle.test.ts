import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { db, sql } from '../src/db/client.js';
import { type NewUser, campaigns, notifications, users } from '../src/db/schema.js';
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
    expect(result).toEqual({ activated: 1, completed: 1, reminded: 0 });
    expect(await statusOf(slept)).toBe('completed');
  });

  it('is IDEMPOTENT — a second tick applies zero transitions', async () => {
    const adv = await seedUser();
    await seedCampaign(adv, 'upcoming', { start: '2026-07-15', end: '2026-08-01' });
    await seedCampaign(adv, 'active', { start: '2026-07-01', end: '2026-07-10' });
    await runCampaignLifecycleTick(silentLog, NOW);
    const second = await runCampaignLifecycleTick(silentLog, NOW);
    expect(second).toEqual({ activated: 0, completed: 0, reminded: 0 });
  });

  it('never touches draft/pending/rejected/completed rows', async () => {
    const adv = await seedUser();
    const rows = await Promise.all([
      seedCampaign(adv, 'draft', { start: '2026-07-01', end: '2026-07-10' }),
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

  it('calls the onCampaignCompleted SEAM once per completed campaign (no-op today — BANKED)', async () => {
    const seam = vi.fn();
    const adv = await seedUser();
    const a = await seedCampaign(adv, 'active', { start: '2026-07-01', end: '2026-07-10' });
    const b = await seedCampaign(adv, 'active', { start: '2026-07-01', end: '2026-07-12' });
    await runCampaignLifecycleTick(silentLog, NOW, seam);
    expect(seam).toHaveBeenCalledTimes(2);
    expect(new Set(seam.mock.calls.flat())).toEqual(new Set([a, b]));
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
    // The spec copy, cart CTA adapted (« soumettez-la ») until the cart lane lands.
    expect(rows[0]?.body).toBe(
      'Votre campagne LC draft doit commencer dans 3 jours. Pour ne pas la perdre, terminez le processus et soumettez-la pour la lancer.',
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

  it('NEVER targets date-less drafts, and NEVER deletes anything', async () => {
    const adv = await seedUser();
    const dateless = await seedCampaign(adv, 'draft', {});
    const result = await runCampaignLifecycleTick(silentLog, NOW);
    expect(result.reminded).toBe(0);
    expect(await notificationsFor(adv)).toHaveLength(0);
    expect(await statusOf(dateless)).toBe('draft'); // still there, untouched
  });
});
