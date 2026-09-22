import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import {
  type NewUser,
  businessSectors,
  campaignTargeting,
  campaigns,
  creatives,
  events,
  screenhostAffluence,
  screenhosts,
  users,
} from '../src/db/schema.js';
import { getDispatchConfig } from '../src/lib/dispatch/config.js';
import { adminCampaignsRoutes } from '../src/routes/admin-campaigns.js';

import { bothHalves, resetAuthTables } from './helpers/db-test-setup.js';
import { seedInstalledScreen } from './helpers/installed-screen.js';

// ELIG-1 — « Consultation des Hosts éligibles » for a campaign AT ANY STATUS (Meriam 15/09,
// blocking for testing). The report must be the engine's own answer: the eligible list is the
// real pool assembly, the exclusion reasons are the ones the pool emits for its journal.
// Dates are a FIXED Monday/Tuesday pair and every venue carries Mon+Tue affluence — nothing here
// depends on the day the suite runs (see tests-green-because-of-when).

type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;
const mockSession = (userId: string, role = 'admin'): void => {
  vi.spyOn(auth.api, 'getSession').mockResolvedValue({
    session: {},
    user: { id: userId, role, status: 'approved' },
  } as unknown as GetSessionResult);
};

interface Report {
  kind: 'standard' | 'event';
  campaign: { id: string; status: string };
  window: { start: string; end: string } | null;
  spot_seconds: number;
  spot_source: 'creative' | 'default';
  cpm_tnd: number;
  eligible: {
    id: string;
    name: string;
    class: string | null;
    sps: number;
    affluence: number;
    hours: number;
    capacity: number;
    days_available: number | null;
    allocation: unknown;
  }[];
  excluded: { id: string; name: string; reason: string }[];
  totals: { eligible: number; excluded: number; capacity: number; c_max_tnd: number };
}

let seq = 0;
const seedUser = async (values: Partial<NewUser> = {}): Promise<string> => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `elig${seq}@example.com`,
      contactName: `U ${seq}`,
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

const ownerSector = async (): Promise<{ id: string; eventEligible: boolean }> => {
  const [s] = await db
    .select({ id: businessSectors.id, eventEligible: businessSectors.eventEligible })
    .from(businessSectors)
    .where(eq(businessSectors.audience, 'owner'))
    .limit(1);
  return { id: s?.id ?? '', eventEligible: s?.eventEligible ?? false };
};

const seedVenue = async (opts: {
  name: string;
  ownerId: string;
  sectorId: string;
  cls: 'populaire' | 'moyen' | 'premium';
  hours?: [number, number] | null;
  capacity?: number | null;
  active?: boolean;
  endHour?: number;
}): Promise<string> => {
  const hours = opts.hours === undefined ? ([8, 23] as [number, number]) : opts.hours;
  const [sh] = await db
    .insert(screenhosts)
    .values({
      name: opts.name,
      ownerId: opts.ownerId,
      businessSectorId: opts.sectorId,
      class: opts.cls,
      openingHour: hours ? hours[0] : null,
      closingHour: hours ? hours[1] : null,
      broadcastCapacity: opts.capacity === undefined ? 4 : opts.capacity,
      isActive: opts.active ?? true,
      sps: '70',
    })
    .returning();
  const id = sh?.id ?? '';
  const rows = [];
  for (const dow of [1, 2, 3, 4, 5, 6, 7])
    for (let h = 8; h < 23; h += 1)
      rows.push({ screenhostId: id, dayOfWeek: dow, hour: h, estimatedImpressions: 100 });
  await db.insert(screenhostAffluence).values(bothHalves(rows));
  await seedInstalledScreen(id);
  return id;
};

const seedCampaign = async (
  advertiserId: string,
  opts: {
    start?: string | null;
    end?: string | null;
    status?: string;
    creativeSeconds?: number;
  } = {},
): Promise<string> => {
  let creativeId: string | null = null;
  if (opts.creativeSeconds) {
    const [cr] = await db
      .insert(creatives)
      .values({
        advertiserId,
        storageKey: `test/elig-${seq}.mp4`,
        durationSeconds: opts.creativeSeconds,
        validationStatus: 'approved',
      })
      .returning();
    creativeId = cr?.id ?? null;
  }
  const [c] = await db
    .insert(campaigns)
    .values({
      advertiserId,
      name: 'Éligibilité',
      campaignType: 'standard',
      status: (opts.status ?? 'draft') as never,
      startDate: opts.start === undefined ? '2024-01-01' : opts.start, // Monday
      endDate: opts.end === undefined ? '2024-01-02' : opts.end, // Tuesday
      creativeId,
    })
    .returning();
  return c?.id ?? '';
};

const buildApp = () => Fastify({ logger: false });

describe('ELIG-1 — GET /api/admin/campaigns/:id/eligible-hosts (real Postgres)', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    await resetAuthTables();
    app = buildApp();
    await app.register(adminCampaignsRoutes);
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    await sql.end();
  });

  const get = (id: string) =>
    app.inject({ method: 'GET', url: `/api/admin/campaigns/${id}/eligible-hosts` });

  it('a DRAFT lists the venues the real pool keeps and names why each other venue is out', async () => {
    const admin = await seedUser({ role: 'admin' });
    const advertiser = await seedUser({ role: 'advertiser' });
    const owner = await seedUser({ role: 'individual_owner' });
    const { id: sector } = await ownerSector();
    const campaignId = await seedCampaign(advertiser, { creativeSeconds: 15 });
    await db.insert(campaignTargeting).values({ campaignId, categoryId: null, class: 'premium' });

    const inPool = await seedVenue({
      name: 'A — premium ouvert',
      ownerId: owner,
      sectorId: sector,
      cls: 'premium',
    });
    const wrongClass = await seedVenue({
      name: 'B — populaire',
      ownerId: owner,
      sectorId: sector,
      cls: 'populaire',
    });
    const noHours = await seedVenue({
      name: 'C — sans horaires',
      ownerId: owner,
      sectorId: sector,
      cls: 'premium',
      hours: null,
    });
    // CAP-EVT1 (operator ruling 2026-09-22) — the capacity is the EVENT switch only: a standard
    // campaign reaches a venue without one.
    const noCapacity = await seedVenue({
      name: 'D — sans capacité',
      ownerId: owner,
      sectorId: sector,
      cls: 'premium',
      capacity: null,
    });
    const inactive = await seedVenue({
      name: 'E — inactif',
      ownerId: owner,
      sectorId: sector,
      cls: 'premium',
      active: false,
    });

    mockSession(admin);
    const res = await get(campaignId);
    expect(res.statusCode).toBe(200);
    const report = res.json<Report>();

    expect(report.kind).toBe('standard');
    expect(report.campaign).toMatchObject({ id: campaignId, status: 'draft' });
    expect(report.window).toEqual({ start: '2024-01-01', end: '2024-01-02' });
    expect(report.spot_seconds).toBe(15);
    expect(report.spot_source).toBe('creative');

    expect(report.eligible.map((v) => v.id)).toEqual([inPool, noCapacity]); // sorted by name
    const a = report.eligible[0]!;
    expect(a.class).toBe('premium');
    expect(a.affluence).toBe(100);
    expect(a.hours).toBeGreaterThan(0);
    expect(a.capacity).toBeGreaterThan(0);
    expect(a.days_available).toBe(2);
    expect(a.allocation).toBeNull();

    const reasonOf = new Map(report.excluded.map((e) => [e.id, e.reason]));
    expect(reasonOf.get(wrongClass)).toBe('targeting_mismatch');
    expect(reasonOf.get(noHours)).toBe('hours_missing');
    expect(reasonOf.has(noCapacity)).toBe(false);
    expect(reasonOf.get(inactive)).toBe('inactive');

    // the ceiling is the real C_max formula over the pool's capacity (two identical venues)
    const d = report.eligible[1]!;
    expect(d.capacity).toBe(a.capacity);
    const cfg = await getDispatchConfig();
    expect(report.totals.eligible).toBe(2);
    expect(report.totals.excluded).toBe(3);
    expect(report.totals.capacity).toBe(a.capacity + d.capacity);
    expect(report.totals.c_max_tnd).toBe(
      Math.floor((cfg.standardCpmTnd * (a.capacity + d.capacity)) / 1000),
    );
    expect(report.cpm_tnd).toBe(cfg.standardCpmTnd);
  });

  it('works whatever the status (en attente, à venir) and prices a creative-less draft at the default spot', async () => {
    const admin = await seedUser({ role: 'admin' });
    const advertiser = await seedUser({ role: 'advertiser' });
    const owner = await seedUser({ role: 'individual_owner' });
    const { id: sector } = await ownerSector();
    await seedVenue({ name: 'Seul', ownerId: owner, sectorId: sector, cls: 'moyen' });

    mockSession(admin);
    for (const status of ['draft', 'pending', 'upcoming']) {
      const id = await seedCampaign(advertiser, { status });
      const report = (await get(id)).json<Report>();
      expect(report.campaign.status).toBe(status);
      // no targeting line = the whole network
      expect(report.eligible).toHaveLength(1);
      expect(report.spot_seconds).toBe(10);
      expect(report.spot_source).toBe('default');
    }
  });

  it('a draft without dates answers 409 NO_DATES; an unknown id 404; a bad id 400', async () => {
    const admin = await seedUser({ role: 'admin' });
    const advertiser = await seedUser({ role: 'advertiser' });
    const undated = await seedCampaign(advertiser, { start: null, end: null });
    mockSession(admin);
    const noDates = await get(undated);
    expect(noDates.statusCode).toBe(409);
    expect(noDates.json()).toMatchObject({ error: 'NO_DATES' });
    expect((await get('00000000-0000-4000-8000-0000000000ab')).statusCode).toBe(404);
    expect((await get('not-a-uuid')).statusCode).toBe(400);
  });

  it('is admin-only', async () => {
    const advertiser = await seedUser({ role: 'advertiser' });
    const id = await seedCampaign(advertiser);
    mockSession(advertiser, 'advertiser');
    expect((await get(id)).statusCode).toBe(403);
  });

  it('an EVENT positioning answers from the event ceiling (A_max × blocs), not from the dispatch pool', async () => {
    const admin = await seedUser({ role: 'admin' });
    const advertiser = await seedUser({ role: 'advertiser' });
    const owner = await seedUser({ role: 'individual_owner' });
    const sector = await ownerSector();
    const open = await seedVenue({
      name: 'Bar du soir',
      ownerId: owner,
      sectorId: sector.id,
      cls: 'premium',
    });
    const closedAtNight = await seedVenue({
      name: 'Fermé le soir',
      ownerId: owner,
      sectorId: sector.id,
      cls: 'premium',
      hours: [8, 12],
    });
    const [event] = await db
      .insert(events)
      .values({
        name: 'Match ELIG',
        type: 'sport',
        source: 'official',
        kickoffAt: new Date('2027-06-10T20:00:00+01:00'),
        endsAt: new Date('2027-06-10T22:00:00+01:00'),
      })
      .returning();
    const [positioning] = await db
      .insert(campaigns)
      .values({
        advertiserId: advertiser,
        name: 'Positionnement ELIG',
        campaignType: 'event',
        status: 'draft',
        startDate: '2027-06-10',
        endDate: '2027-06-10',
        eventId: event?.id ?? null,
      })
      .returning();

    mockSession(admin);
    const report = (await get(positioning?.id ?? '')).json<Report>();
    expect(report.kind).toBe('event');
    const reasonOf = new Map(report.excluded.map((e) => [e.id, e.reason]));
    if (sector.eventEligible) {
      expect(report.eligible.map((v) => v.id)).toEqual([open]);
      expect(report.eligible[0]!.hours).toBeGreaterThan(0); // available blocs
      expect(reasonOf.get(closedAtNight)).toBe('no_bloc_available');
      expect(report.totals.c_max_tnd).toBeGreaterThan(0);
    } else {
      expect(report.eligible).toHaveLength(0);
      expect(reasonOf.get(open)).toBe('not_event_eligible');
    }
    expect(report.cpm_tnd).toBe((await getDispatchConfig()).eventCpmTnd);
  });
});
