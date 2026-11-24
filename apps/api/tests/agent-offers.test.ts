import { addDays } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import {
  type DispatchCreneau,
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
import { noticeHostAnswered, runAgentOfferNoticeTick } from '../src/lib/agent-offers.js';
import { decideAllocation } from '../src/lib/allocation-decision.js';
import { agentOfferRoutes } from '../src/routes/agent-offers.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// Agent Screenhost spec VF §10 — the agent answers a campaign offer for an affiliated venue:
// the first answer decides and is final, its author is stored, and each side is told.

type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;

let seq = 0;
const seedUser = async (values: Partial<NewUser> = {}): Promise<string> => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `offer-${seq}@example.com`,
      contactName: `User ${seq}`,
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

const tunisDay = (offsetDays: number): string =>
  formatInTimeZone(addDays(new Date(), offsetDays), 'Africa/Tunis', 'yyyy-MM-dd');
const FUTURE: DispatchCreneau[] = [{ date: tunisDay(7), hour: 10, reps: 10, impressions: 500 }];

const seedOffer = async (venueId: string, advertiserId: string, name: string) => {
  const [c] = await db
    .insert(campaigns)
    .values({
      advertiserId,
      name,
      campaignType: 'standard',
      // Active: a refusal does not run the pre-diffusion cascade (not this test's subject).
      status: 'active',
      startDate: tunisDay(-1),
      endDate: tunisDay(10),
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
  const [a] = await db
    .insert(campaignDispatchAllocation)
    .values({
      planId: plan?.id ?? '',
      screenhostId: venueId,
      iiPotentiel: 500,
      rI: 1,
      revenuPrevisionnel: '200',
      creneaux: FUTURE,
    })
    .returning();
  return { campaignId: c?.id ?? '', allocationId: a?.id ?? '' };
};

const seedAgentWithVenue = async (venueName: string) => {
  const agent = await seedUser({ role: 'screenhost_agent' });
  await db
    .insert(agents)
    .values({ userId: agent, code: `SH${200000 + seq}`, accountStatus: 'actif' });
  const owner = await seedUser({ role: 'individual_owner' });
  const [venue] = await db
    .insert(screenhosts)
    .values({ name: venueName, ownerId: owner, city: 'Tunis' })
    .returning();
  await db.insert(agentAffiliations).values({
    agentUserId: agent,
    agentRole: 'screenhost_agent',
    referredUserId: owner,
    screenhostId: venue?.id ?? '',
    status: 'en_cours',
  });
  return { agent, owner, venueId: venue?.id ?? '' };
};

const asAgent = (agent: string) =>
  vi.spyOn(auth.api, 'getSession').mockResolvedValue({
    session: {},
    user: { id: agent, role: 'screenhost_agent', status: 'approved' },
  } as unknown as GetSessionResult);

const statutOf = async (allocationId: string) => {
  const [row] = await db
    .select()
    .from(campaignDispatchAllocation)
    .where(eq(campaignDispatchAllocation.id, allocationId));
  return row;
};
const noticesOf = (userId: string) =>
  db.select().from(notifications).where(eq(notifications.userId, userId));

describe('agent spec VF §10 — the agent answers an offer for a Screenhost (real Postgres)', () => {
  const app = Fastify({ logger: false });
  beforeEach(async () => {
    await resetAuthTables();
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await app.close();
    await sql.end();
  });

  it('the agent is told once, sees what the Host sees, accepts: stored as his answer, the Host is told', async () => {
    await app.register(agentOfferRoutes);
    await app.ready();
    const s = await seedAgentWithVenue('Café Nord');
    const advertiser = await seedUser({ role: 'advertiser', businessName: 'Délice' });
    const o = await seedOffer(s.venueId, advertiser, 'Campagne Délice');

    expect(await runAgentOfferNoticeTick()).toBe(1);
    expect(await runAgentOfferNoticeTick()).toBe(0);
    expect(await noticesOf(s.agent)).toEqual([
      expect.objectContaining({
        type: 'agent_offer_new',
        title: 'Nouvelle offre de campagne pour Café Nord : Campagne Délice',
        link: `/agent?offre=${o.allocationId}`,
        readAt: null,
      }),
    ]);

    asAgent(s.agent);
    const list = await app.inject({ method: 'GET', url: '/api/agent/offers' });
    expect(list.statusCode).toBe(200);
    const [view] = (list.json() as { offers: { id: string; gain_tnd: number }[] }).offers;
    expect(view).toMatchObject({
      id: o.allocationId,
      campaign_name: 'Campagne Délice',
      screenhost_name: 'Café Nord',
      state: 'attente',
      answered_by: null,
      decidable: true,
    });
    // The Host's share of the value, not the value itself.
    expect(view?.gain_tnd).toBeGreaterThan(0);
    expect(view?.gain_tnd).toBeLessThan(200);

    const accepted = await app.inject({
      method: 'POST',
      url: `/api/agent/offers/${o.allocationId}/accept`,
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toMatchObject({
      state: 'acceptee',
      answered_by: 'vous',
      changed: true,
    });
    const row = await statutOf(o.allocationId);
    expect(row).toMatchObject({
      statutAcceptation: 'ACCEPTE',
      decidedBy: 'agent',
      decidedByUserId: s.agent,
    });
    expect(row?.decidedAt).toBeInstanceOf(Date);

    // His offer notice is rewritten and read; no second one.
    const mine = await noticesOf(s.agent);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ title: 'Offre acceptée : Campagne Délice (Café Nord)' });
    expect(mine[0]?.readAt).not.toBeNull();
    const hosts = await noticesOf(s.owner);
    expect(hosts).toHaveLength(1);
    expect(hosts[0]?.type).toBe('agent_decided_for_host');
    expect(hosts[0]?.title).toMatch(
      /^Votre agent a accepté la campagne Campagne Délice : vous allez gagner .+ TND$/,
    );

    // Final: neither he nor the Host can turn it into a refusal.
    const refuse = await app.inject({
      method: 'POST',
      url: `/api/agent/offers/${o.allocationId}/refuse`,
    });
    expect(refuse.statusCode).toBe(409);
    expect(refuse.json()).toMatchObject({ message: 'Cette offre a déjà reçu une réponse' });
    expect(
      await decideAllocation({ allocationId: o.allocationId, ownerId: s.owner, statut: 'REFUSE' }),
    ).toMatchObject({ kind: 'already_answered', statut: 'ACCEPTE', by: 'agent' });
    // Not even with the same answer: the Host is only informed.
    expect(
      await decideAllocation({ allocationId: o.allocationId, ownerId: s.owner, statut: 'ACCEPTE' }),
    ).toMatchObject({ kind: 'already_answered' });
    expect((await statutOf(o.allocationId))?.statutAcceptation).toBe('ACCEPTE');

    const detail = await app.inject({ method: 'GET', url: `/api/agent/offers/${o.allocationId}` });
    expect(detail.json()).toMatchObject({
      state: 'acceptee',
      answered_by: 'vous',
      decidable: false,
    });
    expect(detail.json()).not.toHaveProperty('owner_id');
  });

  it('the Host answers first: the agent gets a 409 and reads « by the Screenhost »; an acceptance is final for the Host too', async () => {
    const s = await seedAgentWithVenue('Salon Lina');
    const advertiser = await seedUser({ role: 'advertiser' });
    const o = await seedOffer(s.venueId, advertiser, 'Promo');
    expect(
      await decideAllocation({ allocationId: o.allocationId, ownerId: s.owner, statut: 'ACCEPTE' }),
    ).toMatchObject({ kind: 'ok', changed: true });
    expect(await statutOf(o.allocationId)).toMatchObject({
      decidedBy: 'owner',
      decidedByUserId: s.owner,
    });
    // The Host repeating its own answer is a no-op; changing it is turned away.
    expect(
      await decideAllocation({ allocationId: o.allocationId, ownerId: s.owner, statut: 'ACCEPTE' }),
    ).toMatchObject({ kind: 'ok', changed: false });
    expect(
      await decideAllocation({ allocationId: o.allocationId, ownerId: s.owner, statut: 'REFUSE' }),
    ).toMatchObject({ kind: 'already_answered', by: 'owner' });

    asAgent(s.agent);
    for (const verb of ['accept', 'refuse']) {
      const res = await app.inject({
        method: 'POST',
        url: `/api/agent/offers/${o.allocationId}/${verb}`,
      });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ message: 'Cette offre a déjà reçu une réponse' });
    }
    const detail = await app.inject({ method: 'GET', url: `/api/agent/offers/${o.allocationId}` });
    expect(detail.json()).toMatchObject({ state: 'acceptee', answered_by: 'screenhost' });
    // An answered offer is no longer announced.
    expect(await runAgentOfferNoticeTick()).toBe(0);
    // What the Host's route writes after its own answer.
    await noticeHostAnswered(o.allocationId, true);
    expect(await noticesOf(s.agent)).toEqual([
      expect.objectContaining({
        type: 'agent_host_answered',
        title: "Salon Lina a accepté l'offre : Promo",
        link: `/agent?offre=${o.allocationId}`,
      }),
    ]);
  });

  it('the agent refuses: definitive, the Host is told; another agent’s venue is a 404', async () => {
    const s = await seedAgentWithVenue('Gym Sud');
    const other = await seedAgentWithVenue('Café Ailleurs');
    const advertiser = await seedUser({ role: 'advertiser' });
    const o = await seedOffer(s.venueId, advertiser, 'Soldes');
    const foreign = await seedOffer(other.venueId, advertiser, 'Soldes bis');

    asAgent(s.agent);
    for (const url of [
      `/api/agent/offers/${foreign.allocationId}`,
      `/api/agent/offers/${foreign.allocationId}/creative-url`,
    ]) {
      expect((await app.inject({ method: 'GET', url })).statusCode).toBe(404);
    }
    const stolen = await app.inject({
      method: 'POST',
      url: `/api/agent/offers/${foreign.allocationId}/accept`,
    });
    expect(stolen.statusCode).toBe(404);
    expect((await statutOf(foreign.allocationId))?.statutAcceptation).toBe('EN_ATTENTE');

    const refused = await app.inject({
      method: 'POST',
      url: `/api/agent/offers/${o.allocationId}/refuse`,
    });
    expect(refused.json()).toMatchObject({ state: 'refusee', answered_by: 'vous', changed: true });
    expect(await statutOf(o.allocationId)).toMatchObject({
      statutAcceptation: 'REFUSE',
      decidedBy: 'agent',
    });
    expect((await noticesOf(s.owner)).map((n) => n.title)).toEqual([
      'Votre agent a refusé la campagne Soldes',
    ]);
    // Answered before the sweep: the agent's result notice is written read, once.
    const mine = await noticesOf(s.agent);
    expect(mine.map((n) => n.title)).toEqual(['Offre refusée : Soldes (Gym Sud)']);
    expect(mine[0]?.readAt).not.toBeNull();
  });

  it('an excluded affiliation, a demo campaign and a non-agent get nothing', async () => {
    const s = await seedAgentWithVenue('Café Exclu');
    const advertiser = await seedUser({ role: 'advertiser' });
    const demo = await seedUser({ role: 'advertiser', isDemo: true });
    const o = await seedOffer(s.venueId, advertiser, 'Normale');
    await seedOffer(s.venueId, demo, 'Démo');
    expect(await runAgentOfferNoticeTick()).toBe(1);

    await db
      .update(agentAffiliations)
      .set({ status: 'exclue' })
      .where(eq(agentAffiliations.agentUserId, s.agent));
    asAgent(s.agent);
    const list = await app.inject({ method: 'GET', url: '/api/agent/offers' });
    expect(list.json()).toEqual({ offers: [] });
    const res = await app.inject({
      method: 'POST',
      url: `/api/agent/offers/${o.allocationId}/accept`,
    });
    expect(res.statusCode).toBe(404);

    vi.restoreAllMocks();
    vi.spyOn(auth.api, 'getSession').mockResolvedValue({
      session: {},
      user: { id: s.owner, role: 'individual_owner', status: 'approved' },
    } as unknown as GetSessionResult);
    expect((await app.inject({ method: 'GET', url: '/api/agent/offers' })).statusCode).toBe(403);
  });
});
