import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PERIOD,
  NATURE_PILLS,
  PERIOD_PILLS,
  campaignCountLabel,
  campaignScopeLabel,
  defaultScope,
  natureBadge,
  parseScope,
  periodLabel,
  resolveRange,
  writeScope,
} from './performances-period';

describe('SC-P epic 6 — the generation filter (RG-PERF-15..19)', () => {
  it('RG-PERF-17 — the four periods + Personnalisé, RG-PERF-18 — the three natures', () => {
    expect(PERIOD_PILLS.map((p) => p.label)).toEqual([
      '30 jours',
      '90 jours',
      '12 mois',
      'Depuis le début',
      'Personnalisé',
    ]);
    expect(NATURE_PILLS.map((p) => p.label)).toEqual(['Toutes', 'Normales', 'Événements']);
    expect(DEFAULT_PERIOD).toBe('90d');
  });

  it('parseScope — ?campaign= wins (Campaign mode); ?periode= is Period mode; nothing → null', () => {
    expect(parseScope(new URLSearchParams('campaign=c1&periode=30d'))).toEqual({
      mode: 'campaign',
      campaignId: 'c1',
    });
    expect(
      parseScope(new URLSearchParams('periode=custom&du=2026-07-03&au=2026-07-30&nature=event')),
    ).toEqual({
      mode: 'period',
      period: 'custom',
      nature: 'event',
      custom: { from: '2026-07-03', to: '2026-07-30' },
    });
    // Junk falls back rather than breaking the page.
    expect(parseScope(new URLSearchParams('periode=weird&nature=nope&du=bad'))).toEqual({
      mode: 'period',
      period: '90d',
      nature: 'all',
      custom: { from: null, to: null },
    });
    expect(parseScope(new URLSearchParams(''))).toBeNull();
  });

  it('writeScope round-trips and clears the other mode’s params', () => {
    const fromCampaign = writeScope(new URLSearchParams('campaign=c1&x=1'), {
      mode: 'period',
      period: 'custom',
      nature: 'normal',
      custom: { from: '2026-01-01', to: '2026-01-31' },
    });
    expect(fromCampaign.get('campaign')).toBeNull();
    expect(fromCampaign.get('x')).toBe('1');
    expect(parseScope(fromCampaign)).toEqual({
      mode: 'period',
      period: 'custom',
      nature: 'normal',
      custom: { from: '2026-01-01', to: '2026-01-31' },
    });
    const toCampaign = writeScope(fromCampaign, { mode: 'campaign', campaignId: 'c2' });
    expect([...toCampaign.keys()].sort()).toEqual(['campaign', 'x']);
  });

  it('retained hypothesis — page load initialises on the LAST closed campaign, else 90 days', () => {
    expect(defaultScope([{ id: 'newest' }, { id: 'older' }])).toEqual({
      mode: 'campaign',
      campaignId: 'newest',
    });
    expect(defaultScope([])).toMatchObject({ mode: 'period', period: '90d', nature: 'all' });
  });

  it('resolveRange — inclusive windows ending today (Tunis); custom needs both dates in order', () => {
    const today = '2026-07-31';
    const period = (p: '30d' | '90d' | '12m' | 'all') =>
      resolveRange(
        { mode: 'period', period: p, nature: 'all', custom: { from: null, to: null } },
        today,
      );
    expect(period('30d')).toEqual({ from: '2026-07-01', to: today, incomplete: false });
    expect(period('90d')).toEqual({ from: '2026-05-02', to: today, incomplete: false });
    expect(period('12m')).toEqual({ from: '2025-07-31', to: today, incomplete: false });
    expect(period('all')).toEqual({ from: null, to: null, incomplete: false });
    expect(
      resolveRange(
        {
          mode: 'period',
          period: 'custom',
          nature: 'all',
          custom: { from: '2026-07-03', to: null },
        },
        today,
      ),
    ).toEqual({ from: null, to: null, incomplete: true });
    expect(
      resolveRange(
        {
          mode: 'period',
          period: 'custom',
          nature: 'all',
          custom: { from: '2026-07-30', to: '2026-07-03' },
        },
        today,
      ).incomplete,
    ).toBe(true);
    expect(
      resolveRange(
        {
          mode: 'period',
          period: 'custom',
          nature: 'all',
          custom: { from: '2026-07-03', to: '2026-07-30' },
        },
        today,
      ),
    ).toEqual({ from: '2026-07-03', to: '2026-07-30', incomplete: false });
  });

  it('US-6.5 — the context band wording', () => {
    expect(
      periodLabel({
        mode: 'period',
        period: '90d',
        nature: 'all',
        custom: { from: null, to: null },
      }),
    ).toBe('la période : les 90 derniers jours');
    expect(
      periodLabel({
        mode: 'period',
        period: 'all',
        nature: 'event',
        custom: { from: null, to: null },
      }),
    ).toBe('la période : depuis le début · événements');
    expect(
      periodLabel({
        mode: 'period',
        period: 'custom',
        nature: 'normal',
        custom: { from: '2026-07-03', to: '2026-07-30' },
      }),
    ).toBe('la période : du 03/07/2026 au 30/07/2026 · normales');
    expect(campaignCountLabel(0)).toBe('0 campagne');
    expect(campaignCountLabel(1)).toBe('1 campagne');
    expect(campaignCountLabel(3)).toBe('3 campagnes');
    expect(campaignScopeLabel({ name: "Soldes d'Été 2026", closed_on: '2026-07-15' })).toBe(
      "Soldes d'Été 2026 · Juillet 2026",
    );
    expect(natureBadge('event')).toBe('Campagne événement');
    expect(natureBadge('normal')).toBe('Campagne normale');
  });
});
