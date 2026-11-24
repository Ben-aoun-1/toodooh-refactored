import { and, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { db, sql } from '../src/db/client.js';
import {
  type NewUser,
  agentAffiliations,
  agents,
  campaigns,
  eventAllocations,
  events,
  notifications,
  screenhosts,
  users,
} from '../src/db/schema.js';
import {
  agentEventOffer,
  agentPendingEventOffers,
  noticeHostAnsweredEvent,
  runAgentEventOfferNoticeTick,
} from '../src/lib/agent-event-offers.js';
import { OFFER_HOST_ANSWERED_TYPE, OFFER_NEW_TYPE } from '../src/lib/agent-offers.js';
import { decideEventAllocation } from '../src/lib/event-allocation-decision.js';
import { loadOwnerSharePcts, ownerShareTnd } from '../src/lib/owner-share.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// Mariem 15/11/2026 — the agent answers every offer the Host receives, match nights included:
// a share is an offer once the Host was asked (single or grouped); a grouped match is one offer
// for all its waiting spots; the first answer is final for the agent, the Host and the admin.

const KICKOFF = new Date('2027-09-15T20:00:00+01:00');
const ENDS = new Date('2027-09-15T22:00:00+01:00');
const NOW = new Date('2027-09-15T10:00:00+01:00');

let seq = 0;
const seedUser = async (values: Partial<NewUser> = {}): Promise<string> => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `aeo-${seq}-${Math.random().toString(16).slice(2, 8)}@example.com`,
      contactName: `User ${seq}`,
      role: 'advertiser',
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

const seedAgentWithVenue = async () => {
  const agent = await seedUser({ role: 'screenhost_agent' });
  await db
    .insert(agents)
    .values({ userId: agent, code: `SH${500000 + seq}`, accountStatus: 'actif' });
  const owner = await seedUser({ role: 'individual_owner' });
  const [venue] = await db
    .insert(screenhosts)
    .values({ name: 'Café Nord', ownerId: owner })
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

const seedMatch = async (): Promise<string> => {
  seq += 1;
  const [row] = await db
    .insert(events)
    .values({
      name: `Équipe A${seq} - Équipe B${seq}`,
      type: 'sport',
      kickoffAt: KICKOFF,
      endsAt: ENDS,
      source: 'official',
    })
    .returning();
  return row?.id ?? '';
};

const seedShare = async (
  eventId: string,
  venueId: string,
  montantTnd: number,
  notice: string | null,
): Promise<string> => {
  const advertiserId = await seedUser();
  const [c] = await db
    .insert(campaigns)
    .values({
      advertiserId,
      name: `Positionnement ${seq}`,
      campaignType: 'event',
      status: 'upcoming',
      startDate: '2027-09-15',
      endDate: '2027-09-15',
      requestedBudget: '200.00',
      eventId,
    })
    .returning();
  const [row] = await db
    .insert(eventAllocations)
    .values({
      campaignId: c?.id ?? '',
      screenhostId: venueId,
      blocs: [],
      impressionsTotal: 600,
      montantTnd: montantTnd.toFixed(3),
      statut: 'EN_ATTENTE',
      notice,
    })
    .returning();
  return row?.id ?? '';
};

const shareOf = async (id: string) =>
  (await db.select().from(eventAllocations).where(eq(eventAllocations.id, id)))[0];

describe('agents answer match-night offers', () => {
  beforeEach(async () => {
    await resetAuthTables();
  });
  afterAll(async () => {
    await sql.end();
  });

  it('a single share is an offer once asked; a share still waiting for the match notice is not', async () => {
    const s = await seedAgentWithVenue();
    const eventId = await seedMatch();
    const asked = await seedShare(eventId, s.venueId, 40, 'single');
    await seedShare(eventId, s.venueId, 30, null);
    const pcts = await loadOwnerSharePcts();

    const offers = await agentPendingEventOffers(s.agent, NOW);
    expect(offers).toHaveLength(1);
    expect(offers[0]).toMatchObject({
      id: asked,
      kind: 'event',
      campaign_type: 'evenement',
      spots: 1,
      gain_tnd: ownerShareTnd(40, pcts),
      state: 'attente',
      decidable: true,
      kickoff_at: KICKOFF.toISOString(),
    });
    const stranger = await seedUser({ role: 'screenhost_agent' });
    expect(await agentEventOffer(stranger, asked, NOW)).toBeNull();
  });

  it('a grouped match is ONE offer for all its waiting spots, answered whole', async () => {
    const s = await seedAgentWithVenue();
    const eventId = await seedMatch();
    const a = await seedShare(eventId, s.venueId, 40, 'grouped');
    const b = await seedShare(eventId, s.venueId, 20, 'grouped');
    const pcts = await loadOwnerSharePcts();

    const offers = await agentPendingEventOffers(s.agent, NOW);
    expect(offers).toHaveLength(1);
    expect(offers[0]?.spots).toBe(2);
    expect(offers[0]?.gain_tnd).toBeCloseTo(ownerShareTnd(40, pcts) + ownerShareTnd(20, pcts), 3);
    const found = await agentEventOffer(s.agent, b, NOW);
    expect(found?.shareIds[0]).toBe(b);
    expect([...(found?.shareIds ?? [])].sort()).toEqual([a, b].sort());
  });

  it('the agent’s answer is recorded and final: the Host and the admin can no longer change it', async () => {
    const s = await seedAgentWithVenue();
    const eventId = await seedMatch();
    const id = await seedShare(eventId, s.venueId, 40, 'single');
    const byAgent = await decideEventAllocation({
      allocationId: id,
      ownerId: s.owner,
      statut: 'ACCEPTE',
      actor: { kind: 'agent', userId: s.agent },
    });
    expect(byAgent).toMatchObject({ kind: 'ok', changed: true });
    const row = await shareOf(id);
    expect(row?.statut).toBe('ACCEPTE');
    expect(row?.decidedBy).toBe('agent');
    expect(row?.decidedByUserId).toBe(s.agent);

    expect(
      await decideEventAllocation({ allocationId: id, ownerId: s.owner, statut: 'REFUSE' }),
    ).toEqual({ kind: 'already_answered' });
    const admin = await seedUser({ role: 'admin' });
    expect(
      await decideEventAllocation({
        allocationId: id,
        ownerId: s.owner,
        statut: 'REFUSE',
        actor: { kind: 'admin', userId: admin },
      }),
    ).toEqual({ kind: 'already_answered' });
    expect((await shareOf(id))?.statut).toBe('ACCEPTE');
  });

  it('an acceptance by the Host himself is final too (no accept-then-refuse)', async () => {
    const s = await seedAgentWithVenue();
    const eventId = await seedMatch();
    const id = await seedShare(eventId, s.venueId, 40, 'single');
    expect(
      await decideEventAllocation({ allocationId: id, ownerId: s.owner, statut: 'ACCEPTE' }),
    ).toMatchObject({ kind: 'ok', changed: true });
    expect(
      await decideEventAllocation({ allocationId: id, ownerId: s.owner, statut: 'ACCEPTE' }),
    ).toMatchObject({ kind: 'ok', changed: false });
    expect(
      await decideEventAllocation({ allocationId: id, ownerId: s.owner, statut: 'REFUSE' }),
    ).toEqual({ kind: 'already_answered' });
  });

  it('the agent is told once per offer: per single share, per grouped match', async () => {
    const s = await seedAgentWithVenue();
    const eventId = await seedMatch();
    const single = await seedShare(eventId, s.venueId, 40, 'single');
    const g1 = await seedShare(eventId, s.venueId, 20, 'grouped');
    await seedShare(eventId, s.venueId, 10, 'grouped');

    expect(await runAgentEventOfferNoticeTick(NOW)).toBe(2);
    expect(await runAgentEventOfferNoticeTick(NOW)).toBe(0);
    const notes = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, s.agent), eq(notifications.type, OFFER_NEW_TYPE)));
    expect(notes.map((n) => n.link).sort()).toEqual(
      [`/agent?offre=${single}`, `/agent?offre=${g1}`].sort(),
    );
    expect(notes.some((n) => n.title.includes('(2 spots)'))).toBe(true);

    await noticeHostAnsweredEvent(single, true);
    const answered = await db
      .select()
      .from(notifications)
      .where(
        and(eq(notifications.userId, s.agent), eq(notifications.type, OFFER_HOST_ANSWERED_TYPE)),
      );
    expect(answered).toHaveLength(1);
  });
});
