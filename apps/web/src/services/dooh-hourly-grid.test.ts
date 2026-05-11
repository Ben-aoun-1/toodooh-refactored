import { describe, it, expect } from 'vitest';
import {
  buildLocationWeeklyAffluenceLookup,
  computeCampaignDayCount,
  computeDoohLocationAffluenceCampaign,
  dateToDayOfWeek,
  enumerateDoohLocationCampaignSlots,
  isScreenUnavailableInSlot,
  isEventOverlapInSlot,
  computeHourlyDoohGridByLocation,
  jsGetDayToDbDayOfWeek,
  normalizeLocationScheduleSlotsForEngine,
  parseLocalCampaignCalendarDay,
  doohNumbersToLocationEngineConfig,
} from './dooh-hourly-grid';
import { DEFAULT_DOOH_CONFIG_NUMBERS } from './dooh-calculation.service';

describe('jsGetDayToDbDayOfWeek', () => {
  it('mappe getDay() JS vers day_of_week BD (1=lun..7=dim)', () => {
    expect(jsGetDayToDbDayOfWeek(0)).toBe(7);
    expect(jsGetDayToDbDayOfWeek(1)).toBe(1);
    expect(jsGetDayToDbDayOfWeek(6)).toBe(6);
  });
});

describe('parseLocalCampaignCalendarDay', () => {
  it('interprète YYYY-MM-DD comme jour civil local', () => {
    const d = parseLocalCampaignCalendarDay('2026-04-10');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(3);
    expect(d.getDate()).toBe(10);
    expect(dateToDayOfWeek(d)).toBe(5);
  });
});

describe('computeCampaignDayCount', () => {
  it('compte les jours calendaires de façon inclusive', () => {
    const dayCount = computeCampaignDayCount('2026-04-06T23:00:00.000Z', '2026-04-13T23:00:00.000Z');
    expect(dayCount).toBe(8);
  });
});

describe('dateToDayOfWeek', () => {
  it('maps Monday to 1 and Sunday to 7 (dates locales)', () => {
    expect(dateToDayOfWeek(new Date(2026, 3, 6, 12, 0, 0))).toBe(1);
    expect(dateToDayOfWeek(new Date(2026, 3, 5, 12, 0, 0))).toBe(7);
  });
});

describe('isScreenUnavailableInSlot', () => {
  it('detects overlap', () => {
    const slotStart = new Date('2026-04-10T14:00:00');
    const slotEnd = new Date('2026-04-10T15:00:00');
    const ok = isScreenUnavailableInSlot(slotStart, slotEnd, [
      {
        start_date: '2026-04-10',
        end_date: '2026-04-10',
        start_time: '13:00:00',
        end_time: '16:00:00',
      },
    ]);
    expect(ok).toBe(true);
  });
});

describe('isEventOverlapInSlot', () => {
  it('excludes own event id', () => {
    const slotStart = new Date('2026-04-10T12:00:00');
    const slotEnd = new Date('2026-04-10T13:00:00');
    const overlap = isEventOverlapInSlot(slotStart, slotEnd, [{ id: 'e1', start_date: '2026-04-10', end_date: '2026-04-10' }], 'e1');
    expect(overlap).toBe(false);
  });
});

describe('buildLocationWeeklyAffluenceLookup', () => {
  it('additionne estimated_impressions pour le même (day_of_week, hour)', () => {
    const m = buildLocationWeeklyAffluenceLookup([
      { day_of_week: 1, hour: 10, estimated_impressions: 100 },
      { day_of_week: 1, hour: 10, estimated_impressions: 50 },
      { day_of_week: 1, hour: 11, estimated_impressions: 30 },
    ]);
    expect(m.get('1:10')).toBe(150);
    expect(m.get('1:11')).toBe(30);
  });
});

describe('computeDoohLocationAffluenceCampaign vs enumerate', () => {
  it('impressions = Σ adjustedImpressions créneau par créneau', () => {
    const locId = 'loc-1';
    const campaignStart = new Date(2026, 3, 10, 0, 0, 0, 0);
    const campaignEnd = new Date(2026, 3, 11, 0, 0, 0, 0);
    const slots = [
      { day_of_week: 5, hour: 0, estimated_impressions: 10 },
      { day_of_week: 6, hour: 0, estimated_impressions: 20 },
    ];
    const normalized = normalizeLocationScheduleSlotsForEngine([locId], new Map([[locId, slots]]));
    const input = {
      campaignStart,
      campaignEnd,
      locationIds: [locId] as const,
      locationScheduleSlots: normalized,
      unavailabilityByLocation: new Map(),
      maxOccupiedRphByLocation: new Map(),
      activeEvents: [] as const,
      ownEventId: null as string | null,
      config: doohNumbersToLocationEngineConfig(DEFAULT_DOOH_CONFIG_NUMBERS),
      debugSlotMatching: false,
    };
    const agg = computeDoohLocationAffluenceCampaign(input);
    const rows = enumerateDoohLocationCampaignSlots(input);
    const sumSlots = rows.reduce((s, r) => s + r.adjustedImpressions, 0);
    expect(agg.impressions).toBeCloseTo(sumSlots);
    expect(agg.totalAffluence).toBeCloseTo(rows.reduce((s, r) => s + r.effectiveAffluence, 0));
  });
});

describe('computeHourlyDoohGridByLocation', () => {
  it('une localité × 24 h : créneaux réels dow+hour (2026-04-10 = vendredi dow 5)', () => {
    const campaignStart = new Date(2026, 3, 10, 0, 0, 0, 0);
    const campaignEnd = new Date(2026, 3, 10, 23, 59, 59, 0);
    const locId = 'loc-1';
    const slots = Array.from({ length: 24 }, (_, hour) => ({
      day_of_week: 5,
      hour,
      estimated_impressions: 240,
    }));
    const r = computeHourlyDoohGridByLocation({
      config: DEFAULT_DOOH_CONFIG_NUMBERS,
      effectiveVideoDurationSeconds: 15,
      campaignStart,
      campaignEnd,
      locationIds: [locId],
      locationScheduleSlots: new Map([[locId, slots]]),
      unavailabilityByLocation: new Map(),
      occupiedRepetitionsByLocation: new Map(),
      activeEvents: [],
      ownEventId: null,
      debugSlotMatching: false,
    });
    expect(r.slotsEvaluated).toBe(24);
    expect(r.totalRawImpressions).toBeCloseTo(24 * 240 * DEFAULT_DOOH_CONFIG_NUMBERS.max_billable_spot_rate_per_hour);
    expect(r.perLocationRawImpressions.get(locId)).toBeCloseTo(r.totalRawImpressions);
  });
});
