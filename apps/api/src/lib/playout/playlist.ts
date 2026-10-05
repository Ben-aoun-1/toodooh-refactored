import { addDays, format, parseISO } from 'date-fns';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';

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
  /**
   * FRESH-1 — ADDITIVE: the instant this entry stops being airable (ISO). The player drops an
   * expired entry from a persisted playlist, so a TV restarting OFFLINE never airs what the server
   * has since stopped. ABSENT = no bound known (older senders; the player keeps the entry).
   */
  valid_until?: string;
  /**
   * EVT-STOP — ADDITIVE, classic entries only: the event blackout windows of the next 48 h
   * ([start, end) ISO). The player never airs the entry inside one — offline included (S3 A).
   * ABSENT = no known blackout (older senders; older players ignore it).
   */
  blackouts?: { start: string; end: string }[];
  /**
   * EVT-MIN1 — ADDITIVE, minutes-model event entries only: the exact instants (ISO) this spot
   * starts inside its bloc's pod, each slot lasting `seconds` (the spot, then the Toodooh screen
   * until the slot ends). A player that knows `slots` plays them on time; older players ignore it
   * and fall back to reps_per_hour within valid_until.
   */
  slots?: { at: string; seconds: number }[];
}

export interface PlaylistMessage {
  videos: PlaylistVideo[];
  loop: boolean;
  /** EVT-MIN1 — ADDITIVE: the server's clock when the playlist was built (ISO), for slot alignment. */
  server_time?: string;
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
  /** FRESH-1 — when this entry stops being airable (campaign window end / event bloc end). */
  validUntil?: Date;
  /** EVT-STOP — the blackout windows this (classic) entry must not air in. */
  blackouts?: readonly { start: Date; end: Date }[];
  /** EVT-MIN1 — a minutes-model event spot's exact pod slots. */
  slots?: readonly { at: Date; seconds: number }[];
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

/**
 * FRESH-1 — the instant a campaign window closes: the Tunis midnight AFTER its end date, i.e. the
 * first instant isWindowActive stops covering (pinned against it in tests).
 */
export const campaignWindowValidUntil = (endDate: string): Date =>
  fromZonedTime(`${format(addDays(parseISO(endDate), 1), 'yyyy-MM-dd')}T00:00:00`, PLAYOUT_TZ);

// Map resolved sources → the playlist. id = campaign id (the proof-of-play resolution key); priority
// defaults to 0 (TAKEOVER deferred). loop is always true (the player cycles the list).
export const buildPlaylist = (
  sources: readonly PlaylistSource[],
  serverTime?: Date,
): PlaylistMessage => ({
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
    ...(source.validUntil !== undefined ? { valid_until: source.validUntil.toISOString() } : {}),
    ...(source.blackouts !== undefined && source.blackouts.length > 0
      ? {
          blackouts: source.blackouts.map((b) => ({
            start: b.start.toISOString(),
            end: b.end.toISOString(),
          })),
        }
      : {}),
    ...(source.slots !== undefined && source.slots.length > 0
      ? {
          slots: source.slots.map((slot) => ({ at: slot.at.toISOString(), seconds: slot.seconds })),
        }
      : {}),
  })),
  loop: true,
  ...(serverTime !== undefined ? { server_time: serverTime.toISOString() } : {}),
});
