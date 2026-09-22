import { asc, eq } from 'drizzle-orm';
import Fastify from 'fastify';
import postgres from 'postgres';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { db, sql } from '../src/db/client.js';
import { deviceSessions, screenhosts, screens, users } from '../src/db/schema.js';
import { env } from '../src/env.js';
import { hashDeviceToken, newTokenPair } from '../src/lib/device-tokens.js';
import { updateScreenDeclaration } from '../src/lib/screens.js';
import { screensRoutes } from '../src/routes/screens.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// SCR-DECL1 review: lowering the declared count racing a TV pairing (real Postgres, a SECOND
// connection `side` that holds row locks). Q2 says lowering deletes only never-installed rows.
// The edit locks the screenhost row, but pairing writes `screens` alone, so the edit must lock the
// venue's screens rows too:
//   (a) a pairing in flight when the edit starts: the edit waits for it, sees the paired_at, and
//       keeps that row (it deletes a never-installed one instead);
//   (b) a pairing whose SELECT ran before the rows were deleted: its UPDATE waits on the lock and
//       then matches nothing, so the TV gets a 404, never « paired » for an id that is gone.

const buildApp = () => Fastify({ logger: false });

let seq = 0;
const seedVenueWithRows = async (n: number) => {
  seq += 1;
  const [owner] = await db
    .insert(users)
    .values({
      email: `race${seq}@example.com`,
      contactName: `Owner ${seq}`,
      role: 'individual_owner',
      status: 'approved',
    })
    .returning({ id: users.id });
  const ownerId = owner?.id ?? '';
  const [venue] = await db
    .insert(screenhosts)
    .values({ name: 'Café Course', city: 'Tunis', ownerId, screenCount: n })
    .returning({ id: screenhosts.id });
  const venueId = venue?.id ?? '';
  const ids: Record<string, string> = {};
  for (let i = 1; i <= n; i += 1) {
    const [row] = await db
      .insert(screens)
      .values({ screenhostId: venueId, name: `Écran ${i}` })
      .returning({ id: screens.id });
    ids[`Écran ${i}`] = row?.id ?? '';
  }
  return { ownerId, venueId, ids };
};

const seedDeviceToken = async (userId: string): Promise<string> => {
  const pair = newTokenPair(new Date());
  await db.insert(deviceSessions).values({
    userId,
    accessTokenHash: hashDeviceToken(pair.accessToken),
    refreshTokenHash: hashDeviceToken(pair.refreshToken),
    accessExpiresAt: pair.accessExpiresAt,
    refreshExpiresAt: pair.refreshExpiresAt,
    deviceType: 'android-tv',
  });
  return pair.accessToken;
};

const rowsOf = (venueId: string) =>
  db
    .select({ name: screens.name, pairedAt: screens.pairedAt })
    .from(screens)
    .where(eq(screens.screenhostId, venueId))
    .orderBy(asc(screens.name));

/** Backends of THIS database blocked on a lock (row, tuple or transaction id). */
const waitForLockWaiters = async (n: number): Promise<boolean> => {
  const until = Date.now() + 5_000;
  while (Date.now() < until) {
    const [row] = await sql<{ n: number }[]>`
      select count(*)::int as n from pg_stat_activity
      where datname = current_database() and wait_event_type = 'Lock'`;
    if ((row?.n ?? 0) >= n) return true;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return false;
};

/** Holds `statements` open on the side connection until release() (afterEach releases it too). */
let openHold: (() => Promise<void>) | null = null;
const hold = async (
  side: postgres.Sql,
  statements: (tx: postgres.TransactionSql) => Promise<void>,
) => {
  let ready!: () => void;
  const readyP = new Promise<void>((resolve) => (ready = resolve));
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  const done = side.begin(async (tx) => {
    await statements(tx);
    ready();
    await released;
  });
  await readyP;
  const releaseOnce = async (): Promise<void> => {
    release();
    await done;
  };
  openHold = releaseOnce;
  return releaseOnce;
};

describe('SCR-DECL1 — lowering the count racing a TV pairing (real Postgres, two connections)', () => {
  const side = postgres(env.DATABASE_URL, { max: 1, onnotice: () => undefined });
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    await resetAuthTables();
    app = buildApp();
    await app.register(screensRoutes);
    await app.ready();
  });
  afterEach(async () => {
    await openHold?.();
    openHold = null;
    await app.close();
  });
  afterAll(async () => {
    await side.end();
    await sql.end();
  });

  it('(a) a pairing in flight is waited for: the paired row stays, a never-installed one goes', async () => {
    const { venueId, ids } = await seedVenueWithRows(3);
    // The TV pairs « Écran 3 », the row the edit would delete first, and has not committed yet.
    const release = await hold(side, async (tx) => {
      await tx`update screens set paired_at = now(), last_seen_at = now()
               where id = ${ids['Écran 3'] ?? ''}`;
    });

    const edit = updateScreenDeclaration(venueId, { screenCount: 2 }, 'admin');
    expect(await waitForLockWaiters(1)).toBe(true); // the edit waits on the pairing's row lock
    await release();

    const outcome = await edit;
    expect(outcome).toMatchObject({ kind: 'updated', view: { screen_count: 2, screens_count: 2 } });
    const rows = await rowsOf(venueId);
    expect(rows.map((r) => r.name)).toEqual(['Écran 1', 'Écran 3']);
    expect(rows.find((r) => r.name === 'Écran 3')?.pairedAt).not.toBeNull();
  }, 30_000);

  it('(a′) a pairing in flight on every spare row turns the lowering into a 409, nothing deleted', async () => {
    const { venueId, ids } = await seedVenueWithRows(2);
    const release = await hold(side, async (tx) => {
      await tx`update screens set paired_at = now()
               where id in (${ids['Écran 1'] ?? ''}, ${ids['Écran 2'] ?? ''})`;
    });

    const edit = updateScreenDeclaration(venueId, { screenCount: 1 }, 'admin');
    expect(await waitForLockWaiters(1)).toBe(true);
    await release();

    expect(await edit).toEqual({ kind: 'below_installed', installed: 2 });
    expect((await rowsOf(venueId)).map((r) => r.name)).toEqual(['Écran 1', 'Écran 2']);
  }, 30_000);

  it('(b) a pairing that loses the race gets a 404, and the deleted row is not re-created', async () => {
    const { ownerId, venueId, ids } = await seedVenueWithRows(2);
    const token = await seedDeviceToken(ownerId);
    // The lowering's DELETE, holding the row lock and not committed yet: the pair route's SELECT
    // still sees « Écran 2 », its UPDATE waits on the lock.
    const release = await hold(side, async (tx) => {
      await tx`delete from screens where id = ${ids['Écran 2'] ?? ''}`;
    });

    const pairing = app.inject({
      method: 'POST',
      url: `/api/screens/${ids['Écran 2'] ?? ''}/pair`,
      headers: { authorization: `Bearer ${token}` },
      payload: { latitude: 36.8, longitude: 10.18 },
    });
    expect(await waitForLockWaiters(1)).toBe(true);
    await release();

    const res = await pairing;
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'NOT_FOUND', message: 'No such screen.' });
    expect((await rowsOf(venueId)).map((r) => r.name)).toEqual(['Écran 1']);
    // No GPS link either: the pairing never happened.
    const [venue] = await db
      .select({ latitude: screenhosts.latitude })
      .from(screenhosts)
      .where(eq(screenhosts.id, venueId));
    expect(venue?.latitude).toBeNull();
  }, 30_000);
});
