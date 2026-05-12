import { buildHybridAdjustedHourlyPlan, type HourlyPlanSlotInput } from '../lib/dooh/hourly-plan';
import { supabase } from '../lib/supabase';

import {
  getOccupiedRepetitionsByLocationFromHourlyPlan,
  replaceCampaignHourlyLocationPlan,
} from './campaign-hourly-location-plan.service';
import {
  computeRepetitionsPerHourVideo,
  resolveEffectiveVideoDuration,
} from './dooh-calculation.service';
import {
  aggregateOccupiedRepetitionsByLocation,
  aggregateUnavailabilityByLocation,
  computeCampaignDayCount,
  computeHourlyDoohGridByLocation,
  doohNumbersToLocationEngineConfig,
  enumerateDoohLocationCampaignSlots,
  formatLocalCalendarDate,
  normalizeLocationScheduleSlotsForEngine,
  parseLocalCampaignCalendarDay,
  splitLocationRawImpressionsToScreens,
  type AffluenceSlot,
  type UnavailabilityPeriod,
  type SpecialEventWindow,
} from './dooh-hourly-grid';
import { getDoohConfigNumbers } from './global-configuration.service';

export interface CreateCampaignData {
  name: string;
  client_id?: string;
  category: string;
  /** Catégories multiples (valeurs enum). Si présent, remplace category pour la table campaign_categories. */
  categories?: string[];
  start_date: string;
  end_date: string;
  budget: number;
  views?: number;
  status?: 'draft' | 'pending' | 'active' | 'paused' | 'completed' | 'rejected';
  video_id?: string;
  event_id?: string;
  location_lat?: number;
  location_lng?: number;
  location_radius?: number;
  /** Ciblage par localités (recommandé) : remplit campaign_locations et dérive campaign_screens. */
  location_ids?: string[];
  /** Ciblage par écrans (legacy) : utilisé si location_ids absent. */
  screen_ids?: string[];
}

function slotOccupationKey(
  locationId: string,
  diffusionDate: string,
  diffusionHour: number,
): string {
  return `${locationId}|${diffusionDate}|${diffusionHour}`;
}

function isMissingCampaignCategoriesTable(error: unknown): boolean {
  const err = error as { code?: string; message?: string } | null;
  return Boolean(
    err && err.code === 'PGRST205' && String(err.message || '').includes('campaign_categories'),
  );
}

async function getOccupiedRepetitionsByLocationSlotFromHourlyPlan(input: {
  locationIds: readonly string[];
  startDate: Date;
  endDate: Date;
  excludeCampaignId?: string | null;
}): Promise<Map<string, number>> {
  const locationIds = [...new Set(input.locationIds.filter(Boolean))];
  if (locationIds.length === 0) return new Map<string, number>();

  const start = formatLocalCalendarDate(input.startDate);
  const end = formatLocalCalendarDate(input.endDate);

  const { data: rows, error } = await supabase
    .from('campaign_hourly_location_plan')
    .select(
      'campaign_id, location_id, diffusion_date, diffusion_hour, planned_repetitions_per_hour',
    )
    .in('location_id', locationIds)
    .gte('diffusion_date', start)
    .lte('diffusion_date', end);

  if (error) {
    console.warn(
      'getOccupiedRepetitionsByLocationSlotFromHourlyPlan: lecture indisponible, occupation concurrente à 0.',
      error,
    );
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
    console.warn(
      'getOccupiedRepetitionsByLocationSlotFromHourlyPlan: lecture statuts campagnes indisponible, occupation concurrente à 0.',
      campaignsError,
    );
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

export const campaignService = {
  // Créer ou mettre à jour une campagne en draft
  async saveCampaignDraft(campaignData: CreateCampaignData, campaignId?: string): Promise<any> {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error('Utilisateur non connecté');

      const primaryCategory = (
        campaignData.categories?.length ? campaignData.categories[0] : campaignData.category
      ) as string;
      const campaignRecord: Record<string, unknown> = {
        name: campaignData.name,
        client_id: campaignData.client_id,
        category: primaryCategory,
        start_date: campaignData.start_date,
        end_date: campaignData.end_date,
        budget: campaignData.budget,
        views: Math.max(0, Math.round(campaignData.views ?? 0)),
        status: campaignData.status || 'draft',
        video_id: campaignData.video_id,
        user_id: user.id,
        location_lat: campaignData.location_lat,
        location_lng: campaignData.location_lng,
        location_radius: campaignData.location_radius,
      };
      if (campaignData.event_id != null) {
        campaignRecord.event_id = campaignData.event_id;
      }

      let campaignResult;

      if (campaignId) {
        // Mise à jour d'une campagne existante
        const { data, error } = await supabase
          .from('campaigns')
          .update(campaignRecord)
          .eq('id', campaignId)
          .select()
          .single();

        if (error) throw error;
        campaignResult = data;

        // Supprimer anciens campaign_screens et campaign_locations
        await supabase.from('campaign_screens').delete().eq('campaign_id', campaignId);
        await supabase.from('campaign_locations').delete().eq('campaign_id', campaignId);
      } else {
        // Création d'une nouvelle campagne
        const { data, error } = await supabase
          .from('campaigns')
          .insert(campaignRecord)
          .select()
          .single();

        if (error) throw error;
        campaignResult = data;
      }

      // Ciblage par localités : remplir campaign_locations puis dériver campaign_screens
      if (campaignResult && campaignData.location_ids && campaignData.location_ids.length > 0) {
        const locInserts = campaignData.location_ids.map((locationId) => ({
          campaign_id: campaignResult.id,
          location_id: locationId,
        }));
        const { error: locErr } = await supabase.from('campaign_locations').insert(locInserts);
        if (locErr) {
          console.error('Erreur campaign_locations:', locErr);
        } else {
          const { data: screensInLocs } = await supabase
            .from('screens')
            .select('id')
            .in('location_id', campaignData.location_ids)
            .eq('status', 'active');
          const screenIds = (screensInLocs || []).map((s) => s.id);
          if (screenIds.length > 0) {
            const screenInserts = screenIds.map((screenId) => ({
              campaign_id: campaignResult.id,
              screen_id: screenId,
            }));
            await supabase.from('campaign_screens').insert(screenInserts);
            console.log(
              '✅',
              campaignData.location_ids.length,
              'localité(s),',
              screenIds.length,
              'écran(s) ajoutés',
            );
          }
        }
      } else if (campaignResult && campaignData.screen_ids && campaignData.screen_ids.length > 0) {
        // Legacy : ciblage direct par écrans
        const screenInserts = campaignData.screen_ids.map((screenId) => ({
          campaign_id: campaignResult.id,
          screen_id: screenId,
        }));
        const { error: screensError } = await supabase
          .from('campaign_screens')
          .insert(screenInserts);
        if (screensError) console.error('Erreur ajout écrans:', screensError);
        else console.log('✅ Écrans ajoutés avec succès');
      }

      // Synchroniser les catégories multiples (campaign_categories)
      const categoriesToSync = campaignData.categories?.length
        ? campaignData.categories
        : [primaryCategory];
      const cid = campaignResult.id;
      const { error: delErr } = await supabase
        .from('campaign_categories')
        .delete()
        .eq('campaign_id', cid);
      if (delErr && !isMissingCampaignCategoriesTable(delErr)) {
        console.error('Erreur suppression campaign_categories:', delErr);
      }
      if (categoriesToSync.length > 0) {
        const { error: insErr } = await supabase
          .from('campaign_categories')
          .insert(categoriesToSync.map((cat) => ({ campaign_id: cid, category: cat })));
        if (insErr && !isMissingCampaignCategoriesTable(insErr)) {
          console.error('Erreur insertion campaign_categories:', insErr);
        }
      }

      return campaignResult;
    } catch (error) {
      console.error('Erreur lors de la sauvegarde de la campagne:', error);
      throw error;
    }
  },

  /** Récupérer les catégories (enum) d'une campagne pour l'édition. */
  async getCampaignCategories(campaignId: string): Promise<string[]> {
    const { data, error } = await supabase
      .from('campaign_categories')
      .select('category')
      .eq('campaign_id', campaignId)
      .order('category');
    if (error) {
      if (!isMissingCampaignCategoriesTable(error)) {
        console.error('Erreur getCampaignCategories:', error);
      }
      return [];
    }
    return (data || []).map((r: { category: string }) => r.category);
  },

  // Finaliser une campagne (passer de draft à pending)
  async submitCampaign(campaignId: string): Promise<any> {
    try {
      const { data, error } = await supabase
        .from('campaigns')
        .update({ status: 'pending' })
        .eq('id', campaignId)
        .select()
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Erreur lors de la soumission de la campagne:', error);
      throw error;
    }
  },

  // Créer automatiquement les validations pour les écrans avec auto_accept
  async createAutoApprovalsForCampaign(campaignId: string): Promise<void> {
    try {
      // Modèle localité/owner: pas d'auto-approbation via screen_configurations.
      // Les validations sont gérées explicitement par owner approval.
      void campaignId;
    } catch (error) {
      console.error('❌ Erreur lors de la création des approbations automatiques:', error);
    }
  },

  // Injecter les informations de publication par heure dans la campagne
  async injectCampaignPublicationSchedule(
    campaignId: string,
    options?: {
      /**
       * Propriétaire qui déclenche le recalcul (approbation/rejet).
       * Permet de scoper l'écriture aux localités réellement liées à ses écrans.
       */
      actorOwnerId?: string;
    },
  ): Promise<void> {
    try {
      // Créer d'abord les approbations automatiques pour les écrans avec auto_accept
      await this.createAutoApprovalsForCampaign(campaignId);

      // Récupérer les informations de la campagne
      const { data: campaign, error: campaignError } = await supabase
        .from('campaigns')
        .select('start_date, end_date, budget, views, video_id, event_id, user_id')
        .eq('id', campaignId)
        .single();

      if (campaignError || !campaign) {
        throw campaignError ?? new Error('Campagne introuvable.');
      }

      // Récupérer les écrans de la campagne
      const { data: campaignScreens, error: screensError } = await supabase
        .from('campaign_screens')
        .select('screen_id')
        .eq('campaign_id', campaignId);

      if (screensError) {
        throw screensError;
      }

      let screenIds = campaignScreens?.map((cs) => cs.screen_id) || [];
      if (screenIds.length === 0) {
        throw new Error('Aucun écran trouvé pour la campagne.');
      }

      // Filtrer les écrans approuvés par leurs propriétaires
      // Récupérer les propriétaires des écrans
      const { data: screens, error: screensDataError } = await supabase
        .from('screens')
        .select('id, owner_id')
        .in('id', screenIds);

      if (screensDataError) {
        throw screensDataError;
      }

      // Récupérer les validations des propriétaires
      const ownerIds = [...new Set(screens?.map((s) => s.owner_id) || [])];
      const { data: approvals, error: approvalsError } = await supabase
        .from('campaign_owner_approvals')
        .select('owner_id, status')
        .eq('campaign_id', campaignId)
        .in('owner_id', ownerIds)
        .eq('status', 'approved');

      if (approvalsError) {
        throw approvalsError;
      }
      const approvedOwnerIds = new Set(
        (approvals || []).map((a: { owner_id: string }) => a.owner_id),
      );

      // Construire la liste des écrans approuvés
      const approvedScreenIds = new Set<string>();

      // Pour chaque propriétaire: filtrage strict aux owners approuvés.
      // Modèle localité: on ne dépend pas de screen_configurations ici.
      for (const screen of screens || []) {
        const ownerId = screen.owner_id;
        const isApproved = approvedOwnerIds.has(ownerId);

        if (isApproved) {
          approvedScreenIds.add(screen.id);
        }
      }

      // Filtrer pour ne garder que les écrans approuvés
      screenIds = Array.from(approvedScreenIds);

      if (screenIds.length === 0) {
        console.log(
          `ℹ️ Aucun propriétaire approuvé pour la campagne ${campaignId}: nettoyage du plan horaire (0 ligne active).`,
        );
        await replaceCampaignHourlyLocationPlan(campaignId, []);
        return;
      }

      console.log(
        `✅ ${screenIds.length} écran(s) approuvé(s) pour la campagne ${campaignId}:`,
        screenIds,
      );
      console.log(
        '[DOOH] Un tableau « planning par créneau » (localité / jour / heure) sera affiché après calcul des répétitions.',
      );

      // Récupérer les écrans avec leur location_id pour grouper par localité
      const { data: screensWithData, error: screensAffluenceError } = await supabase
        .from('screens')
        .select('id, location_id')
        .in('id', screenIds);

      if (screensAffluenceError) {
        throw screensAffluenceError;
      }

      const screenToLocation = new Map<string, string>();
      const screensByLocation = new Map<string, string[]>();
      (screensWithData || []).forEach((s: any) => {
        if (s.location_id) {
          screenToLocation.set(s.id, s.location_id);
          const arr = screensByLocation.get(s.location_id) ?? [];
          arr.push(s.id);
          screensByLocation.set(s.location_id, arr);
        }
      });
      const locationIds = [
        ...new Set((screensWithData || []).map((s: any) => s.location_id).filter(Boolean)),
      ];

      // Affluence par localité : créneaux réels `location_affluence_schedule` (day_of_week + hour), sans moyenne hebdo.
      const locationScheduleSlots = new Map<string, AffluenceSlot[]>();
      if (locationIds.length > 0) {
        const { data: locSchedule } = await supabase
          .from('location_affluence_schedule')
          .select('location_id, day_of_week, hour, estimated_impressions')
          .in('location_id', locationIds);
        (locSchedule || []).forEach((r: any) => {
          if (!locationScheduleSlots.has(r.location_id)) {
            locationScheduleSlots.set(r.location_id, []);
          }
          locationScheduleSlots.get(r.location_id)!.push({
            day_of_week: Number(r.day_of_week),
            hour: Number(r.hour),
            estimated_impressions: Number(r.estimated_impressions) || 0,
          });
        });
      }

      if (!screensWithData?.length) {
        throw new Error('Aucun écran exploitable avec localité pour la campagne.');
      }

      const doohConfig = await getDoohConfigNumbers();
      const isEventCampaign = Boolean((campaign as { event_id?: string | null }).event_id);
      const ownEventId = (campaign as { event_id?: string | null }).event_id ?? null;
      const cpmTnd = isEventCampaign
        ? doohConfig.event_campaign_cpm_tnd
        : doohConfig.standard_campaign_cpm_tnd;

      let videoDurationSeconds: number | undefined;
      if ((campaign as { video_id?: string | null }).video_id) {
        const { data: vidRow } = await supabase
          .from('videos')
          .select('*')
          .eq('id', (campaign as { video_id: string }).video_id)
          .maybeSingle();
        const ds = (vidRow as { duration_seconds?: number | null } | null)?.duration_seconds;
        if (ds != null && Number.isFinite(Number(ds)) && Number(ds) > 0) {
          videoDurationSeconds = Number(ds);
        }
      }

      const effectiveDur = resolveEffectiveVideoDuration(videoDurationSeconds, doohConfig);
      const effectiveVideoSeconds = effectiveDur.ok
        ? effectiveDur.seconds
        : doohConfig.video_default_duration_seconds;

      const startDate = parseLocalCampaignCalendarDay(campaign.start_date);
      const endDate = parseLocalCampaignCalendarDay(campaign.end_date);
      const totalDays = computeCampaignDayCount(campaign.start_date, campaign.end_date);
      const ourStartStr = formatLocalCalendarDate(startDate);
      const ourEndStr = formatLocalCalendarDate(endDate);

      const { data: unavailabilityPeriods } = await supabase
        .from('screen_unavailability_periods')
        .select('*')
        .in('screen_id', screenIds)
        .lte('start_date', ourEndStr)
        .gte('end_date', ourStartStr);

      let unavailableHoursPerDay = 0;
      if (unavailabilityPeriods && unavailabilityPeriods.length > 0) {
        const totalUnavailableHours = unavailabilityPeriods.reduce((sum, period) => {
          const start = new Date(`${period.start_date}T${period.start_time}`);
          const end = new Date(`${period.end_date}T${period.end_time}`);
          const hours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
          return sum + Math.max(0, hours);
        }, 0);
        const locationCountForLegacy = Math.max(1, locationIds.length);
        unavailableHoursPerDay = totalUnavailableHours / (locationCountForLegacy * totalDays);
      }

      const BASE_HOURS_PER_DAY = 15;
      const hoursPerDay = Math.max(0, BASE_HOURS_PER_DAY - unavailableHoursPerDay);

      const unavailabilityByScreen = new Map<string, UnavailabilityPeriod[]>();
      (unavailabilityPeriods || []).forEach((p: any) => {
        if (!p.screen_id) return;
        const list = unavailabilityByScreen.get(p.screen_id) ?? [];
        list.push({
          start_date: p.start_date,
          end_date: p.end_date,
          start_time: p.start_time,
          end_time: p.end_time,
        });
        unavailabilityByScreen.set(p.screen_id, list);
      });

      const { data: specialEventsRows, error: specialEventsError } = await supabase
        .from('special_events')
        .select('id, start_date, end_date')
        .eq('is_active', true);

      if (specialEventsError) {
        console.warn(
          '⚠️ Lecture special_events impossible (RLS ?). Chevauchements événement ignorés pour la grille horaire:',
          specialEventsError.message,
        );
      }

      const activeEvents: SpecialEventWindow[] = (specialEventsRows || [])
        .filter((e: any) => {
          const es = String(e.start_date).split('T')[0];
          const ee = String(e.end_date).split('T')[0];
          return es <= ourEndStr && ee >= ourStartStr;
        })
        .map((e: any) => ({
          id: e.id,
          start_date: String(e.start_date).split('T')[0],
          end_date: String(e.end_date).split('T')[0],
        }));

      let occupiedRepetitionsByLocation = new Map<string, number>();
      try {
        occupiedRepetitionsByLocation = await getOccupiedRepetitionsByLocationFromHourlyPlan({
          locationIds,
          startDate,
          endDate,
          excludeCampaignId: campaignId,
        });
      } catch (e) {
        console.warn(
          'injectCampaignPublicationSchedule: lecture occupation depuis campaign_hourly_location_plan impossible, fallback campaign_screens.',
          e,
        );
        const { data: otherCsRows } = await supabase
          .from('campaign_screens')
          .select('campaign_id, screen_id, repetitions_per_hour')
          .in('screen_id', screenIds)
          .neq('campaign_id', campaignId);

        const otherCampaignIds = [...new Set((otherCsRows || []).map((r: any) => r.campaign_id))];
        const overlappingStatuses = new Set<string>();
        if (otherCampaignIds.length > 0) {
          const { data: otherCampaigns } = await supabase
            .from('campaigns')
            .select('id, start_date, end_date, status')
            .in('id', otherCampaignIds)
            .in('status', ['active', 'pending']);

          (otherCampaigns || []).forEach((c: any) => {
            const cs = String(c.start_date).split('T')[0];
            const ce = String(c.end_date).split('T')[0];
            if (cs <= ourEndStr && ce >= ourStartStr) {
              overlappingStatuses.add(c.id);
            }
          });
        }

        const occupiedRepetitionsByScreen = new Map<string, number>();
        (otherCsRows || []).forEach((row: any) => {
          if (!overlappingStatuses.has(row.campaign_id)) return;
          const sid = row.screen_id as string;
          const rph = Number(row.repetitions_per_hour) || 0;
          occupiedRepetitionsByScreen.set(sid, (occupiedRepetitionsByScreen.get(sid) ?? 0) + rph);
        });
        occupiedRepetitionsByLocation = aggregateOccupiedRepetitionsByLocation(
          screenToLocation,
          occupiedRepetitionsByScreen,
        );
      }

      const unavailabilityByLocation = aggregateUnavailabilityByLocation(
        screenToLocation,
        unavailabilityByScreen,
      );
      const orderedLocationIds = [...locationIds].sort();

      const hourlyGrid = computeHourlyDoohGridByLocation({
        config: doohConfig,
        effectiveVideoDurationSeconds: effectiveVideoSeconds,
        campaignStart: startDate,
        campaignEnd: endDate,
        uiExpectedDayCount: totalDays,
        locationIds: orderedLocationIds,
        locationScheduleSlots,
        unavailabilityByLocation,
        occupiedRepetitionsByLocation,
        activeEvents,
        ownEventId,
      });

      const perScreenRawImpressions = splitLocationRawImpressionsToScreens(
        hourlyGrid.perLocationRawImpressions,
        screensByLocation,
      );

      const calculatedImpressions = Math.round((Number(campaign.budget) / cpmTnd) * 1000);
      const slotCapImpressions = hourlyGrid.totalRawImpressions;
      const storedViews = Math.max(0, Number((campaign as { views?: number | null }).views) || 0);
      const finalImpressions = storedViews > 0 ? Math.round(storedViews) : calculatedImpressions;
      const hourlyScale = slotCapImpressions > 0 ? finalImpressions / slotCapImpressions : 0;
      const totalSlotHours = totalDays * 24;

      const screenIdsOrdered = (screensWithData || []).map((s: { id: string }) => s.id);
      const nScreens = Math.max(1, screenIdsOrdered.length);
      const rawSumScreens = screenIdsOrdered.reduce(
        (sum, sid) => sum + (perScreenRawImpressions.get(sid) ?? 0),
        0,
      );

      /** Charge moyenne pondérée sur la période (impressions facturables / heure calendaire), issue du moteur. */
      const screensWithImpressions = screenIdsOrdered.map((sid) => {
        const raw = perScreenRawImpressions.get(sid) ?? 0;
        return {
          id: sid,
          impressions_per_hour: totalSlotHours > 0 ? raw / totalSlotHours : 0,
        };
      });

      const screenSchedules = screensWithImpressions.map((screen) => {
        const rawScreen = perScreenRawImpressions.get(screen.id) ?? 0;
        const capacityRatio = rawSumScreens > 0 ? rawScreen / rawSumScreens : 1 / nScreens;

        let impressionsPerHourForScreen: number;
        if (slotCapImpressions > 0 && hourlyScale > 0) {
          impressionsPerHourForScreen = (rawScreen * hourlyScale) / totalSlotHours;
        } else {
          impressionsPerHourForScreen =
            totalSlotHours > 0 ? finalImpressions / nScreens / totalSlotHours : 0;
        }

        // S'assurer qu'on a au moins une petite allocation si l'écran a une capacité
        // Cela garantit qu'on aura au moins 1 répétition
        if (screen.impressions_per_hour > 0 && impressionsPerHourForScreen === 0) {
          // Allouer au moins 1% de la capacité de l'écran pour garantir au moins 1 répétition
          impressionsPerHourForScreen = screen.impressions_per_hour * 0.01;
        }

        // Calculer le nombre de répétitions par heure pour cet écran
        // IMPORTANT : Le nombre de répétitions doit être proportionnel à la capacité d'impression
        // Un écran avec 1000 imp/h doit avoir plus de répétitions qu'un écran avec 100 imp/h

        // Pour garantir que les écrans avec plus de capacité ont plus de répétitions,
        // on utilise un facteur de répétition qui DIMINUE avec la capacité
        // Cela signifie qu'un écran avec plus de capacité génère MOINS d'impressions par répétition
        // (en pourcentage), donc il a besoin de PLUS de répétitions pour générer les mêmes impressions

        // Calculer la capacité minimale et maximale pour normaliser
        const capacities = screensWithImpressions
          .map((s) => s.impressions_per_hour)
          .filter((c) => c > 0);
        // S'assurer qu'on a au moins une capacité valide
        if (capacities.length === 0) {
          console.warn(`⚠️ Aucune capacité valide pour l'écran ${screen.id}`);
          return {
            screen_id: screen.id,
            impressions_per_hour: 0,
            capacity_ratio: 0,
            impressions_allocated_per_hour: 0,
            repetitions_per_hour: 1,
            total_impressions_allocated: Math.round(rawScreen * hourlyScale),
            impressions_per_repetition: 0,
            repetition_factor: 0.15,
          };
        }
        const minCapacity = Math.min(...capacities);
        const maxCapacity = Math.max(...capacities);
        const capacityRange = maxCapacity - minCapacity;

        // Facteur de répétition : varie entre 0.25 (écrans faibles) et 0.10 (écrans forts)
        // Écrans avec plus de capacité → facteur plus faible → moins d'impressions par répétition → plus de répétitions nécessaires
        let repetitionFactor: number;
        if (capacityRange > 0) {
          // Normaliser la capacité de cet écran entre 0 et 1
          const normalizedCapacity = (screen.impressions_per_hour - minCapacity) / capacityRange;
          // Facteur inverse : écrans forts (normalizedCapacity proche de 1) → facteur proche de 0.10
          // Écrans faibles (normalizedCapacity proche de 0) → facteur proche de 0.25
          repetitionFactor = 0.25 - normalizedCapacity * 0.15; // Entre 0.25 et 0.10
        } else {
          // Tous les écrans ont la même capacité → facteur moyen
          repetitionFactor = 0.15;
        }

        // Calculer les impressions générées par une répétition pour cet écran
        // Écran avec 1000 imp/h et facteur 0.10 → 100 impressions/répétition
        // Écran avec 100 imp/h et facteur 0.25 → 25 impressions/répétition
        const impressionsPerRepetition = screen.impressions_per_hour * repetitionFactor;

        // Calculer le nombre de répétitions nécessaires pour atteindre les impressions allouées
        // Écran avec 1000 imp/h et 500 imp allouées → 500/100 = 5 répétitions
        // Écran avec 100 imp/h et 50 imp allouées → 50/25 = 2 répétitions

        // Calculer le nombre de répétitions nécessaires pour atteindre les impressions allouées
        let repetitionsPerHour = 1; // Minimum par défaut

        if (impressionsPerRepetition > 0 && impressionsPerHourForScreen > 0) {
          const calculatedRepetitions = impressionsPerHourForScreen / impressionsPerRepetition;
          // Utiliser Math.ceil pour s'assurer qu'on a au moins 1 répétition si on a des impressions allouées
          repetitionsPerHour = Math.max(1, Math.ceil(calculatedRepetitions));
        } else if (impressionsPerHourForScreen > 0 && impressionsPerRepetition === 0) {
          // Si impressionsPerRepetition est 0 mais qu'on a des impressions allouées, utiliser un minimum
          repetitionsPerHour = 1;
        }

        // Ajustement supplémentaire : garantir que les écrans avec plus de capacité
        // ont proportionnellement plus de répétitions (au moins 50% du ratio de capacité)
        if (minCapacity > 0 && screen.impressions_per_hour > 0) {
          const capacityRatioForRepetitions = screen.impressions_per_hour / minCapacity;
          // S'assurer qu'on a au moins 1 répétition basée sur la capacité
          const minRepetitionsBasedOnCapacity = Math.max(
            1,
            Math.ceil(capacityRatioForRepetitions * 0.5),
          );

          // Prendre le maximum entre le calcul basé sur les impressions et le minimum basé sur la capacité
          repetitionsPerHour = Math.max(repetitionsPerHour, minRepetitionsBasedOnCapacity);
        }

        // Garantie finale : toujours au moins 1 répétition par heure
        repetitionsPerHour = Math.max(1, repetitionsPerHour);

        // Si l'écran a une capacité d'impression, on doit avoir au moins 1 répétition
        if (screen.impressions_per_hour > 0 && repetitionsPerHour === 0) {
          console.warn(
            `⚠️ Répétitions à 0 pour écran ${screen.id} avec capacité ${screen.impressions_per_hour}, forcer à 1`,
          );
          repetitionsPerHour = 1;
        }

        // Log pour debug
        console.log(`📊 Écran ${screen.id}:`, {
          impressions_per_hour: screen.impressions_per_hour,
          impressionsPerHourForScreen: impressionsPerHourForScreen,
          impressionsPerRepetition: impressionsPerRepetition,
          repetitionFactor: repetitionFactor,
          repetitionsPerHour: repetitionsPerHour,
        });

        return {
          screen_id: screen.id,
          impressions_per_hour: screen.impressions_per_hour,
          capacity_ratio: capacityRatio,
          impressions_allocated_per_hour: Math.round(impressionsPerHourForScreen),
          repetitions_per_hour: repetitionsPerHour,
          total_impressions_allocated: Math.round(rawScreen * hourlyScale),
          impressions_per_repetition: impressionsPerRepetition,
          repetition_factor: repetitionFactor,
        };
      });

      let occupiedRepetitionsBySlot = new Map<string, number>();
      try {
        occupiedRepetitionsBySlot = await getOccupiedRepetitionsByLocationSlotFromHourlyPlan({
          locationIds: orderedLocationIds,
          startDate,
          endDate,
          excludeCampaignId: campaignId,
        });
      } catch (e) {
        console.warn(
          'injectCampaignPublicationSchedule: lecture occupation par créneau indisponible, occupation concurrente à 0.',
          e,
        );
        occupiedRepetitionsBySlot = new Map<string, number>();
      }

      const repetitionsPerHourVideo = computeRepetitionsPerHourVideo(effectiveVideoSeconds);
      const billableSpotsPerHour = Math.max(
        0,
        doohConfig.max_spots_per_hour * doohConfig.max_billable_spot_rate_per_hour,
      );

      const normalizedSlotsDetail = normalizeLocationScheduleSlotsForEngine(
        orderedLocationIds,
        locationScheduleSlots,
      );
      const slotDetailRows = enumerateDoohLocationCampaignSlots({
        campaignStart: startDate,
        campaignEnd: endDate,
        locationIds: orderedLocationIds,
        locationScheduleSlots: normalizedSlotsDetail,
        unavailabilityByLocation,
        maxOccupiedRphByLocation: new Map<string, number>(),
        activeEvents,
        ownEventId,
        config: doohNumbersToLocationEngineConfig(doohConfig),
      });

      const hourlyPlanInput: HourlyPlanSlotInput[] = slotDetailRows.map((s) => {
        const occupationKey = slotOccupationKey(s.locationId, s.date, s.hour);
        const occupiedByOtherCampaigns = Math.max(
          0,
          occupiedRepetitionsBySlot.get(occupationKey) ?? 0,
        );
        const remainingSpotsPerHour = Math.max(0, billableSpotsPerHour - occupiedByOtherCampaigns);
        const allowed = Math.max(0, Math.min(repetitionsPerHourVideo, remainingSpotsPerHour));
        const maxRepetitionsPerHour = allowed > 0 ? Math.max(1, Math.floor(allowed)) : 0;
        const slotMaxImpressions =
          Math.max(0, s.effectiveAffluence) * Math.max(0, maxRepetitionsPerHour);
        return {
          locationId: s.locationId,
          diffusionDate: s.date,
          diffusionHour: s.hour,
          maxImpressions: slotMaxImpressions,
          maxRepetitionsPerHour,
        };
      });

      const finalHourlyPlan = buildHybridAdjustedHourlyPlan({
        slots: hourlyPlanInput,
        targetImpressions: finalImpressions,
        keepLocationsFirst: true,
      });

      // En contexte owner (approbation), limiter l'écriture aux localités qu'il possède.
      // En contexte annonceur (propriétaire de campagne), on remplace le plan complet.
      const {
        data: { user: currentUser },
      } = await supabase.auth.getUser();
      const actorOwnerId = options?.actorOwnerId ?? currentUser?.id;
      const isCampaignAdvertiser = Boolean(
        actorOwnerId && actorOwnerId === (campaign as { user_id?: string | null }).user_id,
      );

      let scopedLocationIds: string[] | undefined;
      if (!isCampaignAdvertiser && actorOwnerId && orderedLocationIds.length > 0) {
        // Source principale: localités dérivées des écrans de ce owner réellement présents dans la campagne.
        // Cela évite les faux négatifs quand locations.owner_id est vide/incohérent.
        const actorScreenIds = new Set(
          (screens || [])
            .filter((s: { id: string; owner_id: string }) => s.owner_id === actorOwnerId)
            .map((s: { id: string }) => s.id),
        );
        const scopedFromScreens = [
          ...new Set(
            (screensWithData || [])
              .filter(
                (s: { id: string; location_id: string | null }) =>
                  actorScreenIds.has(s.id) && Boolean(s.location_id),
              )
              .map((s: { location_id: string | null }) => String(s.location_id)),
          ),
        ];

        if (scopedFromScreens.length > 0) {
          scopedLocationIds = scopedFromScreens;
        }

        // Fallback legacy: ownership porté directement par la localité.
        const { data: ownedLocations, error: ownedLocationsError } = await supabase
          .from('locations')
          .select('id')
          .in('id', orderedLocationIds)
          .eq('owner_id', actorOwnerId);
        if (ownedLocationsError) {
          throw ownedLocationsError;
        }
        const scopedFromLocations = (ownedLocations || []).map((r: { id: string }) => r.id);
        if (scopedFromLocations.length > 0) {
          scopedLocationIds = [...new Set([...(scopedLocationIds || []), ...scopedFromLocations])];
        }

        if ((scopedLocationIds || []).length === 0) {
          throw new Error(
            `Aucune localité écrivable pour le propriétaire ${actorOwnerId} sur la campagne ${campaignId}.`,
          );
        }
      }

      try {
        await replaceCampaignHourlyLocationPlan(campaignId, finalHourlyPlan, {
          scopeLocationIds: scopedLocationIds,
        });
        console.log(
          `✅ campaign_hourly_location_plan mis à jour pour ${campaignId}: ${finalHourlyPlan.length} ligne(s)` +
            (scopedLocationIds?.length
              ? ` (scope localités owner: ${scopedLocationIds.length})`
              : ''),
        );
      } catch (planWriteError) {
        console.error(
          `❌ Échec écriture campaign_hourly_location_plan pour ${campaignId}`,
          planWriteError,
        );
        throw planWriteError;
      }

      const planningTableParCreneau = finalHourlyPlan
        .filter((s) => s.plannedRepetitionsPerHour > 0)
        .map((s) => ({
          localite_id: s.locationId,
          jour: s.diffusionDate,
          heure: s.diffusionHour,
          repetitions_par_heure: s.plannedRepetitionsPerHour,
          impressions_a_generer: s.plannedImpressions,
        }));

      console.log(
        `📊 Total ${screensWithData.length} écran(s) — injection planning (moteur créneaux date×heure)`,
      );
      const nPlanning = planningTableParCreneau.length;
      console.log(
        `%c📋 Planning par créneau : ${nPlanning} ligne(s) (localité × jour × heure, répétitions/heure, impressions allouées)`,
        'font-weight:bold',
      );
      if (nPlanning === 0) {
        const effPos = slotDetailRows.filter((s) => s.effectiveAffluence > 0).length;
        console.warn(
          '📋 Aucune ligne à afficher : tous les créneaux ont 0 impression facturable (événement, indispo, occupation, ou pas d’affluence sur ce (jour, heure)).',
          {
            creneaux_parcourus: slotDetailRows.length,
            creneaux_affluence_effective_strictement_positive: effPos,
            localites: orderedLocationIds.length,
            hourlyScale,
          },
        );
      } else {
        console.table(planningTableParCreneau);
        const maxLines = 40;
        const lines = planningTableParCreneau
          .slice(0, maxLines)
          .map(
            (r) =>
              `  ${r.localite_id} | ${r.jour} | h ${String(r.heure).padStart(2, '0')} | rph ${r.repetitions_par_heure} | imp ${r.impressions_a_generer}`,
          );
        console.log(
          `📋 Même planning en texte (${Math.min(maxLines, nPlanning)} / ${nPlanning}) :\n${lines.join('\n')}` +
            (nPlanning > maxLines
              ? `\n  … +${nPlanning - maxLines} lignes (voir aussi console.table ci-dessus)`
              : ''),
        );
      }

      // Calculer le total des répétitions par heure (pour vérification)
      const totalRepetitionsPerHour = screenSchedules.reduce((sum, schedule) => {
        return sum + schedule.repetitions_per_hour;
      }, 0);

      console.log(
        `📊 Total de ${screenSchedules.length} écran(s) à mettre à jour avec ${totalRepetitionsPerHour} répétitions/heure au total`,
      );

      // Mettre à jour chaque écran dans campaign_screens avec ses informations de répétition
      // Utiliser upsert pour créer ou mettre à jour
      console.log(
        `🔄 Début de la mise à jour de ${screenSchedules.length} écran(s) dans campaign_screens`,
      );

      for (const schedule of screenSchedules) {
        console.log(`📝 Mise à jour écran ${schedule.screen_id}:`, {
          repetitions_per_hour: schedule.repetitions_per_hour,
          impressions_per_hour: schedule.impressions_per_hour,
          impressions_allocated_per_hour: schedule.impressions_allocated_per_hour,
          capacity_ratio: schedule.capacity_ratio,
        });

        // Utiliser update d'abord, et si aucune ligne n'est affectée, utiliser insert
        // Cela évite les problèmes avec les contraintes UNIQUE
        const { data: existingScreen, error: checkError } = await supabase
          .from('campaign_screens')
          .select('id')
          .eq('campaign_id', campaignId)
          .eq('screen_id', schedule.screen_id)
          .single();

        let updateData: any = null;
        let screenUpdateError: any = null;

        if (existingScreen && !checkError) {
          // L'écran existe, utiliser UPDATE
          const { data, error } = await supabase
            .from('campaign_screens')
            .update({
              repetitions_per_hour: schedule.repetitions_per_hour,
              impressions_per_hour: schedule.impressions_per_hour,
              impressions_allocated_per_hour: schedule.impressions_allocated_per_hour,
              capacity_ratio: schedule.capacity_ratio,
              total_impressions_allocated: schedule.total_impressions_allocated,
            })
            .eq('campaign_id', campaignId)
            .eq('screen_id', schedule.screen_id)
            .select()
            .single();

          updateData = data;
          screenUpdateError = error;
        } else {
          // L'écran n'existe pas, mais normalement il devrait exister
          // Si ce n'est pas le cas, on ne met pas à jour
          console.warn(
            `⚠️ L'écran ${schedule.screen_id} n'existe pas dans campaign_screens pour la campagne ${campaignId}`,
          );
          continue;
        }

        if (screenUpdateError) {
          console.error(
            `❌ Erreur lors de la mise à jour de l'écran ${schedule.screen_id}:`,
            screenUpdateError,
          );
          console.error('Code:', screenUpdateError.code);
          console.error('Message:', screenUpdateError.message);
          console.error('Details:', screenUpdateError.details);
          console.error('Hint:', screenUpdateError.hint);
        } else {
          console.log(`✅ Écran ${schedule.screen_id} mis à jour avec succès:`, updateData);
          console.log(`   - ${schedule.repetitions_per_hour} répétitions/heure`);
          console.log(`   - ${schedule.impressions_per_hour} impressions/heure`);
        }
      }

      console.log(`✅ Mise à jour terminée pour ${screenSchedules.length} écran(s)`);

      const aggregateImpressionsPerHour =
        totalSlotHours > 0 ? finalImpressions / totalSlotHours : 0;

      // Créer l'objet de planning de publication avec les détails par écran
      const publicationSchedule = {
        publications_per_hour: totalRepetitionsPerHour,
        total_impressions: finalImpressions,
        impressions_per_hour: aggregateImpressionsPerHour,
        impressions_per_hour_to_distribute: Math.round(aggregateImpressionsPerHour),
        hours_per_day: hoursPerDay,
        total_days: totalDays,
        total_screens: screenIds.length,
        screen_schedules: screenSchedules, // Détails par écran (pour référence)
        calculated_at: new Date().toISOString(),
        dooh_snapshot: {
          effective_video_duration_seconds: effectiveVideoSeconds,
          cpm_tnd: cpmTnd,
          is_event_campaign: isEventCampaign,
          video_duration_seconds_stored: videoDurationSeconds ?? null,
          hourly_slot_cap_impressions: slotCapImpressions,
          hourly_total_raw_impressions: hourlyGrid.totalRawImpressions,
          hourly_total_affluence: hourlyGrid.totalAffluence,
          hourly_slots_evaluated: hourlyGrid.slotsEvaluated,
          hourly_plan_table: {
            source_table: 'campaign_hourly_location_plan',
            total_rows: finalHourlyPlan.length,
            active_rows: planningTableParCreneau.length,
          },
        },
      };

      // Mettre à jour la campagne avec les informations de publication
      const { error: updateError } = await supabase
        .from('campaigns')
        .update({
          publication_schedule: publicationSchedule,
        })
        .eq('id', campaignId);

      if (updateError) {
        throw updateError;
      } else {
        console.log('✅ Planning de publication injecté avec succès:', publicationSchedule);
      }
    } catch (error) {
      console.error("❌ Erreur lors de l'injection du planning de publication:", error);
      throw error;
    }
  },

  // Recalculer les répétitions après qu'un propriétaire ait approuvé/rejeté
  async recalculateRepetitionsAfterApproval(
    campaignId: string,
    options?: {
      actorOwnerId?: string;
    },
  ): Promise<void> {
    try {
      console.log(
        `🔄 Recalcul des répétitions pour la campagne ${campaignId} après validation propriétaire`,
      );

      // Réinjecter le planning avec les nouveaux écrans approuvés
      await this.injectCampaignPublicationSchedule(campaignId, {
        actorOwnerId: options?.actorOwnerId,
      });
    } catch (error) {
      console.error('❌ Erreur lors du recalcul des répétitions:', error);
      throw error;
    }
  },

  // Vérifier et mettre à jour les campagnes expirées
  async checkAndCompleteExpiredCampaigns(): Promise<void> {
    try {
      // Exécuter la fonction PostgreSQL qui met à jour les campagnes expirées
      const { error } = await supabase.rpc('update_expired_campaigns');

      if (error) {
        console.error('❌ Erreur lors de la mise à jour des campagnes expirées:', error);
      } else {
        console.log('✅ Campagnes expirées vérifiées et mises à jour');
      }
    } catch (error) {
      console.error('❌ Erreur lors de la vérification des campagnes expirées:', error);
    }
  },
};
