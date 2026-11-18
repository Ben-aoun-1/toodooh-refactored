// FLEET-2 (operator 18/11, phase 2) — « Santé de la TV », PURE: what a TV may report about itself
// (a strict whitelist: the socket is the TV's, so nothing else is stored) and the warnings the
// admin sees. TV app 1.5.6+ sends DEVICE_REPORT at each connection and every 15 min; older TVs
// send none (« version inconnue »).

/** The version on too-dooh.com/downloads — a TV below it is « à mettre à jour ». */
export const TV_APP_LATEST = { versionCode: 21, versionName: '1.5.6' } as const;

export type StartReason = 'boot' | 'quickboot' | 'update' | 'watchdog' | 'app' | 'system';
const START_REASONS: readonly StartReason[] = [
  'boot',
  'quickboot',
  'update',
  'watchdog',
  'app',
  'system',
];

export interface DeviceReport {
  appVersionName: string | null;
  appVersionCode: number | null;
  androidRelease: string | null;
  androidSdk: number | null;
  manufacturer: string | null;
  model: string | null;
  /** « Afficher par-dessus d'autres applis ». */
  overlayGranted: boolean | null;
  /** TCL « Dispositif de protection » auto-start; null = not readable on this TV. */
  autoStartAllowed: boolean | null;
  startReason: StartReason | null;
  /** When the playback service started (ISO). */
  serviceStartedAt: string | null;
}

export interface StatusReport {
  status: string | null;
  currentVideoId: string | null;
  playlistSize: number | null;
  cachedVideos: number | null;
}

const str = (v: unknown, max = 80): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v.trim().slice(0, max) : null;
const int = (v: unknown): number | null =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 1e9 ? v : null;
const bool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);
const isoTime = (v: unknown): string | null => {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/** The TV's DEVICE_REPORT data, whitelisted. */
export const sanitizeDeviceReport = (data: Record<string, unknown>): DeviceReport => {
  const reason = str(data['start_reason'], 20);
  return {
    appVersionName: str(data['app_version_name'], 30),
    appVersionCode: int(data['app_version_code']),
    androidRelease: str(data['android_release'], 20),
    androidSdk: int(data['android_sdk']),
    manufacturer: str(data['manufacturer']),
    model: str(data['model']),
    overlayGranted: bool(data['overlay_granted']),
    autoStartAllowed: bool(data['auto_start_allowed']),
    startReason: START_REASONS.find((r) => r === reason) ?? null,
    serviceStartedAt: isoTime(data['service_started_at']),
  };
};

/** The TV's STATUS_REPORT data, whitelisted. */
export const sanitizeStatusReport = (data: Record<string, unknown>): StatusReport => ({
  status: str(data['status'], 20),
  currentVideoId: str(data['current_video_id'], 64),
  playlistSize: int(data['playlist_size']),
  cachedVideos: int(data['cached_videos']),
});

export type HealthIssue = 'overlay_missing' | 'auto_start_blocked' | 'outdated' | 'unknown_version';

/** What the admin must fix on this TV, most blocking first. */
export const healthIssues = (report: DeviceReport | null): HealthIssue[] => {
  if (report === null) return ['unknown_version'];
  const issues: HealthIssue[] = [];
  if (report.overlayGranted === false) issues.push('overlay_missing');
  if (report.autoStartAllowed === false) issues.push('auto_start_blocked');
  if (report.appVersionCode !== null && report.appVersionCode < TV_APP_LATEST.versionCode) {
    issues.push('outdated');
  }
  return issues;
};

/** A stored report read back, every field re-checked (the column holds a sanitized report). */
export const readDeviceReport = (stored: Record<string, unknown> | null): DeviceReport | null => {
  if (stored === null) return null;
  const reason = str(stored['startReason'], 20);
  const startedAt = str(stored['serviceStartedAt'], 40);
  return {
    appVersionName: str(stored['appVersionName'], 30),
    appVersionCode: int(stored['appVersionCode']),
    androidRelease: str(stored['androidRelease'], 20),
    androidSdk: int(stored['androidSdk']),
    manufacturer: str(stored['manufacturer']),
    model: str(stored['model']),
    overlayGranted: bool(stored['overlayGranted']),
    autoStartAllowed: bool(stored['autoStartAllowed']),
    startReason: START_REASONS.find((r) => r === reason) ?? null,
    serviceStartedAt: startedAt !== null && !Number.isNaN(Date.parse(startedAt)) ? startedAt : null,
  };
};

/** A stored player state read back, every field re-checked. */
export const readStatusReport = (stored: Record<string, unknown> | null): StatusReport | null =>
  stored === null
    ? null
    : {
        status: str(stored['status'], 20),
        currentVideoId: str(stored['currentVideoId'], 64),
        playlistSize: int(stored['playlistSize']),
        cachedVideos: int(stored['cachedVideos']),
      };

/** The report as the column stores it (a plain JSON object). */
export const toStored = (r: DeviceReport | StatusReport): Record<string, unknown> => ({ ...r });
