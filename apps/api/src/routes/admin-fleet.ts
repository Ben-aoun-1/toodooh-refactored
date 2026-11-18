import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { type DeviceReport, TV_APP_LATEST } from '../lib/fleet/health.js';
import {
  type FleetScreen,
  type FleetScreenDetail,
  loadFleet,
  loadFleetScreen,
} from '../lib/fleet/load.js';
import { recordWsEvent } from '../lib/fleet/ws-events.js';
import { screenRegistry } from '../lib/playout/registry.js';
import { serverMessage } from '../lib/playout/ws-protocol.js';
import { requireAdmin, requireAuth } from '../middleware/require-auth.js';

// FLEET-1 (operator 18/11, phase 1) — « Parc d'écrans »: GET /api/admin/fleet (every active
// screen, its state now and its day so far) and GET /api/admin/fleet/screens/:id (one screen hour
// by hour and campaign by campaign). Admin only, reads only. The figures: lib/fleet.

const idParamSchema = z.object({ id: z.uuid() });

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

const deviceView = (d: DeviceReport | null) =>
  d === null
    ? null
    : {
        app_version_name: d.appVersionName,
        app_version_code: d.appVersionCode,
        android_release: d.androidRelease,
        android_sdk: d.androidSdk,
        manufacturer: d.manufacturer,
        model: d.model,
        overlay_granted: d.overlayGranted,
        auto_start_allowed: d.autoStartAllowed,
        start_reason: d.startReason,
        service_started_at: d.serviceStartedAt,
      };

const screenView = (s: FleetScreen) => ({
  id: s.id,
  name: s.name,
  venue: s.venue,
  status: s.status,
  connected: s.connected,
  last_seen_at: iso(s.lastSeenAt),
  paired_at: iso(s.pairedAt),
  open_now: s.openNow,
  match_now: s.matchNow,
  now: { planned_reps: s.now.plannedReps, campaigns: s.now.campaigns },
  last_proof: s.lastProof
    ? { at: s.lastProof.at.toISOString(), campaign_name: s.lastProof.campaignName }
    : null,
  today: {
    planned_total: s.today.plannedTotal,
    planned_so_far: s.today.plannedSoFar,
    aired: s.today.aired,
  },
  device: deviceView(s.device),
  device_report_at: iso(s.deviceReportAt),
  issues: s.issues,
});

const detailView = (s: FleetScreenDetail) => ({
  ...screenView(s),
  player: s.player
    ? {
        status: s.player.status,
        current_video_id: s.player.currentVideoId,
        playlist_size: s.player.playlistSize,
        cached_videos: s.player.cachedVideos,
      }
    : null,
  player_report_at: iso(s.playerReportAt),
  events: s.events.map((e) => ({ kind: e.kind, detail: e.detail, at: e.at.toISOString() })),
  hours: s.hours.map((h) => ({
    hour: h.hour,
    planned: h.planned,
    aired: h.aired,
    blackout_minutes: h.blackoutMinutes,
    campaigns: h.campaigns,
  })),
  campaigns: s.campaigns.map((c) => ({
    id: c.id,
    name: c.name,
    start_date: c.startDate,
    end_date: c.endDate,
    planned_today: c.plannedToday,
    aired_today: c.airedToday,
    aired_total: c.airedTotal,
    last_proof_at: iso(c.lastProofAt),
  })),
});

export const adminFleetRoutes: FastifyPluginAsync = async (app) => {
  const adminGuard = { preHandler: [requireAuth, requireAdmin] };

  app.get('/api/admin/fleet', adminGuard, async (_request, reply) => {
    const now = new Date();
    const fleet = await loadFleet(now);
    return reply.status(200).send({
      computed_at: now.toISOString(),
      latest_app: {
        version_code: TV_APP_LATEST.versionCode,
        version_name: TV_APP_LATEST.versionName,
      },
      screens: fleet.map(screenView),
    });
  });

  app.get('/api/admin/fleet/screens/:id', adminGuard, async (request, reply) => {
    const parsed = idParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: [{ field: 'id', reason: 'must be a uuid' }],
      });
    }
    const now = new Date();
    const detail = await loadFleetScreen(parsed.data.id, now);
    if (!detail) return reply.status(404).send({ error: 'NOT_FOUND', message: 'No such screen.' });
    return reply.status(200).send({ computed_at: now.toISOString(), ...detailView(detail) });
  });

  // FLEET-2 — the admin's remote actions on a CONNECTED TV: « Reconnecter » (RESTART: the TV
  // reconnects and receives its playlist again) and « Demander un état » (STATUS_REQUEST: the TV
  // sends its player state, stored on the screen). 409 when the TV is not connected now.
  const remote = (
    path: string,
    cmd: 'RESTART' | 'STATUS_REQUEST',
    kind: 'restart_requested' | 'status_requested',
  ) =>
    app.post(path, adminGuard, async (request, reply) => {
      const parsed = idParamSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.status(400).send({
          error: 'INVALID_INPUT',
          message: 'Validation failed',
          fields: [{ field: 'id', reason: 'must be a uuid' }],
        });
      }
      const sockets = screenRegistry.get(parsed.data.id);
      if (sockets.length === 0) {
        return reply.status(409).send({
          error: 'SCREEN_OFFLINE',
          message: 'La TV n’est pas connectée en ce moment.',
        });
      }
      let sent = 0;
      for (const socket of sockets) {
        try {
          socket.send(serverMessage(cmd, {}));
          sent += 1;
        } catch (err) {
          request.log.warn({ err, screenId: parsed.data.id }, 'fleet remote command failed');
        }
      }
      await recordWsEvent(parsed.data.id, kind, request.user?.id ?? null);
      return reply.status(200).send({ sent });
    });
  remote('/api/admin/fleet/screens/:id/restart', 'RESTART', 'restart_requested');
  remote('/api/admin/fleet/screens/:id/status-request', 'STATUS_REQUEST', 'status_requested');
};
