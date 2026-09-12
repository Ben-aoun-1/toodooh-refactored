import { describe, expect, it } from 'vitest';

import type { AcceptedAllocation } from '@/features/screenhost/services/screenhost-calendar.service';

import {
  campaignsOnDay,
  declareConfirmCopy,
  declareResultCopy,
  fmtHour,
  groupCreneauxByDate,
} from './diffusion-calendar';

const alloc = (over: Partial<AcceptedAllocation> = {}): AcceptedAllocation => ({
  id: 'a1',
  campaign_id: 'c1',
  campaign_name: 'Été',
  start_date: '2026-09-20',
  end_date: '2026-09-22',
  screenhost_id: 'sh1',
  screenhost_name: 'Café',
  creneaux: [
    { date: '2026-09-21', hour: 10, impressions: 100 },
    { date: '2026-09-21', hour: 9, impressions: 50 },
    { date: '2026-09-22', hour: 12, impressions: 70 },
  ],
  ...over,
});

// CAL-1 — the diffusion layer's pure helpers (the merged page has no render harness).
describe('groupCreneauxByDate', () => {
  it('one entry per (allocation, date), hours sorted, impressions summed', () => {
    const byDate = groupCreneauxByDate([alloc()]);
    expect([...byDate.keys()].sort()).toEqual(['2026-09-21', '2026-09-22']);
    expect(byDate.get('2026-09-21')).toEqual([
      expect.objectContaining({ hours: [9, 10], impressions: 150, campaignName: 'Été' }),
    ]);
  });

  it('campaignsOnDay dedupes across allocations of the same campaign', () => {
    const byDate = groupCreneauxByDate([
      alloc(),
      alloc({ id: 'a2', screenhost_id: 'sh2', screenhost_name: 'Bar' }),
    ]);
    expect(campaignsOnDay(byDate.get('2026-09-21'))).toEqual(['Été']);
    expect(campaignsOnDay(undefined)).toEqual([]);
  });
});

describe('copy', () => {
  it('the confirm names the campaigns and says the share moves', () => {
    expect(declareConfirmCopy(['Été'])).toContain('La campagne « Été » diffuse ce jour-là');
    expect(declareConfirmCopy(['Été', 'Hiver'])).toContain('2 campagnes diffusent ce jour-là');
  });

  it('the result toast comes from the api account of what moved', () => {
    expect(declareResultCopy([])).toBe('Jour déclaré indisponible.');
    const base = { campaign_id: 'c', slots_moved: 3, v_fact: 100 };
    expect(
      declareResultCopy([
        { ...base, campaign_name: 'Été', mode: 'cascade', absorbed: 100, residual: 0 },
      ]),
    ).toContain("« Été » : part redistribuée à d'autres établissements");
    expect(
      declareResultCopy([
        { ...base, campaign_name: 'Été', mode: 'cascade', absorbed: 40, residual: 60 },
      ]),
    ).toContain('en partie');
    expect(
      declareResultCopy([
        { ...base, campaign_name: 'Été', mode: 'reliquat', absorbed: 0, residual: 100 },
      ]),
    ).toContain('au prochain passage');
  });

  it('fmtHour pads', () => {
    expect(fmtHour(9)).toBe('09h');
  });
});
