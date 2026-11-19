import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { db, sql } from '../src/db/client.js';
import {
  type NewUser,
  campaignDispatchAllocation,
  campaignDispatchPlan,
  campaigns,
  creatives,
  screenhosts,
  screens,
  users,
} from '../src/db/schema.js';
import { tunisDateOf } from '../src/lib/campaign-dates.js';
import { computeScreenPlaylist } from '../src/lib/playout/playlist-service.js';
import { runOverlayTick } from '../src/lib/spot-overlay-job.js';
import {
  OVERLAY_FPS,
  overlayFfmpegArgs,
  overlayKeyFor,
  overlayRegistry,
  transcodeOverlay,
} from '../src/lib/spot-overlay.js';
import { storage } from '../src/storage/s3-storage.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// OVL-LIGHT — the light surimpression copy: its rules (pure), its job (real Postgres, storage
// mocked like the QR copies) and the overlay_url a TV receives once the copy exists.

describe('OVL-LIGHT — the light copy rules (pure)', () => {
  it('one deterministic key per aired source', () => {
    expect(overlayKeyFor('creatives/a/b')).toBe(overlayKeyFor('creatives/a/b'));
    expect(overlayKeyFor('creatives/a/b')).not.toBe(overlayKeyFor('creatives/a/c'));
    expect(overlayKeyFor('creatives/a/b')).toMatch(/^overlays\/[0-9a-f]{32}\.mp4$/);
  });

  it('960×540, 25 fps, Baseline, no audio, faststart', () => {
    const args = overlayFfmpegArgs('in', 'out.mp4').join(' ');
    expect(args).toContain('scale=960:540:force_original_aspect_ratio=decrease');
    expect(args).toContain(`fps=${OVERLAY_FPS}`);
    expect(args).toContain('-profile:v baseline');
    expect(args).toContain('-an');
    expect(args).toContain('+faststart');
  });
});

describe.skipIf(!process.env['FFMPEG_PATH'] || !process.env['FFPROBE_PATH'])(
  'OVL-LIGHT — a real encode (ffmpeg)',
  () => {
    it('a 1080p 30 fps clip becomes 960×540 at 25 fps, Baseline', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'ovl-t-'));
      try {
        const src = join(dir, 'src.mp4');
        execFileSync(process.env['FFMPEG_PATH'] ?? '', [
          '-y',
          '-f',
          'lavfi',
          '-i',
          'testsrc=size=1920x1080:rate=30:duration=2',
          '-c:v',
          'libx264',
          '-pix_fmt',
          'yuv420p',
          src,
        ]);
        const out = join(dir, 'out.mp4');
        const light = await transcodeOverlay(readFileSync(src));
        writeFileSync(out, light);
        const probe = JSON.parse(
          execFileSync(process.env['FFPROBE_PATH'] ?? '', [
            '-v',
            'quiet',
            '-print_format',
            'json',
            '-show_streams',
            out,
          ]).toString(),
        ) as {
          streams: { width: number; height: number; profile: string; r_frame_rate: string }[];
        };
        expect(probe.streams[0]).toMatchObject({ width: 960, height: 540, r_frame_rate: '25/1' });
        expect(probe.streams[0]?.profile).toMatch(/Baseline/);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  },
);

let seq = 0;
const seedUser = async (values: Partial<NewUser> = {}): Promise<string> => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `ovl-${seq}@example.com`,
      contactName: `Ovl ${seq}`,
      role: 'advertiser',
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

describe('OVL-LIGHT — the job and the playlist (real Postgres)', () => {
  beforeEach(async () => {
    await resetAuthTables();
    overlayRegistry.reset();
    vi.spyOn(storage, 'getPresignedUrl').mockImplementation(async ({ key }) => ({
      url: `https://storage.test/${key}`,
    }));
    vi.spyOn(storage, 'download').mockResolvedValue({
      body: Buffer.from('spot'),
      contentType: 'video/mp4',
    });
    vi.spyOn(storage, 'upload').mockImplementation(async ({ key }) => ({ key }));
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await sql.end();
  });

  const seedAiring = async (creativeType: 'video' | 'photo' = 'video') => {
    const advertiser = await seedUser();
    const owner = await seedUser({ role: 'individual_owner' });
    const [venue] = await db
      .insert(screenhosts)
      .values({ name: `Ovl venue ${seq}`, ownerId: owner })
      .returning();
    await db.insert(screens).values({ screenhostId: venue?.id ?? '', name: 'TV' });
    const storageKey = `creatives/${advertiser}/spot-${seq}`;
    const [creative] = await db
      .insert(creatives)
      .values({
        advertiserId: advertiser,
        creativeType,
        storageKey,
        durationSeconds: 20,
        validationStatus: 'approved',
      })
      .returning();
    const today = tunisDateOf(new Date());
    const [campaign] = await db
      .insert(campaigns)
      .values({
        advertiserId: advertiser,
        name: `Ovl ${seq}`,
        campaignType: 'standard',
        status: 'active',
        startDate: today,
        endDate: today,
        creativeId: creative?.id,
        requestedBudget: '100.00',
      })
      .returning();
    const [plan] = await db
      .insert(campaignDispatchPlan)
      .values({
        campaignId: campaign?.id ?? '',
        iCible: 100,
        cpm: '10',
        sSpotSeconds: 20,
        tTierCoef: '1.0',
        seuilDiffusable: 1000,
        sMin: '10',
        gJour: '3.33',
        fMaxSeconds: 300,
        rMinEfficace: 2,
        couvert: 100,
        nMin: 1,
        nMax: 20,
        nRetenus: 1,
      })
      .returning();
    await db.insert(campaignDispatchAllocation).values({
      planId: plan?.id ?? '',
      screenhostId: venue?.id ?? '',
      iiPotentiel: 100,
      rI: 6,
      revenuPrevisionnel: '1',
      creneaux: [],
      statutAcceptation: 'ACCEPTE',
    });
    return { venueId: venue?.id ?? '', storageKey, campaignId: campaign?.id ?? '' };
  };

  it('makes the missing copy once, then the playlist carries overlay_url', async () => {
    const w = await seedAiring();
    vi.spyOn(storage, 'exists').mockResolvedValue(false);
    const before = await computeScreenPlaylist(w.venueId, new Date());
    expect(before.videos[0]).not.toHaveProperty('overlay_url');

    const transcode = vi.fn(async () => Buffer.from('light'));
    expect(await runOverlayTick(transcode)).toBe(1);
    expect(transcode).toHaveBeenCalledTimes(1);
    expect(storage.upload).toHaveBeenCalledWith(
      expect.objectContaining({ key: overlayKeyFor(w.storageKey), contentType: 'video/mp4' }),
    );
    // Known now: the next sweep encodes nothing.
    expect(await runOverlayTick(transcode)).toBe(0);
    expect(transcode).toHaveBeenCalledTimes(1);

    const after = await computeScreenPlaylist(w.venueId, new Date());
    expect(after.videos[0]).toMatchObject({
      id: w.campaignId,
      overlay_url: `https://storage.test/${overlayKeyFor(w.storageKey)}`,
    });
  });

  it('a copy already in storage (after a restart) is known without re-encoding', async () => {
    const w = await seedAiring();
    vi.spyOn(storage, 'exists').mockResolvedValue(true);
    const transcode = vi.fn(async () => Buffer.from('light'));
    expect(await runOverlayTick(transcode)).toBe(0);
    expect(transcode).not.toHaveBeenCalled();
    expect(overlayRegistry.isReady(overlayKeyFor(w.storageKey))).toBe(true);
  });

  it('a photo needs no copy; a failed encode is not retried and the full spot still airs', async () => {
    await seedAiring('photo');
    vi.spyOn(storage, 'exists').mockResolvedValue(false);
    const transcode = vi.fn(async () => Buffer.from('light'));
    expect(await runOverlayTick(transcode)).toBe(0);
    expect(transcode).not.toHaveBeenCalled();

    const w = await seedAiring('video');
    const broken = vi.fn(async (): Promise<Buffer> => {
      throw new Error('boom');
    });
    expect(await runOverlayTick(broken)).toBe(1);
    expect(await runOverlayTick(broken)).toBe(0);
    expect(broken).toHaveBeenCalledTimes(1);
    const playlist = await computeScreenPlaylist(w.venueId, new Date());
    expect(playlist.videos[0]).not.toHaveProperty('overlay_url');
    expect(playlist.videos[0]?.url).toContain(w.storageKey);
  });
});
