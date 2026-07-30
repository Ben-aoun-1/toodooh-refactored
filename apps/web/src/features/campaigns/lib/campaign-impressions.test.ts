import { describe, expect, it } from 'vitest';

import {
  PREVUES_LABEL,
  cpmForCampaignType,
  formatImpressions,
  impressionsDisplay,
} from './campaign-impressions';

// CF-HF3 item 3, amended by CF-HF4 (Kais): the advertiser display rule is PRÉVUES-ONLY.
// prévues = the frozen plan's placed facturable when a plan exists, else the budget estimate;
// '—' when neither is derivable — never a fake 0 on a funded campaign. The validées numbers left
// every cast surface (host surfaces keep their own delivered reads — pinned in cf-hf4-pins).

const PRICING = { standard_cpm_tnd: 15, event_cpm_tnd: 15 };

describe('impressionsDisplay — prévues-only', () => {
  it('a frozen plan wins: prévues = planned_impressions, whatever the status', () => {
    for (const status of ['draft', 'pending', 'upcoming', 'active', 'completed']) {
      const d = impressionsDisplay(
        { status, planned_impressions: 20000, requested_budget: 300 },
        PRICING,
      );
      expect(d).toEqual({ prevues: 20000 });
    }
  });

  it('no plan → the budget estimate at the type CPM; event campaigns price at the event CPM', () => {
    const std = impressionsDisplay(
      { status: 'draft', planned_impressions: null, requested_budget: 300 },
      PRICING,
    );
    expect(std.prevues).toBe(20000); // ⌊300×1000/15⌋

    const evt = impressionsDisplay(
      {
        status: 'draft',
        campaign_type: 'event',
        planned_impressions: null,
        requested_budget: 300,
      },
      { standard_cpm_tnd: 15, event_cpm_tnd: 30 },
    );
    expect(evt.prevues).toBe(10000); // the event CPM, never the standard one
  });

  it('nothing derivable → null (renders — via formatImpressions)', () => {
    const d = impressionsDisplay(
      { status: 'draft', planned_impressions: null, requested_budget: null },
      PRICING,
    );
    expect(d.prevues).toBeNull();
    expect(formatImpressions(d.prevues)).toBe('—');
  });

  it('formatImpressions: a real 0 stays 0; fr-FR grouping', () => {
    expect(formatImpressions(0)).toBe('0');
    expect(formatImpressions(20000)).toBe('20\u202f000'); // fr-FR narrow NBSP grouping
  });

  it('cpmForCampaignType picks by type and degrades to null', () => {
    expect(cpmForCampaignType('standard', PRICING)).toBe(15);
    expect(cpmForCampaignType('event', { event_cpm_tnd: 30 })).toBe(30);
    expect(cpmForCampaignType('standard', undefined)).toBeNull();
  });

  it('the label is the ONE French literal', () => {
    expect(PREVUES_LABEL).toBe('Impressions prévues');
  });
});
