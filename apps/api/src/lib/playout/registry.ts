import { type WebSocket } from 'ws';

// In-memory registry of connected screen sockets, keyed by screen_id, so a re-push can target a
// screen. Single-process (V1, single session); a multi-instance fan-out would need a broker.
const sockets = new Map<string, Set<WebSocket>>();

export const screenRegistry = {
  add(screenId: string, socket: WebSocket): void {
    const set = sockets.get(screenId) ?? new Set<WebSocket>();
    set.add(socket);
    sockets.set(screenId, set);
  },
  remove(screenId: string, socket: WebSocket): void {
    const set = sockets.get(screenId);
    if (!set) return;
    set.delete(socket);
    if (set.size === 0) sockets.delete(screenId);
  },
  get(screenId: string): WebSocket[] {
    return [...(sockets.get(screenId) ?? [])];
  },
  has(screenId: string): boolean {
    return (sockets.get(screenId)?.size ?? 0) > 0;
  },
};
