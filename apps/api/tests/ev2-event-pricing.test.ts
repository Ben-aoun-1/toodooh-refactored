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
  events,
  hourReservations,
  screenhostAffluence,
  screenhostAmax,
  screenhostUnavailability,
  screenhosts,
  users,
} from '../src/db/schema.js';
import {
  AMAX_FALLBACK_PPH,
  REPS_PER_BLOC,
  blocAvailability,
  blocCells,
  computeAmax,
  computeEventCmax,
} from '../src/lib/event-pricing/pricing.js';
import { EVENT_SPOT_MAX_SECONDS, validateEventSpot } from '../src/lib/event-pricing/spot.js';
import { adminEventsRoutes } from '../src/routes/admin-events.js';
import { eventsRoutes } from '../src/routes/events.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// EV2 — the EVENT pricing engine (its own module, D51): the A_max ratchet, the per-bloc D1
// availability (full-bloc-only, per-Tunis-date, E2 + foreign reservations), the I_max/C_max
// arithmetic WITHOUT the attention coefficient, the CPM_evt 30 → 15 config move, the two
// endpoints, the 15 s spot seam, and the module-boundary pin. The CAMPAIGN engine is
// byte-untouched by this lane. No business_sectors/zones rows added (the fixture footgun —
// sector flags are UPDATEd and restored, never inserted).

type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;
const mockSession = (userId: string, role: string): void => {
  vi.spyOn(auth.api, 'getSession').mockResolvedValue({
    session: {},
    user: { id: userId, role, status: 'approved' },
  } as unknown as GetSessionResult);
};

let seq = 0;
const seedUser = async (values: Partial<NewUser> = {}): Promise<string> => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `ev2-${seq}@example.com`,
      contactName: `EV2 User ${seq}`,
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

const ownerSectors = async (): Promise<string[]> => {
  const rows = await db
    .select({ id: businessSectors.id })
    .from(businessSectors)
    .where(eq(businessSectors.audience, 'owner'));
  return rows.map((r) => r.id);
};

/** A venue open [opening, closing); affluence rows optional. */
const seedVenue = async (opts: {
  sector: string;
  opening?: number;
  closing?: number;
  affluence?: number[];
}): Promise<string> => {
  const ownerId = await seedUser({ role: 'individual_owner' });
  seq += 1;
  const [sh] = await db
    .insert(screenhosts)
    .values({
      name: `EV2 Venue ${seq}`,
      ownerId,
      businessSectorId: opts.sector,
      class: 'premium' as never,
      sps: '80',
      openingHour: opts.opening ?? 8,
      closingHour: opts.closing ?? 23,
      broadcastCapacity: 4,
    })
    .returning();
  const shId = sh?.id ?? '';
  if (opts.affluence?.length) {
    await db.insert(screenhostAffluence).values(
      opts.affluence.map((v, i) => ({
        screenhostId: shId,
        dayOfWeek: 1 + (i % 7),
        hour: 8 + Math.floor(i / 7),
        estimatedImpressions: v,
      })),
    );
  }
  return shId;
};

// A Tunis-evening fixture: kickoff 20:00, ends 22:00 → pre blocs 19:00–20:00 (h19), post blocs
// 22:00–23:00 (h22), all on the SAME Tunis date.
const KICKOFF = new Date('2027-06-10T20:00:00+01:00');
const ENDS = new Date('2027-06-10T22:00:00+01:00');
const MATCH_DATE = '2027-06-10';

const seedEvent = async (over: Partial<typeof events.$inferInsert> = {}): Promise<string> => {
  seq += 1;
  const [row] = await db
    .insert(events)
    .values({
      name: `EV2 Match ${seq}`,
      type: 'sport',
      kickoffAt: KICKOFF,
      endsAt: ENDS,
      source: 'official',
      ...over,
    })
    .returning();
  return row?.id ?? '';
};

const buildApp = () => Fastify({ logger: false });

describe('EV2 — the event pricing engine (real Postgres)', () => {
  beforeEach(async () => {
    await resetAuthTables();
  });

  afterAll(async () => {
    await sql.end();
  });

  describe('computeAmax — the ratchet', () => {
    it('picks the grid max and PERSISTS it', async () => {
      const [sector] = await ownerSectors();
      const shId = await seedVenue({ sector: sector ?? '', affluence: [80, 120, 95] });
      expect(await computeAmax(shId)).toBe(120);
      const [row] = await db
        .select()
        .from(screenhostAmax)
        .where(eq(screenhostAmax.screenhostId, shId));
      expect(row?.amaxPph).toBe(120);
    });

    it('NEVER decreases when the grid shrinks; grows when the grid grows', async () => {
      const [sector] = await ownerSectors();
      const shId = await seedVenue({ sector: sector ?? '', affluence: [80, 120] });
      await computeAmax(shId); // ratchets to 120
      await db
        .delete(screenhostAffluence)
        .where(
          and(
            eq(screenhostAffluence.screenhostId, shId),
            eq(screenhostAffluence.estimatedImpressions, 120),
          ),
        );
      expect(await computeAmax(shId)).toBe(120); // history survives the shrink
      await db
        .insert(screenhostAffluence)
        .values({ screenhostId: shId, dayOfWeek: 7, hour: 22, estimatedImpressions: 150 });
      expect(await computeAmax(shId)).toBe(150); // growth persists
      const [row] = await db
        .select()
        .from(screenhostAmax)
        .where(eq(screenhostAmax.screenhostId, shId));
      expect(row?.amaxPph).toBe(150);
    });

    it('falls back to 50 pers/h UNPERSISTED when nothing is known', async () => {
      const [sector] = await ownerSectors();
      const shId = await seedVenue({ sector: sector ?? '' });
      expect(await computeAmax(shId)).toBe(AMAX_FALLBACK_PPH);
      const rows = await db
        .select()
        .from(screenhostAmax)
        .where(eq(screenhostAmax.screenhostId, shId));
      expect(rows).toHaveLength(0); // the fallback is priced, never stored
    });
  });

  describe('blocAvailability — D1, per bloc on its own Tunis date', () => {
    const noCtx = { unavailableDates: new Set<string>(), foreignReservedCells: new Set<string>() };
    const eventRef = { id: 'e', kickoffAt: KICKOFF, endsAt: ENDS };

    it('a fully-open venue offers all six blocs', () => {
      expect(blocAvailability(eventRef, { id: 'v', openingHour: 8, closingHour: 23 }, noCtx)).toBe(
        6,
      );
    });

    it('FULL-bloc-only: a bloc straddling a closed hour is OUT', () => {
      // Kickoff 20:30 → pre blocs 19:30/19:50/20:10; venue opens at 20: the 19:30 bloc is out,
      // the 19:50–20:10 bloc touches hour 19 AND 20 → OUT (half-outside), 20:10–20:30 is in.
      const ref = {
        id: 'e',
        kickoffAt: new Date('2027-06-10T20:30:00+01:00'),
        endsAt: new Date('2027-06-10T22:00:00+01:00'),
      };
      expect(blocAvailability(ref, { id: 'v', openingHour: 20, closingHour: 23 }, noCtx)).toBe(4);
    });

    it('a late kickoff crosses midnight: the post blocs live on the NEXT Tunis date (E2 sees it)', () => {
      const ref = {
        id: 'e',
        kickoffAt: new Date('2027-06-10T23:40:00+01:00'),
        endsAt: new Date('2027-06-11T00:40:00+01:00'),
      };
      const venue = { id: 'v', openingHour: 0, closingHour: 8 };
      // Pre blocs (22:40–23:40, hours 22/23) are outside [0, 8) — only the three post blocs
      // (00:40–01:40 on 2027-06-11) are available.
      expect(blocAvailability(ref, venue, noCtx)).toBe(3);
      const cells = blocCells(
        new Date('2027-06-10T23:50:00+01:00'),
        new Date('2027-06-11T00:10:00+01:00'),
      );
      expect(cells).toEqual([
        { date: '2027-06-10', hour: 23 },
        { date: '2027-06-11', hour: 0 },
      ]);
      // Declaring the NEXT date unavailable kills the post blocs → zero.
      expect(
        blocAvailability(ref, venue, {
          unavailableDates: new Set(['2027-06-11']),
          foreignReservedCells: new Set(),
        }),
      ).toBe(0);
    });

    it('an E2-declared match date leaves zero blocs', () => {
      expect(
        blocAvailability(
          eventRef,
          { id: 'v', openingHour: 8, closingHour: 23 },
          { unavailableDates: new Set([MATCH_DATE]), foreignReservedCells: new Set() },
        ),
      ).toBe(0);
    });

    it('a foreign reservation blocks exactly the blocs touching that hour', () => {
      // Hour 22 reserved → the three post blocs die, the three pre blocs (h19) survive.
      expect(
        blocAvailability(
          eventRef,
          { id: 'v', openingHour: 8, closingHour: 23 },
          {
            unavailableDates: new Set(),
            foreignReservedCells: new Set([`${MATCH_DATE}:22`]),
          },
        ),
      ).toBe(3);
    });

    it('unset opening hours mean zero blocs', () => {
      expect(
        blocAvailability(eventRef, { id: 'v', openingHour: null, closingHour: null }, noCtx),
      ).toBe(0);
    });
  });

  describe('computeEventCmax — the worked example (NO attention coefficient)', () => {
    it('2 venues: A_max 120 × 6 blocs + fallback 50 × 6 blocs at CPM 15 → C_max 306', async () => {
      const sectors = await ownerSectors();
      const venueA = await seedVenue({ sector: sectors[0] ?? '', affluence: [80, 120, 95] });
      const venueB = await seedVenue({ sector: sectors[1] ?? sectors[0] ?? '' }); // no grid → 50
      const eventId = await seedEvent();

      const result = await computeEventCmax({ id: eventId, kickoffAt: KICKOFF, endsAt: ENDS }, 15);
      expect(result.eligibleCount).toBe(2);
      const a = result.venues.find((v) => v.screenhostId === venueA);
      const b = result.venues.find((v) => v.screenhostId === venueB);
      // facturable = brut: A_max × 20 reps × blocs — no T anywhere.
      expect(REPS_PER_BLOC).toBe(20);
      expect(a?.impressions).toBe(120 * 20 * 6); // 14 400
      expect(b?.amaxPph).toBe(AMAX_FALLBACK_PPH);
      expect(b?.impressions).toBe(50 * 20 * 6); // 6 000
      expect(result.iMax).toBe(20_400);
      expect(result.cMaxEvtTnd).toBe(306); // ⌊15 × 20 400 / 1000⌋
    });

    it('an event-INELIGIBLE sector excludes its venues (restored after)', async () => {
      const sectors = await ownerSectors();
      const sectorA = sectors[0] ?? '';
      const sectorB = sectors[1] ?? '';
      await seedVenue({ sector: sectorA, affluence: [100] });
      await seedVenue({ sector: sectorB, affluence: [100] });
      const eventId = await seedEvent();
      try {
        await db
          .update(businessSectors)
          .set({ eventEligible: false })
          .where(eq(businessSectors.id, sectorB));
        const result = await computeEventCmax(
          { id: eventId, kickoffAt: KICKOFF, endsAt: ENDS },
          15,
        );
        expect(result.eligibleCount).toBe(1);
      } finally {
        await db
          .update(businessSectors)
          .set({ eventEligible: true })
          .where(eq(businessSectors.id, sectorB));
      }
    });

    it("the event's OWN reservation never blocks it; another event's does", async () => {
      const sectors = await ownerSectors();
      const shId = await seedVenue({ sector: sectors[0] ?? '', affluence: [100] });
      const eventId = await seedEvent();
      const otherId = await seedEvent({ name: 'EV2 Other Match' });

      await db
        .insert(hourReservations)
        .values({ screenhostId: shId, day: MATCH_DATE, hour: 22, eventId });
      let result = await computeEventCmax({ id: eventId, kickoffAt: KICKOFF, endsAt: ENDS }, 15);
      expect(result.venues[0]?.blocsDisponibles).toBe(6); // our own hold is not a rival

      await db
        .insert(hourReservations)
        .values({ screenhostId: shId, day: MATCH_DATE, hour: 19, eventId: otherId });
      result = await computeEventCmax({ id: eventId, kickoffAt: KICKOFF, endsAt: ENDS }, 15);
      expect(result.venues[0]?.blocsDisponibles).toBe(3); // the rival's hour kills its blocs
    });

    it('an E2 declaration on the match date drops the venue entirely', async () => {
      const sectors = await ownerSectors();
      const shId = await seedVenue({ sector: sectors[0] ?? '', affluence: [100] });
      await db.insert(screenhostUnavailability).values({ screenhostId: shId, day: MATCH_DATE });
      const eventId = await seedEvent();
      const result = await computeEventCmax({ id: eventId, kickoffAt: KICKOFF, endsAt: ENDS }, 15);
      expect(result.eligibleCount).toBe(0);
      expect(result.cMaxEvtTnd).toBe(0);
    });
  });

  describe('the endpoints', () => {
    let app: ReturnType<typeof buildApp>;
    let savedCpm: string | undefined;

    beforeEach(async () => {
      // The endpoints price off the LIVE dispatch_config singleton, which other suites mutate
      // and restore to THEIR fixture (still the pre-move 30). Pin the post-0056 state for these
      // assertions and put back whatever was there — order-independence, not a value claim.
      const rows = await sql`select event_cpm_tnd from dispatch_config`;
      savedCpm = rows[0]?.['event_cpm_tnd'] as string | undefined;
      if (savedCpm !== undefined) await sql`update dispatch_config set event_cpm_tnd = '15.000'`;
      app = buildApp();
      await app.register(eventsRoutes);
      await app.register(adminEventsRoutes);
      await app.ready();
    });

    afterEach(async () => {
      if (savedCpm !== undefined) await sql`update dispatch_config set event_cpm_tnd = ${savedCpm}`;
    });

    it('GET /api/events/:id/cmax — the campaign-cmax idiom + the shared 100 TND floor', async () => {
      const sectors = await ownerSectors();
      await seedVenue({ sector: sectors[0] ?? '', affluence: [120] });
      const eventId = await seedEvent();
      const advId = await seedUser({ role: 'advertiser' });
      mockSession(advId, 'advertiser');

      const res = await app.inject({ method: 'GET', url: `/api/events/${eventId}/cmax` });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.c_max_evt_tnd).toBe(Math.floor((15 * 120 * 20 * 6) / 1000)); // 216
      expect(body.i_max).toBe(14_400);
      expect(body.eligible_count).toBe(1);
      expect(body.min_budget_tnd).toBe(100);

      const missing = await app.inject({
        method: 'GET',
        url: '/api/events/00000000-0000-0000-0000-000000000000/cmax',
      });
      expect(missing.statusCode).toBe(404);

      const annuleId = await seedEvent({ annule: true });
      const annule = await app.inject({ method: 'GET', url: `/api/events/${annuleId}/cmax` });
      expect(annule.statusCode).toBe(409);
      expect(annule.json().error).toBe('EVENT_ANNULE');
      await app.close();
      vi.restoreAllMocks();
    });

    it('GET /api/admin/events/:id/tarification — per-venue detail, admin-gated', async () => {
      const sectors = await ownerSectors();
      const shId = await seedVenue({ sector: sectors[0] ?? '', affluence: [120] });
      const eventId = await seedEvent();
      const adminId = await seedUser({ role: 'admin' });
      const advId = await seedUser({ role: 'advertiser' });

      mockSession(advId, 'advertiser');
      const forbidden = await app.inject({
        method: 'GET',
        url: `/api/admin/events/${eventId}/tarification`,
      });
      expect(forbidden.statusCode).toBe(403);
      expect(forbidden.json().message).toBe('Accès administrateur requis.');
      vi.restoreAllMocks();

      mockSession(adminId, 'admin');
      const res = await app.inject({
        method: 'GET',
        url: `/api/admin/events/${eventId}/tarification`,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.cpm_evt_tnd).toBe(15);
      expect(body.min_budget_tnd).toBe(100);
      expect(body.venues).toEqual([
        {
          screenhost_id: shId,
          name: expect.stringContaining('EV2 Venue'),
          amax_pph: 120,
          blocs_disponibles: 6,
          impressions: 14_400,
        },
      ]);
      await app.close();
      vi.restoreAllMocks();
    });
  });

  describe('the CPM_evt 30 → 15 config move (migration 0056)', () => {
    it('the migration moves the old default and spares a deliberate value', async () => {
      const migration = readFileSync(
        fileURLToPath(new URL('../drizzle/0056_event_pricing_amax.sql', import.meta.url)),
        'utf8',
      );
      expect(migration).toContain(`ALTER COLUMN "event_cpm_tnd" SET DEFAULT '15.000'`);
      expect(migration).toContain(
        `UPDATE "dispatch_config" SET "event_cpm_tnd" = '15.000' WHERE "event_cpm_tnd" = '30.000'`,
      );
      // Live replay of the move against a deliberate 22: it stays 22; a stale 30 moves to 15.
      const before = await sql`select event_cpm_tnd from dispatch_config`;
      try {
        await sql`update dispatch_config set event_cpm_tnd = '22.000'`;
        await sql`UPDATE "dispatch_config" SET "event_cpm_tnd" = '15.000' WHERE "event_cpm_tnd" = '30.000'`;
        const kept = await sql`select event_cpm_tnd from dispatch_config`;
        expect(kept[0]?.['event_cpm_tnd']).toBe('22.000');
        await sql`update dispatch_config set event_cpm_tnd = '30.000'`;
        await sql`UPDATE "dispatch_config" SET "event_cpm_tnd" = '15.000' WHERE "event_cpm_tnd" = '30.000'`;
        const moved = await sql`select event_cpm_tnd from dispatch_config`;
        expect(moved[0]?.['event_cpm_tnd']).toBe('15.000');
      } finally {
        const restore = before[0]?.['event_cpm_tnd'] as string | undefined;
        if (restore !== undefined) await sql`update dispatch_config set event_cpm_tnd = ${restore}`;
      }
    });
  });

  describe('the 15 s event-spot seam (exported, unwired — EV3 wires it)', () => {
    it('a video over 15 s is refused in French; 15 s passes; photos always pass', () => {
      expect(EVENT_SPOT_MAX_SECONDS).toBe(15);
      expect(validateEventSpot({ creativeType: 'video', durationSeconds: 15 })).toEqual({
        ok: true,
      });
      const long = validateEventSpot({ creativeType: 'video', durationSeconds: 16 });
      expect(long.ok).toBe(false);
      if (!long.ok) expect(long.reason).toContain('15 secondes');
      const unknown = validateEventSpot({ creativeType: 'video', durationSeconds: null });
      expect(unknown.ok).toBe(false);
      expect(validateEventSpot({ creativeType: 'photo', durationSeconds: 30 })).toEqual({
        ok: true,
      });
    });
  });
});

describe('D51 — the module boundary (the event engine imports NO campaign engine)', () => {
  it('event-pricing sources never import lib/dispatch or campaign libs (the E7 rail idiom)', () => {
    for (const rel of ['../src/lib/event-pricing/pricing.ts', '../src/lib/event-pricing/spot.ts']) {
      const source = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
      expect(source, `${rel} crosses the D51 boundary`).not.toMatch(/from '.*dispatch/);
      expect(source, `${rel} crosses the D51 boundary`).not.toMatch(/from '.*campaign/i);
    }
  });
});
