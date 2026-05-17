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

  it('keys the predefined-zones reference read under the screens prefix', () => {
    expect(screensKeys.predefinedZones()).toEqual(['screens', 'predefinedZones']);
    expect(screensKeys.predefinedZones()).not.toEqual(screensKeys.list());
  });

  it('deduplicates and sorts screen IDs for the unavailability key', () => {
    // Re-ordered, duplicate-bearing ID lists must resolve to the same key.
    expect(screensKeys.unavailabilityForScreens(['b', 'a'])).toEqual(
      screensKeys.unavailabilityForScreens(['a', 'b']),
    );
    expect(screensKeys.unavailabilityForScreens(['a', 'a'])).toEqual(
      screensKeys.unavailabilityForScreens(['a']),
    );
    expect(screensKeys.unavailabilityForScreens(['a'])).not.toEqual(
      screensKeys.unavailabilityForScreens(['a', 'b']),
    );
    expect(screensKeys.unavailabilityForScreens(['s1'])[0]).toBe('screens');
  });

  it('keeps every view key distinct and prefix-matchable by screensKeys.all', () => {
    const views = [
      screensKeys.list(),
      screensKeys.ownerScreensData(),
      screensKeys.calendarDevices(),
      screensKeys.predefinedZones(),
      screensKeys.unavailabilityForScreens(['s1']),
    ];
    for (const key of views) {
      expect(key.slice(0, screensKeys.all.length)).toEqual(screensKeys.all);
    }
    expect(screensKeys.list()).not.toEqual(screensKeys.ownerScreensData());
    expect(screensKeys.ownerScreensData()).not.toEqual(screensKeys.calendarDevices());
  });
});
