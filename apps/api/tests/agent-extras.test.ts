import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth, emailSender } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import {
  type NewUser,
  agentAffiliations,
  agents,
  campaignDispatchAllocation,
  campaignDispatchPlan,
  campaigns,
  notifications,
  screenhosts,
  users,
} from '../src/db/schema.js';
import { syncAgentCommissions } from '../src/lib/agent-commissions.js';
import { supportRoutes } from '../src/routes/support.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// AGT-8 — the last catalogue entries: « Nouvelle campagne acceptée par {nom} » for the
// Screenhost agent (once, at the venue's acceptance) and the support acknowledgement email.

type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;

let seq = 0;
const seedUser = async (values: Partial<NewUser> = {}): Promise<string> => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `agt8-${seq}@example.com`,
      contactName: `User ${seq}`,
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

describe('AGT-8 — agent extras (real Postgres)', () => {
  beforeEach(async () => {
    await resetAuthTables();
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await sql.end();
  });

  it('a Screenhost agent is told once when an affiliated venue accepts a campaign', async () => {
    const agent = await seedUser({ role: 'screenhost_agent' });
    await db
      .insert(agents)
      .values({ userId: agent, code: `SH${100000 + seq}`, accountStatus: 'actif' });
    const owner = await seedUser({ role: 'individual_owner' });
    const advertiser = await seedUser({ role: 'advertiser' });
    const [venue] = await db
      .insert(screenhosts)
      .values({ name: 'Café Nord', ownerId: owner })
      .returning();
    await db.insert(agentAffiliations).values({
      agentUserId: agent,
      agentRole: 'screenhost_agent',
      referredUserId: owner,
      screenhostId: venue?.id ?? '',
      status: 'en_attente_activation',
    });
    const [c] = await db
      .insert(campaigns)
      .values({
        advertiserId: advertiser,
        name: 'Ramadan',
        campaignType: 'standard',
        status: 'upcoming',
        startDate: '2026-11-01',
        endDate: '2026-11-05',
      })
      .returning();
    const [plan] = await db
      .insert(campaignDispatchPlan)
      .values({
        campaignId: c?.id ?? '',
        iCible: 500,
        cpm: '10',
        sSpotSeconds: 10,
        tTierCoef: '1',
        seuilDiffusable: 10,
        sMin: '1',
        gJour: '1',
        fMaxSeconds: 300,
        rMinEfficace: 2,
        couvert: 500,
        nMin: 1,
        nMax: 1,
        nRetenus: 1,
      })
      .returning();
    const [alloc] = await db
      .insert(campaignDispatchAllocation)
      .values({
        planId: plan?.id ?? '',
        screenhostId: venue?.id ?? '',
        iiPotentiel: 500,
        rI: 1,
        revenuPrevisionnel: '5',
        creneaux: [{ date: '2026-11-02', hour: 10, reps: 10, impressions: 500 }],
      })
      .returning();
    await syncAgentCommissions(c?.id ?? '');
    expect(
      await db.select().from(notifications).where(eq(notifications.userId, agent)),
    ).toHaveLength(0);
    await db
      .update(campaignDispatchAllocation)
      .set({ statutAcceptation: 'ACCEPTE' })
      .where(eq(campaignDispatchAllocation.id, alloc?.id ?? ''));
    await syncAgentCommissions(c?.id ?? '');
    await syncAgentCommissions(c?.id ?? '');
    const notes = await db.select().from(notifications).where(eq(notifications.userId, agent));
    expect(notes.map((n) => n.title)).toEqual(['Nouvelle campagne acceptée par Café Nord']);
  });

  it('an agent’s support ticket gets an acknowledgement email; an advertiser’s does not', async () => {
    const agent = await seedUser({ role: 'screencast_agent', contactName: 'Amine' });
    const send = vi.spyOn(emailSender, 'send').mockResolvedValue({ messageId: 'm' });
    const app = Fastify({ logger: false });
    await app.register(supportRoutes);
    const session = vi.spyOn(auth.api, 'getSession');
    session.mockResolvedValue({
      session: {},
      user: { id: agent, role: 'screencast_agent', status: 'approved' },
    } as unknown as GetSessionResult);
    const res = await app.inject({
      method: 'POST',
      url: '/api/support',
      payload: { kind: 'support', objective: 'Mes revenus et versements', message: 'Bonjour' },
    });
    expect(res.statusCode).toBe(201);
    const acks = send.mock.calls.filter(([p]) => p.to === `agt8-${seq}@example.com`);
    expect(acks).toHaveLength(1);
    expect(acks[0]?.[0].subject).toBe('Toodooh — nous avons bien reçu votre demande');

    const adv = await seedUser({ role: 'advertiser' });
    session.mockResolvedValue({
      session: {},
      user: { id: adv, role: 'advertiser', status: 'approved' },
    } as unknown as GetSessionResult);
    send.mockClear();
    await app.inject({
      method: 'POST',
      url: '/api/support',
      payload: { kind: 'support', objective: 'Autre', message: 'x' },
    });
    expect(send.mock.calls.filter(([p]) => p.to === `agt8-${seq}@example.com`)).toHaveLength(0);
    await app.close();
  });
});
