import { describe, expect, it } from 'vitest';

import {
  PREVUES_LABEL,
  eventLinePrevues,
  eventPlacementPrevues,
  formatImpressions,
  plannedPrevues,
} from './campaign-impressions';

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

// IMP-FACT1 (operator, 2026-09-23) — « estimé et prévu should be the same »: a dispatched campaign's
// « Impressions prévues » is the BILLABLE objective paid for (impressions_objectif), not the plan's
// physical audience. The physical field still decides WHETHER the row is dispatched, and stands in
// only while an older api serves no objective.
describe('IMP-FACT1 — prévues is the objective paid for', () => {
  it('a dispatched row shows its objective, not the physical plan', () => {
    expect(plannedPrevues({ planned_impressions: 16_000, impressions_objectif: 10_000 })).toBe(
      10_000,
    );
  });

  it('a pre-dispatch row stays null: the surface shows the estimate (whose value is the objective)', () => {
    expect(plannedPrevues({ planned_impressions: null, impressions_objectif: 10_000 })).toBeNull();
  });

  it('an older api (no objective) falls back to the physical plan', () => {
    expect(plannedPrevues({ planned_impressions: 16_000 })).toBe(16_000);
  });

  it("the event drawer: the header is the objective, each line the venue's billable share", () => {
    expect(eventPlacementPrevues({ impressions_total: 52_000, impressions_objectif: 40_000 })).toBe(
      40_000,
    );
    expect(eventPlacementPrevues({ impressions_total: 52_000 })).toBe(52_000);
    expect(eventLinePrevues({ impressions_total: 24_000, impressions_facturables: 18_000 })).toBe(
      18_000,
    );
    expect(eventLinePrevues({ impressions_total: 24_000 })).toBe(24_000);
  });
});
