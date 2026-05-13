import { describe, it, expect } from 'vitest';

import {
  DEFAULT_DOOH_CONFIG_V3,
  applyBudget,
  applyEventBudget,
  clampSpotSeconds,
  computeEventCampaign,
  computeStandardCampaign,
  credibilityThreshold,
  repetitionRate,
  screenhostPerformanceScore,
  splitRevenue,
  spsColorBand,
  type ScreenhostInput,
} from './v3-model';

// The four demo screenhosts from the simulator (script lines ~1128-1137), adapted to the
// model's input shape. See ./README.md for what each represents.
function demoScreenhosts(): ScreenhostInput[] {
  return [
    {
      id: 'sh1',
      name: 'Café El Bey',
      operatingHoursPerDay: 8,
      affluencePerHour: 55,
      historicalMaxAffluence: 90,
      soldSlotsInPeriod: 0,
      refused: false,
      eventEligible: true,
      acceptanceRate: 0.95,
      eventRespectRate: 1.0,
      activityRate: 0.92,
      sensorQuality: 0.9,
      seniority: 0.8,
      fillRate: 0.6,
    },
    {
      id: 'sh2',
      name: 'Lounge Arts',
      operatingHoursPerDay: 6,
      affluencePerHour: 40,
      historicalMaxAffluence: 75,
      soldSlotsInPeriod: 0,
      refused: false,
      eventEligible: true,
      acceptanceRate: 0.85,
      eventRespectRate: 0.9,
      activityRate: 0.8,
      sensorQuality: 0.85,
      seniority: 0.5,
      fillRate: 0.45,
    },
    {
      id: 'sh3',
      name: 'Salle SportPlus',
      operatingHoursPerDay: 7,
      affluencePerHour: 35,
      historicalMaxAffluence: 60,
      soldSlotsInPeriod: 0,
      refused: false,
      eventEligible: false,
      acceptanceRate: 0.75,
      eventRespectRate: 0.7,
      activityRate: 0.7,
      sensorQuality: 0.75,
      seniority: 0.3,
      fillRate: 0.4,
    },
    {
      id: 'sh4',
      name: 'Bar Le Zinc',
      operatingHoursPerDay: 5,
      affluencePerHour: 30,
      historicalMaxAffluence: 80,
      soldSlotsInPeriod: 0,
      refused: false,
      eventEligible: true,
      acceptanceRate: 0.6,
      eventRespectRate: 0.5,
      activityRate: 0.65,
      sensorQuality: 0.6,
      seniority: 0.2,
      fillRate: 0.3,
    },
  ];
}

const CFG = DEFAULT_DOOH_CONFIG_V3;

describe('DEFAULT_DOOH_CONFIG_V3 invariants', () => {
  it('revenue split sums to 1', () => {
    const r = CFG.revenueSplit;
    expect(r.screenhost + r.toodooh + r.agentSh + r.agentSc).toBeCloseTo(1, 9);
  });
  it('SPS weights sum to 1', () => {
    const w = CFG.spsWeights;
    expect(
      w.txAccept +
        w.txRespectEvt +
        w.txActivite +
        w.qualiteCapteur +
        w.anciennete +
        w.txRemplissage,
    ).toBeCloseTo(1, 9);
  });
});

describe('clampSpotSeconds', () => {
  it('clamps to [1, 30]', () => {
    expect(clampSpotSeconds(0)).toBe(1);
    expect(clampSpotSeconds(0.5)).toBe(1);
    expect(clampSpotSeconds(36)).toBe(30);
    expect(clampSpotSeconds(15)).toBe(15);
  });
});

describe('credibilityThreshold (simulator getT)', () => {
  it('selects short / medium / long by spot length', () => {
    expect(credibilityThreshold(5, CFG)).toBe(0.5);
    expect(credibilityThreshold(10, CFG)).toBe(0.5);
    expect(credibilityThreshold(11, CFG)).toBe(0.65);
    expect(credibilityThreshold(20, CFG)).toBe(0.65);
    expect(credibilityThreshold(21, CFG)).toBe(0.8);
    expect(credibilityThreshold(30, CFG)).toBe(0.8);
  });
});

describe('repetitionRate (simulator getR)', () => {
  // With default F = 300, the frequency ceiling F/s always wins → R = 300/s.
  it.each([
    [5, 60],
    [10, 30],
    [15, 20],
    [20, 15],
    [25, 12],
    [30, 10],
  ])('S=%is → R=%i (frequency-limited at default F)', (s, r) => {
    const out = repetitionRate(s, CFG);
    expect(out.rate).toBeCloseTo(r, 6);
    expect(out.limitedBy).toBe('frequency');
  });

  it('becomes credibility-limited when F is large', () => {
    const cfg = { ...CFG, frequencyCapSecondsPerHour: 3600 };
    // S=10: R_T = (3600/10)·0.5 = 180 ; R_F = 3600/10 = 360 → R = 180.
    const out = repetitionRate(10, cfg);
    expect(out.rate).toBeCloseTo(180, 6);
    expect(out.limitedBy).toBe('credibility');
  });
});

describe('screenhostPerformanceScore (simulator calcSPS)', () => {
  it('matches the simulator for the four demo screenhosts', () => {
    const [sh1, sh2, sh3, sh4] = demoScreenhosts();
    expect(screenhostPerformanceScore(sh1, CFG)).toBeCloseTo(91.15, 6);
    expect(screenhostPerformanceScore(sh2, CFG)).toBeCloseTo(79.75, 6);
    expect(screenhostPerformanceScore(sh3, CFG)).toBeCloseTo(66.75, 6);
    expect(screenhostPerformanceScore(sh4, CFG)).toBeCloseTo(53.0, 6);
  });

  it('SPS = 100 when every criterion is 1 (weights sum to 1)', () => {
    const allOnes: ScreenhostInput = {
      ...demoScreenhosts()[0],
      acceptanceRate: 1,
      eventRespectRate: 1,
      activityRate: 1,
      sensorQuality: 1,
      seniority: 1,
      fillRate: 1,
    };
    expect(screenhostPerformanceScore(allOnes, CFG)).toBeCloseTo(100, 6);
  });

  it('SPS stays within [0, 100] for any valid screenhost', () => {
    for (const sh of demoScreenhosts()) {
      const sps = screenhostPerformanceScore(sh, CFG);
      expect(sps).toBeGreaterThanOrEqual(0);
      expect(sps).toBeLessThanOrEqual(100);
    }
  });
});

describe('spsColorBand', () => {
  it('maps to green / yellow / red at 75 / 50', () => {
    expect(spsColorBand(91.15, CFG)).toBe('green');
    expect(spsColorBand(75, CFG)).toBe('green');
    expect(spsColorBand(74.99, CFG)).toBe('yellow');
    expect(spsColorBand(66.75, CFG)).toBe('yellow');
    expect(spsColorBand(50, CFG)).toBe('yellow');
    expect(spsColorBand(49.99, CFG)).toBe('red');
  });
});

describe('computeStandardCampaign (simulator recalcNormale)', () => {
  // S=10 → R=30 ; N=25 ; CPM=15 ; no co-selected event.
  it('matches the simulator demo (S=10, N=25)', () => {
    const r = computeStandardCampaign(demoScreenhosts(), 10, 25, CFG);
    expect(r.repetitionRate).toBeCloseTo(30, 6);
    const byId = Object.fromEntries(r.accepting.map((a) => [a.id, a]));
    // Hi = Ei·N − Oi − evtSlots : sh1 200, sh2 150, sh3 175, sh4 125
    expect(byId.sh1.netAvailabilityHours).toBe(200);
    expect(byId.sh2.netAvailabilityHours).toBe(150);
    expect(byId.sh3.netAvailabilityHours).toBe(175);
    expect(byId.sh4.netAvailabilityHours).toBe(125);
    // Ii = Ai·Hi·R : sh1 330000, sh2 180000, sh3 183750, sh4 112500
    expect(byId.sh1.impressions).toBeCloseTo(330_000, 6);
    expect(byId.sh2.impressions).toBeCloseTo(180_000, 6);
    expect(byId.sh3.impressions).toBeCloseTo(183_750, 6);
    expect(byId.sh4.impressions).toBeCloseTo(112_500, 6);
    expect(r.maxImpressions).toBeCloseTo(806_250, 6);
    expect(r.maxBudgetTnd).toBeCloseTo(12_093.75, 6);
    // SPS-descending ranking
    expect(r.accepting.map((a) => a.id)).toEqual(['sh1', 'sh2', 'sh3', 'sh4']);
    expect(r.accepting.map((a) => a.rank)).toEqual([1, 2, 3, 4]);
    expect(r.refused).toEqual([]);
    expect(r.accepting.reduce((s, a) => s + a.impressionShare, 0)).toBeCloseTo(1, 6);
  });

  it('cascade: a refused screenhost gets 0 and is excluded from I_max; others renormalize', () => {
    const shs = demoScreenhosts();
    shs[3].refused = true; // Bar Le Zinc — Ii would have been 112500
    const r = computeStandardCampaign(shs, 10, 25, CFG);
    expect(r.maxImpressions).toBeCloseTo(806_250 - 112_500, 6); // 693750
    expect(r.accepting.map((a) => a.id)).toEqual(['sh1', 'sh2', 'sh3']);
    expect(r.refused.map((x) => x.id)).toEqual(['sh4']);
    expect(r.accepting.reduce((s, a) => s + a.impressionShare, 0)).toBeCloseTo(1, 6);
    // After renormalisation the screenhost pool is fully distributed across the remaining 3.
    const b = applyBudget(r, 10_000, CFG);
    expect(b.perScreenhost.reduce((s, p) => s + p.revenueTnd, 0)).toBeCloseTo(b.split.screenhost, 6);
  });

  it('event slots reduce Hi for every accepting screenhost', () => {
    const r = computeStandardCampaign(demoScreenhosts(), 10, 25, CFG, 4.5);
    const byId = Object.fromEntries(r.accepting.map((a) => [a.id, a]));
    expect(byId.sh1.netAvailabilityHours).toBeCloseTo(200 - 4.5, 6); // 195.5
    expect(byId.sh4.netAvailabilityHours).toBeCloseTo(125 - 4.5, 6); // 120.5
  });

  it('Hi never goes negative', () => {
    const shs = demoScreenhosts();
    shs[0].soldSlotsInPeriod = 999_999;
    const r = computeStandardCampaign(shs, 10, 25, CFG);
    const sh1 = r.accepting.find((a) => a.id === 'sh1')!;
    expect(sh1.netAvailabilityHours).toBe(0);
    expect(sh1.impressions).toBe(0);
  });
});

describe('splitRevenue (simulator rep-amounts, 50/44/3/3)', () => {
  it('splits an amount across the four parties and sums back to the amount', () => {
    const s = splitRevenue(1000, CFG);
    expect(s.screenhost).toBeCloseTo(500, 6);
    expect(s.toodooh).toBeCloseTo(440, 6);
    expect(s.agentSh).toBeCloseTo(30, 6);
    expect(s.agentSc).toBeCloseTo(30, 6);
    expect(s.screenhost + s.toodooh + s.agentSh + s.agentSc).toBeCloseTo(1000, 6);
  });
  it('clamps negatives to 0', () => {
    expect(splitRevenue(-100, CFG).screenhost).toBe(0);
  });
});

describe('applyBudget (simulator slider + per-screenhost revenue)', () => {
  const std = () => computeStandardCampaign(demoScreenhosts(), 10, 25, CFG);

  it('budget = C_max → fillRate = 1, C_cible = C_max', () => {
    const b = applyBudget(std(), 12_093.75, CFG);
    expect(b.targetBudgetTnd).toBeCloseTo(12_093.75, 6);
    expect(b.fillRate).toBeCloseTo(1, 6);
  });
  it('budget = C_max / 2 → fillRate = 0.5', () => {
    const b = applyBudget(std(), 12_093.75 / 2, CFG);
    expect(b.targetBudgetTnd).toBeCloseTo(12_093.75 / 2, 6);
    expect(b.fillRate).toBeCloseTo(0.5, 6);
  });
  it('budget > C_max → clamped to C_max, fillRate = 1', () => {
    const b = applyBudget(std(), 999_999, CFG);
    expect(b.targetBudgetTnd).toBeCloseTo(12_093.75, 6);
    expect(b.fillRate).toBeCloseTo(1, 6);
  });
  it('budget = 0 → fillRate = 0, all per-screenhost revenue = 0', () => {
    const b = applyBudget(std(), 0, CFG);
    expect(b.targetBudgetTnd).toBe(0);
    expect(b.fillRate).toBe(0);
    expect(b.perScreenhost.every((p) => p.revenueTnd === 0)).toBe(true);
  });
  it('per-screenhost revenue = screenhost pool × impression share, summing to the pool', () => {
    const b = applyBudget(std(), 6000, CFG);
    expect(b.purchasedImpressions).toBeCloseTo(400_000, 6); // 6000·1000/15
    expect(b.split.screenhost).toBeCloseTo(3000, 6);
    const byId = Object.fromEntries(b.perScreenhost.map((p) => [p.id, p.revenueTnd]));
    expect(byId.sh1).toBeCloseTo(3000 * (330_000 / 806_250), 6);
    expect(byId.sh4).toBeCloseTo(3000 * (112_500 / 806_250), 6);
    expect(b.perScreenhost.reduce((s, p) => s + p.revenueTnd, 0)).toBeCloseTo(3000, 6);
    expect(b.perScreenhost.map((p) => p.id)).toEqual(['sh1', 'sh2', 'sh3', 'sh4']);
  });
  it('C_max = 0 ⇒ fillRate 0, no division by zero, empty per-screenhost', () => {
    const empty = computeStandardCampaign([], 10, 25, CFG);
    const b = applyBudget(empty, 1000, CFG);
    expect(b.targetBudgetTnd).toBe(0);
    expect(b.fillRate).toBe(0);
    expect(b.perScreenhost).toEqual([]);
  });
});

describe('computeEventCampaign (simulator recalcEvenement)', () => {
  // S=10 → R=30 ; duration 2.5h ; CPM_evt = 15·2 = 30 ; window = 1 + 2.5 + 1 = 4.5h.
  it('matches the simulator demo (Champions League finale, 2.5h)', () => {
    const r = computeEventCampaign(demoScreenhosts(), 10, 2.5, CFG);
    expect(r.repetitionRate).toBeCloseTo(30, 6);
    expect(r.windowHours).toBeCloseTo(4.5, 6);
    expect(r.eventCpmTnd).toBeCloseTo(30, 6);
    // Eligible & !refused: sh1, sh2, sh4 (sh3 not eventEligible → ineligible), SPS-ordered.
    expect(r.accepting.map((e) => e.id)).toEqual(['sh1', 'sh2', 'sh4']);
    expect(r.accepting.map((e) => e.rank)).toEqual([1, 2, 3]);
    expect(r.ineligible.map((x) => x.id)).toEqual(['sh3']);
    expect(r.refused).toEqual([]);
    const byId = Object.fromEntries(r.accepting.map((e) => [e.id, e]));
    // Ii_evt = A_max·window·R
    expect(byId.sh1.impressions).toBeCloseTo(90 * 4.5 * 30, 6); // 12150
    expect(byId.sh2.impressions).toBeCloseTo(75 * 4.5 * 30, 6); // 10125
    expect(byId.sh4.impressions).toBeCloseTo(80 * 4.5 * 30, 6); // 10800
    expect(r.maxImpressions).toBeCloseTo(12_150 + 10_125 + 10_800, 6); // 33075
    expect(r.maxBudgetTnd).toBeCloseTo((30 * 33_075) / 1000, 6); // 992.25
    expect(r.accepting.reduce((s, e) => s + e.impressionShare, 0)).toBeCloseTo(1, 6);
  });

  it('event eligibility: an eventEligible=false screenhost goes in ineligible[] and drops from I_evt_max', () => {
    const all = computeEventCampaign(demoScreenhosts(), 10, 2.5, CFG);
    const shs = demoScreenhosts();
    shs[0].eventEligible = false; // Café El Bey — Ii_evt would have been 12150
    const r = computeEventCampaign(shs, 10, 2.5, CFG);
    expect(r.ineligible.map((x) => x.id).sort()).toEqual(['sh1', 'sh3']);
    expect(r.accepting.map((e) => e.id)).toEqual(['sh2', 'sh4']);
    expect(r.maxImpressions).toBeCloseTo(all.maxImpressions - 12_150, 6); // 33075 - 12150 = 20925
  });

  it('a refused screenhost is excluded even if event-eligible (separate from ineligible)', () => {
    const shs = demoScreenhosts();
    shs[1].refused = true; // Lounge Arts — eventEligible but refused
    const r = computeEventCampaign(shs, 10, 2.5, CFG);
    expect(r.refused.map((x) => x.id)).toEqual(['sh2']);
    expect(r.ineligible.map((x) => x.id)).toEqual(['sh3']);
    expect(r.accepting.map((e) => e.id)).toEqual(['sh1', 'sh4']);
  });
});

describe('applyEventBudget', () => {
  const evt = () => computeEventCampaign(demoScreenhosts(), 10, 2.5, CFG);
  it('uses CPM_evt for purchased impressions; 50% pool sums across eligible screenhosts', () => {
    const b = applyEventBudget(evt(), 500, CFG);
    expect(b.targetBudgetTnd).toBeCloseTo(500, 6);
    expect(b.purchasedImpressions).toBeCloseTo((500 * 1000) / 30, 6);
    expect(b.fillRate).toBeCloseTo(500 / 992.25, 6);
    expect(b.split.screenhost).toBeCloseTo(250, 6);
    expect(b.perScreenhost.reduce((s, p) => s + p.revenueTnd, 0)).toBeCloseTo(250, 6);
    expect(b.perScreenhost.map((p) => p.id)).toEqual(['sh1', 'sh2', 'sh4']);
  });
  it('over-budget clamps to C_evt_max (fillRate = 1)', () => {
    const b = applyEventBudget(evt(), 999_999, CFG);
    expect(b.targetBudgetTnd).toBeCloseTo(992.25, 6);
    expect(b.fillRate).toBeCloseTo(1, 6);
  });
});
