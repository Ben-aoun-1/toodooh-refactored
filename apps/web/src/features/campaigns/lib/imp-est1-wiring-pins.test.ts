import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// IMP-EST1 (Q2 A) — every surface that showed the retired ⌊budget × 1000 ÷ CPM⌋ now reads the
// server's dry-run (useImpressionsEstimate → GET /:id/impressions-estimate). Source-pinned: the web
// has no render harness (vitest node env, .test.ts only).

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const SURFACES = {
  wizardRecap: '../pages/new-campaign/StepCart.tsx',
  eventRecap: '../../events/components/EventRecapStep.tsx',
  prevues: '../components/CampaignPrevues.tsx',
};

describe('« Impressions estimées » reads the dispatch dry-run everywhere', () => {
  it('the wizard recap, the event recap and « prévues » all ask useImpressionsEstimate', () => {
    for (const rel of Object.values(SURFACES)) {
      expect(read(rel), rel).toContain('useImpressionsEstimate(');
    }
  });

  it('the cursor sizes the dry-run on both recaps (budgetTnd: value)', () => {
    expect(read(SURFACES.wizardRecap)).toContain('budgetTnd: value');
    expect(read(SURFACES.eventRecap)).toContain('budgetTnd: value');
  });

  it('the retired CPM formula is gone (helper deleted, no consumer left)', () => {
    expect(existsSync(fileURLToPath(new URL('./impressions.ts', import.meta.url)))).toBe(false);
    for (const rel of [
      ...Object.values(SURFACES),
      './campaign-impressions.ts',
      '../pages/MyCampaigns.tsx',
      '../components/CampaignDrawer.tsx',
      '../../advertiser/components/dashboard/LastCampaignsGrid.tsx',
    ]) {
      expect(read(rel), rel).not.toMatch(/estimateImpressions|campaignCpm\(|impressionsDisplay\(/);
    }
  });

  it('« Mes campagnes » (cards, rows, drawer) and the dashboard grid render CampaignPrevues', () => {
    const page = read('../pages/MyCampaigns.tsx');
    expect(page.match(/<CampaignPrevues campaign=/g)?.length).toBe(3);
    expect(read('../../advertiser/components/dashboard/LastCampaignsGrid.tsx')).toContain(
      '<CampaignPrevues campaign={campaign} />',
    );
  });

  it('the estimate request fires only for a plan-less row (a frozen plan wins)', () => {
    expect(read(SURFACES.prevues)).toContain('enabled: planned === null');
  });

  it('…and only in a pre-dispatch status: the list rows never pay for a terminal row', () => {
    expect(read(SURFACES.prevues)).toContain('notEstimable: !isEstimableStatus(campaign.status)');
    // The hook must honour it by NOT sending the request (the cost half of the gate).
    expect(read('../hooks/useImpressionsEstimate.ts')).toContain('enabled && !notEstimable');
  });
});
