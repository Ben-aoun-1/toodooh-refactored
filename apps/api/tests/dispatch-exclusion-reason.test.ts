import { describe, expect, it } from 'vitest';

import {
  type PoolFilterContext,
  type PoolVenueRow,
  poolExclusionReason,
} from '../src/lib/dispatch/exclusion-reason.js';

// The pool's hard filters as ONE ordered list (pure — no database): an active venue is a candidate
// iff no filter fails, and the FIRST failing one is the reason the engine journal records.

const venue = (over: Partial<PoolVenueRow> = {}): PoolVenueRow => ({
  id: 'venue-1',
  ownerApproved: true,
  businessSectorId: 'cafe',
  class: 'premium',
  zoneId: 'zone-1',
  openingHour: 8,
  closingHour: 23,
  broadcastCapacity: 4,
  ...over,
});

const ctx = (over: Partial<PoolFilterContext> = {}): PoolFilterContext => ({
  lines: [{ categoryId: 'cafe', class: null }],
  zoneIds: ['zone-1'],
  excluded: new Set<string>(),
  ...over,
});

describe('poolExclusionReason — the pool filter and the reason it journals', () => {
  it('a venue that passes every filter is a candidate (null)', () => {
    expect(poolExclusionReason(venue(), ctx())).toBeNull();
    // whole network on both criteria: no targeting line, no zone
    expect(poolExclusionReason(venue({ zoneId: null }), ctx({ lines: [], zoneIds: [] }))).toBe(
      null,
    );
  });

  it('names each filter on its own', () => {
    expect(poolExclusionReason(venue({ ownerApproved: false }), ctx())).toBe('owner_not_approved');
    expect(poolExclusionReason(venue(), ctx({ excluded: new Set(['venue-1']) }))).toBe('excluded');
    expect(poolExclusionReason(venue({ broadcastCapacity: null }), ctx())).toBe('capacity_missing');
    expect(poolExclusionReason(venue({ openingHour: null }), ctx())).toBe('hours_missing');
    expect(poolExclusionReason(venue({ openingHour: 10, closingHour: 10 }), ctx())).toBe(
      'hours_missing',
    );
    expect(poolExclusionReason(venue({ businessSectorId: 'gym' }), ctx())).toBe(
      'targeting_mismatch',
    );
    expect(poolExclusionReason(venue({ zoneId: 'zone-2' }), ctx())).toBe('zone_mismatch');
  });

  it('the FIRST failing filter wins, in the journal order', () => {
    const everythingWrong = venue({
      ownerApproved: false,
      broadcastCapacity: null,
      openingHour: null,
      businessSectorId: 'gym',
      zoneId: 'zone-2',
    });
    const refused = ctx({ excluded: new Set(['venue-1']) });
    expect(poolExclusionReason(everythingWrong, refused)).toBe('owner_not_approved');
    expect(poolExclusionReason({ ...everythingWrong, ownerApproved: true }, refused)).toBe(
      'excluded',
    );
    expect(poolExclusionReason({ ...everythingWrong, ownerApproved: true }, ctx())).toBe(
      'capacity_missing',
    );
    expect(
      poolExclusionReason({ ...everythingWrong, ownerApproved: true, broadcastCapacity: 4 }, ctx()),
    ).toBe('hours_missing');
    expect(
      poolExclusionReason(
        { ...everythingWrong, ownerApproved: true, broadcastCapacity: 4, openingHour: 8 },
        ctx(),
      ),
    ).toBe('targeting_mismatch');
  });
});
