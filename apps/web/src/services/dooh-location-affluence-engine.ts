import { type DoohConfigNumbers } from '../lib/dooh/config';
import {
  MS_PER_DAY,
  jsGetDayToDbDayOfWeek,
  dateToDayOfWeek,
  parseLocalCampaignCalendarDay,
  computeCampaignDayCount,
  formatLocalCalendarDate,
  localSlotRange,
} from '../lib/dooh/dates';
import { logger } from '../lib/logger';

const log = logger.child({ module: 'dooh-location-affluence-engine' });


export {
  MS_PER_DAY,
  jsGetDayToDbDayOfWeek,
  dateToDayOfWeek,
  parseLocalCampaignCalendarDay,
  computeCampaignDayCount,
  formatLocalCalendarDate,
  localSlotRange,
};

/**
 * Moteur DOOH — 100 % localités + affluence `location_affluence_schedule`.
 * Parcourt chaque date calendaire réelle, 24 h, applique événements / indispos / occupation (taux).
 *
 * Formules :
 * - À chaque (date, heure, localité), l’affluence brute = `estimated_impressions` du créneau hebdo (dow, h), puis
 *   événements / indispos / occupation réduisent l’affluence effective.
 * - total_affluence = somme des affluences **effectives** sur tous les créneaux calendaires
 * - impressions = total_affluence × max_billable_spot_rate_per_hour
 *
 * La table hebdo (day_of_week, hour) est un **modèle récurrent** : chaque date calendaire réelle
 * réutilise la valeur du créneau (dow, h) — pas de somme/moyenne hebdomadaire globale.
 *
 * Ne pas utiliser ici : total_impressions_per_week, moyenne sur 7 jours, max_spots_per_hour, 3600/durée vidéo, screen_count.
 *
 * Date/calendar helpers moved to `../lib/dooh/dates`; re-exported above for back-compat.
 */

function shouldDebugDoohSlotMatching(explicit: boolean | undefined): boolean {
  if (explicit === true) return true;
  if (explicit === false) return false;
  try {
    const env = typeof import.meta !== 'undefined' ? (import.meta as ImportMeta).env : undefined;
    if (env?.VITE_DEBUG_DOOH_SLOTS === 'true') return true;
    return Boolean(env?.DEV === true);
  } catch {
    return false;
  }
}

/** Compte les paires (localité, heure) avec affluence > 0 pour ce `day_of_week` BD (1–7). */
function countPositiveAffluenceCellsForDbDay(
  weeklyByLoc: Map<string, Map<string, number>>,
  locationIds: readonly string[],
  dbDayOfWeek: number,
): number {
  let n = 0;
  for (const locId of locationIds) {
    const g = weeklyByLoc.get(locId);
    if (!g) continue;
    for (let h = 0; h < 24; h++) {
      if ((g.get(slotKey(dbDayOfWeek, h)) ?? 0) > 0) n += 1;
    }
  }
  return n;
}

export type AffluenceSlot = {
  day_of_week: number;
  hour: number;
  estimated_impressions: number;
};

export type UnavailabilityPeriod = {
  start_date: string;
  end_date: string;
  start_time: string;
  end_time: string;
};

export type SpecialEventWindow = {
  id: string;
  start_date: string;
  end_date: string;
};

/** Paramètres moteur issus de `global_configuration` (champs effectivement utilisés ici). */
export type DoohLocationEngineConfig = {
  max_billable_spot_rate_per_hour: number;
  /**
   * Référence RPH (autres campagnes) pour convertir le max de répétitions concurrentes
   * par localité en taux d’occupation : min(1, maxRph / reference).
   */
  dooh_occupation_reference_rph: number;
};

export const DEFAULT_LOCATION_ENGINE_CONFIG: DoohLocationEngineConfig = {
  max_billable_spot_rate_per_hour: 0.3,
  dooh_occupation_reference_rph: 10,
};

/** Extrait les paramètres moteur depuis la config globale (`getDoohConfigNumbers`). */
export function doohNumbersToLocationEngineConfig(c: DoohConfigNumbers): DoohLocationEngineConfig {
  return {
    max_billable_spot_rate_per_hour: c.max_billable_spot_rate_per_hour,
    dooh_occupation_reference_rph: c.dooh_occupation_reference_rph,
  };
}

function slotKey(dayOfWeek: number, hour: number): string {
  return `${dayOfWeek}:${hour}`;
}

/**
 * Grille hebdo : clé `${dow}:${hour}` → somme des `estimated_impressions` (plusieurs lignes DB / wizard = addition).
 * L’affluence brute d’un créneau calendaire est toujours issue de cette colonne, jamais du nombre de lignes.
 */
export function buildLocationWeeklyAffluenceLookup(
  slots: readonly AffluenceSlot[],
): Map<string, number> {
  const m = new Map<string, number>();
  for (const s of slots) {
    const k = slotKey(Number(s.day_of_week), Number(s.hour));
    const v = Math.max(0, Number(s.estimated_impressions) || 0);
    m.set(k, (m.get(k) ?? 0) + v);
  }
  return m;
}

/** Compat : `locationId` ignoré (grille purement hebdo). */
export function buildLocationAffluenceLookup(
  _locationId: string,
  slots: readonly AffluenceSlot[],
): Map<string, number> {
  return buildLocationWeeklyAffluenceLookup(slots);
}

/** `locationId` → grille hebdo. */
export function buildAllLocationWeeklyLookups(
  locationScheduleSlots: ReadonlyMap<string, readonly AffluenceSlot[]>,
): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const [locId, slots] of locationScheduleSlots) {
    out.set(locId, buildLocationWeeklyAffluenceLookup(slots));
  }
  return out;
}

/** Affluence brute pour (localité, jour semaine, heure) ; 0 si pas de ligne en base / grille. */
export function rawAffluenceForWeeklySlot(
  weeklyGrid: ReadonlyMap<string, number> | undefined,
  dayOfWeek: number,
  hour: number,
): number {
  if (!weeklyGrid) return 0;
  const v = weeklyGrid.get(slotKey(dayOfWeek, hour));
  return v != null ? Math.max(0, v) : 0;
}

export function isUnavailableInSlot(
  slotStart: Date,
  slotEnd: Date,
  periods: readonly UnavailabilityPeriod[],
): boolean {
  for (const p of periods) {
    const ps = new Date(`${p.start_date}T${p.start_time}`);
    const pe = new Date(`${p.end_date}T${p.end_time}`);
    if (slotStart < pe && slotEnd > ps) return true;
  }
  return false;
}

/** @deprecated alias — utiliser `isUnavailableInSlot`. */
export const isScreenUnavailableInSlot = isUnavailableInSlot;

/** Fenêtre événement étendue −1 h / +1 h sur les bornes calendaires. */
export function isEventOverlapInSlot(
  slotStart: Date,
  slotEnd: Date,
  events: readonly SpecialEventWindow[],
  excludeEventId: string | null,
): boolean {
  for (const e of events) {
    if (excludeEventId && e.id === excludeEventId) continue;
    const es = new Date(`${e.start_date}T00:00:00`);
    es.setHours(es.getHours() - 1);
    const ee = new Date(`${e.end_date}T23:59:59`);
    ee.setHours(ee.getHours() + 1);
    if (slotStart < ee && slotEnd > es) return true;
  }
  return false;
}

/**
 * Max des `repetitions_per_hour` concurrentes par écran → une valeur par localité (canal logique unique).
 */
export function aggregateOccupiedRepetitionsByLocation(
  screenToLocation: ReadonlyMap<string, string>,
  occupiedByScreen: ReadonlyMap<string, number>,
): Map<string, number> {
  const byLoc = new Map<string, number>();
  for (const [sid, rph] of occupiedByScreen) {
    const loc = screenToLocation.get(sid);
    if (!loc) continue;
    const v = Math.max(0, rph);
    const prev = byLoc.get(loc);
    byLoc.set(loc, prev == null ? v : Math.max(prev, v));
  }
  return byLoc;
}

export function aggregateUnavailabilityByLocation(
  screenToLocation: ReadonlyMap<string, string>,
  unavailabilityByScreen: ReadonlyMap<string, UnavailabilityPeriod[]>,
): Map<string, UnavailabilityPeriod[]> {
  const byLoc = new Map<string, UnavailabilityPeriod[]>();
  for (const [sid, periods] of unavailabilityByScreen) {
    const loc = screenToLocation.get(sid);
    if (!loc) continue;
    const list = byLoc.get(loc) ?? [];
    for (const p of periods) list.push(p);
    byLoc.set(loc, list);
  }
  return byLoc;
}

/** Taux d’occupation 0..1 à partir du max RPH observé sur la localité. */
export function occupationRateFromMaxRph(maxRph: number, referenceRph: number): number {
  const ref = Math.max(referenceRph, 1e-6);
  return Math.min(1, Math.max(0, maxRph) / ref);
}

/**
 * Affluence effective sur un créneau (après indispo / événement / taux d’occupation).
 */
export function effectiveAffluenceForSlot(params: {
  rawAffluence: number;
  eventOverlap: boolean;
  unavailable: boolean;
  occupationRate: number;
}): number {
  if (params.eventOverlap || params.unavailable) return 0;
  const free = 1 - Math.min(1, Math.max(0, params.occupationRate));
  return Math.max(0, params.rawAffluence * free);
}

export type LocationAffluenceEngineInput = {
  campaignStart: Date;
  campaignEnd: Date;
  /** Localités évaluées (ordre stable). */
  locationIds: readonly string[];
  /** localité → créneaux hebdo (issues `location_affluence_schedule` uniquement). */
  locationScheduleSlots: ReadonlyMap<string, readonly AffluenceSlot[]>;
  unavailabilityByLocation: ReadonlyMap<string, readonly UnavailabilityPeriod[]>;
  /** Max RPH autres campagnes par localité (avant conversion en taux). */
  maxOccupiedRphByLocation: ReadonlyMap<string, number>;
  activeEvents: readonly SpecialEventWindow[];
  ownEventId: string | null;
  config: DoohLocationEngineConfig;
  /** Nombre de jours attendu côté appelant UI (optionnel, vérifié en debug). */
  uiExpectedDayCount?: number;
  /**
   * `true` : log chaque jour (date, jsDay, mappedDay BD, nb créneaux grille > 0).
   * `false` : jamais. `undefined` : en dev Vite uniquement (`import.meta.env.DEV`).
   */
  debugSlotMatching?: boolean;
};

export type LocationAffluenceEngineResult = {
  /** Somme des affluences effectives (même chose que Σ adjusted_impressions / taux). */
  totalAffluence: number;
  /**
   * Σ créneau `adjusted_impressions` où par créneau (date, heure, localité) :
   * adjusted_impressions = affluence_effective × max_billable_spot_rate_per_hour
   * (affluence_effective dérivée de `estimated_impressions` après événement / indispo / occupation).
   */
  impressions: number;
  /** Nombre de cellules parcourues = nbJours × 24 × nbLocalités. */
  slotsEvaluated: number;
  /** Somme des affluences effectives par localité. */
  perLocationAffluence: Map<string, number>;
  /** Σ par localité des `adjusted_impressions` (pas de moyenne intermédiaire). */
  perLocationImpressions: Map<string, number>;
};

/**
 * Parcourt chaque date calendaire incluse entre `campaignStart` et `campaignEnd` (minuit local),
 * chaque heure 0–23, chaque localité.
 */
export function computeDoohLocationAffluenceCampaign(
  input: LocationAffluenceEngineInput,
): LocationAffluenceEngineResult {
  const rate = Math.min(1, Math.max(0, input.config.max_billable_spot_rate_per_hour));
  const refRph = Math.max(input.config.dooh_occupation_reference_rph, 1e-6);
  const debug = shouldDebugDoohSlotMatching(input.debugSlotMatching);

  const weeklyByLoc = buildAllLocationWeeklyLookups(input.locationScheduleSlots);

  const perLocationAffluence = new Map<string, number>();
  const perLocationImpressions = new Map<string, number>();
  for (const id of input.locationIds) {
    perLocationAffluence.set(id, 0);
    perLocationImpressions.set(id, 0);
  }

  let totalAffluence = 0;
  let totalImpressions = 0;
  let slotsEvaluated = 0;
  let daysWithPositiveRawSlots = 0;

  const startDay = parseLocalCampaignCalendarDay(input.campaignStart);
  const endDay = parseLocalCampaignCalendarDay(input.campaignEnd);
  const dayCount = computeCampaignDayCount(input.campaignStart, input.campaignEnd);

  if (debug) {
    const grilleParLoc: Record<
      string,
      { lignes_source: number; cles_grille: number; dows_en_base: number[] }
    > = {};
    for (const locId of input.locationIds) {
      const slots = input.locationScheduleSlots.get(locId) ?? [];
      const g = weeklyByLoc.get(locId);
      const dows = new Set<number>();
      if (g) {
        for (const key of g.keys()) {
          const dowPart = Number(key.split(':')[0]);
          if (Number.isFinite(dowPart)) dows.add(dowPart);
        }
      }
      grilleParLoc[locId] = {
        lignes_source: slots.length,
        cles_grille: g?.size ?? 0,
        dows_en_base: [...dows].sort((a, b) => a - b),
      };
    }
  }

  for (let dayIndex = 0; dayIndex < dayCount; dayIndex++) {
    const calendarDay = new Date(startDay);
    calendarDay.setDate(startDay.getDate() + dayIndex);
    const jsDay = calendarDay.getDay();
    const mappedDay = jsGetDayToDbDayOfWeek(jsDay);
    const slotsPositifsCeJour = countPositiveAffluenceCellsForDbDay(
      weeklyByLoc,
      input.locationIds,
      mappedDay,
    );
    if (slotsPositifsCeJour > 0) daysWithPositiveRawSlots += 1;

    if (debug) {
    }

    const dow = mappedDay;

    for (let hour = 0; hour < 24; hour++) {
      const { start: slotStart, end: slotEnd } = localSlotRange(calendarDay, hour);
      const eventOverlap = isEventOverlapInSlot(
        slotStart,
        slotEnd,
        input.activeEvents,
        input.ownEventId,
      );

      for (const locationId of input.locationIds) {
        slotsEvaluated += 1;
        const weeklyGrid = weeklyByLoc.get(locationId);
        const raw = rawAffluenceForWeeklySlot(weeklyGrid, dow, hour);
        const periods = input.unavailabilityByLocation.get(locationId) ?? [];
        const unavailable = isUnavailableInSlot(slotStart, slotEnd, periods);
        const maxRph = input.maxOccupiedRphByLocation.get(locationId) ?? 0;
        const occRate = occupationRateFromMaxRph(maxRph, refRph);

        const effectiveAffluence = effectiveAffluenceForSlot({
          rawAffluence: raw,
          eventOverlap,
          unavailable,
          occupationRate: occRate,
        });

        const adjustedImpressions = effectiveAffluence * rate;

        totalAffluence += effectiveAffluence;
        totalImpressions += adjustedImpressions;
        perLocationAffluence.set(
          locationId,
          (perLocationAffluence.get(locationId) ?? 0) + effectiveAffluence,
        );
        perLocationImpressions.set(
          locationId,
          (perLocationImpressions.get(locationId) ?? 0) + adjustedImpressions,
        );
      }
    }
  }

  const expectedSlots = dayCount * 24 * input.locationIds.length;
  if (slotsEvaluated !== expectedSlots) {
    log.error({ slotsEvaluated,
      expectedSlots,
      dayCount,
      locationCount: input.locationIds.length, }, '[DOOH affluence] ERROR: incohérence slots évalués.');
  }

  if (input.uiExpectedDayCount != null && input.uiExpectedDayCount !== dayCount) {
    log.error({ uiExpectedDayCount: input.uiExpectedDayCount,
      engineDayCount: dayCount,
      periode: { debut: formatLocalCalendarDate(startDay), fin: formatLocalCalendarDate(endDay) }, }, '[DOOH affluence] ERROR: dayCount UI != moteur.');
  }

  if (totalImpressions <= 0) {
    let lignesScheduleTotal = 0;
    const dowsSchedule = new Set<number>();
    for (const locId of input.locationIds) {
      const slots = input.locationScheduleSlots.get(locId) ?? [];
      lignesScheduleTotal += slots.length;
      for (const s of slots) dowsSchedule.add(Number(s.day_of_week));
    }
    log.error({ message:
        lignesScheduleTotal === 0
          ? 'Aucune ligne dans locationScheduleSlots (SELECT location_affluence_schedule / wizard vide pour ces localités).'
          : daysWithPositiveRawSlots === 0
            ? 'Aucun créneau grille avec estimated_impressions > 0 pour les jours calendaires parcourus : vérifier day_of_week en base (1=lun..7=dim) vs mapping jsGetDayToDbDayOfWeek, ou affluence à 0 partout.'
            : 'Données grille présentes mais tout est annulé par événements, indisponibilités ou occupation (ou taux facturable 0).',
      periode: { debut: formatLocalCalendarDate(startDay), fin: formatLocalCalendarDate(endDay) },
      localites: input.locationIds,
      lignes_schedule_total: lignesScheduleTotal,
      day_of_week_presents_dans_donnees: [...dowsSchedule].sort((a, b) => a - b),
      jours_avec_au_moins_un_slot_grille_positif: daysWithPositiveRawSlots,
      slotsEvaluated,
      totalAffluence_effective: totalAffluence,
      max_billable_spot_rate_per_hour: rate, }, '[DOOH affluence] ERROR: 0 impression — aucune diffusion facturable calculée.');
  }

  return {
    totalAffluence,
    impressions: totalImpressions,
    slotsEvaluated,
    perLocationAffluence,
    perLocationImpressions,
  };
}

/** Un créneau (localité × date × heure) tel que calculé par le moteur (avant échelle budget). */
export type DoohLocationSlotRow = {
  locationId: string;
  date: string;
  dayOfWeek: number;
  hour: number;
  effectiveAffluence: number;
  /** Par créneau : identique à `computeDoohLocationAffluenceCampaign` (Σ = total impressions). */
  adjustedImpressions: number;
  /** @deprecated alias de adjustedImpressions */
  billableImpressions: number;
};

/**
 * Liste chaque créneau calendaire × localité avec affluence effective et impressions facturables théoriques.
 * Même logique que `computeDoohLocationAffluenceCampaign` (déterministe).
 */
export function enumerateDoohLocationCampaignSlots(
  input: LocationAffluenceEngineInput,
): DoohLocationSlotRow[] {
  const rate = Math.min(1, Math.max(0, input.config.max_billable_spot_rate_per_hour));
  const refRph = Math.max(input.config.dooh_occupation_reference_rph, 1e-6);
  const weeklyByLoc = buildAllLocationWeeklyLookups(input.locationScheduleSlots);
  const rows: DoohLocationSlotRow[] = [];

  const startDay = parseLocalCampaignCalendarDay(input.campaignStart);
  const dayCount = computeCampaignDayCount(input.campaignStart, input.campaignEnd);

  for (let dayIndex = 0; dayIndex < dayCount; dayIndex++) {
    const calendarDay = new Date(startDay);
    calendarDay.setDate(startDay.getDate() + dayIndex);
    const dow = jsGetDayToDbDayOfWeek(calendarDay.getDay());
    const dateStr = formatLocalCalendarDate(calendarDay);

    for (let hour = 0; hour < 24; hour++) {
      const { start: slotStart, end: slotEnd } = localSlotRange(calendarDay, hour);
      const eventOverlap = isEventOverlapInSlot(
        slotStart,
        slotEnd,
        input.activeEvents,
        input.ownEventId,
      );

      for (const locationId of input.locationIds) {
        const weeklyGrid = weeklyByLoc.get(locationId);
        const raw = rawAffluenceForWeeklySlot(weeklyGrid, dow, hour);
        const periods = input.unavailabilityByLocation.get(locationId) ?? [];
        const unavailable = isUnavailableInSlot(slotStart, slotEnd, periods);
        const maxRph = input.maxOccupiedRphByLocation.get(locationId) ?? 0;
        const occRate = occupationRateFromMaxRph(maxRph, refRph);
        const effectiveAffluence = effectiveAffluenceForSlot({
          rawAffluence: raw,
          eventOverlap,
          unavailable,
          occupationRate: occRate,
        });
        const adjustedImpressions = effectiveAffluence * rate;
        rows.push({
          locationId,
          date: dateStr,
          dayOfWeek: dow,
          hour,
          effectiveAffluence,
          adjustedImpressions,
          billableImpressions: adjustedImpressions,
        });
      }
    }
  }

  return rows;
}

/** Répartition des impressions par localité vers les écrans (parts égales) — couche persistence. */
export function splitLocationImpressionsToScreens(
  perLocationImpressions: ReadonlyMap<string, number>,
  screensByLocation: ReadonlyMap<string, readonly string[]>,
): Map<string, number> {
  const perScreen = new Map<string, number>();
  for (const [locId, imp] of perLocationImpressions) {
    const sids = screensByLocation.get(locId);
    const n = sids?.length ?? 0;
    if (n <= 0) continue;
    const each = imp / n;
    for (const sid of sids) {
      perScreen.set(sid, (perScreen.get(sid) ?? 0) + each);
    }
  }
  return perScreen;
}
