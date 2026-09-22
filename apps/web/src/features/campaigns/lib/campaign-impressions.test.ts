import { describe, expect, it } from 'vitest';

import { PREVUES_LABEL, formatImpressions, plannedPrevues } from './campaign-impressions';

// CF-HF3 item 3, amended by CF-HF4 (Kais) and IMP-EST1 (2026-09-22): the advertiser display rule
// is PRÉVUES-ONLY. prévues = the frozen plan's figure when a plan exists; before that the surface
// shows the server’s dry-run estimate (components/CampaignPrevues, pinned in
// imp-est1-wiring-pins.test.ts) — the budget × 1000 ÷ CPM fallback is retired.

describe('plannedPrevues — the frozen plan wins', () => {
  it('a plan: prévues = planned_impressions', () => {
    expect(plannedPrevues({ planned_impressions: 20000 })).toBe(20000);
  });

  it('a real 0 plan stays 0 (a genuine outcome, not absence)', () => {
    expect(plannedPrevues({ planned_impressions: 0 })).toBe(0);
  });

  it('no plan → null: the surface asks the dry-run estimate (never a budget-derived number)', () => {
    expect(plannedPrevues({ planned_impressions: null })).toBeNull();
    expect(plannedPrevues({})).toBeNull();
  });
});

describe('formatImpressions', () => {
  it('a real 0 stays 0; fr-FR grouping; null renders —', () => {
    expect(formatImpressions(0)).toBe('0');
    expect(formatImpressions(20000)).toBe('20 000'); // fr-FR narrow NBSP grouping
    expect(formatImpressions(null)).toBe('—');
  });

  it('the label is the ONE French literal', () => {
    expect(PREVUES_LABEL).toBe('Impressions prévues');
  });
});
