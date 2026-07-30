import { formatInTimeZone } from 'date-fns-tz';

// The network is Grand-Tunis; "today" for the playout window is pinned to Africa/Tunis so a campaign
// window doesn't slip a day at the server-local midnight boundary.
const PLAYOUT_TZ = 'Africa/Tunis';

// Playlist shape sent to the screen (UPDATE_PLAYLIST.data) — matches CommandProtocol.kt VideoEntry.
export interface PlaylistVideo {
  id: string; // video_id-as-sent: the campaign id (resolvable to campaign+creative on VIDEO_ENDED)
  url: string;
  campaign_name: string;
  duration_seconds: number | null;
  priority: number;
  reps_per_hour: number; // R_i — planned plays/hour, so the player can space (cadence) the spot
  /** EV4 rider — ADDITIVE: 'video' | 'image'; ABSENT = video (the TV-C3 backcompat contract). */
  creative_type?: 'video' | 'image';
}

export interface PlaylistMessage {
  videos: PlaylistVideo[];
  loop: boolean;
}

export interface PlaylistSource {
  campaignId: string;
  campaignName: string;
  url: string;
  durationSeconds: number | null;
  priority?: number;
  repsPerHour?: number; // R_i for this (campaign, screenhost); a spot with no allocation rI → 0
  /** EV4 rider — the media kind; omitted = video (legacy senders stay valid). */
  creativeType?: 'video' | 'photo';
}

// A frozen plan feeds a screen today iff its campaign window covers `now` (V1 rule), with "today"
// taken in Africa/Tunis. Date-only ISO strings compare lexically = chronologically; a campaign
// without both bounds is not active.
export const isWindowActive = (
  startDate: string | null,
  endDate: string | null,
  now: Date,
): boolean => {
  if (!startDate || !endDate) return false;
  const today = formatInTimeZone(now, PLAYOUT_TZ, 'yyyy-MM-dd');
  return startDate <= today && today <= endDate;
};

// Map resolved sources → the playlist. id = campaign id (the proof-of-play resolution key); priority
// defaults to 0 (TAKEOVER deferred). loop is always true (the player cycles the list).
export const buildPlaylist = (sources: readonly PlaylistSource[]): PlaylistMessage => ({
  videos: sources.map((source) => ({
    id: source.campaignId,
    url: source.url,
    campaign_name: source.campaignName,
    duration_seconds: source.durationSeconds,
    priority: source.priority ?? 0,
    reps_per_hour: source.repsPerHour ?? 0, // no allocation rI → 0 (player falls back)
    // EV4 rider — only a declared kind emits the field; absent = video (TV-C3 backcompat).
    ...(source.creativeType !== undefined
      ? { creative_type: source.creativeType === 'photo' ? ('image' as const) : ('video' as const) }
      : {}),
  })),
  loop: true,
});
