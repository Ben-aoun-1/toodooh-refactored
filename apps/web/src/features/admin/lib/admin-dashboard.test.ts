import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { PlatformStats } from '@/features/admin/types/platform-stats';

import {
  CAMPAIGN_ACTIVITY_ORDER,
  campaignActivityRows,
  campaignFilterLabel,
  campaignQueueHref,
  formatHt,
  revenueMonthLabel,
} from './admin-dashboard';
import {
  CAMPAIGN_QUEUE_ALL,
  CAMPAIGN_QUEUE_OPTIONS,
  parseCampaignQueueFilter,
} from './campaign-queue';

// DASH-1 (operator rulings 2026-09-21) — the admin dashboard's view rules. apps/web has no render
// harness, so the page keeps no logic of its own and these pin it.

const campaigns: PlatformStats['campaigns'] = {
  total: 21,
  draft: 1,
  pending: 2,
  upcoming: 3,
  active: 4,
  rejected: 5,
  completed: 6,
  average_budget_tnd: 0,
};

// Intl separates groups and the currency with no-break spaces; compare on plain spaces.
const plain = (s: string): string => s.replace(/\s/g, ' ');

describe('« Activité campagnes » (R6 — one vocabulary, six statuses, lifecycle order)', () => {
  it('lists all six stored statuses in lifecycle order, labelled from the queue vocabulary', () => {
    const rows = campaignActivityRows(campaigns);
    expect(rows.map((r) => r.label)).toEqual([
      'Brouillons',
      'En attente',
      'À venir',
      'Actives',
      'Passées',
      'Non validés',
    ]);
    expect(rows.map((r) => r.status)).toEqual([
      'draft',
      'pending',
      'upcoming',
      'active',
      'completed',
      'rejected',
    ]);
    expect(CAMPAIGN_ACTIVITY_ORDER).toHaveLength(6);
  });

  it('every label IS the admin queue’s label for that status — never a local synonym', () => {
    for (const row of campaignActivityRows(campaigns)) {
      const option = CAMPAIGN_QUEUE_OPTIONS.find((o) => o.value === row.status);
      expect(row.label).toBe(option?.label);
    }
  });

  it('carries each status count, and « En attente » is no longer missing', () => {
    const counts = Object.fromEntries(
      campaignActivityRows(campaigns).map((r) => [r.status, r.count]),
    );
    expect(counts).toEqual({
      draft: 1,
      pending: 2,
      upcoming: 3,
      active: 4,
      completed: 6,
      rejected: 5,
    });
  });

  it('renders zeros (never blanks) while the stats are loading', () => {
    expect(campaignActivityRows(undefined).map((r) => r.count)).toEqual([0, 0, 0, 0, 0, 0]);
  });
});

describe('campaign deep links', () => {
  it('the « Total » tile opens « Toutes », not the queue default (« En attente »)', () => {
    const href = campaignQueueHref(CAMPAIGN_QUEUE_ALL);
    expect(href).toBe('/admin-campaigns?status=all');
    const param = new URLSearchParams(href.split('?')[1]).get('status');
    expect(parseCampaignQueueFilter(param)).toBe(CAMPAIGN_QUEUE_ALL);
  });

  it('a status tile lands on its own bucket', () => {
    expect(campaignQueueHref('completed')).toBe('/admin-campaigns?status=completed');
    expect(campaignFilterLabel('completed')).toBe('Passées');
    expect(campaignFilterLabel('active')).toBe('Actives');
  });
});

describe('money figures say HT', () => {
  it('formats an amount in TND with two decimals and the HT marker', () => {
    expect(plain(formatHt(1234.5))).toBe('1 234,50 TND HT');
    expect(plain(formatHt(0))).toBe('0,00 TND HT');
  });
});

describe('« Revenu mensuel » names its Tunis month', () => {
  it('turns the wire month into a French month label', () => {
    expect(revenueMonthLabel('2026-10')).toBe('octobre 2026');
    expect(revenueMonthLabel('2027-01')).toBe('janvier 2027');
  });

  it('renders « — » for a missing or malformed month', () => {
    expect(revenueMonthLabel(undefined)).toBe('—');
    expect(revenueMonthLabel('octobre')).toBe('—');
  });
});

// The page is pinned by source (no render harness): the retired labels and the recharge-era
// fields cannot come back, and the lib above is what it renders. Comments are stripped first —
// they may name a retired label to explain what replaced it.
describe('AdminDashboard wiring', () => {
  const source = (...parts: string[]): string =>
    readFileSync(join(__dirname, '..', ...parts), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
  const page = source('pages', 'AdminDashboard.tsx');
  const revenue = source('components', 'DashboardRevenue.tsx');

  it('drops the retired tiles and labels', () => {
    for (const retired of [
      'Budget Campagnes',
      'Revenu Total',
      'Revenu Mensuel',
      'Terminées',
      'Rejetées',
      'Écrans actifs',
      '>Actifs<',
      'total_budget_tnd',
      'monthly_tnd',
      'screensStats?.active',
      'formatCurrency',
    ]) {
      expect(page).not.toContain(retired);
      expect(revenue).not.toContain(retired);
    }
    // « Actives » (campaigns) still renders, through the vocabulary — only the screens’ is gone.
    expect(page).toContain('campaignsStats?.active ?? 0');
  });

  it('renders the ruled revenue tiles, HT, with the Tunis month', () => {
    expect(page).toContain('<DashboardRevenue revenue={revenueStats} />');
    for (const wired of [
      'Revenu Toodooh',
      'Revenu mensuel',
      'Revenu total',
      'revenue?.toodooh_tnd',
      'revenue?.total_tnd',
      'revenue?.monthly.total_tnd',
      'revenue?.monthly.toodooh_tnd',
      'revenueMonthLabel(revenue?.monthly.month)',
    ]) {
      expect(revenue).toContain(wired);
    }
    expect(revenue).not.toMatch(/\{revenue\?\.[a-z_.]+ \?\? 0\}/); // every amount goes through formatHt
  });

  it('renders the ruled screens, campaigns and activity through the lib', () => {
    for (const wired of [
      'Installés',
      'En ligne',
      'Écrans installés',
      'Écrans en ligne',
      'screensStats?.installed',
      'screensStats?.online',
      'campaignActivityRows(campaignsStats)',
      'campaignQueueHref(CAMPAIGN_QUEUE_ALL)',
      'formatHt(campaignsStats?.average_budget_tnd',
    ]) {
      expect(page).toContain(wired);
    }
    expect(page).not.toContain("navigate('/admin-campaigns");
  });
});
