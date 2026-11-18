import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import { type NewUser, screenWsEvents, screenhosts, screens, users } from '../src/db/schema.js';
import {
  TV_APP_LATEST,
  healthIssues,
  readDeviceReport,
  sanitizeDeviceReport,
} from '../src/lib/fleet/health.js';
import { loadFleet, loadFleetScreen } from '../src/lib/fleet/load.js';
import { recordConnect, recordWsEvent } from '../src/lib/fleet/ws-events.js';
import { handleScreenEvent } from '../src/lib/playout/ingest.js';
import { screenRegistry } from '../src/lib/playout/registry.js';
import { adminFleetRoutes } from '../src/routes/admin-fleet.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// FLEET-2 — « Santé de la TV »: the TV's own report (whitelisted), its player state, its connection
// history and the admin's remote actions. Real Postgres.

const silentLog = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never;

const report = {
  app_version_name: '1.5.6',
  app_version_code: TV_APP_LATEST.versionCode,
  android_release: '11',
  android_sdk: 30,
  manufacturer: 'TCL',
  model: 'Smart TV Pro',
  overlay_granted: true,
  auto_start_allowed: false,
  start_reason: 'watchdog',
  service_started_at: Date.parse('2026-03-10T08:00:00Z'),
};

describe('FLEET-2 — device report rules (pure)', () => {
  it('whitelists, types and caps every field; drops anything else', () => {
    const r = sanitizeDeviceReport({
      ...report,
      model: 'x'.repeat(500),
      secret: 'nope',
      android_sdk: '30',
    });
    expect(r).toMatchObject({
      appVersionCode: 21,
      manufacturer: 'TCL',
      startReason: 'watchdog',
      androidSdk: null,
    });
    expect(r.model).toHaveLength(80);
    expect(r).not.toHaveProperty('secret');
    expect(r.serviceStartedAt).toBe('2026-03-10T08:00:00.000Z');
    expect(sanitizeDeviceReport({ start_reason: 'hack', overlay_granted: 'yes' })).toMatchObject({
      startReason: null,
      overlayGranted: null,
    });
    // Stored then read back, unchanged.
    expect(readDeviceReport({ ...r })).toEqual(r);
  });

  it('issues: overlay missing, auto-start blocked, outdated, unknown (an app older than 1.5.6)', () => {
    const ok = sanitizeDeviceReport({ ...report, auto_start_allowed: true });
    expect(healthIssues(ok)).toEqual([]);
    expect(healthIssues(sanitizeDeviceReport(report))).toEqual(['auto_start_blocked']);
    expect(
      healthIssues(
        sanitizeDeviceReport({ ...report, overlay_granted: false, app_version_code: 20 }),
      ),
    ).toEqual(['overlay_missing', 'auto_start_blocked', 'outdated']);
    expect(healthIssues(null)).toEqual(['unknown_version']);
    // Not readable (another brand): no auto-start warning.
    expect(healthIssues(sanitizeDeviceReport({ ...report, auto_start_allowed: null }))).toEqual([]);
  });
});

type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;
const mockSession = (userId: string, role = 'admin'): void => {
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
      email: `fh-${seq}@example.com`,
      contactName: `FH ${seq}`,
      role: 'admin',
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

describe('FLEET-2 — reports, history and remote actions (real Postgres)', () => {
  beforeEach(async () => {
    await resetAuthTables();
    // No FK on screen_ws_events (migration 0115): the truncate cascade does not reach it.
    await db.delete(screenWsEvents);
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await sql.end();
  });

  const seedScreen = async () => {
    const owner = await seedUser({ role: 'individual_owner' });
    const [sh] = await db
      .insert(screenhosts)
      .values({ name: 'La Rosa', ownerId: owner })
      .returning();
    const [s] = await db
      .insert(screens)
      .values({ screenhostId: sh?.id ?? '', name: 'Écran 1', lastSeenAt: new Date() })
      .returning();
    return { screenId: s?.id ?? '', screenhostId: sh?.id ?? '' };
  };

  it('the TV report, its player state and its errors reach the fleet reads', async () => {
    const ctx = await seedScreen();
    await handleScreenEvent({ event: 'DEVICE_REPORT', data: report }, ctx, silentLog);
    await handleScreenEvent(
      {
        event: 'STATUS_REPORT',
        data: { status: 'playing', playlist_size: 2, cached_videos: 2, current_video_id: 'abc' },
      },
      ctx,
      silentLog,
    );
    await handleScreenEvent(
      { event: 'PLAYBACK_ERROR', data: { error: 'decoder lost' } },
      ctx,
      silentLog,
    );

    const [listed] = await loadFleet();
    expect(listed).toMatchObject({
      device: { appVersionName: '1.5.6', manufacturer: 'TCL', autoStartAllowed: false },
      issues: ['auto_start_blocked'],
    });
    expect(listed?.deviceReportAt).not.toBeNull();
    const d = await loadFleetScreen(ctx.screenId);
    expect(d?.player).toEqual({
      status: 'playing',
      currentVideoId: 'abc',
      playlistSize: 2,
      cachedVideos: 2,
    });
    expect(d?.events.map((e) => [e.kind, e.detail])).toEqual([['playback_error', 'decoder lost']]);
  });

  it('a connection prunes the screen’s events older than 14 days', async () => {
    const { screenId } = await seedScreen();
    await recordWsEvent(screenId, 'disconnect', null, new Date(Date.now() - 15 * 24 * 3_600_000));
    await recordWsEvent(screenId, 'disconnect', null, new Date(Date.now() - 2 * 24 * 3_600_000));
    await recordConnect(screenId);
    expect(await db.$count(screenWsEvents, eq(screenWsEvents.screenId, screenId))).toBe(2);
  });

  it('remote actions: 409 when the TV is offline; sent and recorded when connected', async () => {
    const { screenId } = await seedScreen();
    const app = Fastify({ logger: false });
    await app.register(adminFleetRoutes);
    await app.ready();
    const admin = await seedUser();
    mockSession(admin);
    const restart = () =>
      app.inject({ method: 'POST', url: `/api/admin/fleet/screens/${screenId}/restart` });
    const status = () =>
      app.inject({ method: 'POST', url: `/api/admin/fleet/screens/${screenId}/status-request` });

    expect((await restart()).statusCode).toBe(409);
    const tv = { send: vi.fn() };
    screenRegistry.add(screenId, tv as never);
    try {
      expect((await restart()).json()).toEqual({ sent: 1 });
      expect((await status()).json()).toEqual({ sent: 1 });
      expect(tv.send.mock.calls.map((c) => JSON.parse(String(c[0])).cmd)).toEqual([
        'RESTART',
        'STATUS_REQUEST',
      ]);
      const kinds = (
        await db.select().from(screenWsEvents).where(eq(screenWsEvents.screenId, screenId))
      )
        .map((e) => e.kind)
        .sort();
      expect(kinds).toEqual(['restart_requested', 'status_requested']);
    } finally {
      screenRegistry.remove(screenId, tv as never);
    }
    vi.restoreAllMocks();
    mockSession(await seedUser({ role: 'individual_owner' }), 'individual_owner');
    expect((await restart()).statusCode).toBe(403);
    await app.close();
  });
});
