import { describe, expect, it } from 'vitest';

import type { AgentCampaign } from '../services/agent-portfolio.service';

import {
  campaignCounters,
  cardModel,
  filterCampaigns,
  filterShCampaigns,
  scoreLabel,
  sortFollowup,
  frDate,
  initialsOf,
  variationLabel,
} from './agent-portfolio';

const row = (over: Partial<AgentCampaign>): AgentCampaign => ({
  id: 'c',
  name: 'Campagne',
  type: 'standard',
  status: 'active',
  start_date: '2026-10-01',
  end_date: '2026-10-30',
  affiliate_id: 'a1',
  affiliate_name: 'Pâtisserie Lina',
  impressions: 100,
  revenue_tnd: 0,
  forecast_tnd: 0,
  ...over,
});

describe('AGT-4 — agent portfolio rules', () => {
  const rows = [
    row({ id: '1', name: 'Ramadan', status: 'active' }),
    row({ id: '2', name: 'Été', status: 'terminee', affiliate_id: 'a2', affiliate_name: 'Café' }),
    row({ id: '3', name: 'Rentrée', status: 'a_venir' }),
  ];

  it('counters: Total = Actives + À venir + Terminées', () => {
    const c = campaignCounters(rows);
    expect(c).toEqual({ total: 3, active: 1, a_venir: 1, terminee: 1 });
    expect(c.total).toBe(c.active + c.a_venir + c.terminee);
  });

  it('filters by tab, accent-insensitive search on campaign or Screencaster, and affiliate', () => {
    expect(filterCampaigns(rows, 'active', '', null).map((r) => r.id)).toEqual(['1']);
    expect(filterCampaigns(rows, 'all', 'patisserie', null).map((r) => r.id)).toEqual(['1', '3']);
    expect(filterCampaigns(rows, 'all', 'ete', null).map((r) => r.id)).toEqual(['2']);
    expect(filterCampaigns(rows, 'all', '', 'a2').map((r) => r.id)).toEqual(['2']);
  });

  it('formats dates, initials and variations', () => {
    expect(frDate('2026-10-01')).toBe('01/10/2026');
    expect(frDate(null)).toBe('—');
    expect(initialsOf('Pâtisserie Lina')).toBe('PL');
    expect(initialsOf('Café')).toBe('C');
    expect(variationLabel(12.5)).toEqual({ text: '+12,5 %', up: true });
    expect(variationLabel(-3)).toEqual({ text: '−3 %', up: false });
    expect(variationLabel(null)).toBeNull();
  });
});

describe('AGT-7 — the Screenhost agent views', () => {
  it('a Screenhost campaign card shows the advertiser and the venues touched', () => {
    const sh = {
      id: 's',
      name: 'Ramadan',
      type: 'standard' as const,
      status: 'active' as const,
      start_date: '2026-10-01',
      end_date: '2026-10-30',
      advertiser_name: 'Pâtisserie Lina',
      venues: [
        { id: 'v1', name: 'Café Nord', impressions: 10 },
        { id: 'v2', name: 'Café Sud', impressions: 5 },
      ],
      venues_touched: 2,
      impressions: 15,
      revenue_tnd: 1,
      forecast_tnd: 2,
    };
    expect(cardModel(sh)).toMatchObject({
      avatar_name: 'Pâtisserie Lina',
      subtitle: 'Pâtisserie Lina — 2 Screenhosts touchés',
    });
    expect(filterShCampaigns([sh], 'all', 'cafe sud', null)).toHaveLength(1);
    expect(filterShCampaigns([sh], 'all', '', 'v3')).toHaveLength(0);
  });

  it('follow-up: attention first, then the lowest score; a dash without offers', () => {
    const r = (name: string, sps: number | null, attention: number) => ({
      screenhost_id: name,
      name,
      status: 'en_cours' as const,
      sps,
      trend: null,
      refused: 0,
      no_answer: 0,
      missed: 0,
      attention: Array.from({ length: attention }, (_, i) => ({ key: `k${i}`, label: 'x' })),
      computed_at: null,
    });
    const rows = [r('A', 80, 0), r('B', 40, 0), r('C', 90, 1), r('D', null, 0)];
    expect(sortFollowup(rows, 'default').map((x) => x.name)).toEqual(['C', 'B', 'A', 'D']);
    expect(sortFollowup(rows, 'name').map((x) => x.name)).toEqual(['A', 'B', 'C', 'D']);
    expect(scoreLabel(null)).toBe('—');
    expect(scoreLabel(71.6)).toBe('72 / 100');
  });
});
