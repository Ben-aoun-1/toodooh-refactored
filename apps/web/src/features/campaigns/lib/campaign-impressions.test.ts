import { describe, expect, it } from 'vitest';

import {
  PREVUES_LABEL,
  VALIDEES_LABEL,
  cpmForCampaignType,
  formatImpressions,
  impressionsDisplay,
} from './campaign-impressions';

// CF-HF3 (Mejri item 3) — the ONE impressions display rule, per status: prévues from the frozen
// plan (else the budget estimate), validées only on Active/Passée, '—' for a not-yet value —
// never a fake 0 on a funded campaign.

const PRICING = { standard_cpm_tnd: 15, event_cpm_tnd: 30 };

describe('impressionsDisplay — the per-status matrix', () => {
  it('a PLANNED campaign shows the frozen plan facturable (the plan wins over the estimate)', () => {
    const d = impressionsDisplay(
      {
        status: 'upcoming',
        planned_impressions: 18000,
        requested_budget: 300,
        validated_impressions: null,
      },
      PRICING,
    );
    expect(d).toEqual({ prevues: 18000, validees: null, showValidees: false });
  });

  it('a FUNDED plan-less campaign estimates ⌊budget×1000/cpm⌋ — never a bare 0', () => {
    for (const status of ['draft', 'pending', 'upcoming']) {
      const d = impressionsDisplay(
        { status, planned_impressions: null, requested_budget: 300, validated_impressions: null },
        PRICING,
      );
      expect(d.prevues).toBe(20000); // ⌊300×1000/15⌋
      expect(d.showValidees).toBe(false);
    }
  });

  it('an EVENT campaign estimates at the event CPM (never 2× overstated)', () => {
    const d = impressionsDisplay(
      {
        status: 'pending',
        campaign_type: 'event',
        planned_impressions: null,
        requested_budget: 300,
        validated_impressions: null,
      },
      PRICING,
    );
    expect(d.prevues).toBe(10000); // ⌊300×1000/30⌋
    expect(cpmForCampaignType('event', PRICING)).toBe(30);
    expect(cpmForCampaignType('standard', PRICING)).toBe(15);
  });

  it('Active/Passée show BOTH lines; validées stays null-honest until the reconcile writes it', () => {
    const active = impressionsDisplay(
      {
        status: 'active',
        planned_impressions: 18000,
        requested_budget: 300,
        validated_impressions: null,
      },
      PRICING,
    );
    expect(active.showValidees).toBe(true);
    expect(active.validees).toBeNull(); // '—', not a fake 0
    const settled = impressionsDisplay(
      {
        status: 'completed',
        planned_impressions: 18000,
        requested_budget: 300,
        validated_impressions: 12000,
      },
      PRICING,
    );
    expect(settled).toEqual({ prevues: 18000, validees: 12000, showValidees: true });
  });

  it('no plan, no budget (or no CPM) → prévues null (renders « — », never NaN/0)', () => {
    expect(
      impressionsDisplay(
        { status: 'draft', planned_impressions: null, requested_budget: null },
        PRICING,
      ).prevues,
    ).toBeNull();
    expect(
      impressionsDisplay(
        { status: 'draft', planned_impressions: null, requested_budget: 300 },
        undefined,
      ).prevues,
    ).toBeNull();
  });

  it('a genuinely ZERO validated settlement renders 0 (a real outcome, not absence)', () => {
    const d = impressionsDisplay(
      {
        status: 'completed',
        planned_impressions: 18000,
        requested_budget: 300,
        validated_impressions: 0,
      },
      PRICING,
    );
    expect(d.validees).toBe(0);
    expect(formatImpressions(d.validees)).toBe('0');
  });

  it('pins the French labels + the dash', () => {
    expect(PREVUES_LABEL).toBe('Impressions prévues');
    expect(VALIDEES_LABEL).toBe('Impressions validées');
    expect(formatImpressions(null)).toBe('—');
    expect(formatImpressions(20000)).toBe('20 000');
  });
});
