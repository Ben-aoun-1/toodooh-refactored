import { readFileSync } from 'node:fs';

import { and, eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import {
  type DispatchCreneau,
  type NewUser,
  agentAffiliations,
  agentCommissionLines,
  agentPayouts,
  agentRibSubmissions,
  agents,
  campaignDispatchAllocation,
  campaignDispatchPlan,
  campaigns,
  creatives,
  notifications,
  proofOfPlay,
  reversementLines,
  screenhosts,
  screens,
  users,
} from '../src/db/schema.js';
import { runAgentCommissionTick, syncAgentCommissions } from '../src/lib/agent-commissions.js';
import { agentWallet, markAgentPayoutPaid, prepareAgentPayouts } from '../src/lib/agent-wallet.js';
import { getDispatchConfig } from '../src/lib/dispatch/config.js';
import { reconcileCampaignById } from '../src/lib/reconcile/reconcile-service.js';
import { agentWalletRoutes } from '../src/routes/agent-wallet.js';

import { seedLiveAffiliation } from './helpers/agent-affiliation.js';
import { resetAuthTables } from './helpers/db-test-setup.js';

// AGT-3 — agent commission lines, the split at the agents' frozen rates, the Screenhost window
// pro rata, the wallet and the monthly payouts (agent specs v1.0 §10) on a real Postgres.
// Harness mirrors e7-reversement-settlement: cpm=10, T=1, two créneaux of 10 000 imp → 200 TND.

type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;

let seq = 0;
const seedUser = async (values: Partial<NewUser> = {}): Promise<string> => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `agt3-${seq}@example.com`,
      contactName: `User ${seq}`,
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

const seedAgent = async (
  role: 'screenhost_agent' | 'screencast_agent',
  values: Partial<typeof agents.$inferInsert> = {},
) => {
  const id = await seedUser({ role });
  await db
    .insert(agents)
    .values({ userId: id, code: `AG${100000 + seq}`, accountStatus: 'actif', ...values });
  return id;
};

const CRENEAUX: DispatchCreneau[] = [
  { date: '2024-01-01', hour: 8, reps: 100, impressions: 10000 },
  { date: '2024-01-02', hour: 8, reps: 100, impressions: 10000 },
];

const seedCampaign = async () => {
  const admin = await seedUser({ role: 'admin' });
  const advertiser = await seedUser({ role: 'advertiser' });
  const ownerId = await seedUser({ role: 'individual_owner' });
  const [creative] = await db
    .insert(creatives)
    .values({
      advertiserId: advertiser,
      creativeType: 'video',
      storageKey: `creatives/${advertiser}/c`,
      durationSeconds: 20,
      validationStatus: 'approved',
    })
    .returning();
  const [campaign] = await db
    .insert(campaigns)
    .values({
      advertiserId: advertiser,
      name: 'AGT-3',
      campaignType: 'standard',
      status: 'active',
      startDate: '2024-01-01',
      endDate: '2024-01-02',
      creativeId: creative?.id,
    })
    .returning();
  const [plan] = await db
    .insert(campaignDispatchPlan)
    .values({
      campaignId: campaign?.id ?? '',
      iCible: 20000,
      cpm: '10',
      sSpotSeconds: 10,
      tTierCoef: '1.0',
      seuilDiffusable: 1000,
      sMin: '10',
      gJour: '3.33',
      fMaxSeconds: 300,
      rMinEfficace: 2,
      couvert: 20000,
      nMin: 1,
      nMax: 20,
      nRetenus: 1,
    })
    .returning();
  const [sh] = await db.insert(screenhosts).values({ name: 'Café AGT', ownerId }).returning();
  const [screen] = await db
    .insert(screens)
    .values({ screenhostId: sh?.id ?? '', name: 'Screen' })
    .returning();
  await db.insert(campaignDispatchAllocation).values({
    planId: plan?.id ?? '',
    screenhostId: sh?.id ?? '',
    iiPotentiel: 20000,
    rI: 100,
    revenuPrevisionnel: '200',
    statutAcceptation: 'ACCEPTE',
    creneaux: CRENEAUX,
  });
  const campaignId = campaign?.id ?? '';
  const venueId = sh?.id ?? '';
  const deliver = async (date: string) =>
    db.insert(proofOfPlay).values({
      screenId: screen?.id ?? '',
      screenhostId: venueId,
      campaignId,
      creativeId: creative?.id ?? '',
      videoIdAsSent: campaignId,
      eventType: 'VIDEO_ENDED',
      receivedAt: new Date(`${date}T07:30:00Z`),
    });
  return { admin, advertiser, ownerId, campaignId, venueId, deliver };
};

const linesOf = (campaignId: string) =>
  db.select().from(agentCommissionLines).where(eq(agentCommissionLines.campaignId, campaignId));

const revOf = async (campaignId: string) =>
  (await db.select().from(reversementLines).where(eq(reversementLines.campaignId, campaignId)))[0];

describe('AGT-3 — agent commissions (real Postgres)', () => {
  beforeEach(async () => {
    await resetAuthTables();
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await sql.end();
  });

  it('Screencaster agent: forecast at his own rate, frozen; the split uses it; settlement acquires it', async () => {
    const c = await seedCampaign();
    const agent = await seedAgent('screencast_agent', { commissionPct: '5' });
    await seedLiveAffiliation({ agentUserId: agent, referredUserId: c.advertiser });

    await runAgentCommissionTick();
    let [line] = await linesOf(c.campaignId);
    expect(line).toMatchObject({ status: 'previsionnel', ratePct: '5.00', screenhostId: null });
    expect(Number(line?.forecastTnd)).toBe(10); // 5 % × 200 TND

    // A later rate change only reaches NEW lines.
    await db.update(agents).set({ commissionPct: '8' }).where(eq(agents.userId, agent));
    await syncAgentCommissions(c.campaignId);
    [line] = await linesOf(c.campaignId);
    expect(line?.ratePct).toBe('5.00');

    await c.deliver('2024-01-01');
    await c.deliver('2024-01-02');
    expect((await reconcileCampaignById(c.campaignId, c.admin)).status).toBe('OK');

    const cfg = await getDispatchConfig();
    const rev = await revOf(c.campaignId);
    expect(rev?.agentScId).toBe(agent);
    expect(Number(rev?.agentScAmountTnd)).toBe(10);
    expect(rev?.agentShId).toBeNull();
    // Toodooh takes what the rates leave; the four parts still sum to the base.
    expect(Number(rev?.toodoohAmountTnd)).toBe(
      200 - (200 * (cfg.pctSh + cfg.pctAgentSh)) / 100 - 10,
    );
    expect(
      Number(rev?.shAmountTnd) +
        Number(rev?.toodoohAmountTnd) +
        Number(rev?.agentShAmountTnd) +
        Number(rev?.agentScAmountTnd),
    ).toBe(200);

    [line] = await linesOf(c.campaignId);
    expect(line).toMatchObject({ status: 'acquise', acquiredTnd: '10.0000' });
    expect(await agentWallet(agent)).toMatchObject({
      cumulative_tnd: 10,
      balance_tnd: 10,
      forecast_tnd: 0,
    });
  });

  it('Screenhost agent: pending at settlement, acquired at activation for the in-window days only', async () => {
    const c = await seedCampaign();
    const agent = await seedAgent('screenhost_agent');
    const [aff] = await db
      .insert(agentAffiliations)
      .values({
        agentUserId: agent,
        agentRole: 'screenhost_agent',
        referredUserId: c.ownerId,
        screenhostId: c.venueId,
        status: 'en_attente_activation',
      })
      .returning();
    const cfg = await getDispatchConfig();
    await syncAgentCommissions(c.campaignId);
    expect((await linesOf(c.campaignId))[0]).toMatchObject({
      status: 'previsionnel',
      screenhostId: c.venueId,
    });

    await c.deliver('2024-01-01');
    await c.deliver('2024-01-02');
    expect((await reconcileCampaignById(c.campaignId, c.admin)).status).toBe('OK');
    expect((await revOf(c.campaignId))?.agentShId).toBe(agent);
    expect((await linesOf(c.campaignId))[0]?.status).toBe('previsionnel');

    // Activated from 2024-01-02: only the second diffusion day is commissioned.
    await db
      .update(agentAffiliations)
      .set({ status: 'en_cours', startDate: '2024-01-02', endDate: '2026-01-02' })
      .where(eq(agentAffiliations.id, aff?.id ?? ''));
    await runAgentCommissionTick();
    const [line] = await linesOf(c.campaignId);
    expect(line?.status).toBe('acquise');
    expect(Number(line?.acquiredTnd)).toBe((200 * cfg.pctAgentSh) / 100 / 2);
  });

  it('no line for a closed agent, nor for a venue « exploité » without convention — Toodooh keeps it', async () => {
    const c = await seedCampaign();
    const closed = await seedAgent('screencast_agent', { accountStatus: 'cloture' });
    await seedLiveAffiliation({ agentUserId: closed, referredUserId: c.advertiser });
    const shAgent = await seedAgent('screenhost_agent');
    const affId = await seedLiveAffiliation({
      agentUserId: shAgent,
      referredUserId: c.ownerId,
      screenhostId: c.venueId,
    });
    await db
      .update(agentAffiliations)
      .set({ exploitedByAgent: true })
      .where(eq(agentAffiliations.id, affId));

    await c.deliver('2024-01-01');
    await c.deliver('2024-01-02');
    expect((await reconcileCampaignById(c.campaignId, c.admin)).status).toBe('OK');
    expect(await linesOf(c.campaignId)).toHaveLength(0);
    const cfg = await getDispatchConfig();
    const rev = await revOf(c.campaignId);
    expect(rev).toMatchObject({ agentScId: null, agentShId: null });
    expect(Number(rev?.agentScAmountTnd)).toBe((200 * cfg.pctAgentSc) / 100);
  });

  it('payouts: RIB required, Screencaster invoice required, « effectué » debits and notifies', async () => {
    const c = await seedCampaign();
    const agent = await seedAgent('screencast_agent');
    await db.insert(agentCommissionLines).values({
      agentUserId: agent,
      agentRole: 'screencast_agent',
      campaignId: c.campaignId,
      status: 'acquise',
      ratePct: '3',
      forecastTnd: '12.5',
      acquiredTnd: '12.5',
      acquiredAt: new Date(),
    });

    expect((await prepareAgentPayouts('2026-10', c.admin)).waiting_rib).toEqual([agent]);
    await db.insert(agentRibSubmissions).values({
      agentUserId: agent,
      storageKey: 'rib/k',
      fileName: 'rib.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 10,
      status: 'valide',
    });
    const prep = await prepareAgentPayouts('2026-10', c.admin);
    expect(prep.prepared).toEqual([{ agent_user_id: agent, amount_tnd: 12.5 }]);
    expect((await prepareAgentPayouts('2026-10', c.admin)).prepared).toEqual([]);
    expect(await agentWallet(agent)).toMatchObject({ balance_tnd: 12.5, unprepared_tnd: 0 });

    const [payout] = await db
      .select()
      .from(agentPayouts)
      .where(eq(agentPayouts.agentUserId, agent));
    const id = payout?.id ?? '';
    expect(await markAgentPayoutPaid(id, c.admin, '2026-11-05')).toEqual({
      ok: false,
      error: 'INVOICE_REQUIRED',
    });
    await db.update(agentPayouts).set({ invoiceKey: 'inv/k' }).where(eq(agentPayouts.id, id));
    expect(await markAgentPayoutPaid(id, c.admin, '2026-11-05')).toEqual({ ok: true });
    expect(await markAgentPayoutPaid(id, c.admin, '2026-11-05')).toEqual({
      ok: false,
      error: 'ALREADY_PAID',
    });
    expect(await agentWallet(agent)).toMatchObject({ cumulative_tnd: 12.5, balance_tnd: 0 });
    const notes = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, agent), eq(notifications.type, 'agent_payout_done')));
    expect(notes[0]?.title).toBe('Nouveau versement effectué pour le mois de octobre 2026');

    // The agent reads it through GET /api/agent/wallet.
    const app = Fastify({ logger: false });
    await app.register(agentWalletRoutes);
    vi.spyOn(auth.api, 'getSession').mockResolvedValue({
      session: {},
      user: { id: agent, role: 'screencast_agent', status: 'approved' },
    } as unknown as GetSessionResult);
    const res = await app.inject({ method: 'GET', url: '/api/agent/wallet' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      balance_tnd: 0,
      cumulative_tnd: 12.5,
      invoice_required: true,
      payouts: [{ month: '2026-10', status: 'effectue', transfer_date: '2026-11-05' }],
    });
    await app.close();
  });

  it('migration 0087 carries pre-AGT-3 attributed settlement lines into the wallets (ruling A)', async () => {
    const c = await seedCampaign();
    const shAgent = await seedAgent('screenhost_agent');
    const scAgent = await seedAgent('screencast_agent');
    await db.insert(reversementLines).values({
      campaignId: c.campaignId,
      screenhostId: c.venueId,
      baseValueTnd: '200',
      shAmountTnd: '100',
      toodoohAmountTnd: '88',
      agentShAmountTnd: '6',
      agentScAmountTnd: '6',
      agentShId: shAgent,
      agentScId: scAgent,
      settledAt: new Date('2026-09-01T10:00:00Z'),
    });
    const file = readFileSync(
      new URL('../drizzle/0087_agent_commissions.sql', import.meta.url),
      'utf8',
    );
    const carries = file
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter((s) => s.startsWith('INSERT INTO "agent_commission_lines"'));
    expect(carries).toHaveLength(2);
    for (const stmt of carries) await sql.unsafe(stmt);

    const lines = await linesOf(c.campaignId);
    expect(
      lines.map((l) => [l.agentRole, l.kind, l.status, l.ratePct, l.acquiredTnd]).sort(),
    ).toEqual([
      ['screencast_agent', 'historique', 'acquise', '3.00', '6.0000'],
      ['screenhost_agent', 'historique', 'acquise', '3.00', '6.0000'],
    ]);
    // A historique line is final: the sync never touches it.
    await syncAgentCommissions(c.campaignId);
    expect((await linesOf(c.campaignId)).every((l) => l.status === 'acquise')).toBe(true);
    expect((await agentWallet(shAgent)).balance_tnd).toBe(6);
  });
});
