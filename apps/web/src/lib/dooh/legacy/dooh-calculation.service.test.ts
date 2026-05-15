import { describe, it, expect } from 'vitest';

import {
  DEFAULT_DOOH_CONFIG_NUMBERS,
  resolveEffectiveVideoDuration,
  effectiveVideoSecondsForDoohEstimate,
  computeRepetitionsPerHourVideo,
  computeDoohSlotMetrics,
  sumImpressionsTranches,
  computeCampaignCostTnd,
} from './dooh-calculation.service';

describe('resolveEffectiveVideoDuration', () => {
  const c = DEFAULT_DOOH_CONFIG_NUMBERS;

  it('uses default when actual is absent', () => {
    const r = resolveEffectiveVideoDuration(null, c);
    expect(r).toEqual({ ok: true, seconds: c.video_default_duration_seconds });
  });

  it('rejects below min when a positive actual is provided', () => {
    const r = resolveEffectiveVideoDuration(0.5, c);
    expect(r.ok).toBe(false);
  });

  it('rejects above max', () => {
    const r = resolveEffectiveVideoDuration(999, c);
    expect(r.ok).toBe(false);
  });
});

describe('effectiveVideoSecondsForDoohEstimate', () => {
  const c = DEFAULT_DOOH_CONFIG_NUMBERS;

  it('clamp au max si durée réelle au-dessus du plafond config', () => {
    expect(effectiveVideoSecondsForDoohEstimate(36, c)).toBe(c.video_max_duration_seconds);
  });
});

describe('computeRepetitionsPerHourVideo', () => {
  it('is floor(3600 / duration)', () => {
    expect(computeRepetitionsPerHourVideo(15)).toBe(240);
    expect(computeRepetitionsPerHourVideo(30)).toBe(120);
  });
});

describe('computeDoohSlotMetrics', () => {
  const c = DEFAULT_DOOH_CONFIG_NUMBERS;

  it('zeros when unavailable', () => {
    const m = computeDoohSlotMetrics(c, 15, {
      affluence_horaire: 100,
      occupied_by_other_campaigns: 0,
      unavailable: true,
      event_overlap: false,
    });
    expect(m.allowed_repetitions_per_hour).toBe(0);
    expect(m.impressions_tranche).toBe(0);
  });

  it('zeros on event overlap', () => {
    const m = computeDoohSlotMetrics(c, 15, {
      affluence_horaire: 100,
      occupied_by_other_campaigns: 0,
      unavailable: false,
      event_overlap: true,
    });
    expect(m.impressions_tranche).toBe(0);
  });

  it('applies min(repetitions_video, remaining) × affluence', () => {
    const m = computeDoohSlotMetrics(c, 15, {
      affluence_horaire: 10,
      occupied_by_other_campaigns: 1,
      unavailable: false,
      event_overlap: false,
    });
    const billable = c.max_spots_per_hour * c.max_billable_spot_rate_per_hour;
    const remaining = billable - 1;
    const repVideo = computeRepetitionsPerHourVideo(15);
    const allowed = Math.min(repVideo, remaining);
    expect(m.allowed_repetitions_per_hour).toBe(allowed);
    expect(m.impressions_tranche).toBe(allowed * 10);
  });
});

describe('computeCampaignCostTnd', () => {
  it('uses standard vs event CPM', () => {
    const c = DEFAULT_DOOH_CONFIG_NUMBERS;
    expect(computeCampaignCostTnd(1000, false, c)).toBe(2.5);
    expect(computeCampaignCostTnd(1000, true, c)).toBe(2.5);
    expect(computeCampaignCostTnd(2000, false, { ...c, standard_campaign_cpm_tnd: 3 })).toBe(6);
  });
});

describe('sumImpressionsTranches', () => {
  it('sums impressions_tranche', () => {
    expect(
      sumImpressionsTranches([
        {
          impressions_tranche: 1,
          allowed_repetitions_per_hour: 0,
          billable_spots_per_hour: 0,
          remaining_spots_per_hour: 0,
          repetitions_per_hour_video: 0,
        },
        {
          impressions_tranche: 2,
          allowed_repetitions_per_hour: 0,
          billable_spots_per_hour: 0,
          remaining_spots_per_hour: 0,
          repetitions_per_hour_video: 0,
        },
      ]),
    ).toBe(3);
  });
});
