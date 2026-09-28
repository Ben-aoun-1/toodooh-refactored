import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import {
  type NewUser,
  campaigns,
  creatives,
  eventAllocations,
  events,
  screenhosts,
  screens,
  users,
} from '../src/db/schema.js';
import { fenetreDiffusion } from '../src/lib/fenetre-diffusion.js';
import { computeScreenPlaylist } from '../src/lib/playout/playlist-service.js';
import { screenRegistry } from '../src/lib/playout/registry.js';
import { screenhostsRoutes } from '../src/routes/screenhosts.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// FRESH-1 — the event half of playlist freshness (emulator run 2026-09-28):
//   • an event entry carries valid_until = the END of the bloc airing now, so a TV restarting
//     offline on its persisted playlist stops the spot when the bloc ends (it aired a cancelled
//     event's spot until it reconnected);
//   • the owner's ACCEPTE on an event allocation re-pushes the venue's playlist, like the classic
//     accept (CF-HF4) — an accept made mid-bloc otherwise waited for the next bloc edge.
//
// Clock: the event is placed RELATIVE to the real instant — kickoff = now + 50 min puts the first
// pre-match bloc at [now − 10 min, now + 10 min).

vi.mock('../src/lib/wedooh-sync.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/wedooh-sync.js')>();
  return { ...actual, pushApprovedOwnerLocations: vi.fn(() => Promise.resolve()) };
});

type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;
const mockSession = (userId: string): void => {
  vi.spyOn(auth.api, 'getSession').mockResolvedValue({
    session: {},
    user: { id: userId, role: 'individual_owner', status: 'approved' },
  } as unknown as GetSessionResult);
};

const MIN = 60_000;

let seq = 0;
const seedUser = async (values: Partial<NewUser> = {}): Promise<string> => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `fresh1-${seq}@example.com`,
      contactName: `FRESH1 User ${seq}`,
      role: 'advertiser',
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

interface Chain {
  ownerId: string;
  screenId: string;
  screenhostId: string;
  positioningId: string;
  allocationId: string;
  currentBlocEnd: Date;
}

const seedChain = async (statut: 'EN_ATTENTE' | 'ACCEPTE'): Promise<Chain> => {
  const now = Date.now();
  const kickoff = new Date(now + 50 * MIN);
  const ends = new Date(kickoff.getTime() + 120 * MIN);
  const grid = fenetreDiffusion(kickoff, ends);
  const current = grid.blocs.find((b) => b.start.getTime() <= now && now < b.end.getTime());
  if (!current) throw new Error('fixture: no bloc covers now');

  const ownerId = await seedUser({ role: 'individual_owner' });
  const [venue] = await db
    .insert(screenhosts)
    .values({ name: `FRESH1 Venue ${seq}`, ownerId, openingHour: 0, closingHour: 23 })
    .returning();
  const [screen] = await db
    .insert(screens)
    .values({ screenhostId: venue?.id ?? '', name: 'TV', pairedAt: new Date('2024-01-01') })
    .returning();
  const advertiserId = await seedUser();
  const [creative] = await db
    .insert(creatives)
    .values({
      advertiserId,
      creativeType: 'video',
      storageKey: `creatives/fresh1/${seq}`,
      durationSeconds: 15,
      validationStatus: 'approved',
    })
    .returning();
  const [event] = await db
    .insert(events)
    .values({
      name: `FRESH1 Match ${seq}`,
      type: 'sport',
      kickoffAt: kickoff,
      endsAt: ends,
      source: 'official',
    })
    .returning();
  const day = kickoff.toISOString().slice(0, 10);
  const [positioning] = await db
    .insert(campaigns)
    .values({
      advertiserId,
      name: `FRESH1 Positionnement ${seq}`,
      campaignType: 'event',
      status: 'active',
      startDate: day,
      endDate: day,
      requestedBudget: '300.00',
      eventId: event?.id,
      creativeId: creative?.id,
    })
    .returning();
  const [allocation] = await db
    .insert(eventAllocations)
    .values({
      campaignId: positioning?.id ?? '',
      screenhostId: venue?.id ?? '',
      blocs: grid.blocs.map((b) => ({
        start: b.start.toISOString(),
        end: b.end.toISOString(),
        impressions: 2000,
      })),
      impressionsTotal: grid.blocs.length * 2000,
      montantTnd: '300.000',
      statut,
      ...(statut === 'ACCEPTE' ? { decidedAt: new Date() } : {}),
    })
    .returning();

  return {
    ownerId,
    screenId: screen?.id ?? '',
    screenhostId: venue?.id ?? '',
    positioningId: positioning?.id ?? '',
    allocationId: allocation?.id ?? '',
    currentBlocEnd: current.end,
  };
};

describe('FRESH-1 — event playlist freshness (real Postgres)', () => {
  beforeEach(async () => {
    await resetAuthTables();
  });
  afterAll(async () => {
    await sql.end();
  });

  it('an airing event entry expires at the end of the bloc covering now', async () => {
    const chain = await seedChain('ACCEPTE');
    const playlist = await computeScreenPlaylist(chain.screenhostId, new Date());
    const entry = playlist.videos.find((v) => v.id === chain.positioningId);
    expect(entry).toBeDefined();
    expect(entry?.valid_until).toBe(chain.currentBlocEnd.toISOString());
  });

  it('accepting an event allocation mid-bloc pushes the spot to the venue screens at once', async () => {
    const app = Fastify({ logger: false });
    await app.register(screenhostsRoutes);
    await app.ready();
    const chain = await seedChain('EN_ATTENTE');
    const socket = { send: vi.fn() };
    screenRegistry.add(chain.screenId, socket as never);
    try {
      mockSession(chain.ownerId);
      const res = await app.inject({
        method: 'POST',
        url: `/api/screenhosts/event-allocations/${chain.allocationId}/accept`,
      });
      expect(res.statusCode).toBe(200);
      const [row] = await db
        .select({ statut: eventAllocations.statut })
        .from(eventAllocations)
        .where(eq(eventAllocations.id, chain.allocationId));
      expect(row?.statut).toBe('ACCEPTE');

      expect(socket.send).toHaveBeenCalledTimes(1);
      const sent = JSON.parse(socket.send.mock.calls[0]?.[0] as string) as {
        cmd: string;
        data: { videos: { id: string }[] };
      };
      expect(sent.cmd).toBe('UPDATE_PLAYLIST');
      expect(sent.data.videos.map((v) => v.id)).toContain(chain.positioningId);
    } finally {
      screenRegistry.remove(chain.screenId, socket as never);
      await app.close();
      vi.restoreAllMocks();
    }
  });

  it('a refusal pushes nothing (the venue plays what it played)', async () => {
    const app = Fastify({ logger: false });
    await app.register(screenhostsRoutes);
    await app.ready();
    const chain = await seedChain('EN_ATTENTE');
    const socket = { send: vi.fn() };
    screenRegistry.add(chain.screenId, socket as never);
    try {
      mockSession(chain.ownerId);
      const res = await app.inject({
        method: 'POST',
        url: `/api/screenhosts/event-allocations/${chain.allocationId}/refuse`,
      });
      expect(res.statusCode).toBe(200);
      expect(socket.send).not.toHaveBeenCalled();
    } finally {
      screenRegistry.remove(chain.screenId, socket as never);
      await app.close();
      vi.restoreAllMocks();
    }
  });
});
