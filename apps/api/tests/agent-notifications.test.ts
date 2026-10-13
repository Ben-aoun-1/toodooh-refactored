import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import {
  type NewUser,
  agents,
  campaignDispatchAllocation,
  campaignDispatchPlan,
  campaigns,
  notifications,
  screenhosts,
  users,
} from '../src/db/schema.js';
import type { EmailSender } from '../src/email/sender.js';
import { syncAgentCommissions } from '../src/lib/agent-commissions.js';
import {
  noticeCategory,
  publishAgentNews,
  runAgentNoticeEmailTick,
} from '../src/lib/agent-notifications.js';
import { notificationsRoutes } from '../src/routes/notifications.js';

import { seedLiveAffiliation } from './helpers/agent-affiliation.js';
import { resetAuthTables } from './helpers/db-test-setup.js';

// AGT-6 — the agent notification catalogue (spec §8): preference categories, the email double
// sent once, « Actualité Toodooh », « Nouvelle campagne lancée », and the bell's feed shape.

type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;

let seq = 0;
const seedUser = async (values: Partial<NewUser> = {}): Promise<string> => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `agt6-${seq}@example.com`,
      contactName: `User ${seq}`,
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};
const seedAgent = async (
  role: 'screenhost_agent' | 'screencast_agent',
  values: Partial<NewUser> = {},
) => {
  const id = await seedUser({ role, ...values });
  await db.insert(agents).values({ userId: id, code: `AG${100000 + seq}`, accountStatus: 'actif' });
  return id;
};

const fakeSender = () => {
  const sent: { to: string; subject: string; html: string }[] = [];
  const sender: EmailSender = {
    send: (p) => {
      sent.push(p);
      return Promise.resolve({ messageId: `m${sent.length}` });
    },
  };
  return { sender, sent };
};

describe('AGT-6 — agent notifications (real Postgres)', () => {
  beforeEach(async () => {
    await resetAuthTables();
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await sql.end();
  });

  it('only news and reminders can be switched off', () => {
    expect(noticeCategory('agent_news')).toBe('news');
    expect(noticeCategory('agent_appointment_reminder')).toBe('reminders');
    expect(noticeCategory('agent_affiliation_ending')).toBe('reminders');
    expect(noticeCategory('agent_payout_done')).toBe('always');
    expect(noticeCategory('agent_appointment_requested')).toBe('always');
  });

  it('emails each agent notification once, on the preferences; never a non-agent one', async () => {
    const agent = await seedAgent('screencast_agent', { notifyRemindersEvents: false });
    const advertiser = await seedUser({ role: 'advertiser' });
    await db.insert(notifications).values([
      { userId: agent, type: 'agent_rib_validated', title: 'RIB validé', body: 'ok' },
      { userId: agent, type: 'agent_appointment_reminder', title: 'Rappel', body: 'demain' },
      { userId: advertiser, type: 'campaign_report_ready', title: 'Rapport', body: 'prêt' },
    ]);
    const { sender, sent } = fakeSender();
    expect(await runAgentNoticeEmailTick(sender)).toEqual({ sent: 1, skipped: 1 });
    expect(sent.map((s) => s.subject)).toEqual(['RIB validé']);
    expect(sent[0]?.html).toContain('/agent/parametres');
    expect(await runAgentNoticeEmailTick(sender)).toEqual({ sent: 0, skipped: 0 });
    const [adv] = await db.select().from(notifications).where(eq(notifications.userId, advertiser));
    expect(adv?.emailedAt).toBeNull();
  });

  it('« Actualité Toodooh » reaches the audience that keeps news on', async () => {
    const on = await seedAgent('screencast_agent', { notifyNewsUpdates: true });
    await seedAgent('screencast_agent', { notifyNewsUpdates: false });
    await seedAgent('screenhost_agent', { notifyNewsUpdates: true });
    const r = await publishAgentNews(
      { title: 'Nouveaux écrans', body: '12 cafés à Sousse', audience: 'screencast_agent' },
      null,
    );
    expect(r.recipients).toBe(1);
    const rows = await db.select().from(notifications);
    expect(rows.map((n) => [n.userId, n.title])).toEqual([
      [on, 'Actualité Toodooh : Nouveaux écrans'],
    ]);
  });

  it('« Nouvelle campagne lancée par {nom} » once, at the confirmed launch', async () => {
    const agent = await seedAgent('screencast_agent');
    const sc = await seedUser({ role: 'advertiser', businessName: 'Pâtisserie Lina' });
    const owner = await seedUser({ role: 'individual_owner' });
    await seedLiveAffiliation({ agentUserId: agent, referredUserId: sc });
    const [c] = await db
      .insert(campaigns)
      .values({
        advertiserId: sc,
        name: 'Ramadan',
        campaignType: 'standard',
        status: 'upcoming',
        startDate: '2026-11-01',
        endDate: '2026-11-10',
      })
      .returning();
    const [plan] = await db
      .insert(campaignDispatchPlan)
      .values({
        campaignId: c?.id ?? '',
        iCible: 1000,
        cpm: '10',
        sSpotSeconds: 10,
        tTierCoef: '1',
        seuilDiffusable: 10,
        sMin: '1',
        gJour: '1',
        fMaxSeconds: 300,
        rMinEfficace: 2,
        couvert: 1000,
        nMin: 1,
        nMax: 1,
        nRetenus: 1,
      })
      .returning();
    const [sh] = await db.insert(screenhosts).values({ name: 'Café', ownerId: owner }).returning();
    await db.insert(campaignDispatchAllocation).values({
      planId: plan?.id ?? '',
      screenhostId: sh?.id ?? '',
      iiPotentiel: 1000,
      rI: 1,
      revenuPrevisionnel: '10',
      creneaux: [{ date: '2026-11-01', hour: 9, reps: 10, impressions: 1000 }],
    });
    await syncAgentCommissions(c?.id ?? '');
    await syncAgentCommissions(c?.id ?? '');
    const notes = await db.select().from(notifications).where(eq(notifications.userId, agent));
    expect(notes.map((n) => [n.type, n.title, n.campaignId])).toEqual([
      ['agent_campaign_launched', 'Nouvelle campagne lancée par Pâtisserie Lina', c?.id],
    ]);
  });

  it('the feed carries « Consulter »’s link; « Marquer tout comme lu » clears the badge', async () => {
    const agent = await seedAgent('screencast_agent');
    await db.insert(notifications).values([
      { userId: agent, type: 'agent_affiliate_new', title: 'Nouveau', body: 'x' },
      { userId: agent, type: 'agent_rib_refused', title: 'RIB', body: 'y' },
    ]);
    const app = Fastify({ logger: false });
    await app.register(notificationsRoutes);
    vi.spyOn(auth.api, 'getSession').mockResolvedValue({
      session: {},
      user: { id: agent, role: 'screencast_agent', status: 'approved' },
    } as unknown as GetSessionResult);
    const feed = (await app.inject({ method: 'GET', url: '/api/notifications' })).json<
      { type: string; link: string | null; appointment_status: string | null }[]
    >();
    expect(Object.fromEntries(feed.map((n) => [n.type, n.link]))).toEqual({
      agent_affiliate_new: '/agent/affilies',
      agent_rib_refused: '/agent/parametres',
    });
    const all = await app.inject({ method: 'POST', url: '/api/notifications/read-all' });
    expect(all.json()).toEqual({ updated: 2 });
    await app.close();
  });
});
