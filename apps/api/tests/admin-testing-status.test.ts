import { describe, expect, it } from 'vitest';

import {
  type AllocationForStatus,
  campaignsOnVenue,
  hourStatuses,
} from '../src/lib/admin-testing-status.js';

// ADM-OBS1 slice B — the pure derivations behind the « Tests » page's status and campaign views.
const alloc = (over: Partial<AllocationForStatus> = {}): AllocationForStatus => ({
  campaignId: 'c1',
  campaignName: 'Été',
  campaignStatus: 'active',
  statutAcceptation: 'ACCEPTE',
  rI: 10,
  sSpotSeconds: 10,
  fMaxSeconds: 300,
  cpm: 10,
  t: 0.6,
  creneaux: [
    { date: '2026-09-10', hour: 9, reps: 10, impressions: 100 },
    { date: '2026-09-10', hour: 10, reps: 30, impressions: 100 },
    { date: '2026-09-11', hour: 9, reps: 10, impressions: 50 },
  ],
  ...over,
});

describe('hourStatuses — the four states', () => {
  it('libre / partiel (minutes free) / plein / indisponible, never collapsed', () => {
    const rows = hourStatuses(['2026-09-10', '2026-09-12'], [9, 10, 11], new Set(['2026-09-12']), [
      alloc(),
    ]);
    const at = (date: string, hour: number) => rows.find((r) => r.date === date && r.hour === hour);
    expect(at('2026-09-10', 9)).toMatchObject({
      state: 'partiel',
      engaged_seconds: 100,
      minutes_free: 3.3,
      campaigns: 1,
    });
    expect(at('2026-09-10', 10)).toMatchObject({
      state: 'plein',
      engaged_seconds: 300,
      minutes_free: 0,
    });
    expect(at('2026-09-10', 11)).toMatchObject({
      state: 'libre',
      engaged_seconds: 0,
      minutes_free: 5,
    });
    expect(at('2026-09-12', 9)).toMatchObject({
      state: 'indisponible',
      minutes_free: null,
      campaigns: 0,
    });
  });

  it('an EN_ATTENTE or REFUSE share does not occupy the screen', () => {
    const rows = hourStatuses(['2026-09-10'], [9], new Set(), [
      alloc({ statutAcceptation: 'EN_ATTENTE' }),
    ]);
    expect(rows[0]?.state).toBe('libre');
  });
});

describe('campaignsOnVenue — ran fully / disrupted / redispatched / money lost', () => {
  it('counts elapsed vs delivered slots and values the missed ones at CPM (the ruled rule)', () => {
    const delivered = new Map([['c1', new Set(['2026-09-10:9'])]]);
    const [row] = campaignsOnVenue(
      'sh1',
      [alloc()],
      '2026-09-10',
      '2026-09-11',
      '2026-09-11',
      12,
      delivered,
      [
        {
          campaignId: 'c1',
          missedFrom: [{ screenhost_id: 'sh1' }],
          placedTo: [{ screenhost_id: 'sh2', added_fact: 60 }],
        },
      ],
    );
    expect(row).toMatchObject({
      slots_in_period: 3,
      slots_elapsed: 3,
      slots_delivered: 1,
      slots_missed: 2,
      impressions_missed_physical: 150,
      impressions_missed_fact: 90, // ⌊150 × 0.6⌋
      money_lost_tnd: 0.9, // 90 × 10 / 1000
      ran_fully: false,
      disrupted: true,
      received_redispatch: false,
      redirected_to: [{ screenhost_id: 'sh2', added_fact: 60 }],
    });
  });

  it('a host that delivered every elapsed slot ran fully and lost nothing; one that received a round is flagged', () => {
    const delivered = new Map([['c1', new Set(['2026-09-10:9', '2026-09-10:10', '2026-09-11:9'])]]);
    const [row] = campaignsOnVenue(
      'sh2',
      [alloc()],
      '2026-09-10',
      '2026-09-11',
      '2026-09-12',
      0,
      delivered,
      [
        {
          campaignId: 'c1',
          missedFrom: [{ screenhost_id: 'sh1' }],
          placedTo: [{ screenhost_id: 'sh2', added_fact: 60 }],
        },
      ],
    );
    expect(row).toMatchObject({
      ran_fully: true,
      disrupted: false,
      money_lost_tnd: 0,
      received_redispatch: true,
    });
  });

  it('future slots are neither delivered nor missed; a campaign outside the période is absent', () => {
    const [row] = campaignsOnVenue(
      'sh1',
      [alloc()],
      '2026-09-10',
      '2026-09-11',
      '2026-09-10',
      10,
      new Map(),
      [],
    );
    expect(row).toMatchObject({ slots_elapsed: 1, slots_missed: 1, slots_in_period: 3 });
    expect(
      campaignsOnVenue(
        'sh1',
        [alloc()],
        '2026-10-01',
        '2026-10-02',
        '2026-10-05',
        0,
        new Map(),
        [],
      ),
    ).toEqual([]);
  });
});
