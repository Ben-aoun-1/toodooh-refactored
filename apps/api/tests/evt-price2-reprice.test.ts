import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import {
  planReprice,
  repriceAllocation,
  repricedBudget,
  run,
} from '../scripts/evt-price2-reprice.js';
import { db, sql } from '../src/db/client.js';
import {
  campaigns,
  creatives,
  eventAllocations,
  events,
  screenhosts,
  users,
} from '../src/db/schema.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// EVT-PRICE2 (operator ruling 2026-10-08, « c: modify them ») — the one-off repricing of the
// unsettled minutes positionings: a minute's A_max × 4 becomes A_max ÷ 3 × R. Dry-run by default.

describe('EVT-PRICE2 reprice — the pure math', () => {
  it("an allocation keeps its blocs; each bloc's A_max is read back from its impressions", () => {
    // Two blocs at A_max 120 (stored 480 each), CPM 15, an 11 s spot (R 5): 200 impressions and
    // 3 TND a bloc — it was 480 impressions and 7.20 TND.
    const r = repriceAllocation(
      {
        id: 'a',
        statut: 'ACCEPTE',
        blocs: [
          { start: '2027-06-10T18:00:00.000Z', end: '2027-06-10T18:20:00.000Z', impressions: 480 },
          { start: '2027-06-10T18:20:00.000Z', end: '2027-06-10T18:40:00.000Z', impressions: 480 },
        ],
        montantTnd: 14.4,
        impressionsTotal: 960,
      },
      15,
      5,
    );
    expect(r.newImpressions).toBe(400);
    expect(r.newMontantTnd).toBe(6);
    expect(r.blocs.map((b) => b.impressions)).toEqual([200, 200]);
    expect(r.blocs.every((b) => b.repriced === 'EVT-PRICE2')).toBe(true);
    expect(r.blocs[0]?.start).toBe('2027-06-10T18:00:00.000Z');
  });

  it('never prices above the old montant (a capped charge stays capped)', () => {
    const r = repriceAllocation(
      {
        id: 'a',
        statut: 'ACCEPTE',
        blocs: [{ start: 's', end: 'e', impressions: 480 }],
        montantTnd: 2,
        impressionsTotal: 480,
      },
      15,
      6,
    );
    expect(r.newMontantTnd).toBe(2); // 120 ÷ 3 × 6 = 240 → 3.60, capped at the 2 charged
  });

  it('the budget drops by what the live allocations lose; an unplaced rest scales by R ÷ 12', () => {
    const live = {
      allocationId: 'a',
      statut: 'ACCEPTE',
      oldMontantTnd: 14.4,
      newMontantTnd: 6,
      oldImpressions: 0,
      newImpressions: 0,
      blocs: [],
    };
    const refused = {
      ...live,
      allocationId: 'b',
      statut: 'REFUSE',
      oldMontantTnd: 7.2,
      newMontantTnd: 3,
    };
    // Budget 21.60 = 14.40 placed + 7.20 refused and not re-placed (refunded at settlement).
    expect(repricedBudget(21.6, [live, refused], 5)).toBe(9); // 6 + 7.20 × 5 ÷ 12
    expect(repricedBudget(14.4, [live], 5)).toBe(6);
  });
});

describe('EVT-PRICE2 reprice — dry-run then execute (real Postgres)', () => {
  let ids: {
    advertiser: string;
    event: string;
    venue: string;
    active: string;
    completed: string;
    allocation: string;
  };

  const seed = async () => {
    const [adv] = await db
      .insert(users)
      .values({
        email: `price2-${Date.now()}@test.local`,
        contactName: 'PRICE2',
        role: 'advertiser',
        status: 'approved',
      })
      .returning({ id: users.id });
    const [ev] = await db
      .insert(events)
      .values({
        name: 'PRICE2 Match',
        type: 'sport',
        source: 'official',
        kickoffAt: new Date('2027-06-10T20:00:00+01:00'),
        endsAt: new Date('2027-06-10T22:00:00+01:00'),
      })
      .returning({ id: events.id });
    const [venue] = await db
      .insert(screenhosts)
      .values({ name: 'PRICE2 Café' })
      .returning({ id: screenhosts.id });
    const [spot] = await db
      .insert(creatives)
      .values({
        advertiserId: adv?.id ?? '',
        creativeType: 'video',
        storageKey: `creatives/price2/${Date.now()}`,
        durationSeconds: 11,
        validationStatus: 'approved',
      })
      .returning({ id: creatives.id });
    const positioning = async (status: 'active' | 'completed') => {
      const [c] = await db
        .insert(campaigns)
        .values({
          advertiserId: adv?.id ?? '',
          name: `PRICE2 ${status}`,
          campaignType: 'event',
          status,
          startDate: '2027-06-10',
          endDate: '2027-06-10',
          eventId: ev?.id ?? null,
          creativeId: spot?.id ?? null,
          eventMinutes: 2,
          requestedBudget: '14.40',
          eventCpmTnd: '15.000',
        })
        .returning({ id: campaigns.id });
      const [a] = await db
        .insert(eventAllocations)
        .values({
          campaignId: c?.id ?? '',
          screenhostId: venue?.id ?? '',
          blocs: [
            {
              start: '2027-06-10T18:00:00.000Z',
              end: '2027-06-10T18:20:00.000Z',
              impressions: 480,
            },
            {
              start: '2027-06-10T18:20:00.000Z',
              end: '2027-06-10T18:40:00.000Z',
              impressions: 480,
            },
          ],
          impressionsTotal: 960,
          montantTnd: '14.400',
          statut: 'ACCEPTE',
          decidedAt: new Date(),
        })
        .returning({ id: eventAllocations.id });
      return { campaign: c?.id ?? '', allocation: a?.id ?? '' };
    };
    const active = await positioning('active');
    const completed = await positioning('completed');
    ids = {
      advertiser: adv?.id ?? '',
      event: ev?.id ?? '',
      venue: venue?.id ?? '',
      active: active.campaign,
      completed: completed.campaign,
      allocation: active.allocation,
    };
  };

  const budgetOf = async (id: string) =>
    Number((await db.select().from(campaigns).where(eq(campaigns.id, id)))[0]?.requestedBudget);

  beforeEach(async () => {
    await resetAuthTables();
    await seed();
  });

  afterAll(async () => {
    await sql.end();
  });

  it('plans the active positioning only; the dry-run writes nothing; execute writes once', async () => {
    const deploy = new Date(Date.now() + 60_000).toISOString(); // both seeded before it
    const plan = (await planReprice(new Date(deploy))).filter((p) => p.name.startsWith('PRICE2'));
    expect(plan.map((p) => [p.status, p.playsPerMinute, p.oldBudgetTnd, p.newBudgetTnd])).toEqual([
      ['active', 5, 14.4, 6],
    ]);

    await expect(run([])).rejects.toThrow(/dispatched-before/); // the cutoff is mandatory
    await run(['--dispatched-before', deploy]);
    expect(await budgetOf(ids.active)).toBe(14.4);

    await run(['--dispatched-before', deploy, '--execute']);
    expect(await budgetOf(ids.active)).toBe(6);
    const [alloc] = await db
      .select()
      .from(eventAllocations)
      .where(eq(eventAllocations.id, ids.allocation));
    expect(Number(alloc?.montantTnd)).toBe(6);
    expect(alloc?.impressionsTotal).toBe(400);
    expect(await budgetOf(ids.completed)).toBe(14.4); // settled history is never touched

    // A re-run changes nothing: the repriced blocs carry the mark.
    await run(['--dispatched-before', deploy, '--execute']);
    expect(await budgetOf(ids.active)).toBe(6);
    expect(
      Number(
        (await db.select().from(eventAllocations).where(eq(eventAllocations.id, ids.allocation)))[0]
          ?.montantTnd,
      ),
    ).toBe(6);
    // An allocation dispatched AFTER the deploy (new formula already) is never repriced.
    const early = new Date(Date.now() - 3_600_000).toISOString();
    expect((await planReprice(new Date(early))).filter((p) => p.name.startsWith('PRICE2'))).toEqual(
      [],
    );
  });
});
