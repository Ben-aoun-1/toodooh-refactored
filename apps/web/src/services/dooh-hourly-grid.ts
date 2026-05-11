/**
 * Grille DOOH par localité : façade sur le moteur affluence (`dooh-location-affluence-engine`)
 * + `computeHourlyDoohGridByLocation` (API stable pour estimation / injection).
 */
import type { DoohConfigNumbers } from './dooh-calculation.service';
import {
  aggregateOccupiedRepetitionsByLocation,
  aggregateUnavailabilityByLocation,
  buildLocationAffluenceLookup,
  buildLocationWeeklyAffluenceLookup,
  computeDoohLocationAffluenceCampaign,
  computeCampaignDayCount,
  dateToDayOfWeek,
  doohNumbersToLocationEngineConfig,
  enumerateDoohLocationCampaignSlots,
  formatLocalCalendarDate,
  jsGetDayToDbDayOfWeek,
  parseLocalCampaignCalendarDay,
  effectiveAffluenceForSlot,
  isEventOverlapInSlot,
  isScreenUnavailableInSlot,
  isUnavailableInSlot,
  occupationRateFromMaxRph,
  splitLocationImpressionsToScreens,
  type AffluenceSlot,
  type DoohLocationEngineConfig,
  type DoohLocationSlotRow,
  type LocationAffluenceEngineInput,
  type LocationAffluenceEngineResult,
  type SpecialEventWindow,
  type UnavailabilityPeriod,
} from './dooh-location-affluence-engine';

export {
  aggregateOccupiedRepetitionsByLocation,
  aggregateUnavailabilityByLocation,
  buildLocationAffluenceLookup,
  buildLocationWeeklyAffluenceLookup,
  computeDoohLocationAffluenceCampaign,
  computeCampaignDayCount,
  dateToDayOfWeek,
  doohNumbersToLocationEngineConfig,
  enumerateDoohLocationCampaignSlots,
  formatLocalCalendarDate,
  jsGetDayToDbDayOfWeek,
  parseLocalCampaignCalendarDay,
  effectiveAffluenceForSlot,
  isEventOverlapInSlot,
  isScreenUnavailableInSlot,
  isUnavailableInSlot,
  occupationRateFromMaxRph,
  splitLocationImpressionsToScreens,
  splitLocationImpressionsToScreens as splitLocationRawImpressionsToScreens,
  type AffluenceSlot,
  type DoohLocationEngineConfig,
  type DoohLocationSlotRow,
  type LocationAffluenceEngineInput,
  type LocationAffluenceEngineResult,
  type SpecialEventWindow,
  type UnavailabilityPeriod,
};

/**
 * Normalise les créneaux `location_affluence_schedule` (day_of_week + hour) par localité.
 * Pas de repli sur une moyenne hebdomadaire : créneau absent en base → affluence 0 sur ce (dow,h).
 */
export function normalizeLocationScheduleSlotsForEngine(
  locationIds: readonly string[],
  locationScheduleSlots: ReadonlyMap<string, readonly AffluenceSlot[]>
): Map<string, AffluenceSlot[]> {
  const out = new Map<string, AffluenceSlot[]>();
  for (const locId of locationIds) {
    const fromDb = locationScheduleSlots.get(locId);
    if (!fromDb?.length) {
      out.set(locId, []);
      continue;
    }
    out.set(
      locId,
      fromDb.map((s) => ({
        day_of_week: Number(s.day_of_week),
        hour: Number(s.hour),
        estimated_impressions: Math.max(0, Number(s.estimated_impressions) || 0),
      }))
    );
  }
  return out;
}

export type ComputeHourlyDoohGridByLocationInput = {
  config: DoohConfigNumbers;
  /**
   * Conservé pour compatibilité des appelants ; le moteur affluence-only n’utilise pas la durée vidéo.
   */
  effectiveVideoDurationSeconds: number;
  campaignStart: Date;
  campaignEnd: Date;
  locationIds: readonly string[];
  locationScheduleSlots: ReadonlyMap<string, readonly AffluenceSlot[]>;
  unavailabilityByLocation: ReadonlyMap<string, readonly UnavailabilityPeriod[]>;
  occupiedRepetitionsByLocation: ReadonlyMap<string, number>;
  activeEvents: readonly SpecialEventWindow[];
  ownEventId: string | null;
  uiExpectedDayCount?: number;
  /** Voir `LocationAffluenceEngineInput.debugSlotMatching`. */
  debugSlotMatching?: boolean;
};

export type ComputeHourlyDoohGridByLocationResult = {
  /** `total_affluence × max_billable_spot_rate_per_hour` */
  totalRawImpressions: number;
  perLocationRawImpressions: Map<string, number>;
  slotsEvaluated: number;
  totalAffluence: number;
};

export function computeHourlyDoohGridByLocation(
  input: ComputeHourlyDoohGridByLocationInput
): ComputeHourlyDoohGridByLocationResult {
  void input.effectiveVideoDurationSeconds;
  const normalized = normalizeLocationScheduleSlotsForEngine(
    input.locationIds,
    input.locationScheduleSlots
  );
  const r = computeDoohLocationAffluenceCampaign({
    campaignStart: input.campaignStart,
    campaignEnd: input.campaignEnd,
    locationIds: input.locationIds,
    locationScheduleSlots: normalized,
    unavailabilityByLocation: input.unavailabilityByLocation,
    maxOccupiedRphByLocation: input.occupiedRepetitionsByLocation,
    activeEvents: input.activeEvents,
    ownEventId: input.ownEventId,
    config: doohNumbersToLocationEngineConfig(input.config),
    uiExpectedDayCount: input.uiExpectedDayCount,
    debugSlotMatching: input.debugSlotMatching,
  });
  return {
    totalRawImpressions: r.impressions,
    perLocationRawImpressions: r.perLocationImpressions,
    slotsEvaluated: r.slotsEvaluated,
    totalAffluence: r.totalAffluence,
  };
}
