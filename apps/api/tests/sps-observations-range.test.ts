import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { db, sql } from '../src/db/client.js';
import {
  type DispatchCreneau,
  type NewUser,
  campaignDispatchAllocation,
  campaignDispatchPlan,
  campaigns,
  creatives,
  eventAllocations,
  eventAttestations,
  events,
  screenhosts,
  users,
} from '../src/db/schema.js';
import { buildTestingReport } from '../src/lib/admin-testing-report.js';
import { spsObservationsInRange } from '../src/lib/sps-observations.js';
import { computeSps } from '../src/lib/sps-score.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// ADM-OBS2 (Mejri 19/09, ruling R10) — on the admin « Tests » page the four SPS EVIDENCE counts
// follow the Du/Au période instead of the score's trailing windows. The SCORE does not move: it
// keeps its fixed windows (that is what dispatch reads), so computeSps is asserted next to the
// range counts on the very same rows.

/** A Tunis wall-clock instant (UTC+1, no DST since 2008). */
const tunis = (local: string): Date => new Date(`${local}+01:00`);

// A Tunis WEDNESDAY noon: the week runs Mon 14 → Sun 20 June 2027.
const NOW = tunis('2027-06-16T12:00:00');
const FROM = '2027-06-01';
const TO = '2027-06-10';

let seq = 0;
const seedUser = async (values: Partial<NewUser> = {}): Promise<string> => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `sps-range-${seq}@example.com`,
      contactName: `SPS Range ${seq}`,
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

const seedVenue = async (): Promise<string> => {
  seq += 1;
  const [sh] = await db
    .insert(screenhosts)
    .values({
      name: `Range Venue ${seq}`,
      ownerId: await seedUser({ role: 'individual_owner' }),
      openingHour: 8,
      closingHour: 22,
    })
    .returning();
  return sh?.id ?? '';
};

/** An advertiser's creative + a campaign (standard, or event-bound when `eventId` is given). */
const seedCampaign = async (eventId?: string): Promise<string> => {
  const advertiserId = await seedUser({ role: 'advertiser' });
  const [creative] = await db
    .insert(creatives)
    .values({
      advertiserId,
      creativeType: 'video',
      storageKey: `creatives/sps-range/${seq}`,
      durationSeconds: 10,
      validationStatus: 'approved',
    })
    .returning();
  const [c] = await db
    .insert(campaigns)
    .values({
      advertiserId,
      name: `Range campagne ${seq}`,
      campaignType: eventId ? 'event' : 'standard',
      status: 'active',
      startDate: FROM,
      endDate: TO,
      requestedBudget: '300',
      creativeId: creative?.id ?? null,
      ...(eventId ? { eventId } : {}),
    })
    .returning();
  return c?.id ?? '';
};

/** A standard campaign's frozen plan, S = 10 s. */
const seedPlan = async (): Promise<string> => {
  const [plan] = await db
    .insert(campaignDispatchPlan)
    .values({
      campaignId: await seedCampaign(),
      iCible: 20000,
      cpm: '15.000',
      sSpotSeconds: 10,
      tTierCoef: '0.600',
      seuilDiffusable: 1000,
      sMin: '100',
      gJour: '3.3333',
      fMaxSeconds: 300,
      rMinEfficace: 2,
      couvert: 20000,
      nMin: 1,
      nMax: 5,
      nRetenus: 1,
    })
    .returning();
  return plan?.id ?? '';
};

const seedAllocation = async (
  shId: string,
  statut: 'EN_ATTENTE' | 'ACCEPTE' | 'REFUSE',
  createdAt: Date,
  creneaux: DispatchCreneau[] = [],
): Promise<void> => {
  await db.insert(campaignDispatchAllocation).values({
    planId: await seedPlan(),
    screenhostId: shId,
    iiPotentiel: 1000,
    rI: 30,
    revenuPrevisionnel: '15.0000',
    statutAcceptation: statut,
    creneaux,
    createdAt,
  });
};

const seedEvent = async (): Promise<string> => {
  seq += 1;
  const [row] = await db
    .insert(events)
    .values({
      name: `Range Match ${seq}`,
      type: 'sport',
      kickoffAt: tunis('2027-06-07T20:00:00'),
      endsAt: tunis('2027-06-07T22:00:00'),
      source: 'official',
    })
    .returning();
  return row?.id ?? '';
};

const seedEventAllocation = async (
  eventId: string,
  shId: string,
  statut: 'EN_ATTENTE' | 'ACCEPTE' | 'REFUSE',
  createdAt: Date,
): Promise<void> => {
  await db.insert(eventAllocations).values({
    campaignId: await seedCampaign(eventId),
    screenhostId: shId,
    blocs: [],
    impressionsTotal: 0,
    montantTnd: '0.000',
    statut,
    createdAt,
  });
};

const seedAttestation = async (eventId: string, shId: string, createdAt: Date): Promise<void> => {
  await db.insert(eventAttestations).values({
    eventId,
    screenhostId: shId,
    authorId: await seedUser({ role: 'admin' }),
    respecte: true,
    createdAt,
  });
};

const cren = (date: string, hour: number, reps: number): DispatchCreneau => ({
  date,
  hour,
  reps,
  impressions: 100 * reps,
});

describe('ADM-OBS2 R10 — spsObservationsInRange: the SPS evidence over a période (real Postgres)', () => {
  beforeEach(async () => {
    await resetAuthTables();
  });

  afterAll(async () => {
    await sql.end();
  });

  it('counts only what falls in [from, to] — Tunis days, both ends inclusive — while the score keeps its windows', async () => {
    const venue = await seedVenue();
    const other = await seedVenue();

    // ACCEPTE, created 01/06 00:30 Tunis = 31/05 23:30 UTC: IN by the Tunis day, not the UTC one.
    // Its créneaux: two inside the période (300 s + 60 s), one on each side outside it.
    await seedAllocation(venue, 'ACCEPTE', tunis('2027-06-01T00:30:00'), [
      cren('2027-05-31', 10, 30),
      cren('2027-06-02', 10, 30),
      cren('2027-06-10', 20, 6),
      cren('2027-06-11', 10, 30),
    ]);
    // A refusal inside the période is a decision; its créneau is not air time (not ACCEPTE).
    await seedAllocation(venue, 'REFUSE', tunis('2027-06-05T12:00:00'), [
      cren('2027-06-03', 9, 30),
    ]);
    // Pending: no decision, no air time.
    await seedAllocation(venue, 'EN_ATTENTE', tunis('2027-06-06T12:00:00'), [
      cren('2027-06-04', 9, 30),
    ]);
    // Created 11/06 00:30 Tunis = 10/06 23:30 UTC: OUT by the Tunis day, though the UTC day is in.
    await seedAllocation(venue, 'REFUSE', tunis('2027-06-11T00:30:00'));
    // Another venue's decisions and air time never count here.
    await seedAllocation(other, 'REFUSE', tunis('2027-06-05T12:00:00'));
    await seedAllocation(other, 'ACCEPTE', tunis('2027-06-05T12:00:00'), [
      cren('2027-06-05', 10, 30),
    ]);

    // EV4 — an event decision is a decision; a pending one is not.
    const ev1 = await seedEvent();
    const ev2 = await seedEvent();
    await seedEventAllocation(ev1, venue, 'ACCEPTE', tunis('2027-06-07T10:00:00'));
    await seedEventAllocation(ev2, venue, 'EN_ATTENTE', tunis('2027-06-07T10:00:00'));
    // Attestations anchor on created_at, as the respect window does: one in, one after « Au ».
    await seedAttestation(ev1, venue, tunis('2027-06-03T18:00:00'));
    await seedAttestation(ev2, venue, tunis('2027-06-12T09:00:00'));
    await seedAttestation(ev1, other, tunis('2027-06-03T18:00:00'));

    const inRange = await spsObservationsInRange(venue, FROM, TO, NOW);
    expect(inRange).toEqual({
      decided: 3, // the 01/06 acceptance, the 05/06 refusal, the event acceptance
      attested: 1,
      scheduledElapsed: 2, // 02/06 10h and 10/06 20h
      engagedSeconds: 360, // 30 × 10 s + 6 × 10 s
    });

    // R9 — the score's evidence keeps its trailing windows on the same rows: 90 d of decisions
    // (the 11/06 refusal is in) and attestations, 30 d of elapsed créneaux, the CURRENT week's
    // air time (none — every créneau is before Monday 14/06).
    const live = await computeSps(venue, NOW);
    expect(live.observations).toEqual({
      decided: 4,
      attested: 2,
      scheduledElapsed: 4,
      engagedSeconds: 0,
    });

    // The Tests report carries both: `observations` (drives « calculable ? ») and the période's.
    const report = await buildTestingReport({ id: venue, from: FROM, to: TO, now: NOW });
    expect(report?.sps.observations).toEqual(live.observations);
    expect(report?.sps.observations_period).toEqual(inRange);
    expect(report?.sps.live).toBe(live.sps);
  });

  it('a période reaching past « now »: every créneau reserves air time, only the elapsed ones have passed', async () => {
    const venue = await seedVenue();
    // Created before the période: not a decision of it.
    await seedAllocation(venue, 'ACCEPTE', tunis('2027-06-14T10:00:00'), [
      cren('2027-06-16', 11, 30), // elapsed at 12:00
      cren('2027-06-16', 12, 30), // the hour in progress is NOT elapsed
      cren('2027-06-18', 10, 30), // future
      cren('2027-06-21', 10, 30), // after « Au »
    ]);

    expect(await spsObservationsInRange(venue, '2027-06-15', '2027-06-20', NOW)).toEqual({
      decided: 0,
      attested: 0,
      scheduledElapsed: 1,
      engagedSeconds: 900,
    });
  });

  it('a venue with nothing in the période reads zero everywhere', async () => {
    const venue = await seedVenue();
    await seedAllocation(venue, 'ACCEPTE', tunis('2027-05-20T10:00:00'), [
      cren('2027-05-20', 10, 30),
    ]);
    expect(await spsObservationsInRange(venue, FROM, TO, NOW)).toEqual({
      decided: 0,
      attested: 0,
      scheduledElapsed: 0,
      engagedSeconds: 0,
    });
  });
});
