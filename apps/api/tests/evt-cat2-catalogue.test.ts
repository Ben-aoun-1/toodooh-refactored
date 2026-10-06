import { eq, inArray, or } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import { type NewUser, campaigns, eventMatches, events, teams, users } from '../src/db/schema.js';
import { adminEventsRoutes } from '../src/routes/admin-events.js';
import { adminTeamsRoutes } from '../src/routes/admin-teams.js';
import { eventsRoutes } from '../src/routes/events.js';
import { storage } from '../src/storage/s3-storage.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// EVT-CAT2 (operator rulings 2026-10-06) — the new « Événements » catalogue:
//  - admins manage TEAMS (name, national/club, #RRGGBB colours, OPTIONAL logo) and give an event
//    its card facts + matches (one, or three for a « Soirée Ligue des champions »);
//  - the advertiser catalogue carries them, and `positionable`;
//  - B1: a match whose date or time is « à confirmer » is listed but NOT positionable;
//  - « Je me positionne sur ces N événements » creates N drafts in one transaction, or none.

type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;
const mockSession = (userId: string, role: string): void => {
  vi.spyOn(auth.api, 'getSession').mockResolvedValue({
    session: {},
    user: { id: userId, role, status: 'approved' },
  } as unknown as GetSessionResult);
};

let seq = 0;
const tag = () => `${Date.now().toString(36)}-${(seq += 1)}`;
const seedUser = async (values: Partial<NewUser> = {}): Promise<string> => {
  const [u] = await db
    .insert(users)
    .values({
      email: `cat2-${tag()}@example.com`,
      contactName: 'CAT2',
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

const KICKOFF = '2027-03-10T20:00:00+01:00';
const ENDS = '2027-03-10T22:00:00+01:00';
// The smallest valid PNG (1×1): its bytes sniff as png.
const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da6364f8cf00000301010096a9a76d0000000049454e44ae426082',
  'hex',
);

describe('EVT-CAT2 — teams, matches and the new catalogue (real Postgres)', () => {
  let app: ReturnType<typeof Fastify>;
  let adminId: string;
  let advId: string;
  const createdTeams: string[] = [];

  beforeEach(async () => {
    await resetAuthTables();
    app = Fastify({ logger: false });
    await app.register(eventsRoutes);
    await app.register(adminEventsRoutes);
    await app.register(adminTeamsRoutes);
    await app.ready();
    adminId = await seedUser({ role: 'admin' });
    advId = await seedUser({ role: 'advertiser' });
    vi.spyOn(storage, 'upload').mockResolvedValue({ key: 'stub' } as never);
    vi.spyOn(storage, 'getPresignedUrl').mockImplementation(async ({ key }) => ({
      url: `https://cdn.test/${key}`,
    }));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await app.close();
    // teams are not under the auth reset: drop what this test created.
    if (createdTeams.length > 0) {
      const ids = createdTeams.splice(0);
      await db
        .delete(eventMatches)
        .where(or(inArray(eventMatches.homeTeamId, ids), inArray(eventMatches.awayTeamId, ids)));
      await db.delete(teams).where(inArray(teams.id, ids));
    }
  });

  afterAll(async () => {
    await sql.end();
  });

  const as = (role: 'admin' | 'advertiser') => {
    vi.mocked(auth.api.getSession).mockReset?.();
    mockSession(role === 'admin' ? adminId : advId, role);
  };

  const createTeam = async (payload: Record<string, unknown>) => {
    as('admin');
    const res = await app.inject({ method: 'POST', url: '/api/admin/teams', payload });
    if (res.statusCode === 201) createdTeams.push((res.json() as { id: string }).id);
    return res;
  };

  describe('teams (admin)', () => {
    it('creates, refuses a duplicate name and a bad colour, edits, uploads an optional logo', async () => {
      const name = `Tunisie ${tag()}`;
      const res = await createTeam({
        name,
        is_national: true,
        color_main: '#e70013',
        color_second: '#FFFFFF',
      });
      expect(res.statusCode).toBe(201);
      const team = res.json() as { id: string; color_main: string; logo_url: string | null };
      expect(team.color_main).toBe('#E70013');
      expect(team.logo_url).toBeNull(); // logos are optional

      expect((await createTeam({ name: name.toUpperCase() })).statusCode).toBe(409);
      expect((await createTeam({ name: `X ${tag()}`, color_main: 'red' })).statusCode).toBe(400);

      as('admin');
      const patched = await app.inject({
        method: 'PATCH',
        url: `/api/admin/teams/${team.id}`,
        payload: { color_crowd: '#239E46' },
      });
      expect(patched.json()).toMatchObject({ color_crowd: '#239E46' });

      const boundary = '----cat2logo';
      const body = Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="t.png"\r\nContent-Type: image/png\r\n\r\n`,
        ),
        PNG,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);
      const logo = await app.inject({
        method: 'POST',
        url: `/api/admin/teams/${team.id}/logo`,
        headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
        payload: body,
      });
      expect(logo.statusCode).toBe(200);
      expect((logo.json() as { logo_url: string }).logo_url).toMatch(
        /^https:\/\/cdn\.test\/teams\//,
      );
    });

    it('is admin-only', async () => {
      as('advertiser');
      expect((await app.inject({ method: 'GET', url: '/api/admin/teams' })).statusCode).toBe(403);
    });
  });

  describe('events with matches → the advertiser catalogue', () => {
    it('carries the card facts, the matches (unknown opponent = null) and positionable', async () => {
      const home = (
        await createTeam({ name: `Espérance ${tag()}`, color_main: '#C8001E' })
      ).json() as {
        id: string;
      };
      const away = (await createTeam({ name: `Club Africain ${tag()}` })).json() as { id: string };

      as('admin');
      const created = await app.inject({
        method: 'POST',
        url: '/api/admin/events',
        payload: {
          name: 'Club Africain - Espérance',
          kickoff_at: KICKOFF,
          ends_at: ENDS,
          competition: 'Ligue 1 tunisienne',
          round: 'Ligue 1 tunisienne, 8ème journée',
          stadium: 'Stade Hamadi-Agrebi, Radès',
          featured: 'pinned',
          matches: [{ home_team_id: away.id, away_team_id: home.id }],
        },
      });
      expect(created.statusCode).toBe(201);
      const tbc = await app.inject({
        method: 'POST',
        url: '/api/admin/events',
        payload: {
          name: 'Espérance - (tirage)',
          kickoff_at: KICKOFF,
          ends_at: ENDS,
          time_tbc: true,
          qualification_pending: true,
          date_label: 'Entre le 27 et le 29 novembre 2026',
          matches: [{ home_team_id: home.id, away_team_id: null }],
        },
      });
      expect(tbc.statusCode).toBe(201);
      const unknownTeam = await app.inject({
        method: 'POST',
        url: '/api/admin/events',
        payload: {
          name: 'X',
          kickoff_at: KICKOFF,
          ends_at: ENDS,
          matches: [{ home_team_id: '00000000-0000-0000-0000-000000000000', away_team_id: null }],
        },
      });
      expect(unknownTeam.statusCode).toBe(400);

      as('advertiser');
      const list = (await app.inject({ method: 'GET', url: '/api/events' })).json() as {
        events: Record<string, unknown>[];
      };
      const derby = list.events.find((e) => e['name'] === 'Club Africain - Espérance');
      expect(derby).toMatchObject({
        competition: 'Ligue 1 tunisienne',
        stadium: 'Stade Hamadi-Agrebi, Radès',
        featured: 'pinned',
        positionable: true,
      });
      expect((derby?.['matches'] as { home: { name: string } }[])[0]?.home.name).toMatch(
        /^Club Africain/,
      );
      const pending = list.events.find((e) => e['name'] === 'Espérance - (tirage)');
      expect(pending).toMatchObject({
        time_tbc: true,
        qualification_pending: true,
        date_label: 'Entre le 27 et le 29 novembre 2026',
        positionable: false,
      });
      expect((pending?.['matches'] as { away: unknown }[])[0]?.away).toBeNull();

      // A team in a match cannot be deleted.
      as('admin');
      const del = await app.inject({ method: 'DELETE', url: `/api/admin/teams/${home.id}` });
      expect(del.statusCode).toBe(409);
      // Editing the matches is a replace-set ([] clears).
      const derbyId = (created.json() as { id: string }).id;
      const cleared = await app.inject({
        method: 'PATCH',
        url: `/api/admin/events/${derbyId}`,
        payload: { matches: [], featured: null },
      });
      expect(cleared.json()).toMatchObject({ matches: [], featured: null });
    });
  });

  describe('positioning — B1 and the multi-match selection', () => {
    const seedEvent = async (over: Partial<typeof events.$inferInsert> = {}) => {
      const [row] = await db
        .insert(events)
        .values({
          name: `Match ${tag()}`,
          type: 'sport',
          kickoffAt: new Date(KICKOFF),
          endsAt: new Date(ENDS),
          source: 'official',
          ...over,
        })
        .returning();
      return row?.id ?? '';
    };

    it('a match « à confirmer » refuses the single positionner (EVENT_NOT_CONFIRMED)', async () => {
      const id = await seedEvent({ dateTbc: true });
      as('advertiser');
      const res = await app.inject({ method: 'POST', url: `/api/events/${id}/positionner` });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ error: 'EVENT_NOT_CONFIRMED' });
    });

    it('positionner-multiple creates one draft per match, or NONE when one is not positionable', async () => {
      const a = await seedEvent();
      const b = await seedEvent();
      const tbc = await seedEvent({ timeTbc: true });
      as('advertiser');

      const refused = await app.inject({
        method: 'POST',
        url: '/api/events/positionner-multiple',
        payload: { event_ids: [a, tbc] },
      });
      expect(refused.statusCode).toBe(409);
      expect(refused.json()).toMatchObject({ error: 'EVENT_NOT_CONFIRMED', event_id: tbc });
      expect(
        await db.select().from(campaigns).where(eq(campaigns.advertiserId, advId)),
      ).toHaveLength(0);

      const ok = await app.inject({
        method: 'POST',
        url: '/api/events/positionner-multiple',
        payload: { event_ids: [a, b, a] },
      });
      expect(ok.statusCode).toBe(201);
      const made = (ok.json() as { positionings: { id: string; event_id: string }[] }).positionings;
      expect(made.map((p) => p.event_id)).toEqual([a, b]);
      const rows = await db.select().from(campaigns).where(eq(campaigns.advertiserId, advId));
      expect(rows).toHaveLength(2);
      for (const r of rows) {
        expect(r).toMatchObject({ campaignType: 'event', status: 'draft' });
        expect([a, b]).toContain(r.eventId);
      }

      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/events/positionner-multiple',
            payload: { event_ids: [] },
          })
        ).statusCode,
      ).toBe(400);
    });
  });
});
