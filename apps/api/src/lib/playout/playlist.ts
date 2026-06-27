import { format } from 'date-fns';

// Playlist shape sent to the screen (UPDATE_PLAYLIST.data) — matches CommandProtocol.kt VideoEntry.
export interface PlaylistVideo {
  id: string; // video_id-as-sent: the campaign id (resolvable to campaign+creative on VIDEO_ENDED)
  url: string;
  campaign_name: string;
  duration_seconds: number | null;
  priority: number;
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
}

// A frozen plan feeds a screen today iff its campaign window covers `now` (V1 rule). Date-only
// ISO strings compare lexically = chronologically; a campaign without both bounds is not active.
export const isWindowActive = (
  startDate: string | null,
  endDate: string | null,
  now: Date,
): boolean => {
  if (!startDate || !endDate) return false;
  const today = format(now, 'yyyy-MM-dd');
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
  })),
  loop: true,
});
