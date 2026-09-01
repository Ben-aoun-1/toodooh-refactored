import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { eq } from 'drizzle-orm';
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
  screenhosts,
  users,
} from '../src/db/schema.js';
import { assemblePool } from '../src/lib/dispatch/pool.js';
import { adminEventsRoutes } from '../src/routes/admin-events.js';
import { eventsRoutes } from '../src/routes/events.js';

import { resetAuthTables, bothHalves } from './helpers/db-test-setup.js';

// EV1 — the event entity + catalogue + suggestions + the slots_evt seam (real Postgres):
//  - admin CRUD per the §10 field set (type LOCKED sport; the removed legacy fields do not
//    exist as columns; NO stored window column — the fenêtre is always derived);
//  - the suggest matrix (each field required, « A – B » naming, +2 h end, the shared list,
//    duplicate 409 either team order, never in the official catalogue);
//  - the INERT seam pin: with hour_reservations empty the pool is byte-identical before/after,
//    and ONE synthetic reservation row shrinks exactly one venue-hour of capacity.
// No business_sectors/zones rows added (the fixture footgun).

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
      email: `ev1-${seq}@example.com`,
      contactName: `EV1 User ${seq}`,
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

// Future instants (the catalogue filters live-or-future).
const KICKOFF = new Date('2027-03-10T20:00:00+01:00');
const ENDS = new Date('2027-03-10T22:00:00+01:00');

const seedOfficial = async (over: Partial<typeof events.$inferInsert> = {}): Promise<string> => {
  seq += 1;
  const [row] = await db
    .insert(events)
    .values({
      name: `Officiel ${seq}`,
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

describe('EV1 — events entity + catalogue + suggestions (real Postgres)', () => {
  let app: ReturnType<typeof buildApp>;
  let adminId: string;
  let advId: string;

  beforeEach(async () => {
    await resetAuthTables();
    app = buildApp();
    await app.register(eventsRoutes);
    await app.register(adminEventsRoutes);
    await app.ready();
    adminId = await seedUser({ role: 'admin' });
    advId = await seedUser({ role: 'advertiser' });
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await sql.end();
  });

  describe('the §10 schema pins', () => {
    it('the removed legacy fields do NOT exist as columns; NO window column is stored', async () => {
      const cols =
        await sql`select column_name from information_schema.columns where table_name = 'events'`;
      const names = cols.map((r) => (r as { column_name: string }).column_name);
      // The §10 kept set (+ the entity's own bookkeeping) and NOTHING legacy:
      for (const removed of [
        'expected_attendance',
        'target_audience',
        'priority_level',
        'pricing_multiplier',
        'is_active',
        'is_featured',
        'city',
        'location',
        'address',
        'latitude',
        'longitude',
        'banner_url',
        'image_url',
      ])
        expect(names).not.toContain(removed);
      // The window is ALWAYS derived — no stored window/bloc column of any spelling:
      expect(names.some((n) => /window|fenetre|bloc/.test(n))).toBe(false);
    });
  });

  describe('admin CRUD (§10 field set)', () => {
    it('create matrix: name/kickoff_at/ends_at each required (French 400), type locked sport', async () => {
      mockSession(adminId, 'admin');
      const post = (payload: Record<string, unknown>) =>
        app.inject({ method: 'POST', url: '/api/admin/events', payload });

      const noName = await post({ kickoff_at: KICKOFF.toISOString(), ends_at: ENDS.toISOString() });
      expect(noName.statusCode).toBe(400);
      expect(noName.json().fields[0].field).toBe('name');

      const noKick = await post({ name: 'Tunisie – Brésil', ends_at: ENDS.toISOString() });
      expect(noKick.statusCode).toBe(400);
      expect(noKick.json().fields[0].field).toBe('kickoff_at');

      const noEnd = await post({ name: 'Tunisie – Brésil', kickoff_at: KICKOFF.toISOString() });
      expect(noEnd.statusCode).toBe(400);
      expect(noEnd.json().fields[0].field).toBe('ends_at');

      const inverted = await post({
        name: 'Tunisie – Brésil',
        kickoff_at: ENDS.toISOString(),
        ends_at: KICKOFF.toISOString(),
      });
      expect(inverted.statusCode).toBe(400);
      expect(inverted.json().fields[0].reason).toBe('La fin doit être postérieure au début.');

      const wrongType = await post({
        name: 'Concert X',
        type: 'concert',
        kickoff_at: KICKOFF.toISOString(),
        ends_at: ENDS.toISOString(),
      });
      expect(wrongType.statusCode).toBe(400);
      expect(wrongType.json().fields[0].reason).toBe('Le type est verrouillé sur « Sport ».');

      const ok = await post({
        name: 'Tunisie – Brésil',
        description: 'Match amical',
        category: 'Phase de groupes',
        kickoff_at: KICKOFF.toISOString(),
        ends_at: ENDS.toISOString(),
      });
      expect(ok.statusCode).toBe(201);
      const body = ok.json();
      expect(body.type).toBe('sport');
      expect(body.source).toBe('official');
      expect(body.category).toBe('Phase de groupes');
      expect(body.statut).toBe('a_venir');
      // The derived window rides the view:
      expect(body.fenetre.blocs).toHaveLength(6);
      expect(new Date(body.fenetre.window_start).getTime()).toBe(KICKOFF.getTime() - 3_600_000);
    });

    it('editing dates re-derives the window on read (nothing stored to recompute)', async () => {
      mockSession(adminId, 'admin');
      const id = await seedOfficial();
      const newKick = new Date('2027-03-11T18:00:00+01:00');
      const newEnd = new Date('2027-03-11T20:10:00+01:00');
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/admin/events/${id}`,
        payload: { kickoff_at: newKick.toISOString(), ends_at: newEnd.toISOString() },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(new Date(body.fenetre.window_start).getTime()).toBe(newKick.getTime() - 3_600_000);
      expect(new Date(body.fenetre.window_end).getTime()).toBe(newEnd.getTime() + 3_600_000);
    });

    it('a suggested match is not editable (409) but IS annulable; double annuler 409', async () => {
      mockSession(adminId, 'admin');
      const sid = await seedOfficial({ source: 'suggested', name: 'EST – CA', suggestedBy: advId });
      const patch = await app.inject({
        method: 'PATCH',
        url: `/api/admin/events/${sid}`,
        payload: { name: 'Autre' },
      });
      expect(patch.statusCode).toBe(409);
      expect(patch.json().message).toContain('suggéré');

      const annuler = await app.inject({ method: 'POST', url: `/api/admin/events/${sid}/annuler` });
      expect(annuler.statusCode).toBe(200);
      expect(annuler.json().annule).toBe(true);
      const again = await app.inject({ method: 'POST', url: `/api/admin/events/${sid}/annuler` });
      expect(again.statusCode).toBe(409);
      expect(again.json().message).toBe('Événement déjà annulé.');
    });

    it('the admin list carries EVERYTHING (annulé + suggested, badged by source)', async () => {
      mockSession(adminId, 'admin');
      await seedOfficial({ name: 'Officiel A' });
      await seedOfficial({ name: 'Annulé B', annule: true });
      await seedOfficial({ name: 'EST – CA', source: 'suggested', suggestedBy: advId });
      const res = await app.inject({ method: 'GET', url: '/api/admin/events' });
      expect(res.statusCode).toBe(200);
      const list = res.json().events as { name: string; source: string; annule: boolean }[];
      expect(list).toHaveLength(3);
      expect(list.find((e) => e.name === 'Annulé B')?.annule).toBe(true);
      expect(list.find((e) => e.name === 'EST – CA')?.source).toBe('suggested');
    });

    it('admin routes refuse a non-admin with the French 403', async () => {
      mockSession(advId, 'advertiser');
      const res = await app.inject({ method: 'GET', url: '/api/admin/events' });
      expect(res.statusCode).toBe(403);
      expect(res.json().message).toBe('Accès administrateur requis.');
    });
  });

  describe('the advertiser catalogue', () => {
    it('lists official, not annulé, live-or-future — suggested and annulé NEVER appear', async () => {
      await seedOfficial({ name: 'Visible' });
      await seedOfficial({ name: 'Annulé', annule: true });
      await seedOfficial({ name: 'EST – CA', source: 'suggested', suggestedBy: advId });
      await seedOfficial({
        name: 'Passé',
        kickoffAt: new Date('2020-01-01T20:00:00+01:00'),
        endsAt: new Date('2020-01-01T22:00:00+01:00'),
      });
      mockSession(advId, 'advertiser');
      const res = await app.inject({ method: 'GET', url: '/api/events' });
      expect(res.statusCode).toBe(200);
      const names = (res.json().events as { name: string }[]).map((e) => e.name);
      expect(names).toEqual(['Visible']);
    });

    it('an en-cours event stays listed (live), with statut en_cours and its window', async () => {
      const now = Date.now();
      await seedOfficial({
        name: 'Live',
        kickoffAt: new Date(now - 30 * 60 * 1000),
        endsAt: new Date(now + 60 * 60 * 1000),
      });
      mockSession(advId, 'advertiser');
      const res = await app.inject({ method: 'GET', url: '/api/events' });
      const list = res.json().events as { name: string; statut: string }[];
      expect(list.find((e) => e.name === 'Live')?.statut).toBe('en_cours');
    });
  });

  describe('« Suggérer un match »', () => {
    const suggest = (payload: Record<string, unknown>) =>
      app.inject({ method: 'POST', url: '/api/events/suggest', payload });

    it('each of the four fields is required — a 400 names the missing field in French', async () => {
      mockSession(advId, 'advertiser');
      const base = { team_a: 'EST', team_b: 'CA', date: '2027-04-01', kickoff_time: '20:00' };
      for (const field of ['team_a', 'team_b', 'date', 'kickoff_time'] as const) {
        const payload: Record<string, unknown> = { ...base };
        delete payload[field];
        const res = await suggest(payload);
        expect(res.statusCode).toBe(400);
        expect(res.json().fields[0].field).toBe(field);
        expect(res.json().fields[0].reason).toMatch(/obligatoire/);
      }
      const badTime = await suggest({ ...base, kickoff_time: '26:99' });
      expect(badTime.statusCode).toBe(400);
      expect(badTime.json().fields[0].field).toBe('kickoff_time');
    });

    it('creates « A – B », ends kickoff + 2 h, source suggested, shared with EVERY advertiser, never official', async () => {
      mockSession(advId, 'advertiser');
      const res = await suggest({
        team_a: 'Espérance',
        team_b: 'Club Africain',
        date: '2027-04-01',
        kickoff_time: '20:00',
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.name).toBe('Espérance – Club Africain');
      expect(body.source).toBe('suggested');
      expect(new Date(body.ends_at).getTime() - new Date(body.kickoff_at).getTime()).toBe(
        2 * 60 * 60 * 1000,
      );
      expect(new Date(body.kickoff_at).toISOString()).toBe(
        new Date('2027-04-01T20:00:00+01:00').toISOString(),
      );

      // A SECOND advertiser sees it in the shared list…
      const otherAdv = await seedUser({ role: 'advertiser' });
      mockSession(otherAdv, 'advertiser');
      const shared = await app.inject({ method: 'GET', url: '/api/events/suggested' });
      expect((shared.json().events as { name: string }[]).map((e) => e.name)).toContain(
        'Espérance – Club Africain',
      );
      // …and NEVER in the official catalogue.
      const official = await app.inject({ method: 'GET', url: '/api/events' });
      expect((official.json().events as { name: string }[]).map((e) => e.name)).not.toContain(
        'Espérance – Club Africain',
      );
    });

    it('an EXACT duplicate (either team order, case-insensitive, same date) is a 409 with the pointer', async () => {
      mockSession(advId, 'advertiser');
      const first = await suggest({
        team_a: 'Espérance',
        team_b: 'Club Africain',
        date: '2027-04-01',
        kickoff_time: '20:00',
      });
      expect(first.statusCode).toBe(201);

      const sameOrder = await suggest({
        team_a: 'espérance',
        team_b: 'CLUB AFRICAIN',
        date: '2027-04-01',
        kickoff_time: '21:30',
      });
      expect(sameOrder.statusCode).toBe(409);
      expect(sameOrder.json().message).toContain('Ce que les screencasters suggèrent');

      const reversed = await suggest({
        team_a: 'Club Africain',
        team_b: 'Espérance',
        date: '2027-04-01',
        kickoff_time: '20:00',
      });
      expect(reversed.statusCode).toBe(409);

      // A DIFFERENT date is a different match — accepted.
      const otherDay = await suggest({
        team_a: 'Espérance',
        team_b: 'Club Africain',
        date: '2027-04-08',
        kickoff_time: '20:00',
      });
      expect(otherDay.statusCode).toBe(201);
    });

    it('an OFFICIAL twin refuses too (either order, same date) — one real-world match, ONE entity', async () => {
      // Ratification amendment: a suggestion shadowing an official match would mint two entities
      // for one fixture — an EV3/EV4 integrity trap. Official rows carry only `name`, so the
      // match is by composition.
      await seedOfficial({
        name: 'Tunisie – Brésil',
        kickoffAt: new Date('2027-04-01T20:00:00+01:00'),
        endsAt: new Date('2027-04-01T22:00:00+01:00'),
      });
      mockSession(advId, 'advertiser');

      const sameOrder = await suggest({
        team_a: 'tunisie',
        team_b: 'BRÉSIL',
        date: '2027-04-01',
        kickoff_time: '21:00',
      });
      expect(sameOrder.statusCode).toBe(409);
      expect(sameOrder.json().message).toBe('Ce match existe déjà dans le catalogue officiel.');

      const reversed = await suggest({
        team_a: 'Brésil',
        team_b: 'Tunisie',
        date: '2027-04-01',
        kickoff_time: '20:00',
      });
      expect(reversed.statusCode).toBe(409);
      expect(reversed.json().message).toBe('Ce match existe déjà dans le catalogue officiel.');

      // A different date is a different fixture — accepted (and lands in the SHARED list).
      const otherDay = await suggest({
        team_a: 'Tunisie',
        team_b: 'Brésil',
        date: '2027-04-15',
        kickoff_time: '20:00',
      });
      expect(otherDay.statusCode).toBe(201);
      expect(otherDay.json().source).toBe('suggested');
    });
  });

  describe('the slots_evt seam (hour_reservations → assemblePool)', () => {
    const MON = '2027-03-15';
    const TUE = '2027-03-16';

    const seedVenue = async (): Promise<string> => {
      const [s] = await db
        .select({ id: businessSectors.id })
        .from(businessSectors)
        .where(eq(businessSectors.audience, 'owner'))
        .limit(1);
      const ownerId = await seedUser({ role: 'individual_owner' });
      const [sh] = await db
        .insert(screenhosts)
        .values({
          name: 'EV1 Seam Venue',
          ownerId,
          businessSectorId: s?.id ?? '',
          class: 'premium' as never,
          sps: '80',
          openingHour: 8,
          closingHour: 18,
          broadcastCapacity: 4,
        })
        .returning();
      const shId = sh?.id ?? '';
      const rows = [];
      for (const dow of [1, 2])
        for (let h = 8; h < 18; h += 1)
          rows.push({ screenhostId: shId, dayOfWeek: dow, hour: h, estimatedImpressions: 100 });
      await db.insert(screenhostAffluence).values(bothHalves(rows));
      return shId;
    };

    it('EMPTY table → byte-identical pool; ONE row → exactly one venue-hour gone; delete → byte-identical again', async () => {
      const shId = await seedVenue();
      const campaignRef = {
        id: '00000000-0000-0000-0000-000000000000',
        startDate: MON,
        endDate: TUE,
      };
      const inputs = { s: 10, t: 0.6, fMaxSeconds: 300 };

      // Capture the PRE-change pool (the E2/LOG1 pin pattern — the reservation table is empty).
      const before = await assemblePool(db, campaignRef, inputs);
      const capture = JSON.stringify(before);
      const entryBefore = before.pool.find((p) => p.id === shId);
      // 2 days × 10 broadcastable hours, uniform Ai=100: Hi 20, capacity 100×20×30×0.6 = 36 000.
      expect(entryBefore?.hours).toBe(20);
      expect(entryBefore?.capaciteUtile).toBe(36_000);

      // A synthetic reservation on ONE venue-hour (MON 08:00) — the seam must subtract it.
      const [ev] = await db
        .insert(events)
        .values({ name: 'Seam Event', kickoffAt: KICKOFF, endsAt: ENDS, source: 'official' })
        .returning();
      await db.insert(hourReservations).values({
        screenhostId: shId,
        day: MON,
        hour: 8,
        eventId: ev?.id ?? '',
      });
      const during = await assemblePool(db, campaignRef, inputs);
      const entryDuring = during.pool.find((p) => p.id === shId);
      expect(entryDuring?.hours).toBe(19); // one cell out of Hi
      // Capacity shrinks by EXACTLY that hour's facturable worth: 100 × 30 reps × 0.6 = 1 800.
      expect(entryDuring?.capaciteUtile).toBe(34_200);
      // Créneau/day surfaces are untouched by EV1 (EV4 owns neutralization semantics):
      expect(entryDuring?.days).toEqual(entryBefore?.days);

      // Clean the seam → the pool must round-trip byte-identical to the capture.
      await db.delete(hourReservations).where(eq(hourReservations.screenhostId, shId));
      const after = await assemblePool(db, campaignRef, inputs);
      expect(JSON.stringify(after)).toBe(capture);
    });
  });
});

// The engine stays event-blind: the reservation subtraction in pool.ts must never mention events.
describe('the engine event-blindness pin', () => {
  it('pool.ts never branches on an event type — no `if événement` in the campaign engine', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../src/lib/dispatch/pool.ts', import.meta.url)),
      'utf8',
    );
    expect(source).toContain('hourReservations'); // the seam is real…
    expect(source).not.toMatch(/eventType|event_type|source === '|événement'/); // …and generic.
  });
});
