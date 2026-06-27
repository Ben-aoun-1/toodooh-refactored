// Screen WebSocket wire shapes (match toodooh-streamer CommandProtocol.kt + mock-server.js).
// Server→screen: { cmd, data }.  Screen→server: { event, data:{...} }.

export const serverMessage = (cmd: string, data: unknown): string => JSON.stringify({ cmd, data });

export interface ScreenEventMessage {
  event: string;
  data: Record<string, unknown>;
}

/**
 * Defensive parse of a screen→server frame. Returns null for non-JSON or any frame without a string
 * `event` (the caller logs + ignores — never crashes the socket). `data` defaults to {} so handlers
 * can read fields without extra guards.
 */
export const parseScreenEvent = (raw: string): ScreenEventMessage | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  if (typeof obj['event'] !== 'string') return null;
  const data = obj['data'];
  return {
    event: obj['event'],
    data: typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {},
  };
};
