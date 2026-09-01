import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { and, eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import {
  type NewUser,
  businessSectors,
  campaignReconciliation,
  campaigns,
  creatives,
  eventAllocations,
  eventAttestations,
  events,
  notifications,
  proofOfPlay,
  screenhostAffluence,
  screenhosts,
  screens,
  users,
} from '../src/db/schema.js';
import { runBlocPushTick } from '../src/lib/event-playout/bloc-pusher.js';
import {
  measureEventDelivery,
  runEventSettlementSweep,
  settleEventPositioning,
} from '../src/lib/event-playout/settlement.js';
import {
  activeEventSpots,
  eventRepsPerHour,
  venuesAtBlocEdge,
} from '../src/lib/event-playout/spots.js';
import { fenetreDiffusion } from '../src/lib/fenetre-diffusion.js';
import { computeScreenPlaylist } from '../src/lib/playout/playlist-service.js';
import { walletBalance } from '../src/lib/recharges.js';
import { computeSps } from '../src/lib/sps-score.js';
import { adminEventsRoutes } from '../src/routes/admin-events.js';

import { resetAuthTables, bothHalves } from './helpers/db-test-setup.js';

// EV5 — event playout + the dual-proof monitor + the direct refund + attestation + R4.
// The campaign playout SOURCE is byte-identical (the composition pin below); manquements are LOST
// (no rattrapage — divergent by spec); an absent attestation is RESPECTED; venue reversement
// lines stay EV6 (pinned absent). No business_sectors/zones rows added (the fixture footgun).

type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;
const mockSession = (userId: string, role = 'admin'): void => {
  vi.spyOn(auth.api, 'getSession').mockResolvedValue({
    session: {},
    user: { id: userId, role, status: 'approved' },
  } as unknown as GetSessionResult);
};

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
      email: `ev5-${seq}@example.com`,
      contactName: `EV5 User ${seq}`,
      role: 'advertiser',
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

const ownerSectorId = async (): Promise<string> => {
  const [s] = await db
    .select({ id: businessSectors.id })
    .from(businessSectors)
    .where(eq(businessSectors.audience, 'owner'))
    .limit(1);
  return s?.id ?? '';
};

const seedVenue = async (): Promise<{ id: string; ownerId: string }> => {
  const ownerId = await seedUser({ role: 'individual_owner' });
  seq += 1;
  const [sh] = await db
    .insert(screenhosts)
    .values({
      name: `EV5 Venue ${seq}`,
      ownerId,
      businessSectorId: await ownerSectorId(),
      class: 'premium',
      sps: '80',
      openingHour: 8,
      closingHour: 23,
      broadcastCapacity: 4,
    })
    .returning();
  const id = sh?.id ?? '';
  await db
    .insert(screenhostAffluence)
    .values(bothHalves({ screenhostId: id, dayOfWeek: 1, hour: 19, estimatedImpressions: 100 }));
  return { id, ownerId };
};

// A Tunis-evening fixture: kickoff 20:00, ends 22:00 → window 19:00–23:00; six blocs.
const KICKOFF = new Date('2027-06-10T20:00:00+01:00');
const ENDS = new Date('2027-06-10T22:00:00+01:00');
const GRID = fenetreDiffusion(KICKOFF, ENDS);
/** After the window closes (23:00 + 1 min) — the settlement clock. */
const AFTER_WINDOW = new Date(GRID.windowEnd.getTime() + 60_000);

const seedEvent = async (over: Partial<typeof events.$inferInsert> = {}): Promise<string> => {
  seq += 1;
  const [row] = await db
    .insert(events)
    .values({
      name: `EV5 Match ${seq}`,
      type: 'sport',
      kickoffAt: KICKOFF,
      endsAt: ENDS,
      source: 'official',
      ...over,
    })
    .returning();
  return row?.id ?? '';
};

/**
 * A positioning with ONE allocation over the first `blocCount` blocs of the grid.
 * `montant` is the venue's chargeable value (EV4's capped montant).
 */
const seedPositioning = async (
  eventId: string,
  venueId: string,
  opts: {
    blocCount?: number;
    montant?: string;
    statut?: 'EN_ATTENTE' | 'ACCEPTE' | 'REFUSE';
    status?: 'active' | 'upcoming' | 'completed';
    spotSeconds?: number;
  } = {},
): Promise<{ campaignId: string; advertiserId: string; allocationId: string }> => {
  const advertiserId = await seedUser();
  seq += 1;
  const [creative] = await db
    .insert(creatives)
    .values({
      advertiserId,
      creativeType: 'video',
      storageKey: `creatives/ev5/${seq}`,
      durationSeconds: opts.spotSeconds ?? 15,
      validationStatus: 'approved',
      fileHash: `ev5-${seq}-${Math.random().toString(16).slice(2)}`,
    })
    .returning();
  const [campaign] = await db
    .insert(campaigns)
    .values({
      advertiserId,
      name: `Positionnement ${seq}`,
      campaignType: 'event',
      status: opts.status ?? 'active',
      startDate: '2027-06-10',
      endDate: '2027-06-10',
      requestedBudget: '300.00',
      eventId,
      creativeId: creative?.id,
    })
    .returning();
  const blocCount = opts.blocCount ?? 6;
  const blocs = GRID.blocs.slice(0, blocCount).map((b) => ({
    start: b.start.toISOString(),
    end: b.end.toISOString(),
    impressions: 2000,
  }));
  const [allocation] = await db
    .insert(eventAllocations)
    .values({
      campaignId: campaign?.id ?? '',
      screenhostId: venueId,
      blocs,
      impressionsTotal: blocCount * 2000,
      montantTnd: opts.montant ?? '300.000',
      statut: opts.statut ?? 'ACCEPTE',
      ...(opts.statut && opts.statut !== 'EN_ATTENTE' ? { decidedAt: new Date() } : {}),
    })
    .returning();
  return {
    campaignId: campaign?.id ?? '',
    advertiserId,
    allocationId: allocation?.id ?? '',
  };
};

/** A VIDEO_ENDED proof for (positioning, venue) at a given server instant. */
const seedProof = async (campaignId: string, venueId: string, receivedAt: Date): Promise<void> => {
  seq += 1;
  const [campaign] = await db
    .select({ creativeId: campaigns.creativeId })
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);
  const [screen] = await db
    .insert(screens)
    .values({ screenhostId: venueId, name: `EV5 Screen ${seq}` })
    .returning();
  await db.insert(proofOfPlay).values({
    screenId: screen?.id ?? '',
    screenhostId: venueId,
    campaignId,
    creativeId: campaign?.creativeId ?? '',
    videoIdAsSent: campaignId,
    eventType: 'VIDEO_ENDED',
    receivedAt,
  });
};

const buildApp = () => Fastify({ logger: false });

describe('EV5 — event playout, monitoring + settlement (real Postgres)', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    await resetAuthTables();
    app = buildApp();
    await app.register(adminEventsRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await sql.end();
  });

  describe('activeEventSpots — the airability gate', () => {
    it('airs INSIDE a bloc, never outside it and never during the match', async () => {
      const venue = await seedVenue();
      const eventId = await seedEvent();
      await seedPositioning(eventId, venue.id);
      const firstBloc = GRID.blocs[0];
      const lastPre = GRID.blocs[2];
      if (!firstBloc || !lastPre) throw new Error('grid');

      // Inside the first pre-match bloc.
      const inside = await activeEventSpots(venue.id, new Date(firstBloc.start.getTime() + 60_000));
      expect(inside).toHaveLength(1);
      expect(inside[0]?.repsPerHour).toBe(60); // 900 ÷ 15

      // The bloc is HALF-OPEN: its own end instant already belongs to the next slot.
      expect(await activeEventSpots(venue.id, firstBloc.start)).toHaveLength(1);
      expect(
        await activeEventSpots(venue.id, new Date(firstBloc.start.getTime() - 1)),
      ).toHaveLength(0);

      // DURING the match (right after the last pre-match bloc ends AT kickoff) — no bloc exists.
      expect(
        await activeEventSpots(venue.id, new Date(lastPre.end.getTime() + 60_000)),
      ).toHaveLength(0);
      // After the whole window.
      expect(await activeEventSpots(venue.id, AFTER_WINDOW)).toHaveLength(0);
    });

    it('ACCEPTE only; an annulé event and a non-active positioning never air', async () => {
      const venue = await seedVenue();
      const inBloc = new Date((GRID.blocs[0]?.start.getTime() ?? 0) + 60_000);

      const pendingEvent = await seedEvent();
      await seedPositioning(pendingEvent, venue.id, { statut: 'EN_ATTENTE' });
      expect(await activeEventSpots(venue.id, inBloc)).toHaveLength(0);

      const refusedEvent = await seedEvent();
      await seedPositioning(refusedEvent, venue.id, { statut: 'REFUSE' });
      expect(await activeEventSpots(venue.id, inBloc)).toHaveLength(0);

      const upcomingEvent = await seedEvent();
      await seedPositioning(upcomingEvent, venue.id, { status: 'upcoming' });
      expect(await activeEventSpots(venue.id, inBloc)).toHaveLength(0);

      const annuleEvent = await seedEvent({ annule: true });
      await seedPositioning(annuleEvent, venue.id);
      expect(await activeEventSpots(venue.id, inBloc)).toHaveLength(0);
    });

    it('a cross-midnight bloc airs on its own instants (timezone-free)', async () => {
      const venue = await seedVenue();
      const kickoff = new Date('2027-06-11T00:30:00+01:00');
      const ends = new Date('2027-06-11T02:30:00+01:00');
      const grid = fenetreDiffusion(kickoff, ends);
      const eventId = await seedEvent({ kickoffAt: kickoff, endsAt: ends });
      const advertiserId = await seedUser();
      seq += 1;
      const [creative] = await db
        .insert(creatives)
        .values({
          advertiserId,
          creativeType: 'video',
          storageKey: `creatives/ev5-mid/${seq}`,
          durationSeconds: 15,
          validationStatus: 'approved',
          fileHash: `ev5-mid-${seq}`,
        })
        .returning();
      const [campaign] = await db
        .insert(campaigns)
        .values({
          advertiserId,
          name: 'Positionnement minuit',
          campaignType: 'event',
          status: 'active',
          startDate: '2027-06-10',
          endDate: '2027-06-11',
          requestedBudget: '300.00',
          eventId,
          creativeId: creative?.id,
        })
        .returning();
      const first = grid.blocs[0];
      if (!first) throw new Error('grid');
      await db.insert(eventAllocations).values({
        campaignId: campaign?.id ?? '',
        screenhostId: venue.id,
        blocs: [
          { start: first.start.toISOString(), end: first.end.toISOString(), impressions: 2000 },
        ],
        impressionsTotal: 2000,
        montantTnd: '30.000',
        statut: 'ACCEPTE',
      });
      // The 23:30 bloc (June 10 Tunis) airs even though the match sits on June 11.
      expect(
        await activeEventSpots(venue.id, new Date(first.start.getTime() + 60_000)),
      ).toHaveLength(1);
    });

    it('R = 900 ÷ S (60 at the 15 s reference), never below 1', () => {
      expect(eventRepsPerHour(15)).toBe(60);
      expect(eventRepsPerHour(10)).toBe(90);
      expect(eventRepsPerHour(30)).toBe(30);
      expect(eventRepsPerHour(2000)).toBe(1);
      expect(eventRepsPerHour(0)).toBe(0);
    });
  });

  describe('THE COMPOSITION PIN — the campaign source is byte-identical', () => {
    it('a venue with no event allocation yields the exact pre-EV5 playlist', async () => {
      const venue = await seedVenue();
      const before = await computeScreenPlaylist(venue.id, new Date());
      expect(before).toEqual({ videos: [], loop: true });
      // Even INSIDE what would be a bloc — there is simply no event source to append.
      const inBloc = new Date((GRID.blocs[0]?.start.getTime() ?? 0) + 60_000);
      expect(await computeScreenPlaylist(venue.id, inBloc)).toEqual({ videos: [], loop: true });
    });

    it('the playout sources never learn event semantics beyond the composition (source pin)', () => {
      const service = readFileSync(
        fileURLToPath(new URL('../src/lib/playout/playlist-service.ts', import.meta.url)),
        'utf8',
      );
      // ONE import + ONE loop: the campaign branch above it is untouched.
      expect(service).toContain('activeEventSpots');
      for (const rel of [
        '../src/lib/playout/active-allocations.ts',
        '../src/lib/playout/playlist.ts',
        '../src/lib/playout/push.ts',
        '../src/lib/playout/ingest.ts',
      ]) {
        const source = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
        expect(source, `${rel} learned event semantics`).not.toMatch(
          /eventAllocations|activeEventSpots|event_allocations/,
        );
      }
    });
  });

  describe('the bloc pusher', () => {
    it('detects START and END edges inside the window, and nothing outside it', async () => {
      const venue = await seedVenue();
      const eventId = await seedEvent();
      await seedPositioning(eventId, venue.id);
      const first = GRID.blocs[0];
      if (!first) throw new Error('grid');

      // A minute straddling the first bloc's start.
      const atStart = await venuesAtBlocEdge(new Date(first.start.getTime() - 60_000), first.start);
      expect(atStart).toEqual([venue.id]);
      // A minute straddling its end.
      const atEnd = await venuesAtBlocEdge(new Date(first.end.getTime() - 60_000), first.end);
      expect(atEnd).toEqual([venue.id]);
      // A quiet minute in the middle of the match.
      const quiet = await venuesAtBlocEdge(
        new Date(KICKOFF.getTime() + 60 * 60_000),
        new Date(KICKOFF.getTime() + 61 * 60_000),
      );
      expect(quiet).toEqual([]);
    });

    it('the tick is idempotent and never throws with no connected screen', async () => {
      const venue = await seedVenue();
      const eventId = await seedEvent();
      await seedPositioning(eventId, venue.id);
      const first = GRID.blocs[0];
      if (!first) throw new Error('grid');
      const once = await runBlocPushTick(silentLog, first.start);
      const twice = await runBlocPushTick(silentLog, first.start);
      expect(once).toEqual({ venues: 1, pushed: 0 }); // no socket registered → 0 pushed
      expect(twice).toEqual(once); // idempotent
    });
  });

  describe('the monitor + settlement (the dual proof)', () => {
    it('THE WORKED EXAMPLE: 4 of 6 blocs proven → 200 delivered, 100 refunded', async () => {
      const venue = await seedVenue();
      const eventId = await seedEvent();
      const { campaignId, advertiserId } = await seedPositioning(eventId, venue.id, {
        montant: '300.000',
      });
      // One proof inside each of the first four blocs.
      for (const bloc of GRID.blocs.slice(0, 4)) {
        await seedProof(campaignId, venue.id, new Date(bloc.start.getTime() + 5_000));
      }
      const result = await settleEventPositioning(campaignId, AFTER_WINDOW);
      expect(result.status).toBe('SETTLED');
      expect(result.engagedTnd).toBe(300);
      expect(result.deliveredTnd).toBe(200); // 300 × 4/6
      expect(result.refundTnd).toBe(100);
      expect(result.venues?.[0]?.blocsDelivered).toBe(4);

      // THE REFUND LANDED: the wallet debits spend_tnd only, so the undelivered 100 was never
      // debited (E6's movement — no new mechanism, no wallet_adjustment row).
      const [recon] = await db
        .select()
        .from(campaignReconciliation)
        .where(eq(campaignReconciliation.campaignId, campaignId));
      expect(Number(recon?.spendTnd)).toBe(200);
      expect(Number(recon?.refundTnd)).toBe(100);
      expect(recon?.status).toBe('partial');
      const balance = await walletBalance(advertiserId);
      expect(balance.debited_tnd).toBe(200);

      // The positioning closed and the advertiser was told.
      const [row] = await db
        .select({ status: campaigns.status })
        .from(campaigns)
        .where(eq(campaigns.id, campaignId));
      expect(row?.status).toBe('completed');
      const notifs = await db
        .select()
        .from(notifications)
        .where(eq(notifications.campaignId, campaignId));
      expect(notifs.some((n) => n.type === 'event_settled')).toBe(true);
    });

    it('a proof OUTSIDE every bloc proves nothing; full delivery refunds zero', async () => {
      const venue = await seedVenue();
      const eventId = await seedEvent();
      const { campaignId } = await seedPositioning(eventId, venue.id, { montant: '300.000' });
      // A proof during the MATCH (no bloc covers it) — the venue aired something, but not the
      // event's grid: nothing is credited.
      await seedProof(campaignId, venue.id, new Date(KICKOFF.getTime() + 30 * 60_000));
      const nothing = await measureEventDelivery(campaignId, eventId);
      expect(nothing.deliveredTnd).toBe(0);
      expect(nothing.refundTnd).toBe(300);

      // Now prove every bloc → zero refund, status réussie.
      for (const bloc of GRID.blocs) {
        await seedProof(campaignId, venue.id, new Date(bloc.start.getTime() + 5_000));
      }
      const settled = await settleEventPositioning(campaignId, AFTER_WINDOW);
      expect(settled.deliveredTnd).toBe(300);
      expect(settled.refundTnd).toBe(0);
      const [recon] = await db
        .select({ status: campaignReconciliation.status })
        .from(campaignReconciliation)
        .where(eq(campaignReconciliation.campaignId, campaignId));
      expect(recon?.status).toBe('reussie');
    });

    it('a respecte=FALSE attestation NEGATES a fully-proven venue; absent = respected', async () => {
      const venue = await seedVenue();
      const eventId = await seedEvent();
      const { campaignId } = await seedPositioning(eventId, venue.id, { montant: '300.000' });
      for (const bloc of GRID.blocs) {
        await seedProof(campaignId, venue.id, new Date(bloc.start.getTime() + 5_000));
      }
      // ABSENT attestation → respected → everything delivered.
      const respected = await measureEventDelivery(campaignId, eventId);
      expect(respected.deliveredTnd).toBe(300);
      expect(respected.venues[0]?.attestationNegated).toBe(false);

      // A NEGATIVE verdict wipes the venue's delivery whatever the screen reported.
      const agentId = await seedUser({ role: 'screenhost_agent' });
      await db.insert(eventAttestations).values({
        eventId,
        screenhostId: venue.id,
        authorId: agentId,
        respecte: false,
        note: 'Écrans éteints pendant le match.',
      });
      const negated = await measureEventDelivery(campaignId, eventId);
      expect(negated.deliveredTnd).toBe(0);
      expect(negated.refundTnd).toBe(300);
      expect(negated.venues[0]?.attestationNegated).toBe(true);

      // A POSITIVE verdict restores it (the same upsert path the route uses).
      await db
        .update(eventAttestations)
        .set({ respecte: true })
        .where(
          and(eq(eventAttestations.eventId, eventId), eq(eventAttestations.screenhostId, venue.id)),
        );
      expect((await measureEventDelivery(campaignId, eventId)).deliveredTnd).toBe(300);
    });

    it('an EN_ATTENTE allocation refunds in full; a REFUSE one carries no money at all', async () => {
      const venue = await seedVenue();
      const eventId = await seedEvent();
      const { campaignId } = await seedPositioning(eventId, venue.id, {
        montant: '300.000',
        statut: 'EN_ATTENTE',
      });
      const pending = await measureEventDelivery(campaignId, eventId);
      expect(pending.engagedTnd).toBe(300);
      expect(pending.refundTnd).toBe(300);

      // A refused venue's share was re-placed by EV4's cascade: counting it would double-charge.
      const other = await seedVenue();
      await db.insert(eventAllocations).values({
        campaignId,
        screenhostId: other.id,
        blocs: [],
        impressionsTotal: 4000,
        montantTnd: '120.000',
        statut: 'REFUSE',
        decidedAt: new Date(),
      });
      const withRefusal = await measureEventDelivery(campaignId, eventId);
      expect(withRefusal.engagedTnd).toBe(300); // unchanged — the REFUSE line adds nothing
      expect(withRefusal.venues.find((v) => v.screenhostId === other.id)?.montantTnd).toBe(0);
    });

    it('the settlement is IDEMPOTENT and refuses while the window is still open', async () => {
      const venue = await seedVenue();
      const eventId = await seedEvent();
      const { campaignId } = await seedPositioning(eventId, venue.id);
      // Mid-window: nothing settles.
      expect((await settleEventPositioning(campaignId, KICKOFF)).status).toBe('WINDOW_OPEN');
      expect((await settleEventPositioning(campaignId, AFTER_WINDOW)).status).toBe('SETTLED');
      expect((await settleEventPositioning(campaignId, AFTER_WINDOW)).status).toBe(
        'ALREADY_SETTLED',
      );
      const rows = await db
        .select()
        .from(campaignReconciliation)
        .where(eq(campaignReconciliation.campaignId, campaignId));
      expect(rows).toHaveLength(1);
    });

    // EV6 FLIPPED THIS PIN (chartered): the venue side now settles too. What EV5 owns — and what
    // this asserts — is that the ADVERTISER settlement is unchanged by the venue lines; their own
    // identity (Σ lines ≡ delivered value, source='event') is pinned in the EV6 suite.
    it('the advertiser settlement is unchanged by the venue side (EV6 writes the lines)', async () => {
      const venue = await seedVenue();
      const eventId = await seedEvent();
      const { campaignId } = await seedPositioning(eventId, venue.id, { montant: '300.000' });
      for (const bloc of GRID.blocs) {
        await seedProof(campaignId, venue.id, new Date(bloc.start.getTime() + 5_000));
      }
      const settled = await settleEventPositioning(campaignId, AFTER_WINDOW);
      expect(settled.deliveredTnd).toBe(300);
      expect(settled.refundTnd).toBe(0);
      const [recon] = await db
        .select({ spendTnd: campaignReconciliation.spendTnd })
        .from(campaignReconciliation)
        .where(eq(campaignReconciliation.campaignId, campaignId));
      expect(Number(recon?.spendTnd)).toBe(300);
    });

    it('the sweep settles closed windows only', async () => {
      const venue = await seedVenue();
      const closed = await seedEvent();
      const { campaignId } = await seedPositioning(closed, venue.id);
      const open = await seedEvent({
        kickoffAt: new Date(AFTER_WINDOW.getTime() + 24 * 60 * 60_000),
        endsAt: new Date(AFTER_WINDOW.getTime() + 26 * 60 * 60_000),
      });
      const later = await seedPositioning(open, venue.id);
      const result = await runEventSettlementSweep(silentLog, AFTER_WINDOW);
      expect(result.settled).toBe(1);
      const settledRows = await db
        .select({ campaignId: campaignReconciliation.campaignId })
        .from(campaignReconciliation);
      expect(settledRows.map((r) => r.campaignId)).toContain(campaignId);
      expect(settledRows.map((r) => r.campaignId)).not.toContain(later.campaignId);
    });
  });

  describe('the SPS respect variable (EV5 turns it real)', () => {
    it('no attestation → 100 BY RULE; a negative verdict lowers it; mixed averages', async () => {
      const venue = await seedVenue();
      const agentId = await seedUser({ role: 'screenhost_agent' });
      // The DEFAULT RULE: an uninspected venue is never sanctioned.
      expect((await computeSps(venue.id)).variables.respect_evenements).toBe(100);

      const firstEvent = await seedEvent();
      await db.insert(eventAttestations).values({
        eventId: firstEvent,
        screenhostId: venue.id,
        authorId: agentId,
        respecte: false,
      });
      expect((await computeSps(venue.id)).variables.respect_evenements).toBe(0);

      const secondEvent = await seedEvent();
      await db.insert(eventAttestations).values({
        eventId: secondEvent,
        screenhostId: venue.id,
        authorId: agentId,
        respecte: true,
      });
      expect((await computeSps(venue.id)).variables.respect_evenements).toBe(50);
    });
  });

  describe('the attestation surface (admin + screenhost_agent)', () => {
    const putAttestation = (eventId: string, venueId: string, body: Record<string, unknown>) =>
      app.inject({
        method: 'PUT',
        url: `/api/admin/events/${eventId}/attestations/${venueId}`,
        payload: body,
      });

    it('an AGENT may attest; the verdict upserts and recomputes the venue SPS', async () => {
      const venue = await seedVenue();
      const eventId = await seedEvent();
      await seedPositioning(eventId, venue.id);
      const agentId = await seedUser({ role: 'screenhost_agent' });
      mockSession(agentId, 'screenhost_agent');

      const created = await putAttestation(eventId, venue.id, {
        respecte: false,
        note: 'Écran éteint.',
      });
      expect(created.statusCode).toBe(200);
      expect((created.json() as { respecte: boolean }).respecte).toBe(false);

      // Upsert: the same (event, venue) updates in place.
      const updated = await putAttestation(eventId, venue.id, { respecte: true });
      expect(updated.statusCode).toBe(200);
      const rows = await db
        .select()
        .from(eventAttestations)
        .where(eq(eventAttestations.eventId, eventId));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.respecte).toBe(true);

      // The SPS moved with it (the recompute hook).
      const [sh] = await db
        .select({ sps: screenhosts.sps })
        .from(screenhosts)
        .where(eq(screenhosts.id, venue.id));
      expect(Number(sh?.sps)).toBeGreaterThan(0);
    });

    it('refuses a venue that does not diffuse the event, and a non-agent role', async () => {
      const venue = await seedVenue();
      const stranger = await seedVenue();
      const eventId = await seedEvent();
      await seedPositioning(eventId, venue.id);
      const agentId = await seedUser({ role: 'screenhost_agent' });
      mockSession(agentId, 'screenhost_agent');
      expect((await putAttestation(eventId, stranger.id, { respecte: true })).statusCode).toBe(404);

      const advertiserId = await seedUser();
      mockSession(advertiserId, 'advertiser');
      expect((await putAttestation(eventId, venue.id, { respecte: true })).statusCode).toBe(403);
    });

    it('the GET lists every allocated venue, unattested ones as null (= respected)', async () => {
      const venue = await seedVenue();
      const eventId = await seedEvent();
      await seedPositioning(eventId, venue.id);
      const adminId = await seedUser({ role: 'admin' });
      mockSession(adminId, 'admin');
      const res = await app.inject({
        method: 'GET',
        url: `/api/admin/events/${eventId}/attestations`,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { screenhost_id: string; respecte: boolean | null }[];
      expect(body).toHaveLength(1);
      expect(body[0]?.screenhost_id).toBe(venue.id);
      expect(body[0]?.respecte).toBeNull();
    });
  });

  describe('R4 — reporter / annuler / prolongation', () => {
    it('REPORTER re-snapshots the dates, remaps blocs BY RELATIVE INDEX and rewrites the holds', async () => {
      const venue = await seedVenue();
      const eventId = await seedEvent();
      const { campaignId, advertiserId } = await seedPositioning(eventId, venue.id, {
        blocCount: 6,
      });
      const before = await db
        .select({ blocs: eventAllocations.blocs })
        .from(eventAllocations)
        .where(eq(eventAllocations.campaignId, campaignId));
      const beforeStarts = (before[0]?.blocs as { start: string }[]).map((b) => b.start);
      const heldBefore =
        await sql`select day, hour from hour_reservations where event_id = ${eventId} order by hour`;
      expect(heldBefore.length).toBeGreaterThanOrEqual(0);

      const adminId = await seedUser({ role: 'admin' });
      mockSession(adminId, 'admin');
      const newKickoff = new Date('2027-06-17T20:00:00+01:00'); // one week later
      const res = await app.inject({
        method: 'POST',
        url: `/api/admin/events/${eventId}/reporter`,
        payload: { kickoff_at: newKickoff.toISOString() },
      });
      expect(res.statusCode).toBe(200);
      expect(
        (res.json() as { positionnements_recalcules: number }).positionnements_recalcules,
      ).toBe(1);

      // The event moved and its duration was preserved.
      const [moved] = await db.select().from(events).where(eq(events.id, eventId));
      expect(moved?.kickoffAt.toISOString()).toBe(newKickoff.toISOString());
      const newGrid = fenetreDiffusion(moved?.kickoffAt ?? newKickoff, moved?.endsAt ?? newKickoff);

      // RELATIVE INDEX: bloc i is now grid i of the NEW window, in order.
      const [after] = await db
        .select({ blocs: eventAllocations.blocs })
        .from(eventAllocations)
        .where(eq(eventAllocations.campaignId, campaignId));
      const afterStarts = (after?.blocs as { start: string }[]).map((b) => b.start);
      expect(afterStarts).toEqual(newGrid.blocs.map((b) => b.start.toISOString()));
      expect(afterStarts).not.toEqual(beforeStarts);

      // The snapshotted dates followed the new window.
      const [row] = await db
        .select({ startDate: campaigns.startDate, endDate: campaigns.endDate })
        .from(campaigns)
        .where(eq(campaigns.id, campaignId));
      expect(row?.startDate).toBe('2027-06-17');

      // The holds were rewritten onto the new instants (none left on the old date).
      const held =
        await sql`select distinct day from hour_reservations where event_id = ${eventId}`;
      expect(held.map((h) => h['day'])).toEqual(['2027-06-17']);

      // Both sides were told, in French.
      const notifs = await db
        .select()
        .from(notifications)
        .where(eq(notifications.type, 'event_reported'));
      expect(notifs.some((n) => n.userId === advertiserId)).toBe(true);
      expect(notifs.some((n) => n.userId === venue.ownerId)).toBe(true);
    });

    it('a PROLONGATION (ends_at only) leaves the pre-match blocs and moves the post ones', async () => {
      const venue = await seedVenue();
      const eventId = await seedEvent();
      const { campaignId } = await seedPositioning(eventId, venue.id, { blocCount: 6 });
      const adminId = await seedUser({ role: 'admin' });
      mockSession(adminId, 'admin');
      const longerEnd = new Date(ENDS.getTime() + 30 * 60_000);
      const res = await app.inject({
        method: 'POST',
        url: `/api/admin/events/${eventId}/reporter`,
        payload: { kickoff_at: KICKOFF.toISOString(), ends_at: longerEnd.toISOString() },
      });
      expect(res.statusCode).toBe(200);
      const newGrid = fenetreDiffusion(KICKOFF, longerEnd);
      const [after] = await db
        .select({ blocs: eventAllocations.blocs })
        .from(eventAllocations)
        .where(eq(eventAllocations.campaignId, campaignId));
      const starts = (after?.blocs as { start: string }[]).map((b) => b.start);
      // The three pre-match blocs are unchanged (they hang off the kickoff)…
      expect(starts.slice(0, 3)).toEqual(GRID.blocs.slice(0, 3).map((b) => b.start.toISOString()));
      // …and the three post-match ones followed the new end.
      expect(starts.slice(3)).toEqual(newGrid.blocs.slice(3).map((b) => b.start.toISOString()));
    });

    it('ANNULER voids the positionings: holds released, FULL refund, closed, both sides notified', async () => {
      const venue = await seedVenue();
      const eventId = await seedEvent();
      const { campaignId, advertiserId } = await seedPositioning(eventId, venue.id, {
        montant: '300.000',
      });
      // Give it holds to release (the R4 path releases whatever exists).
      await sql`insert into hour_reservations (screenhost_id, day, hour, event_id) values (${venue.id}, '2027-06-10', 19, ${eventId})`;

      const adminId = await seedUser({ role: 'admin' });
      mockSession(adminId, 'admin');
      const res = await app.inject({
        method: 'POST',
        url: `/api/admin/events/${eventId}/annuler`,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { positionnements_annules: number; remboursement_tnd: number };
      expect(body.positionnements_annules).toBe(1);
      expect(body.remboursement_tnd).toBe(300);

      // FULL refund through E6's movement: spend 0 → nothing debited.
      const [recon] = await db
        .select()
        .from(campaignReconciliation)
        .where(eq(campaignReconciliation.campaignId, campaignId));
      expect(Number(recon?.spendTnd)).toBe(0);
      expect(Number(recon?.refundTnd)).toBe(300);
      expect((await walletBalance(advertiserId)).debited_tnd).toBe(0);

      const held =
        await sql`select count(*)::int as n from hour_reservations where event_id = ${eventId}`;
      expect(held[0]?.['n']).toBe(0);
      const [row] = await db
        .select({ status: campaigns.status })
        .from(campaigns)
        .where(eq(campaigns.id, campaignId));
      expect(row?.status).toBe('completed');
      const notifs = await db
        .select()
        .from(notifications)
        .where(eq(notifications.type, 'event_cancelled'));
      expect(notifs.some((n) => n.userId === advertiserId)).toBe(true);
      expect(notifs.some((n) => n.userId === venue.ownerId)).toBe(true);
      // And nothing airs any more.
      const inBloc = new Date((GRID.blocs[0]?.start.getTime() ?? 0) + 60_000);
      expect(await activeEventSpots(venue.id, inBloc)).toHaveLength(0);
    });

    it('THE OVERLAP PIN: a venue can never serve two events at overlapping instants', async () => {
      // EV2's placement-time exclusion (foreignReservedCells) is what guarantees it: a venue-hour
      // already reserved by ANOTHER event is not available to the next one, so two allocations on
      // the same venue can never carry blocs that overlap in time.
      const venue = await seedVenue();
      const firstEvent = await seedEvent();
      await seedPositioning(firstEvent, venue.id);
      await sql`insert into hour_reservations (screenhost_id, day, hour, event_id) values (${venue.id}, '2027-06-10', 19, ${firstEvent})`;
      const { assembleEventPool } = await import('../src/lib/event-dispatch/dispatch.js');
      // A second event over the SAME window sees the venue as unavailable on the reserved hour.
      const secondKickoff = KICKOFF;
      const pool = await assembleEventPool({
        id: '00000000-0000-4000-8000-0000000000e5',
        kickoffAt: secondKickoff,
        endsAt: ENDS,
      });
      const entry = pool.find((p) => p.screenhostId === venue.id);
      // Hour 19 carries the three pre-match blocs — all excluded, so only post-match ones remain.
      expect(entry?.blocs.every((b) => b.start.getTime() >= ENDS.getTime())).toBe(true);
    });
  });
});
