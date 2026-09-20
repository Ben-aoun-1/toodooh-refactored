import { describe, expect, it } from 'vitest';

import { CAMPAIGN_STATUS_IDS, CAMPAIGN_STATUS_UI } from '@/features/campaigns/lib/campaign-status';

import {
  CAMPAIGN_QUEUE_ALL,
  CAMPAIGN_QUEUE_DEFAULT,
  CAMPAIGN_QUEUE_OPTIONS,
  isCampaignQueueFilter,
  isPeriodeDepassee,
  parseCampaignQueueFilter,
  queueFilterStatus,
} from './campaign-queue';

// ADM-FIX1 — the admin campaign queue's pure rules. The bug these pin: the queue held its filter in
// a plain useState and ignored `?status=`, so the dashboard's deep links landed on « En attente ».

describe('the queue filter', () => {
  it('offers every stored status PLUS « Toutes » — nothing is unreachable', () => {
    const values = CAMPAIGN_QUEUE_OPTIONS.map((o) => o.value);
    for (const id of CAMPAIGN_STATUS_IDS) expect(values).toContain(id);
    expect(values).toContain(CAMPAIGN_QUEUE_ALL);
    expect(values).toHaveLength(CAMPAIGN_STATUS_IDS.length + 1);
    // Every option is labelled in French, none leaks the raw id.
    for (const o of CAMPAIGN_QUEUE_OPTIONS) expect(o.label).not.toBe(o.value);
  });

  it('accepts every option value and rejects anything else', () => {
    for (const o of CAMPAIGN_QUEUE_OPTIONS) expect(isCampaignQueueFilter(o.value)).toBe(true);
    expect(isCampaignQueueFilter('paused')).toBe(false); // the retired legacy status
    expect(isCampaignQueueFilter('')).toBe(false);
    expect(isCampaignQueueFilter(null)).toBe(false);
    expect(isCampaignQueueFilter(undefined)).toBe(false);
  });

  it('parses the URL param, falling back to « En attente » for absent/unknown values', () => {
    expect(parseCampaignQueueFilter('active')).toBe('active');
    expect(parseCampaignQueueFilter('upcoming')).toBe('upcoming');
    expect(parseCampaignQueueFilter('completed')).toBe('completed');
    expect(parseCampaignQueueFilter(CAMPAIGN_QUEUE_ALL)).toBe(CAMPAIGN_QUEUE_ALL);
    expect(parseCampaignQueueFilter(null)).toBe(CAMPAIGN_QUEUE_DEFAULT);
    expect(parseCampaignQueueFilter('nonsense')).toBe(CAMPAIGN_QUEUE_DEFAULT);
    expect(CAMPAIGN_QUEUE_DEFAULT).toBe('pending');
  });

  it('« Toutes » omits the api param; every other filter is sent verbatim', () => {
    expect(queueFilterStatus(CAMPAIGN_QUEUE_ALL)).toBeUndefined();
    for (const id of CAMPAIGN_STATUS_IDS) expect(queueFilterStatus(id)).toBe(id);
  });

  // CONTROLLER RULING (review round) — one vocabulary: the canonical badge map wins, so a
  // filter's label may only pluralize the badge's, never rename it (the badge said « Non
  // validé » while the filter said « Rejetées »; « Passée » vs « Terminées »). This strips at
  // most one trailing plural « s » and requires what's left to match verbatim.
  it('every filter label shares its stem with the canonical badge label', () => {
    const stem = (label: string): string => (label.endsWith('s') ? label.slice(0, -1) : label);
    for (const id of CAMPAIGN_STATUS_IDS) {
      const option = CAMPAIGN_QUEUE_OPTIONS.find((o) => o.value === id);
      expect(option).toBeDefined();
      expect(stem(option?.label ?? '')).toBe(stem(CAMPAIGN_STATUS_UI[id].label));
    }
  });
});

describe('« Période dépassée » (display-only ruling)', () => {
  // Fixed dates, never `new Date()`: the verdict must not depend on WHEN the suite runs.
  const today = '2026-09-20';

  it('flags a pending campaign whose end_date is STRICTLY before today', () => {
    expect(isPeriodeDepassee({ status: 'pending', endDate: '2026-09-19', todayIso: today })).toBe(
      true,
    );
    expect(isPeriodeDepassee({ status: 'pending', endDate: '2020-01-01', todayIso: today })).toBe(
      true,
    );
  });

  it('does NOT flag a période ending today or later (strictly before, not on or after)', () => {
    expect(isPeriodeDepassee({ status: 'pending', endDate: today, todayIso: today })).toBe(false);
    expect(isPeriodeDepassee({ status: 'pending', endDate: '2026-09-21', todayIso: today })).toBe(
      false,
    );
  });

  it('only ever applies to a PENDING campaign — no other status is re-judged', () => {
    for (const status of CAMPAIGN_STATUS_IDS.filter((s) => s !== 'pending')) {
      expect(isPeriodeDepassee({ status, endDate: '2020-01-01', todayIso: today })).toBe(false);
    }
  });

  it('a campaign with no end_date, or an unusable date, is never flagged', () => {
    expect(isPeriodeDepassee({ status: 'pending', endDate: null, todayIso: today })).toBe(false);
    expect(isPeriodeDepassee({ status: 'pending', endDate: 'bientôt', todayIso: today })).toBe(
      false,
    );
    expect(isPeriodeDepassee({ status: 'pending', endDate: '2020-01-01', todayIso: 'x' })).toBe(
      false,
    );
  });

  it('tolerates a datetime end_date by comparing the DAY only', () => {
    expect(
      isPeriodeDepassee({ status: 'pending', endDate: '2026-09-19T23:00:00Z', todayIso: today }),
    ).toBe(true);
    expect(
      isPeriodeDepassee({ status: 'pending', endDate: '2026-09-20T00:00:00Z', todayIso: today }),
    ).toBe(false);
  });
});
