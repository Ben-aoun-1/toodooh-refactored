/**
 * Estimation capacité impressions (moteur DOOH horaire) pour le parcours nouvelle campagne.
 * Pivot métier : **localités** (affluence, occupation et indispos agrégées par localité).
 *
 * Appel `screens` (id + location_id) : uniquement pour (1) connaître la localité de chaque écran
 * afin de dériver occupation (max des répétitions / écran → une valeur par localité) et indisponibilités ;
 * (2) ajouter des localités présentes sur les écrans mais absentes du wizard (ex. parc TV).
 * L’affluence `location_affluence_schedule` est interrogée par **location_id** (souvent en parallèle
 * du fetch `screens` pour les ids wizard), pas « à cause » du retour des écrans.
 */
import { supabase } from '../lib/supabase';

import type { DoohConfigNumbers } from './dooh-calculation.service';
import {
  computeRepetitionsPerHourVideo,
  effectiveVideoSecondsForDoohEstimate,
} from './dooh-calculation.service';
import {
  computeCampaignDayCount,
  enumerateDoohLocationCampaignSlots,
  parseLocalCampaignCalendarDay,
  type AffluenceSlot,
  type SpecialEventWindow,
  type UnavailabilityPeriod,
} from './dooh-hourly-grid';
import { logger } from '../lib/logger';

const log = logger.child({ module: 'dooh-new-campaign-estimate.service' });


export type WizardUnavailabilityRow = {
  screen_id: string;
  start_date: string;
  end_date: string;
  start_time: string;
  end_time: string;
};

/** Données déjà chargées côté wizard (carte campagne), si la lecture DB est vide (ex. avant déploiement RLS). */
export type WizardLocationAffluenceInput = {
  id: string;
  affluence_schedule?: readonly {
    day_of_week: number;
    hour: number;
    estimated_impressions: number;
  }[];
};

function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Construit une grille 7×24 à partir des créneaux wizard (`affluence_schedule` uniquement). */
export function buildWizardLocationScheduleMap(
  locations: readonly WizardLocationAffluenceInput[],
): Map<string, AffluenceSlot[]> {
  const m = new Map<string, AffluenceSlot[]>();
  for (const loc of locations) {
    const raw = loc.affluence_schedule;
    if (raw && raw.length > 0) {
      m.set(
        loc.id,
        raw.map((s) => ({
          day_of_week: Number(s.day_of_week),
          hour: Number(s.hour),
          estimated_impressions: Math.max(0, Number(s.estimated_impressions) || 0),
        })),
      );
    }
  }
  return m;
}

/** Grille initiale depuis le wizard (carte / getLocationsByIds), avant lecture DB. */
function applyWizardLocationAffluence(
  slotsMap: Map<string, AffluenceSlot[]>,
  wizard: Map<string, AffluenceSlot[]> | undefined,
): void {
  if (!wizard?.size) return;
  for (const [locId, wSlots] of wizard) {
    if (wSlots.length === 0) continue;
    slotsMap.set(locId, wSlots);
  }
}

/** Données `location_affluence_schedule` : écrasent le wizard pour les localités qui ont des lignes en base. */
function applyDbLocationScheduleRows(
  slotsMap: Map<string, AffluenceSlot[]>,
  rows: readonly {
    location_id: string;
    day_of_week: number;
    hour: number;
    estimated_impressions: number | null;
  }[],
): void {
  const byLoc = new Map<string, AffluenceSlot[]>();
  for (const r of rows) {
    if (!byLoc.has(r.location_id)) byLoc.set(r.location_id, []);
    byLoc.get(r.location_id)!.push({
      day_of_week: Number(r.day_of_week),
      hour: Number(r.hour),
      estimated_impressions: Number(r.estimated_impressions) || 0,
    });
  }
  for (const [locId, slots] of byLoc) {
    if (slots.length) slotsMap.set(locId, slots);
  }
}

function slotOccupationKey(
  locationId: string,
  diffusionDate: string,
  diffusionHour: number,
): string {
  return `${locationId}|${diffusionDate}|${diffusionHour}`;
}

async function getOccupiedRepetitionsByLocationSlotFromHourlyPlan(input: {
  locationIds: readonly string[];
  startDate: Date;
  endDate: Date;
  excludeCampaignId?: string | null;
}): Promise<Map<string, number>> {
  const locationIds = [...new Set(input.locationIds.filter(Boolean))];
  if (locationIds.length === 0) return new Map<string, number>();

  const start = toDateStr(input.startDate);
  const end = toDateStr(input.endDate);

  const { data: rows, error } = await supabase
    .from('campaign_hourly_location_plan')
    .select(
      'campaign_id, location_id, diffusion_date, diffusion_hour, planned_repetitions_per_hour',
    )
    .in('location_id', locationIds)
    .gte('diffusion_date', start)
    .lte('diffusion_date', end);

  if (error) {
    log.warn({ error }, 'getOccupiedRepetitionsByLocationSlotFromHourlyPlan: lecture indisponible, occupation concurrente à 0.');
    return new Map<string, number>();
  }

  const all = (rows ?? []) as Array<{
    campaign_id: string;
    location_id: string;
    diffusion_date: string;
    diffusion_hour: number;
    planned_repetitions_per_hour: number | null;
  }>;
  const campaignIds = [
    ...new Set(all.map((r) => r.campaign_id).filter((id) => id && id !== input.excludeCampaignId)),
  ];
  if (campaignIds.length === 0) return new Map<string, number>();

  const { data: campaigns, error: campaignsError } = await supabase
    .from('campaigns')
    .select('id, status')
    .in('id', campaignIds)
    .in('status', ['active', 'pending']);
  if (campaignsError) {
    log.warn({ campaignsError }, 'getOccupiedRepetitionsByLocationSlotFromHourlyPlan: lecture statuts campagnes indisponible, occupation concurrente à 0.');
    return new Map<string, number>();
  }

  const allowedCampaignIds = new Set((campaigns ?? []).map((c: { id: string }) => c.id));
  const occupiedBySlot = new Map<string, number>();
  for (const r of all) {
    if (!allowedCampaignIds.has(r.campaign_id)) continue;
    if (input.excludeCampaignId && r.campaign_id === input.excludeCampaignId) continue;
    const key = slotOccupationKey(r.location_id, r.diffusion_date, Number(r.diffusion_hour));
    const reps = Math.max(0, Number(r.planned_repetitions_per_hour) || 0);
    occupiedBySlot.set(key, (occupiedBySlot.get(key) ?? 0) + reps);
  }

  return occupiedBySlot;
}

/**
 * Retourne le plafond brut d’impressions (somme des impressions_tranche) sur la période,
 * moteur **par localité** (calcul horaire : répétitions autorisées × affluence effective).
 */
export async function computeNewCampaignDoohMaxImpressions(input: {
  config: DoohConfigNumbers;
  /** Localités sélectionnées dans le parcours (pivot métier). */
  locationIds: string[];
  /** @deprecated Modèle localité: ignoré, conservé pour compat appelant. */
  screenIds: string[];
  campaignStart: Date;
  campaignEnd: Date;
  videoId: string | null;
  unavailabilityRows: WizardUnavailabilityRow[];
  ownEventId: string | null;
  /** En édition, exclure la campagne courante du calcul d’occupation. */
  excludeCampaignId?: string | null;
  /** Grilles par localité déjà connues du parcours (fallback si SELECT affluence DB vide). */
  wizardLocationSlots?: Map<string, AffluenceSlot[]>;
}): Promise<number> {
  const wizardLocationIds = [...new Set(input.locationIds.filter(Boolean))];

  type ScheduleRow = {
    location_id: string;
    day_of_week: number;
    hour: number;
    estimated_impressions: number | null;
  };

  const scheduleWizardPromise =
    wizardLocationIds.length > 0
      ? supabase
          .from('location_affluence_schedule')
          .select('location_id, day_of_week, hour, estimated_impressions')
          .in('location_id', wizardLocationIds)
      : Promise.resolve({ data: [] as ScheduleRow[], error: null });

  const scheduleWizardResult = await scheduleWizardPromise;
  if (scheduleWizardResult.error) {
    log.warn({ message: scheduleWizardResult.error.message }, 'computeNewCampaignDoohMaxImpressions: location_affluence_schedule (localités wizard)');
  }

  const evaluationLocationIds = [...new Set(input.locationIds.filter(Boolean))];
  if (evaluationLocationIds.length === 0) {
    return 0;
  }

  const startDate = parseLocalCampaignCalendarDay(input.campaignStart);
  const endDate = parseLocalCampaignCalendarDay(input.campaignEnd);
  const totalDays = computeCampaignDayCount(input.campaignStart, input.campaignEnd);
  const ourStartStr = toDateStr(startDate);
  const ourEndStr = toDateStr(endDate);

  const locationScheduleSlots = new Map<string, AffluenceSlot[]>();

  applyWizardLocationAffluence(locationScheduleSlots, input.wizardLocationSlots);

  const locScheduleRows: ScheduleRow[] = [...(scheduleWizardResult.data ?? [])];
  const affluenceScheduleFetchError = !!scheduleWizardResult.error;
  if (locScheduleRows.length > 0) {
    applyDbLocationScheduleRows(locationScheduleSlots, locScheduleRows);
  } else if (evaluationLocationIds.length > 0 && !affluenceScheduleFetchError) {
    const wizardFilled =
      input.wizardLocationSlots &&
      [...input.wizardLocationSlots.values()].some((slots) => slots.length > 0);
    if (!wizardFilled) {
    }
  }

  let videoDurationSeconds: number | undefined;
  if (input.videoId) {
    const { data: vidRow } = await supabase
      .from('videos')
      .select('*')
      .eq('id', input.videoId)
      .maybeSingle();
    const ds = (vidRow as { duration_seconds?: number | null } | null)?.duration_seconds;
    if (ds != null && Number.isFinite(Number(ds)) && Number(ds) > 0) {
      videoDurationSeconds = Number(ds);
    }
  }

  const effectiveVideoSeconds = effectiveVideoSecondsForDoohEstimate(
    videoDurationSeconds,
    input.config,
  );

  // Modèle localité: indisponibilités par écran non appliquées ici.
  // Elles doivent être déjà reflétées dans l'affluence/localités ou dans le plan horaire.
  void input.unavailabilityRows;

  const { data: specialEventsRows, error: specialEventsError } = await supabase
    .from('special_events')
    .select('id, start_date, end_date')
    .eq('is_active', true);

  if (specialEventsError) {
    log.warn({ message: specialEventsError.message }, 'computeNewCampaignDoohMaxImpressions: special_events');
  }

  const activeEvents: SpecialEventWindow[] = (specialEventsRows || [])
    .filter((e: { start_date: string; end_date: string }) => {
      const es = String(e.start_date).split('T')[0];
      const ee = String(e.end_date).split('T')[0];
      return es <= ourEndStr && ee >= ourStartStr;
    })
    .map((e: { id: string; start_date: string; end_date: string }) => ({
      id: e.id,
      start_date: String(e.start_date).split('T')[0],
      end_date: String(e.end_date).split('T')[0],
    }));

  /**
   * Campagne standard (sans `ownEventId`) : n’applique pas le blackout `special_events` sur le plafond.
   * Sinon une ligne `special_events` active avec des dates très larges met toutes les tranches à 0
   * (impressions et montant TND). La publication (`injectCampaignPublicationSchedule`) continue
   * d’appliquer les événements pour le planning réel.
   */
  const specialEventsForGrid =
    input.ownEventId != null && String(input.ownEventId).trim() !== '' ? activeEvents : [];

  const unavailabilityByLocation = new Map<string, UnavailabilityPeriod[]>();

  let occupiedRepetitionsBySlot = new Map<string, number>();
  try {
    occupiedRepetitionsBySlot = await getOccupiedRepetitionsByLocationSlotFromHourlyPlan({
      locationIds: evaluationLocationIds,
      startDate,
      endDate,
      excludeCampaignId: input.excludeCampaignId ?? null,
    });
  } catch (e) {
    log.warn({ e }, 'computeNewCampaignDoohMaxImpressions: lecture occupation depuis campaign_hourly_location_plan impossible.');
    occupiedRepetitionsBySlot = new Map<string, number>();
  }

  const slotRows = enumerateDoohLocationCampaignSlots({
    config: input.config,
    campaignStart: startDate,
    campaignEnd: endDate,
    uiExpectedDayCount: totalDays,
    locationIds: evaluationLocationIds,
    locationScheduleSlots,
    unavailabilityByLocation,
    maxOccupiedRphByLocation: new Map<string, number>(),
    activeEvents: specialEventsForGrid,
    ownEventId: input.ownEventId,
  });

  const repetitionsPerHourVideo = computeRepetitionsPerHourVideo(effectiveVideoSeconds);
  const billableSpotsPerHour = Math.max(
    0,
    input.config.max_spots_per_hour * input.config.max_billable_spot_rate_per_hour,
  );
  let totalRawImpressions = 0;
  for (const row of slotRows) {
    const occupationKey = slotOccupationKey(row.locationId, row.date, row.hour);
    const occupiedByOtherCampaigns = Math.max(0, occupiedRepetitionsBySlot.get(occupationKey) ?? 0);
    const remainingSpotsPerHour = Math.max(0, billableSpotsPerHour - occupiedByOtherCampaigns);
    const allowedRepetitionsPerHour = Math.min(repetitionsPerHourVideo, remainingSpotsPerHour);
    totalRawImpressions += allowedRepetitionsPerHour * Math.max(0, row.effectiveAffluence);
  }

  const total = Math.round(totalRawImpressions);
  if (total < 1 && evaluationLocationIds.length > 0) {
    const slotRows = evaluationLocationIds.reduce(
      (s, id) => s + (locationScheduleSlots.get(id)?.length ?? 0),
      0,
    );
    const occVals = [...occupiedRepetitionsBySlot.values()];
    const occMax = occVals.length > 0 ? Math.max(...occVals) : 0;
    log.warn({ locations: evaluationLocationIds.length,
      location_affluence_schedule_rows: slotRows,
      specialEventsInCampaignRange: activeEvents.length,
      specialEventsAppliedToGrid: specialEventsForGrid.length,
      eventBlackoutSkippedForStandardCampaign:
        specialEventsForGrid.length === 0 && activeEvents.length > 0,
      maxOccupiedRph: occMax,
      effectiveVideoSeconds,
      repetitionsPerHourVideo,
      billableSpotsPerHour, }, 'computeNewCampaignDoohMaxImpressions: total=0');
  }

  return total;
}
