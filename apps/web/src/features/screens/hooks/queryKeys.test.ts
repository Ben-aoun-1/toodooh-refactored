import { describe, expect, it } from 'vitest';

import { screensKeys } from './queryKeys';

describe('screensKeys', () => {
  it('namespaces every view key under the "screens" prefix', () => {
    expect(screensKeys.all).toEqual(['screens']);
    expect(screensKeys.list()[0]).toBe('screens');
    expect(screensKeys.ownerScreensData()[0]).toBe('screens');
    expect(screensKeys.calendarDevices()[0]).toBe('screens');
  });

  it('builds hierarchical [feature, view] tuples', () => {
    expect(screensKeys.list()).toEqual(['screens', 'list']);
    expect(screensKeys.ownerScreensData()).toEqual(['screens', 'ownerScreensData']);
    expect(screensKeys.calendarDevices()).toEqual(['screens', 'calendarDevices']);
  });

  it('keeps every view key distinct and prefix-matchable by screensKeys.all', () => {
    const views = [
      screensKeys.list(),
      screensKeys.ownerScreensData(),
      screensKeys.calendarDevices(),
    ];
    for (const key of views) {
      expect(key.slice(0, screensKeys.all.length)).toEqual(screensKeys.all);
    }
    expect(screensKeys.list()).not.toEqual(screensKeys.ownerScreensData());
    expect(screensKeys.ownerScreensData()).not.toEqual(screensKeys.calendarDevices());
  });
});
