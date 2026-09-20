import { describe, expect, it } from 'vitest';

import {
  type AllocationForStatus,
  campaignsOnVenue,
  hourStatuses,
  isElapsed,
} from '../src/lib/admin-testing-status.js';
import { DEFAULT_REVERSEMENT_PCTS } from '../src/lib/reversement/split.js';

// ADM-OBS1 slice B — the pure derivations behind the « Tests » page's status and campaign views.
// ADM-OBS2 — rulings D (pending shares engage, event-held hours are a fifth state) and C (the
// missed value AND the host's own share of it).
const NO_RESERVATION = new Set<string>();
const F = 300;
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

describe('hourStatuses — the five states', () => {
  it('libre / partiel (seconds free) / plein / indisponible / réservée, never collapsed', () => {
    const rows = hourStatuses(
      ['2026-09-10', '2026-09-12'],
      [9, 10, 11, 12],
      new Set(['2026-09-12']),
      new Set(['2026-09-10:12']),
      [alloc()],
      F,
    );
    const at = (date: string, hour: number) => rows.find((r) => r.date === date && r.hour === hour);
    expect(at('2026-09-10', 9)).toMatchObject({
      state: 'partiel',
      engaged_seconds: 100,
      pending_seconds: 0,
      seconds_free: 200,
      reps: 10,
      campaigns: 1,
    });
    expect(at('2026-09-10', 10)).toMatchObject({
      state: 'plein',
      engaged_seconds: 300,
      seconds_free: 0,
      reps: 30,
    });
    expect(at('2026-09-10', 11)).toMatchObject({
      state: 'libre',
      engaged_seconds: 0,
      seconds_free: 300,
      reps: 0,
    });
    // An event holds 12h: classic capacity is gone (the pool drops the hour from Hi).
    expect(at('2026-09-10', 12)).toMatchObject({ state: 'reservee_evenement', seconds_free: null });
    expect(at('2026-09-12', 9)).toMatchObject({
      state: 'indisponible',
      seconds_free: null,
      campaigns: 0,
    });
  });

  it('an EN_ATTENTE share is engaged (the engine still holds it) and shown apart as pending', () => {
    const rows = hourStatuses(
      ['2026-09-10'],
      [9, 10],
      new Set(),
      NO_RESERVATION,
      [alloc({ statutAcceptation: 'EN_ATTENTE' })],
      F,
    );
    expect(rows[0]).toMatchObject({
      state: 'partiel',
      engaged_seconds: 100,
      pending_seconds: 100,
      seconds_free: 200,
      reps: 10,
    });
    expect(rows[1]).toMatchObject({ state: 'plein', pending_seconds: 300 });
  });

  it('a REFUSE share, or any share of a rejected campaign, holds nothing', () => {
    for (const over of [
      { statutAcceptation: 'REFUSE' },
      { campaignStatus: 'rejected', statutAcceptation: 'EN_ATTENTE' },
    ]) {
      const rows = hourStatuses(['2026-09-10'], [9], new Set(), NO_RESERVATION, [alloc(over)], F);
      expect(rows[0]).toMatchObject({ state: 'libre', engaged_seconds: 0, seconds_free: F });
    }
  });

  it('F comes from the caller (the config in force), not from whichever plan is first', () => {
    const rows = hourStatuses(['2026-09-10'], [9], new Set(), NO_RESERVATION, [alloc()], 150);
    expect(rows[0]).toMatchObject({ state: 'partiel', seconds_free: 50 });
  });
});

describe('isElapsed — strictly before the current Tunis hour', () => {
  it('past days and earlier hours of today are elapsed; the current hour is not', () => {
    expect(isElapsed('2026-09-17', 23, '2026-09-18', 10)).toBe(true);
    expect(isElapsed('2026-09-18', 9, '2026-09-18', 10)).toBe(true);
    expect(isElapsed('2026-09-18', 10, '2026-09-18', 10)).toBe(false);
    expect(isElapsed('2026-09-19', 0, '2026-09-18', 10)).toBe(false);
  });
});

describe('campaignsOnVenue — ran fully / disrupted / redispatched / money lost', () => {
  it('counts elapsed vs delivered slots, values the missed ones at CPM and gives the host share', () => {
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
      DEFAULT_REVERSEMENT_PCTS,
    );
    expect(row).toMatchObject({
      slots_in_period: 3,
      slots_elapsed: 3,
      slots_delivered: 1,
      slots_missed: 2,
      impressions_missed_physical: 150,
      impressions_missed_fact: 90, // ⌊150 × 0.6⌋
      missed_value_tnd: 0.9, // 90 × 10 / 1000
      host_share_lost_tnd: 0.45, // the SH line: 50 % of 900 millimes
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
      DEFAULT_REVERSEMENT_PCTS,
    );
    expect(row).toMatchObject({
      ran_fully: true,
      disrupted: false,
      missed_value_tnd: 0,
      host_share_lost_tnd: 0,
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
      DEFAULT_REVERSEMENT_PCTS,
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
        DEFAULT_REVERSEMENT_PCTS,
      ),
    ).toEqual([]);
  });

  it('the host share floors to the millime like the settlement, and a drifted split reads null', () => {
    // 7 facturable × 10 / 1000 = 0.07 TND = 70 millimes; 50 % → 35 millimes.
    const one = alloc({
      t: 1,
      creneaux: [{ date: '2026-09-10', hour: 9, reps: 1, impressions: 7 }],
    });
    const args = [
      'sh1',
      [one],
      '2026-09-10',
      '2026-09-10',
      '2026-09-11',
      0,
      new Map(),
      [],
    ] as const;
    expect(campaignsOnVenue(...args, DEFAULT_REVERSEMENT_PCTS)[0]).toMatchObject({
      missed_value_tnd: 0.07,
      host_share_lost_tnd: 0.035,
    });
    // 33 millimes at 50 % → 16.5 → the SH line FLOORS to 16.
    const odd = alloc({
      t: 1,
      cpm: 11,
      creneaux: [{ date: '2026-09-10', hour: 9, reps: 1, impressions: 3 }],
    });
    expect(
      campaignsOnVenue('sh1', [odd], '2026-09-10', '2026-09-10', '2026-09-11', 0, new Map(), [], {
        ...DEFAULT_REVERSEMENT_PCTS,
      })[0]?.host_share_lost_tnd,
    ).toBe(0.016);
    expect(
      campaignsOnVenue(...args, { sh: 60, toodooh: 44, agentSh: 3, agentSc: 3 })[0]
        ?.host_share_lost_tnd,
    ).toBeNull();
  });
});
