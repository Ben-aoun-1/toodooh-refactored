import { describe, expect, it } from 'vitest';

import {
  buildHybridAdjustedHourlyPlan,
  type HourlyPlanSlotInput,
} from './campaign-hourly-location-plan.service';

function sampleSlots(): HourlyPlanSlotInput[] {
  return [
    {
      locationId: 'loc-a',
      diffusionDate: '2026-04-06',
      diffusionHour: 10,
      maxImpressions: 120,
      maxRepetitionsPerHour: 6,
    },
    {
      locationId: 'loc-a',
      diffusionDate: '2026-04-06',
      diffusionHour: 11,
      maxImpressions: 80,
      maxRepetitionsPerHour: 4,
    },
    {
      locationId: 'loc-b',
      diffusionDate: '2026-04-06',
      diffusionHour: 10,
      maxImpressions: 100,
      maxRepetitionsPerHour: 5,
    },
    {
      locationId: 'loc-b',
      diffusionDate: '2026-04-06',
      diffusionHour: 11,
      maxImpressions: 60,
      maxRepetitionsPerHour: 3,
    },
  ];
}

describe('buildHybridAdjustedHourlyPlan', () => {
  it('réduit prioritairement les répétitions en conservant les localités si possible', () => {
    const slots = sampleSlots();
    const out = buildHybridAdjustedHourlyPlan({
      slots,
      targetImpressions: 260, // max = 360, réduction absorbable sans retirer totalement une localité
      keepLocationsFirst: true,
    });

    const activeLocs = new Set(
      out.filter((r) => r.plannedRepetitionsPerHour > 0).map((r) => r.locationId),
    );
    expect(activeLocs.has('loc-a')).toBe(true);
    expect(activeLocs.has('loc-b')).toBe(true);
  });

  it('peut finir par couper des localités en dernier recours si la cible est très basse', () => {
    const slots = sampleSlots();
    const out = buildHybridAdjustedHourlyPlan({
      slots,
      targetImpressions: 20,
      keepLocationsFirst: true,
    });

    const activeLocs = new Set(
      out.filter((r) => r.plannedRepetitionsPerHour > 0).map((r) => r.locationId),
    );
    expect(activeLocs.size).toBeLessThanOrEqual(2);
  });

  it('est déterministe pour les mêmes entrées', () => {
    const slots = sampleSlots();
    const a = buildHybridAdjustedHourlyPlan({
      slots,
      targetImpressions: 211,
      keepLocationsFirst: true,
    });
    const b = buildHybridAdjustedHourlyPlan({
      slots,
      targetImpressions: 211,
      keepLocationsFirst: true,
    });
    expect(a).toEqual(b);
  });

  it('respecte les bornes de répétitions (jamais négatif, jamais > max)', () => {
    const slots = sampleSlots();
    const out = buildHybridAdjustedHourlyPlan({
      slots,
      targetImpressions: 180,
      keepLocationsFirst: true,
    });

    out.forEach((r) => {
      expect(r.plannedRepetitionsPerHour).toBeGreaterThanOrEqual(0);
      expect(r.plannedRepetitionsPerHour).toBeLessThanOrEqual(r.maxRepetitionsPerHour);
    });
  });
});
