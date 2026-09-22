import { and, eq } from 'drizzle-orm';

import { db } from '../../src/db/client.js';
import {
  businessSectors,
  campaigns,
  events,
  screenhostAffluence,
  screenhosts,
} from '../../src/db/schema.js';

import { seedApprovedOwner } from './approved-owner.js';
import { bothHalves } from './db-test-setup.js';
import { seedInstalledScreen } from './installed-screen.js';

// MAP-TV1 (operator ruling 2026-09-21, M1 A · M2 A) — a venue is SELLABLE only with at least one
// INSTALLED screen (paired_at OR last_seen_at on any of its rows, lib/installed-screen.ts). Both
// MAP-TV1 suites pin every gated site on the same five venues, all passing every OTHER gate:
//   (a) no screens row at all                         → OUT
//   (b) rows that were never paired nor ever seen     → OUT
//   (c) one row paired, never seen                    → IN
//   (d) one row seen, never paired                    → IN
//   (e) one never-installed row + one paired row      → IN (« at least one »)
//
// Every date is FIXED and named: the standard window is Monday 2024-01-01 → Wednesday 2024-01-03,
// the match is Thursday 2027-06-10 at 20:00 Tunis. Nothing depends on the day the suite runs.

export const MONDAY = '2024-01-01';
export const TUESDAY = '2024-01-02';
export const WEDNESDAY = '2024-01-03';
export const MATCH_KICKOFF = new Date('2027-06-10T20:00:00+01:00'); // Thursday, Tunis
export const MATCH_ENDS = new Date('2027-06-10T22:00:00+01:00');
export const SEEN_AT = new Date('2026-07-30T10:00:00.000Z');

/** An owner-audience sector that is event-eligible (the seeded owner sectors are). */
export const eventSector = async (): Promise<string> => {
  const [s] = await db
    .select({ id: businessSectors.id })
    .from(businessSectors)
    .where(and(eq(businessSectors.audience, 'owner'), eq(businessSectors.eventEligible, true)))
    .limit(1);
  if (!s) throw new Error('no event-eligible owner sector seeded');
  return s.id;
};

/** A venue that passes every OTHER gate: active, approved owner, 8–23, capacity, located, 100/h. */
export const seedVenue = async (
  name: string,
  sectorId: string,
  ownerId?: string,
): Promise<string> => {
  const [sh] = await db
    .insert(screenhosts)
    .values({
      name,
      ownerId: ownerId ?? (await seedApprovedOwner()),
      businessSectorId: sectorId,
      class: 'premium',
      openingHour: 8,
      closingHour: 23,
      broadcastCapacity: 4,
      latitude: '36.80000000',
      longitude: '10.18000000',
      sps: '70',
    })
    .returning({ id: screenhosts.id });
  const id = sh?.id ?? '';
  const rows = [];
  for (const dow of [1, 2, 3, 4, 5, 6, 7])
    for (let h = 8; h < 23; h += 1)
      rows.push({ screenhostId: id, dayOfWeek: dow, hour: h, estimatedImpressions: 100 });
  await db.insert(screenhostAffluence).values(bothHalves(rows));
  return id;
};

/** A declared screen row that no device ever ran against. */
export const neverInstalled = { pairedAt: null, lastSeenAt: null } as const;

/** The five venues; `out` = (a)(b), `in` = (c)(d)(e), each sorted. */
export const seedMatrix = async (sectorId: string): Promise<{ out: string[]; in: string[] }> => {
  const noRows = await seedVenue('(a) sans écran', sectorId);
  const declaredOnly = await seedVenue('(b) écrans jamais installés', sectorId);
  await seedInstalledScreen(declaredOnly, { name: 'TV 1', ...neverInstalled });
  await seedInstalledScreen(declaredOnly, { name: 'TV 2', ...neverInstalled });
  const pairedOnly = await seedVenue('(c) appairé, jamais vu', sectorId);
  await seedInstalledScreen(pairedOnly, { lastSeenAt: null });
  const seenOnly = await seedVenue('(d) vu, jamais appairé', sectorId);
  await seedInstalledScreen(seenOnly, { pairedAt: null, lastSeenAt: SEEN_AT });
  const mixed = await seedVenue('(e) un écran sur deux installé', sectorId);
  await seedInstalledScreen(mixed, { name: 'TV déclarée', ...neverInstalled });
  await seedInstalledScreen(mixed, { name: 'TV appairée' });
  return { out: [noRows, declaredOnly].sort(), in: [pairedOnly, seenOnly, mixed].sort() };
};

/** A standard campaign, whole network (no targeting line, no zone), MONDAY → `endDate`. */
export const seedCampaign = async (
  advertiserId: string,
  opts: { endDate?: string; status?: 'draft' | 'upcoming' } = {},
) => {
  const endDate = opts.endDate ?? WEDNESDAY;
  const [c] = await db
    .insert(campaigns)
    .values({
      advertiserId,
      name: 'MAP-TV1',
      campaignType: 'standard',
      status: opts.status ?? 'draft',
      startDate: MONDAY,
      endDate,
    })
    .returning();
  if (!c) throw new Error('seedCampaign: no row');
  return { ...c, startDate: MONDAY, endDate };
};

const seedMatch = async (name: string) => {
  const [event] = await db
    .insert(events)
    .values({
      name,
      type: 'sport',
      source: 'official',
      kickoffAt: MATCH_KICKOFF,
      endsAt: MATCH_ENDS,
    })
    .returning({ id: events.id });
  if (!event) throw new Error('seedMatch: no row');
  return { id: event.id, kickoffAt: MATCH_KICKOFF, endsAt: MATCH_ENDS };
};

/** A match alone — what the event ceiling and the bloc pool read. */
export const eventRef = () => seedMatch('MAP-TV1 Match seul');

/** A match and an advertiser's draft positioning on it. */
export const seedPositioning = async (advertiserId: string) => {
  const event = await seedMatch('MAP-TV1 Match');
  const [positioning] = await db
    .insert(campaigns)
    .values({
      advertiserId,
      name: 'Positionnement MAP-TV1',
      campaignType: 'event',
      status: 'draft',
      startDate: '2027-06-10',
      endDate: '2027-06-10',
      eventId: event.id,
    })
    .returning({ id: campaigns.id });
  if (!positioning) throw new Error('seedPositioning: no row');
  return { positioningId: positioning.id, event };
};
