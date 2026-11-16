import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '../src/db/client.js';
import {
  type NewUser,
  businessSectors,
  campaignDispatchAllocation,
  campaignDispatchPlan,
  campaigns,
  creatives,
  dispatchConfig,
  notifications,
  recharges,
  screenhostAffluence,
  screenhosts,
  users,
} from '../src/db/schema.js';
import { activateCampaign } from '../src/lib/activation-service.js';
import {
  hostPrelaunchStep,
  prelaunchFinalNotice,
  runCampaignPrelaunchTick,
} from '../src/lib/campaign-prelaunch.js';
import { runRefusalCascade } from '../src/lib/dispatch/cascade.js';
import { hostStartInstant } from '../src/lib/dispatch/tours/host-start.js';

import { bothHalves, resetAuthTables } from './helpers/db-test-setup.js';
import { seedInstalledScreen } from './helpers/installed-screen.js';

// Mariem 13/11 point 2 — the pre-launch steps on a real Postgres, on dispatch-tours-placement's
// fixture (Café A 16 h → 20 h, Café B 16 h → 22 h with its 20 h and 21 h free, 30 s spot, CPM
// 12, F = 600 s, 260 DT, window 9 → 18 November 2026, launched on Thursday 5 November). Each
// Host starts at its own opening hour (operator 2026-11-14): every café opens at 16 h, so on
// Monday 9 November a Host starts at 15:00 UTC, locks at 09:00 UTC and freezes at 14:55 UTC.

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const C = '00000000-0000-4000-8000-00000000000c';

const WEEK_A = [
  [20, 30, 25, 10],
  [20, 25, 30, 15],
  [15, 20, 25, 30],
  [30, 25, 20, 10],
  [20, 30, 35, 25],
  [25, 35, 40, 30],
  [30, 25, 20, 15],
];
const WEEK_B = [
  [10, 15, 12, 8, 4, 3],
  [12, 10, 15, 8, 4, 3],
  [8, 12, 15, 10, 4, 3],
  [15, 12, 10, 8, 4, 3],
  [10, 15, 18, 12, 4, 3],
  [12, 18, 20, 15, 4, 3],
  [15, 12, 10, 8, 4, 3],
];

let seq = 0;
const seedUser = async (values: Partial<NewUser> = {}): Promise<string> => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `tours-pre${seq}@example.com`,
      contactName: `Tours ${seq}`,
      role: 'advertiser',
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

const seedVenue = async (
  id: string,
  ownerId: string,
  sectorId: string,
  week: number[][],
  closing: number,
): Promise<string> => {
  await db.insert(screenhosts).values({
    id,
    name: `Café ${id.slice(-1).toUpperCase()}`,
    ownerId,
    businessSectorId: sectorId,
    class: 'moyen',
    openingHour: 16,
    closingHour: closing,
    broadcastCapacity: 4,
  });
  await db.insert(screenhostAffluence).values(
    bothHalves(
      week.flatMap((row, d) =>
        row.map((estimatedImpressions, i) => ({
          screenhostId: id,
          dayOfWeek: d + 1,
          hour: 16 + i,
          estimatedImpressions,
        })),
      ),
    ),
  );
  return seedInstalledScreen(id);
};

describe('Mariem 13/11 — the pre-launch clock, per Host (pure)', () => {
  const proposedAt = new Date('2026-11-05T10:00:00Z');
  const pending = {
    statutAcceptation: 'EN_ATTENTE' as const,
    lateProposal: false,
    createdAt: proposedAt,
  };
  it('a Host starts at its opening hour on the start date, in Tunis', () => {
    expect(hostStartInstant('2026-11-09', 8)).toEqual(new Date('2026-11-09T07:00:00Z'));
    expect(hostStartInstant('2026-11-09', null)).toEqual(new Date('2026-11-08T23:00:00Z'));
  });
  it('locks at its start − 6 h, freezes at its start − 5 min', () => {
    const at = (iso: string) => hostPrelaunchStep('2026-11-09', 8, pending, new Date(iso));
    expect(at('2026-11-09T00:59:59Z')).toBeNull();
    expect(at('2026-11-09T01:00:00Z')).toBe('lock');
    expect(at('2026-11-09T06:55:00Z')).toBe('freeze');
  });
  it('a late proposal waits for the freeze; an answer is never withdrawn', () => {
    const late = {
      statutAcceptation: 'EN_ATTENTE' as const,
      lateProposal: true,
      createdAt: proposedAt,
    };
    expect(hostPrelaunchStep('2026-11-09', 8, late, new Date('2026-11-09T02:00:00Z'))).toBeNull();
    expect(hostPrelaunchStep('2026-11-09', 8, late, new Date('2026-11-09T06:56:00Z'))).toBe(
      'freeze',
    );
    const accepted = {
      statutAcceptation: 'ACCEPTE' as const,
      lateProposal: false,
      createdAt: proposedAt,
    };
    expect(
      hostPrelaunchStep('2026-11-09', 8, accepted, new Date('2026-11-09T06:56:00Z')),
    ).toBeNull();
  });
  it('Mariem 16/11 — a Host proposed after its own lock (launched the evening before) waits for the freeze', () => {
    // Opens at 00 h on the 9th: locks on the 8th at 18:00 Tunis; the campaign is launched at 19:20.
    const launched = { ...pending, createdAt: new Date('2026-11-08T18:20:00Z') };
    const at = (iso: string) => hostPrelaunchStep('2026-11-09', 0, launched, new Date(iso));
    expect(at('2026-11-08T18:21:00Z')).toBeNull();
    expect(at('2026-11-08T22:55:00Z')).toBe('freeze');
  });
  it('tells the Screencaster in Mariem’s words', () => {
    expect(
      prelaunchFinalNotice({ name: 'Été', impressions: 12500, venues: 3, amountTnd: 150.5 }).body,
    ).toBe(
      'Votre campagne Été démarre dans quelques minutes. Nous vous offrons finalement 12\u202f500 impressions dans 3 établissements, pour un montant de 150,50 DT.',
    );
  });
});

describe('Mariem 13/11 — the pre-launch lock and freeze of a tours campaign (real Postgres)', () => {
  let advertiser = '';
  let ownerB = '';
  let ownerC = '';
  let sectorId = '';
  let campaignId = '';

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-05T10:00:00Z'));
    await resetAuthTables();
    await db.update(dispatchConfig).set({ fMaxSeconds: 600 });
    const [sector] = await db
      .select({ id: businessSectors.id })
      .from(businessSectors)
      .where(eq(businessSectors.audience, 'owner'))
      .limit(1);
    sectorId = sector?.id ?? '';
    const ownerA = await seedUser({ role: 'individual_owner' });
    ownerB = await seedUser({ role: 'individual_owner' });
    // C exists at launch (the launch freezes the whole network's typical week) but its owner is
    // not validated yet: out of the launch, in once approved (ELIG-2 reads the owner live).
    ownerC = await seedUser({ role: 'individual_owner', status: 'pending' });
    await seedVenue(A, ownerA, sectorId, WEEK_A, 20);
    await seedVenue(B, ownerB, sectorId, WEEK_B, 22);
    await seedVenue(C, ownerC, sectorId, WEEK_A, 20);
    advertiser = await seedUser();
    await db.insert(recharges).values({
      advertiserId: advertiser,
      amountTnd: '5000.00',
      status: 'confirmed',
      reference: `TOURS-PRE-${seq}`,
    });
    const [creative] = await db
      .insert(creatives)
      .values({
        advertiserId: advertiser,
        creativeType: 'video',
        storageKey: `creatives/tours-pre/${seq}`,
        durationSeconds: 30,
        validationStatus: 'approved',
      })
      .returning();
    const [c] = await db
      .insert(campaigns)
      .values({
        advertiserId: advertiser,
        name: 'Tours prélancement',
        campaignType: 'standard',
        status: 'pending',
        startDate: '2026-11-09',
        endDate: '2026-11-18',
        creativeId: creative?.id ?? '',
        requestedBudget: '260.00',
        standardCpmTnd: '12.000',
        t10s: '0.60',
        t20s: '0.70',
        t30s: '0.80',
      })
      .returning();
    campaignId = c?.id ?? '';
    const [row] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId));
    if (!row) throw new Error('campaign missing');
    const outcome = await activateCampaign({
      campaign: row,
      contentValidationStatus: 'approved',
      creativeDurationSeconds: 30,
      activatedBy: null,
      fromStatus: 'pending',
    });
    expect(outcome.status).toBe('OK');
  });

  afterEach(async () => {
    vi.useRealTimers();
    await db.update(dispatchConfig).set({ fMaxSeconds: 300 });
  });

  const LOCK = new Date('2026-11-09T09:00:00Z');
  const FREEZE = new Date('2026-11-09T14:55:00Z');

  const planAllocations = async () => {
    const [plan] = await db
      .select()
      .from(campaignDispatchPlan)
      .where(eq(campaignDispatchPlan.campaignId, campaignId));
    if (!plan) throw new Error('plan missing');
    const rows = await db
      .select()
      .from(campaignDispatchAllocation)
      .where(eq(campaignDispatchAllocation.planId, plan.id));
    return { plan, rows, of: (v: string) => rows.find((r) => r.screenhostId === v) };
  };
  const accept = (venue: string) =>
    db
      .update(campaignDispatchAllocation)
      .set({ statutAcceptation: 'ACCEPTE' })
      .where(eq(campaignDispatchAllocation.screenhostId, venue));
  const campaignRow = async () =>
    (await db.select().from(campaigns).where(eq(campaigns.id, campaignId)))[0];
  /** C becomes eligible: a new venue, open like A — able to take A's share at 30 DT. */
  const newVenueC = () => db.update(users).set({ status: 'approved' }).where(eq(users.id, ownerC));

  it('nothing happens before start − 6 h; at the lock a silent Host is removed and its share goes to the Host that accepted', async () => {
    await accept(B);
    expect(await runCampaignPrelaunchTick(new Date('2026-11-09T08:59:00Z'))).toEqual([]);
    const before = await planAllocations();
    const bBefore = before.of(B)?.creneaux.length ?? 0;

    const [outcome] = await runCampaignPrelaunchTick(LOCK);
    expect(outcome).toMatchObject({ campaignId, locked: 1, frozen: 0 });
    const after = await planAllocations();
    // The silent Host's proposal is withdrawn, its trace kept (Mariem 16/11).
    expect(after.of(A)).toMatchObject({ statutAcceptation: 'REFUSE', decidedBy: 'system' });
    const b = after.of(B);
    expect(b?.statutAcceptation).toBe('ACCEPTE'); // accepted at once, whatever the amount
    expect(b?.creneaux.length ?? 0).toBeGreaterThan(bBefore);
    const notes = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, ownerB), eq(notifications.type, 'dispatch_slots_added')));
    expect(notes).toHaveLength(1);
    expect(notes[0]?.body).toMatch(
      /^Bonne nouvelle ! Vous avez bénéficié d’un redispatching d’une campagne déjà acceptée sur votre écran\. Cela vous permet de gagner \d+,\d{2} TND supplémentaires\.$/,
    );
    // Once only.
    expect(await runCampaignPrelaunchTick(new Date('2026-11-09T09:01:00Z'))).toEqual([]);
  });

  it('at the lock a NEW Host comes first (told, to accept); the accepted one keeps its share', async () => {
    await accept(B);
    await newVenueC();
    const bBefore = (await planAllocations()).of(B)?.creneaux.length ?? 0;
    await runCampaignPrelaunchTick(LOCK);
    const after = await planAllocations();
    expect(after.of(C)?.statutAcceptation).toBe('EN_ATTENTE');
    expect(after.of(B)?.creneaux.length).toBe(bBefore);
    const told = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, ownerC),
          eq(notifications.type, 'dispatch_pending_acceptance'),
        ),
      );
    expect(told).toHaveLength(1);
  });

  it('at the freeze a Host still silent goes too, its share onto the accepted Host only; the price comes down and the Screencaster is told', async () => {
    await accept(B);
    await newVenueC();
    await runCampaignPrelaunchTick(LOCK); // C proposed A's share — and never answers
    const launched = Number((await campaignRow())?.requestedBudget);

    const [outcome] = await runCampaignPrelaunchTick(FREEZE);
    expect(outcome).toMatchObject({ locked: 0, frozen: 1, final: { told: true } });
    const after = await planAllocations();
    expect(after.of(C)).toMatchObject({ statutAcceptation: 'REFUSE', decidedBy: 'system' });
    expect(after.rows.filter((r) => r.statutAcceptation === 'ACCEPTE')).toHaveLength(1);
    expect(after.rows.some((r) => r.statutAcceptation === 'EN_ATTENTE')).toBe(false);
    const row = await campaignRow();
    expect(row?.prelaunchFrozenAt).toEqual(FREEZE);
    const amount = Number(row?.requestedBudget);
    expect(amount).toBeLessThan(launched); // B cannot hold all of A's share: never above
    expect(amount).toBeCloseTo(Number(after.of(B)?.revenuPrevisionnel), 2);
    const [note] = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, advertiser),
          eq(notifications.type, 'campaign_prelaunch_final'),
        ),
      );
    expect(note?.body).toBe(
      `Votre campagne Tours prélancement démarre dans quelques minutes. Nous vous offrons finalement ${(after.of(B)?.iiPotentiel ?? 0).toLocaleString('fr-FR')} impressions dans 1 établissement, pour un montant de ${amount.toFixed(2).replace('.', ',')} DT.`,
    );
    expect(await runCampaignPrelaunchTick(new Date('2026-11-09T14:56:00Z'))).toEqual([]);
  });

  it('a campaign started as launched (everyone accepted) is frozen silently, its price untouched', async () => {
    await accept(A);
    await accept(B);
    const launched = (await campaignRow())?.requestedBudget;
    const [outcome] = await runCampaignPrelaunchTick(FREEZE);
    expect(outcome).toMatchObject({ locked: 0, frozen: 0, final: { told: false } });
    expect((await campaignRow())?.requestedBudget).toBe(launched);
  });

  it('each Host keeps its own deadline: a Host opening later is locked later', async () => {
    await accept(B);
    // A opens at 18 h: it starts at 17:00 UTC and locks at 11:00 UTC.
    await db.update(screenhosts).set({ openingHour: 18 }).where(eq(screenhosts.id, A));
    expect(await runCampaignPrelaunchTick(LOCK)).toEqual([]);
    expect((await planAllocations()).of(A)?.statutAcceptation).toBe('EN_ATTENTE');
    const [outcome] = await runCampaignPrelaunchTick(new Date('2026-11-09T11:00:00Z'));
    expect(outcome).toMatchObject({ locked: 1 });
    expect((await planAllocations()).of(A)).toMatchObject({
      statutAcceptation: 'REFUSE',
      decidedBy: 'system',
    });
  });

  it('a new Host proposed after its own lock is withdrawn only at its freeze', async () => {
    await accept(B);
    await newVenueC();
    // A opens at 20 h (locks at 13:00 UTC) — by then C (16 h) is past its own lock.
    await db.update(screenhosts).set({ openingHour: 20 }).where(eq(screenhosts.id, A));
    await runCampaignPrelaunchTick(new Date('2026-11-09T13:00:00Z'));
    const c = (await planAllocations()).of(C);
    expect(c).toMatchObject({ statutAcceptation: 'EN_ATTENTE', lateProposal: true });
    expect(await runCampaignPrelaunchTick(new Date('2026-11-09T13:30:00Z'))).toEqual([]);
    const [outcome] = await runCampaignPrelaunchTick(FREEZE);
    expect(outcome).toMatchObject({ frozen: 1 });
    expect((await planAllocations()).of(C)).toMatchObject({
      statutAcceptation: 'REFUSE',
      decidedBy: 'system',
    });
  });

  it('Mariem 16/11 — a refusal before the start goes onto the Host that ACCEPTED first', async () => {
    await accept(B);
    await newVenueC();
    const { plan, of } = await planAllocations();
    const a = of(A);
    if (!a) throw new Error('A missing');
    await db
      .update(campaignDispatchAllocation)
      .set({ statutAcceptation: 'REFUSE' })
      .where(eq(campaignDispatchAllocation.id, a.id));
    const bBefore = of(B)?.creneaux.length;
    await db.transaction((tx) =>
      runRefusalCascade(tx, {
        plan,
        campaign: {
          id: campaignId,
          name: 'Tours prélancement',
          startDate: '2026-11-09',
          endDate: '2026-11-18',
        },
        refused: { id: a.id, screenhostId: A, iiPotentiel: a.iiPotentiel },
      }),
    );
    const after = await planAllocations();
    expect(after.of(B)?.statutAcceptation).toBe('ACCEPTE');
    expect(after.of(B)?.creneaux.length ?? 0).toBeGreaterThan(bBefore ?? 0);
    const notes = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, ownerB), eq(notifications.type, 'dispatch_slots_added')));
    expect(notes).toHaveLength(1);
  });

  it('Mariem 16/11 — a Host proposed inside its 6 h window that refuses: only the accepted Hosts take it', async () => {
    await newVenueC();
    const run = async (late: boolean) => {
      const { plan, of } = await planAllocations();
      const a = of(A);
      if (!a) throw new Error('A missing');
      await db
        .update(campaignDispatchAllocation)
        .set({ statutAcceptation: 'REFUSE', lateProposal: late })
        .where(eq(campaignDispatchAllocation.id, a.id));
      await db.transaction((tx) =>
        runRefusalCascade(tx, {
          plan,
          campaign: {
            id: campaignId,
            name: 'Tours prélancement',
            startDate: '2026-11-09',
            endDate: '2026-11-18',
          },
          refused: { id: a.id, screenhostId: A, iiPotentiel: a.iiPotentiel },
        }),
      );
      return (await planAllocations()).of(C);
    };
    // B has not accepted: no accepted Host can take A's share, and no new Host is offered it.
    expect(await run(true)).toBeUndefined();
  });

  it('Mariem 16/11 — a regular refusal (no accepted Host) is offered to a new Host', async () => {
    await newVenueC();
    const { plan, of } = await planAllocations();
    const a = of(A);
    if (!a) throw new Error('A missing');
    await db
      .update(campaignDispatchAllocation)
      .set({ statutAcceptation: 'REFUSE' })
      .where(eq(campaignDispatchAllocation.id, a.id));
    await db.transaction((tx) =>
      runRefusalCascade(tx, {
        plan,
        campaign: {
          id: campaignId,
          name: 'Tours prélancement',
          startDate: '2026-11-09',
          endDate: '2026-11-18',
        },
        refused: { id: a.id, screenhostId: A, iiPotentiel: a.iiPotentiel },
      }),
    );
    expect((await planAllocations()).of(C)?.statutAcceptation).toBe('EN_ATTENTE');
  });

  it('Mariem 16/11 — a Host launched after its own lock is not withdrawn at once', async () => {
    await accept(B);
    // A was proposed after its lock (09:00 UTC): only the freeze can withdraw it.
    await db
      .update(campaignDispatchAllocation)
      .set({ createdAt: new Date('2026-11-09T10:00:00Z') })
      .where(eq(campaignDispatchAllocation.screenhostId, A));
    expect(await runCampaignPrelaunchTick(new Date('2026-11-09T10:01:00Z'))).toEqual([]);
    expect((await planAllocations()).of(A)?.statutAcceptation).toBe('EN_ATTENTE');
    const [outcome] = await runCampaignPrelaunchTick(FREEZE);
    expect(outcome).toMatchObject({ frozen: 1 });
  });

  it('Mariem 16/11 — a Host withdrawn for no answer is never proposed the campaign again', async () => {
    await accept(B);
    await runCampaignPrelaunchTick(LOCK); // A silent → withdrawn
    const { plan, of } = await planAllocations();
    const b = of(B);
    if (!b) throw new Error('B missing');
    await db
      .update(campaignDispatchAllocation)
      .set({ statutAcceptation: 'REFUSE' })
      .where(eq(campaignDispatchAllocation.id, b.id));
    await newVenueC();
    await db.transaction((tx) =>
      runRefusalCascade(tx, {
        plan,
        campaign: {
          id: campaignId,
          name: 'Tours prélancement',
          startDate: '2026-11-09',
          endDate: '2026-11-18',
        },
        refused: { id: b.id, screenhostId: B, iiPotentiel: b.iiPotentiel },
      }),
    );
    const after = await planAllocations();
    // Still the system's withdrawal: never re-proposed as a « new » Host.
    expect(after.of(A)).toMatchObject({ statutAcceptation: 'REFUSE', decidedBy: 'system' });
  });
});
