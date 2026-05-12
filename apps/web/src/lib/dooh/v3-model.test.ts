import { describe, it, expect } from 'vitest';

import {
  DEFAULT_DOOH_CONFIG_V3,
  clampSpotSeconds,
  credibilityThreshold,
  repetitionRate,
  screenhostPerformanceScore,
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
