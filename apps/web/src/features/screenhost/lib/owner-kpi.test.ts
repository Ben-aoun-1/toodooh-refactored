import { describe, expect, it } from 'vitest';

import { ownerKpiFrom } from './owner-kpi';

describe('ownerKpiFrom (R11 — Dashboard tiles from real wires)', () => {
  it('counts DISTINCT campaigns, sums impressions through the R10 home, floors ms→s', () => {
    const kpi = ownerKpiFrom(
      [
        { campaign_id: 'a', display_imp: 800 },
        { campaign_id: 'a', display_imp: 150 }, // same campaign on a second venue
        { campaign_id: 'b', display_imp: 50 },
      ],
      4500,
    );
    expect(kpi.campaignsDiffused).toBe(2);
    expect(kpi.impressions).toBe(1000);
    expect(kpi.totalDurationSeconds).toBe(4);
  });

  it('the honest empty state is all zeros', () => {
    expect(ownerKpiFrom([], 0)).toEqual({
      campaignsDiffused: 0,
      impressions: 0,
      totalDurationSeconds: 0,
    });
  });
});
