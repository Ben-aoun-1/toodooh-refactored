import { describe, expect, it } from 'vitest';

import { parseScreenEvent, serverMessage } from '../src/lib/playout/ws-protocol.js';

describe('serverMessage — { cmd, data } frame', () => {
  it('frames CONNECTED with null data', () => {
    expect(serverMessage('CONNECTED', null)).toBe('{"cmd":"CONNECTED","data":null}');
  });
  it('frames UPDATE_PLAYLIST', () => {
    expect(JSON.parse(serverMessage('UPDATE_PLAYLIST', { videos: [], loop: true }))).toEqual({
      cmd: 'UPDATE_PLAYLIST',
      data: { videos: [], loop: true },
    });
  });
});

describe('parseScreenEvent — defensive { event, data } parse', () => {
  it('parses a well-formed event', () => {
    expect(parseScreenEvent('{"event":"HEARTBEAT","data":{"status":"playing"}}')).toEqual({
      event: 'HEARTBEAT',
      data: { status: 'playing' },
    });
  });
  it('defaults data to {} when absent or non-object', () => {
    expect(parseScreenEvent('{"event":"VIDEO_ENDED"}')).toEqual({ event: 'VIDEO_ENDED', data: {} });
    expect(parseScreenEvent('{"event":"X","data":5}')).toEqual({ event: 'X', data: {} });
  });
  it('returns null for non-JSON, a missing/non-string event, or a non-object', () => {
    expect(parseScreenEvent('not json')).toBeNull();
    expect(parseScreenEvent('{"data":{}}')).toBeNull();
    expect(parseScreenEvent('{"event":123}')).toBeNull();
    expect(parseScreenEvent('123')).toBeNull();
    expect(parseScreenEvent('"a string"')).toBeNull();
    expect(parseScreenEvent('null')).toBeNull();
  });
});
