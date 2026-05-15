import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import 'react-datepicker/dist/react-datepicker.css';
import {
  MapPin,
  Calendar,
  Film,
  Target,
  Users,
  DollarSign,
  ArrowRight,
  Check,
  CheckCircle,
  TrendingUp,
  Clock,
  Info,
  Monitor,
  Sparkles,
  X,
  PartyPopper,
  Megaphone,
  LayoutList,
  ChevronRight,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useNavigate, useLocation } from 'react-router-dom';

import ariane1 from '../assets/ariane/1.png';
import ariane1s from '../assets/ariane/1s.png';
import ariane2 from '../assets/ariane/2.png';
import ariane2s from '../assets/ariane/2s.png';
import ariane3 from '../assets/ariane/3.png';
import ariane3s from '../assets/ariane/3s.png';
import ariane4 from '../assets/ariane/4.png';
import ariane4s from '../assets/ariane/4s.png';
import ariane5 from '../assets/ariane/5.png';
import ariane5s from '../assets/ariane/5s.png';
import ariane6 from '../assets/ariane/6.png';
import ariane6s from '../assets/ariane/6s.png';
import panierPng from '../assets/panier.png';
import { useCampaignWizard } from '../hooks/new-campaign/useCampaignWizard';
import { buildInitialWizardState } from '../hooks/new-campaign/wizard-init';
import type {
  GeographicZone,
  ParcTV,
  UseCampaignWizardOptions,
  WizardState,
} from '../hooks/new-campaign/wizard-types';
import { useAdvertiserGlobalConfig } from '../hooks/useAdvertiserGlobalConfig';
import { getErrorMessage } from '../lib/errors';
import { logger } from '../lib/logger';
import { supabase } from '../lib/supabase';
import { parseCampaignUiDate, toLocalDateOnlyString } from '../lib/wizard-dates';
import { authService } from '../services/auth.service';
import { balanceService } from '../services/balance.service';
import {
  campaignScreensService,
  type CampaignLocation,
} from '../services/campaign-screens.service';
import { campaignService } from '../services/campaign.service';
import {
  buildWizardLocationScheduleMap,
  computeNewCampaignDoohMaxImpressions,
} from '../services/dooh-new-campaign-estimate.service';
import { predefinedZonesService, type PredefinedZone } from '../services/predefined-zones.service';
import { screensService, type UnavailabilityPeriod } from '../services/screens.service';
import { useAuthStore } from '../stores/auth.store';
import { useCartStore } from '../stores/cart.store';
import type { BusinessSector } from '../types/auth';
import type { SpecialEvent } from '../types/event';

import Step1NameType from './new-campaign/Step1NameType';
import Step2 from './new-campaign/Step2';
import Step3 from './new-campaign/Step3';
import Step4 from './new-campaign/Step4';
import Step5 from './new-campaign/Step5';

const log = logger.child({ module: 'NewCampaign' });

const ARIANE_ICONS = [ariane1, ariane2, ariane3, ariane4, ariane5, ariane6] as const;
const ARIANE_ICONS_DONE = [ariane1s, ariane2s, ariane3s, ariane4s, ariane5s, ariane6s] as const;


const center = {
  lat: 36.8065,
  lng: 10.1815, // Tunis center coordinates
};

export default function NewCampaign() {
  const navigate = useNavigate();
  const location = useLocation();
  const { profileType } = useAuthStore();

  // Détecter le mode édition
  const editMode = location.state?.editMode || false;
  const campaignToEdit = location.state?.campaign || null;
  // Campagne événement : 3 étapes (zones, spot, validation), dates/nom issus de l'événement
  const eventFromState = location.state?.event as SpecialEvent | undefined;
  const isEventCampaign = Boolean(
    (location.pathname === '/new-event-campaign' && eventFromState) ||
      (editMode && campaignToEdit?.event_id),
  );
  const campaignType: 'standard' | 'event' = isEventCampaign ? 'event' : 'standard';

  const { dooh, refresh: refreshGlobalDoohConfig } = useAdvertiserGlobalConfig();
  const cpmTnd = isEventCampaign ? dooh.event_campaign_cpm_tnd : dooh.standard_campaign_cpm_tnd;

  // Vérifier si le champ client doit être affiché (uniquement pour agences et organisateurs)
  const shouldShowClientField =
    profileType === 'advertising_agency' || profileType === 'event_organizer';

  // --- Wizard hook adoption (Step 7 Commit 6). The hook owns 16 persistent
  //     fields (WizardState); selectedLocation / radius / selectedVideo and
  //     the UI overlays remain local. initialState is computed once via
  //     useRef so the hook never re-initializes on later renders.
  const initialStateRef = useRef<WizardState | null>(null);
  if (initialStateRef.current === null) {
    initialStateRef.current = buildInitialWizardState({
      campaignType,
      campaignToEdit,
      eventFromState,
    });
  }
  const wizOpts = useMemo<UseCampaignWizardOptions>(
    () => ({
      initialState: initialStateRef.current as WizardState,
      campaignType,
      clientRequired: shouldShowClientField,
      cpmTnd,
      eventId: eventFromState?.id ?? campaignToEdit?.event_id ?? null,
      eventName: eventFromState?.name ?? null,
      fallbackLocation: center,
    }),
    [
      campaignType,
      shouldShowClientField,
      cpmTnd,
      eventFromState?.id,
      eventFromState?.name,
      campaignToEdit?.event_id,
    ],
  );
  const wiz = useCampaignWizard(wizOpts);
  const { state, setState } = wiz;
  const currentStep = wiz.currentStep;
  // setCurrentStep shim removed: all call sites were rewritten inline to
  // wiz.nextStep / wiz.prevStep / wiz.goToStep during the Commit 6 footer
  // + breadcrumb rewrite. Step 2/3/4/5 extractions in Commits 7-10 may
  // re-introduce a step-specific setter pattern via their props.

  // Per-field setter shims: preserve old setX(value | updater) API at every
  // call site below so the migration touches reads only.
  const setCampaignName = useCallback(
    (value: string) => setState((prev) => ({ ...prev, campaignName: value })),
    [setState],
  );
  const setClient = useCallback(
    (value: string) => setState((prev) => ({ ...prev, client: value })),
    [setState],
  );
  const setCategories = useCallback(
    (next: string[] | ((prev: string[]) => string[])) =>
      setState((prev) => ({
        ...prev,
        categories:
          typeof next === 'function'
            ? (next as (p: string[]) => string[])(prev.categories)
            : next,
      })),
    [setState],
  );
  const setDiffusionType = useCallback(
    (value: 'toodooh' | 'parc_tv') =>
      setState((prev) => ({ ...prev, diffusionType: value })),
    [setState],
  );
  const setSelectedParcIds = useCallback(
    (next: string[] | ((prev: string[]) => string[])) =>
      setState((prev) => ({
        ...prev,
        selectedParcIds:
          typeof next === 'function'
            ? (next as (p: string[]) => string[])(prev.selectedParcIds)
            : next,
      })),
    [setState],
  );
  const setStartDate = useCallback(
    (next: Date | null) =>
      setState((prev) => ({
        ...prev,
        startDate: next ? toLocalDateOnlyString(next) : null,
      })),
    [setState],
  );
  const setEndDate = useCallback(
    (next: Date | null) =>
      setState((prev) => ({
        ...prev,
        endDate: next ? toLocalDateOnlyString(next) : null,
      })),
    [setState],
  );
  const setGeographicZones = useCallback(
    (next: GeographicZone[] | ((prev: GeographicZone[]) => GeographicZone[])) =>
      setState((prev) => ({
        ...prev,
        geographicZones:
          typeof next === 'function'
            ? (next as (p: GeographicZone[]) => GeographicZone[])(prev.geographicZones)
            : next,
      })),
    [setState],
  );
  const setAdjustedBudget = useCallback(
    (next: number | ((prev: number) => number)) =>
      setState((prev) => ({
        ...prev,
        adjustedBudget:
          typeof next === 'function'
            ? (next as (p: number) => number)(prev.adjustedBudget)
            : next,
      })),
    [setState],
  );
  const setCalculatedImpressions = useCallback(
    (next: number | ((prev: number) => number)) =>
      setState((prev) => ({
        ...prev,
        calculatedImpressions:
          typeof next === 'function'
            ? (next as (p: number) => number)(prev.calculatedImpressions)
            : next,
      })),
    [setState],
  );
  const setCustomMinBudget = useCallback(
    (next: number | null | ((prev: number | null) => number | null)) =>
      setState((prev) => ({
        ...prev,
        customMinBudget:
          typeof next === 'function'
            ? (next as (p: number | null) => number | null)(prev.customMinBudget)
            : next,
      })),
    [setState],
  );
  const setCustomMaxBudget = useCallback(
    (next: number | null | ((prev: number | null) => number | null)) =>
      setState((prev) => ({
        ...prev,
        customMaxBudget:
          typeof next === 'function'
            ? (next as (p: number | null) => number | null)(prev.customMaxBudget)
            : next,
      })),
    [setState],
  );
  const setUploadedVideoId = useCallback(
    (value: string) => setState((prev) => ({ ...prev, uploadedVideoId: value })),
    [setState],
  );
  const setUploadedVideoUrl = useCallback(
    (value: string) => setState((prev) => ({ ...prev, uploadedVideoUrl: value })),
    [setState],
  );
  const setDraftCampaignId = useCallback(
    (value: string) => setState((prev) => ({ ...prev, draftCampaignId: value })),
    [setState],
  );

  // Destructure wizard state: preserves the old variable names at every read
  // site below. startDate/endDate are computed back to Date|null since the
  // bulk of the file consumes them as Dates (toLocaleDateString, .getTime,
  // DatePicker selected={...}). Serialization uses the ISO form on state.
  const {
    diffusionType,
    selectedParcIds,
    geographicZones,
    adjustedBudget,
    calculatedImpressions,
    customMinBudget,
    customMaxBudget,
    uploadedVideoId,
    uploadedVideoUrl,
    existingVideoId,
    draftCampaignId,
  } = state;
  // `categories` is read via `formData.categories` (the legacy-stub memo); no
  // direct top-level alias needed in this commit. Step 2's extraction in
  // Commit 7 may switch to a direct `state.categories` read.
  const startDate = useMemo(
    () => parseCampaignUiDate(state.startDate),
    [state.startDate],
  );
  const endDate = useMemo(
    () => parseCampaignUiDate(state.endDate),
    [state.endDate],
  );

  // --- Transient/UI-local state (NOT in WizardState) ---
  // selectedLocation: still read by saveCampaignDraft's fallback when no
  //   geographicZones are selected. setSelectedLocation removed (Commit 9):
  //   only the deleted geolocation-at-mount effect ever called it.
  const selectedLocation =
    campaignToEdit?.location_lat && campaignToEdit?.location_lng
      ? { lat: campaignToEdit.location_lat, lng: campaignToEdit.location_lng }
      : center;
  const [radius, _setRadius] = useState(campaignToEdit?.location_radius || 1000);
  const [_searchQuery, _setSearchQuery] = useState('');

  // Parcs TV (ParcTV interface imported from wizard-types)
  const [availableParcs, setAvailableParcs] = useState<ParcTV[]>([]);
  const [loadingParcs, setLoadingParcs] = useState(false);

  // --- Legacy formData stub. The migrated fields (campaignName, client,
  //     categories) now live in WizardState. The remaining slots
  //     (budget, nbImpressions, nbEcrans) feed only the dead
  //     `campaignEstimations` memo (live DOOH engine drives via
  //     doohMaxImpressions). Flagged for cleanup in a follow-up commit.
  // TODO(step-7-cleanup): drop campaignEstimations memo + this stub.
  const [legacyFormData, _setLegacyFormData] = useState({
    budget: campaignToEdit?.budget?.toString() || '',
    nbImpressions: 1000,
    nbEcrans: 1,
  });
  const formData = useMemo(
    () => ({
      campaignName: state.campaignName,
      client: state.client,
      category: state.categories[0] ?? '',
      categories: state.categories,
      ...legacyFormData,
    }),
    [state.campaignName, state.client, state.categories, legacyFormData],
  );
  const [campaignCategories, setCampaignCategories] = useState<string[]>([]);

  // Validation state: fully internalized into the extracted step components
  // (Commit 7 moved errors/touched into Step1NameType + Step2; Commit 8
  // moved dateErrors/dateTouched into Step3).

  // _allScreens / _locationsInZone / _loadingScreens removed (Commit 9):
  //   pre-existing dead trio (write-only useState slots; never read). The
  //   L1408 useEffect that wrote _locationsInZone is deleted alongside.
  // showZoneModal / editingZone / tempZoneLocation / tempZoneRadius /
  //   tempZoneSearchQuery removed (Commit 9): the custom-zone modal was
  //   unreachable UI (setShowZoneModal(true) was never called anywhere).
  //   The 370-line modal JSX + handleSaveZone + handleApplyPredefinedZone +
  //   tempZoneLocations memo + MapEvents + TUNISIA_CITIES + getCitySuggestions
  //   all deleted as one cascade.
  const [predefinedZones, setPredefinedZones] = useState<PredefinedZone[]>([]);
  const [loadingPredefinedZones, setLoadingPredefinedZones] = useState(false);
  // zoneFilterCountry / zoneFilterRegion: moved into Step4.tsx as local state.
  /** IDs d'écrans des localités sélectionnées (pour indisponibilités) */
  const [screenIdsFromSelectedLocations, setScreenIdsFromSelectedLocations] = useState<string[]>(
    [],
  );

  // Ajout d'un état pour le budget slider (avec bornes min/max)
  const BUDGET_MIN = 0;
  const [_budget, _setBudget] = useState(BUDGET_MIN);
  // adjustedBudget / calculatedImpressions / customMinBudget / customMaxBudget
  // are now in WizardState; their setters are shimmed at the top of the
  // component to preserve the setX(value|updater) API at all call sites.
  const [_budgetPercentage, setBudgetPercentage] = useState(100); // Pourcentage du budget (0-100%)
  const [unavailabilityPeriods, setUnavailabilityPeriods] = useState<UnavailabilityPeriod[]>([]);
  /** Plafond impressions (moteur DOOH horaire), aligné injectCampaignPublicationSchedule */
  const [doohMaxImpressions, setDoohMaxImpressions] = useState(0);
  const [doohEstimateLoading, setDoohEstimateLoading] = useState(false);
  const [doohEstimateError, setDoohEstimateError] = useState<string | null>(null);
  /** Rechargement affluence depuis l’API (évite les objets zone figés avant RLS / données). */
  const [freshLocationsForEstimate, setFreshLocationsForEstimate] = useState<CampaignLocation[]>(
    [],
  );

  // Calcul dynamique des jours
  const nbJours =
    startDate && endDate
      ? Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)))
      : 0;

  // Condition pour activer l'estimation
  const canEstimate = geographicZones.length > 0 && nbJours > 0 && adjustedBudget > 0;

  // Mémoriser : un flatMap à chaque rendu créait une nouvelle référence → useMemo/useEffect en boucle + carte bloquée
  const allSelectedLocations = useMemo(
    () => geographicZones.flatMap((zone) => zone.locations || []),
    [geographicZones],
  );

  const nbEcransSelected = allSelectedLocations.reduce((s, loc) => s + (loc.screen_count || 0), 0);

  const selectedParcScreenIds = useMemo(() => {
    if (diffusionType !== 'parc_tv' || selectedParcIds.length === 0) return null;
    const ids = new Set<string>();
    availableParcs
      .filter((p) => selectedParcIds.includes(p.ownerId))
      .forEach((p) => {
        p.screenIds.forEach((id) => ids.add(id));
      });
    return ids;
  }, [diffusionType, selectedParcIds, availableParcs]);

  const effectiveScreenIds = useMemo(() => {
    const fromLocs = screenIdsFromSelectedLocations;
    if (diffusionType === 'parc_tv' && selectedParcScreenIds && selectedParcScreenIds.size > 0) {
      return [...new Set([...fromLocs, ...selectedParcScreenIds])];
    }
    return [...fromLocs];
  }, [diffusionType, screenIdsFromSelectedLocations, selectedParcScreenIds]);

  const effectiveScreenIdsKey = useMemo(
    () => [...effectiveScreenIds].sort().join(','),
    [effectiveScreenIds],
  );

  const unavailabilityPeriodsKey = useMemo(
    () =>
      unavailabilityPeriods
        .map((p) => `${p.screen_id}|${p.start_date}|${p.end_date}|${p.start_time}|${p.end_time}`)
        .sort()
        .join(';'),
    [unavailabilityPeriods],
  );

  const wizardLocationsAffluenceKey = useMemo(
    () =>
      allSelectedLocations
        .map((l) => {
          const s = l.affluence_schedule || [];
          const slotSig = s
            .map((x) => `${x.day_of_week}:${x.hour}:${x.estimated_impressions ?? 0}`)
            .sort()
            .join(',');
          return `${l.id}|${slotSig}`;
        })
        .sort()
        .join('||'),
    [allSelectedLocations],
  );

  const selectedLocationIdsKey = useMemo(
    () => [...new Set(allSelectedLocations.map((l) => l.id))].sort().join(','),
    [allSelectedLocations],
  );

  const freshLocationsScheduleKey = useMemo(
    () =>
      freshLocationsForEstimate
        .map((l) => {
          const s = l.affluence_schedule || [];
          const slotSig = s
            .map((x) => `${x.day_of_week}:${x.hour}:${x.estimated_impressions ?? 0}`)
            .sort()
            .join(',');
          return `${l.id}|${slotSig}`;
        })
        .sort()
        .join('||'),
    [freshLocationsForEstimate],
  );

  /** Localités sélectionnées (pivot métier du moteur de validation DOOH). */
  const estimateLocationIds = useMemo(
    () => [
      ...new Set(
        (freshLocationsForEstimate.length > 0 ? freshLocationsForEstimate : allSelectedLocations)
          .map((l) => l.id)
          .filter(Boolean),
      ),
    ],
    [freshLocationsForEstimate, allSelectedLocations],
  );
  const estimateLocationIdsKey = useMemo(
    () => [...estimateLocationIds].sort().join(','),
    [estimateLocationIds],
  );

  const nbImpressions = doohMaxImpressions;

  // Calcul du prix total : (Nombre d'impressions / 1000) × CPM (potentiel max sur la sélection)
  const prixTotal = nbImpressions > 0 ? Math.round((nbImpressions / 1000) * cpmTnd * 100) / 100 : 0;

  // campaignEstimations memo: removed in Commit 8. Sole consumer was the
  // inline Step 3 duration display; Step3.tsx now computes duration locally
  // from startDate/endDate. The other fields (reach/cost/views/engagement/
  // area/efficiency) were never read anywhere — pre-existing dead code.

  // draftCampaignId is in WizardState; its setter is shimmed at the top.
  // myApprovedVideos cache + selectedExistingVideo memo stay in parent — they
  // have parent-level consumers (DOOH estimate effect, saveDraft, cart
  // create, Step 6 recap). Step 5 receives them as props and patches the
  // duration_seconds write-back through setMyApprovedVideos.
  // TODO(phase-1): typed source [supabase] — see #15
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [myApprovedVideos, setMyApprovedVideos] = useState<any[]>([]);
  const selectedExistingVideo = useMemo(
    () =>
      existingVideoId
        ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (myApprovedVideos.find((v: any) => v?.id === existingVideoId) ?? null)
        : null,
    [existingVideoId, myApprovedVideos],
  );
  const setExistingVideoId = useCallback(
    (value: string | null) =>
      setState((prev) => ({ ...prev, existingVideoId: value })),
    [setState],
  );
  const [showPostCartStep, setShowPostCartStep] = useState(false);
  const [recommendedEvents, setRecommendedEvents] = useState<SpecialEvent[]>([]);
  const [loadingRecommendedEvents, setLoadingRecommendedEvents] = useState(false);
  const [addingToCart, setAddingToCart] = useState(false);

  useEffect(() => {
    const ids = selectedLocationIdsKey.split(',').filter(Boolean);
    if (ids.length === 0) {
      setFreshLocationsForEstimate([]);
      return;
    }
    let cancelled = false;
    campaignScreensService.getLocationsByIds(ids).then((locs) => {
      if (!cancelled) setFreshLocationsForEstimate(locs);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedLocationIdsKey]);

  const isValidationStepUi =
    (currentStep === 6 && !isEventCampaign) || (currentStep === 3 && isEventCampaign);

  useEffect(() => {
    if (!isValidationStepUi) return;
    refreshGlobalDoohConfig();
  }, [isValidationStepUi, refreshGlobalDoohConfig]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (
        !startDate ||
        !endDate ||
        (effectiveScreenIds.length === 0 && estimateLocationIds.length === 0)
      ) {
        if (!cancelled) {
          setDoohMaxImpressions(0);
          setDoohEstimateLoading(false);
          setDoohEstimateError(null);
        }
        return;
      }
      setDoohEstimateLoading(true);
      setDoohEstimateError(null);
      try {
        const ownEventId = isEventCampaign
          ? (eventFromState?.id ?? campaignToEdit?.event_id ?? null)
          : null;
        const n = await computeNewCampaignDoohMaxImpressions({
          config: dooh,
          locationIds: estimateLocationIds,
          screenIds: effectiveScreenIds,
          campaignStart: startDate,
          campaignEnd: endDate,
          videoId: uploadedVideoId || selectedExistingVideo?.id || null,
          unavailabilityRows: unavailabilityPeriods,
          ownEventId: ownEventId ? String(ownEventId) : null,
          excludeCampaignId: draftCampaignId || null,
          wizardLocationSlots: buildWizardLocationScheduleMap(
            freshLocationsForEstimate.length > 0 ? freshLocationsForEstimate : allSelectedLocations,
          ),
        });
        if (!cancelled) setDoohMaxImpressions(n);
      } catch (e) {
        if (!cancelled) {
          setDoohMaxImpressions(0);
          setDoohEstimateError(e instanceof Error ? e.message : 'Erreur estimation DOOH');
        }
      } finally {
        if (!cancelled) setDoohEstimateLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    startDate,
    endDate,
    effectiveScreenIdsKey,
    uploadedVideoId,
    selectedExistingVideo?.id,
    unavailabilityPeriodsKey,
    isEventCampaign,
    eventFromState?.id,
    campaignToEdit?.event_id,
    draftCampaignId,
    wizardLocationsAffluenceKey,
    freshLocationsScheduleKey,
    estimateLocationIdsKey,
    dooh,
  ]);

  // États pour les événements spéciaux
  const [detectedEvents, _setDetectedEvents] = useState<SpecialEvent[]>([]);
  const [showEventsModal, setShowEventsModal] = useState(false);
  const [selectedEvents, setSelectedEvents] = useState<string[]>([]);

  // Mapping des catégories français → anglais (enum)
  const categoryMapping: { [key: string]: string } = {
    'Publicité commerciale': 'commercial',
    'Événement culturel': 'cultural',
    Promotion: 'promotional',
    'Promotion spéciale': 'promotional',
    Institutionnel: 'institutional',
    'Annonce institutionnelle': 'institutional',
  };
  const categoryReverseMapping: { [key: string]: string } = {
    commercial: 'Publicité commerciale',
    cultural: 'Événement culturel',
    promotional: 'Promotion spéciale',
    institutional: 'Annonce institutionnelle',
  };

  useEffect(() => {
    const loadCampaignCategories = async () => {
      try {
        const sectors = await authService.getOwnerBusinessSectors();
        const names = (sectors || [])
          .map((s: BusinessSector) => s.name)
          .filter((name): name is string => Boolean(name && name.trim()));

        setCampaignCategories(names);

        // Campagne événement: pré-remplir avec la 1ère catégorie DB si aucune sélection.
        if (isEventCampaign && names.length > 0) {
          setState((prev) => {
            if (prev.categories.length > 0) return prev;
            return {
              ...prev,
              categories: [names[0] as string],
            };
          });
        }
      } catch (err) {
        log.error({ err }, 'Erreur chargement catégories campagne');
      }
    };

    loadCampaignCategories();
    // setState is stable (useState's raw setter, exposed via the hook). We
    // intentionally re-run only on isEventCampaign change.
  }, [isEventCampaign, setState]);

  // En mode édition, charger les catégories multiples depuis campaign_categories
  useEffect(() => {
    if (!editMode || !draftCampaignId) return;
    campaignService
      .getCampaignCategories(draftCampaignId)
      .then((enumCategories) => {
        if (enumCategories.length > 0) {
          const displayNames = enumCategories.map((c) => categoryReverseMapping[c] || c);
          setState((prev) => ({
            ...prev,
            categories: displayNames,
          }));
        }
      })
      .catch(() => {});
    // categoryReverseMapping is a component-local const (defined above), stable
    // by reference between renders within a session; setState is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editMode, draftCampaignId, setState]);

  const categoryChoices = useMemo(() => {
    const base =
      campaignCategories.length > 0
        ? [...campaignCategories]
        : Array.from(new Set(Object.values(categoryReverseMapping)));

    for (const selected of formData.categories) {
      if (!base.includes(selected)) base.push(selected);
    }
    return base;
  }, [campaignCategories, formData.categories]);

  const saveCampaignDraft = async (videoId?: string, _isVideoValidated: boolean = false) => {
    try {
      // Validation des champs obligatoires
      if (!formData.campaignName || formData.campaignName.trim() === '') {
        throw new Error('Le nom de la campagne est obligatoire');
      }

      if (diffusionType !== 'parc_tv' && !formData.categories?.length) {
        throw new Error('Sélectionnez au moins une catégorie');
      }

      if (!startDate || !endDate) {
        throw new Error('Les dates de début et fin sont obligatoires');
      }

      const mappedCategories =
        diffusionType === 'parc_tv'
          ? ['parc']
          : formData.categories.map((c) => categoryMapping[c] || c);
      const primaryCategory = mappedCategories[0] || 'parc';

      // TOUJOURS créer en draft d'abord
      // La vérification du solde et de la vidéo se fera lors de "Créer maintenant"
      const campaignStatus = 'draft';

      // Récupérer les IDs des localités sélectionnées (une localité = une audience, pas de doublon écran)
      const selectedLocationIds = geographicZones.flatMap((zone) =>
        (zone.locations || []).map((loc) => loc.id),
      );

      // Calculer la position centrale moyenne de toutes les zones
      const avgLat =
        geographicZones.length > 0
          ? geographicZones.reduce((sum, zone) => sum + zone.location.lat, 0) /
            geographicZones.length
          : selectedLocation.lat;
      const avgLng =
        geographicZones.length > 0
          ? geographicZones.reduce((sum, zone) => sum + zone.location.lng, 0) /
            geographicZones.length
          : selectedLocation.lng;

      // Utiliser le rayon maximum de toutes les zones
      const maxRadius =
        geographicZones.length > 0
          ? Math.max(...geographicZones.map((zone) => zone.radius))
          : radius;

      // Calculer le budget à utiliser : utiliser adjustedBudget si disponible, sinon calculer à partir des impressions
      const budgetToSave = adjustedBudget;
      const maxImpSave = calculateBudgetAndImpressions.impressions;
      const linkedImpSave =
        maxImpSave > 0 && adjustedBudget > 0
          ? Math.min(Math.round((adjustedBudget / cpmTnd) * 1000), maxImpSave)
          : 0;

      const campaign = await campaignService.saveCampaignDraft(
        {
          name: formData.campaignName,
          category: primaryCategory,
          categories: mappedCategories,
          start_date: toLocalDateOnlyString(startDate),
          end_date: toLocalDateOnlyString(endDate),
          budget: Number(budgetToSave) || 0,
          views: Math.max(0, linkedImpSave),
          status: campaignStatus,
          video_id: videoId || uploadedVideoId || undefined,
          event_id: isEventCampaign ? (eventFromState?.id ?? campaignToEdit?.event_id) : undefined,
          location_lat: avgLat,
          location_lng: avgLng,
          location_radius: maxRadius,
          location_ids: selectedLocationIds.length > 0 ? selectedLocationIds : undefined,
          screen_ids: undefined,
        },
        draftCampaignId || undefined,
      );

      if (!draftCampaignId) {
        setDraftCampaignId(campaign.id);
      }

      return campaign;
    } catch (error) {
      throw error;
    }
  };

  // handleVideoUpload + handleSelectExistingVideo + MAX_VIDEO_DURATION_SECONDS:
  //   moved into Step5.tsx (Commit 10). Step 5 owns the upload flow, the
  //   transient selectedVideo/uploading/uploadProgress useState slots, and the
  //   30-second duration ceiling. The parent retains myApprovedVideos +
  //   selectedExistingVideo memo because they have multiple parent-level
  //   consumers (DOOH estimate effect, saveDraft, cart create, Step 6 recap).

  // validateField + handleFieldChange: removed (Step1NameType + Step2 own
  //   their own field-level validation; Step3-6 will follow the same pattern
  //   as they extract). The 'budget' / 'category' / 'categories' branches of
  //   the old validateField were dead even before extraction (the live budget
  //   gate is canProceedToStep6, not a string-input validator).

  // handleCategoriesToggle: removed (Step2.tsx owns its own toggle logic via
  //   setCategories prop).
  // validateStep1, validateStep2Category: removed (extracted step components
  //   own their own field-error surfacing).
  // canProceedToStep2/3/4/5, canLeaveStep2, canNavigateToStep, handleStepClick:
  //   removed in Commit 6 (hook's stepList[i].validate + canGoToStep replace).
  // canProceedToStep6 retained below — it carries the budget-bounds check
  //   (effectiveMin/effectiveMax against cpmTnd) that the hook's pure
  //   validateBudget intentionally omits per Commit 5's contract.

  const canProceedToStep6 = () => {
    const impressionsFromSelection = calculateBudgetAndImpressions.impressions;
    if (impressionsFromSelection <= 0 || adjustedBudget <= 0) return false;
    const impressionsForBudget = Math.min(
      Math.round((adjustedBudget / cpmTnd) * 1000),
      impressionsFromSelection,
    );
    if (impressionsForBudget <= 0) return false;

    const defaultMaxAmount = (impressionsFromSelection / 1000) * cpmTnd;
    const defaultMinAmount = defaultMaxAmount * 0.5;
    const effectiveMin = customMinBudget !== null ? customMinBudget : defaultMinAmount;
    const effectiveMax = customMaxBudget !== null ? customMaxBudget : defaultMaxAmount;
    const minVal = Math.min(effectiveMin, effectiveMax);
    const maxVal = Math.max(effectiveMin, effectiveMax);

    return adjustedBudget > 0 && adjustedBudget >= minVal && adjustedBudget <= maxVal;
  };

  // Fonction pour calculer les heures d'indisponibilité par jour en moyenne (écrans des localités sélectionnées)

  // Dériver les IDs d'écrans des localités sélectionnées (pour indisponibilités)
  useEffect(() => {
    const run = async () => {
      const ids = allSelectedLocations.map((l) => l.id);
      if (ids.length === 0) {
        setScreenIdsFromSelectedLocations([]);
        return;
      }
      const screenIds = await campaignScreensService.getScreenIdsByLocationIds(ids);
      setScreenIdsFromSelectedLocations((prev) => {
        if (prev.length === screenIds.length && prev.every((id, i) => id === screenIds[i]))
          return prev;
        return screenIds;
      });
    };
    run();
  }, [allSelectedLocations]);

  // Charger les périodes d'indisponibilité pour tous les écrans concernés (localités + parcs TV)
  useEffect(() => {
    const loadUnavailabilityPeriods = async () => {
      if (effectiveScreenIds.length === 0) {
        setUnavailabilityPeriods([]);
        return;
      }
      try {
        const allPeriods: UnavailabilityPeriod[] = [];
        for (const screenId of effectiveScreenIds) {
          try {
            const periods = await screensService.getUnavailabilityPeriods(screenId);
            allPeriods.push(...periods);
          } catch (error) {
            log.error({ error }, `Erreur chargement indisponibilités écran ${screenId}`);
          }
        }
        setUnavailabilityPeriods(allPeriods);
      } catch (error) {
        log.error({ error }, "Erreur chargement périodes d'indisponibilité");
      }
    };
    loadUnavailabilityPeriods();
  }, [effectiveScreenIdsKey]);

  // Impressions : source unique = moteur DOOH affluence (créneaux réels), sans moyenne artificielle.
  const calculateBudgetAndImpressions = useMemo(() => {
    if (!startDate || !endDate || effectiveScreenIds.length === 0) {
      return {
        impressions: 0,
        totalDays: 0,
      };
    }
    const totalDays = Math.max(
      1,
      Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)),
    );
    const totalImpressions = Math.round(doohMaxImpressions);
    return {
      impressions: totalImpressions,
      totalDays,
    };
  }, [startDate, endDate, effectiveScreenIdsKey, doohMaxImpressions]);

  /** Impressions correspondant au budget curseur (plafonnées au max de la sélection) — source de vérité affichage validation */
  const impressionsForCurrentBudget = useMemo(() => {
    const maxImp = calculateBudgetAndImpressions.impressions;
    if (maxImp <= 0 || adjustedBudget <= 0) return 0;
    return Math.min(Math.round((adjustedBudget / cpmTnd) * 1000), maxImp);
  }, [adjustedBudget, calculateBudgetAndImpressions.impressions, cpmTnd]);

  /** Snapshot sérialisable : tout ce qui alimente l’étape Validation (étapes précédentes + moteur DOOH). */

  // Mettre à jour les impressions calculées quand le budget change
  useEffect(() => {
    const { impressions } = calculateBudgetAndImpressions;

    // Calculer les impressions basées sur le budget ajusté selon la formule : (montant / CPM) * 1000
    if (adjustedBudget > 0) {
      // Formule correcte : (montant / CPM) * 1000 = impressions
      const calculatedImpressionsFromBudget = Math.round((adjustedBudget / cpmTnd) * 1000);

      // Limiter aux impressions maximales possibles
      const maxImpressions = impressions > 0 ? impressions : Infinity;
      const finalImpressions = Math.min(calculatedImpressionsFromBudget, maxImpressions);
      setCalculatedImpressions(finalImpressions);

      // Calculer le pourcentage pour l'affichage
      const defaultMaxAmount = impressions > 0 ? (impressions / 1000) * cpmTnd : adjustedBudget;
      const defaultMinAmount = BUDGET_MIN;
      const effectiveMin = customMinBudget !== null ? customMinBudget : defaultMinAmount;
      const effectiveMax = customMaxBudget !== null ? customMaxBudget : defaultMaxAmount;

      // Calculer le pourcentage
      const percentage =
        effectiveMax > effectiveMin
          ? ((adjustedBudget - effectiveMin) / (effectiveMax - effectiveMin)) * 100
          : 100;
      setBudgetPercentage(Math.max(0, Math.min(100, percentage)));
    } else {
      setCalculatedImpressions(0);
    }
  }, [
    adjustedBudget,
    calculateBudgetAndImpressions.impressions,
    customMinBudget,
    customMaxBudget,
    cpmTnd,
  ]);

  // Recentrer le curseur uniquement quand la plage change (impressions / CPM / min-max perso), pas quand l'utilisateur déplace le slider
  useEffect(() => {
    if (calculateBudgetAndImpressions.impressions > 0) {
      const defaultMaxAmount = (calculateBudgetAndImpressions.impressions / 1000) * cpmTnd;
      const effectiveMax = customMaxBudget !== null ? customMaxBudget : defaultMaxAmount;
      const defaultMinAmount = BUDGET_MIN;
      const effectiveMin = customMinBudget !== null ? customMinBudget : defaultMinAmount;

      // Par défaut : garder la valeur choisie si dans la plage, sinon borner.
      // Si la valeur est encore au minimum initial, prendre le max pour refléter le plan max.
      if (customMinBudget === null && customMaxBudget === null) {
        setAdjustedBudget((prev) => {
          if (prev > effectiveMax) return effectiveMax;
          if (prev < effectiveMin) return effectiveMin;
          return prev;
        });
      } else {
        setAdjustedBudget((prev) => {
          if (prev > effectiveMax) return effectiveMax;
          if (prev < effectiveMin) return effectiveMin;
          return prev;
        });
      }
    }
  }, [calculateBudgetAndImpressions.impressions, customMinBudget, customMaxBudget, cpmTnd]);

  // Le budget ajusté est maintenant géré par le pourcentage, donc on n'a plus besoin de cette logique

  // canNavigateToStep + handleStepClick: removed (hook's canGoToStep / goToStep
  // replace them; breadcrumb call sites are rewritten inline).

  // Fonctions de validation pour les dates
  // validateDate: moved into Step3.tsx (only callers were validateStep2 +
  //   handleDateChange, both also moved).

  // Fonction pour vérifier les événements spéciaux durant la période

  const loadRecommendedEventsForSelectedPeriod = useCallback(async () => {
    if (!startDate || !endDate) {
      setRecommendedEvents([]);
      return;
    }

    setLoadingRecommendedEvents(true);
    try {
      let query = supabase
        .from('special_events')
        .select('*')
        .eq('is_active', true)
        .lte('start_date', endDate.toISOString())
        .gte('end_date', startDate.toISOString())
        .order('start_date', { ascending: true })
        .limit(3);

      if (eventFromState?.id) {
        query = query.neq('id', eventFromState.id);
      }

      const { data, error } = await query;
      if (error) throw error;

      setRecommendedEvents((data || []) as SpecialEvent[]);
    } catch (error) {
      log.error({ error }, 'Erreur chargement événements recommandés');
      setRecommendedEvents([]);
    } finally {
      setLoadingRecommendedEvents(false);
    }
  }, [startDate, endDate, eventFromState?.id]);

  // Événements recommandés limités à la période sélectionnée de la campagne (chevauchement)
  const recommendedEventsInPeriod = useMemo(() => {
    if (!startDate || !endDate || !recommendedEvents.length) return recommendedEvents;
    const start = startDate.getTime();
    const end = endDate.getTime();
    return recommendedEvents.filter((ev) => {
      const evStart = new Date(ev.start_date).getTime();
      const evEnd = new Date(ev.end_date).getTime();
      return evStart <= end && evEnd >= start;
    });
  }, [recommendedEvents, startDate, endDate]);

  const pushCampaignToSidebarCart = useCallback(
    (campaignId: string) => {
      const amount = adjustedBudget > 0 ? adjustedBudget : prixTotal;
      const periodLabel =
        startDate && endDate
          ? `${startDate.toLocaleDateString('fr-FR')} – ${endDate.toLocaleDateString('fr-FR')}`
          : undefined;
      const totalAreaKm2 = geographicZones.reduce(
        (sum, z) => sum + Math.PI * Math.pow(z.radius / 1000, 2),
        0,
      );
      const zonesLabel =
        geographicZones.length > 0
          ? `${geographicZones.length} zone${geographicZones.length > 1 ? 's' : ''} · ${totalAreaKm2.toFixed(1)} km²`
          : undefined;
      useCartStore.getState().addItem({
        id: campaignId,
        name: formData.campaignName || eventFromState?.name || 'Nom de la campagne',
        amount,
        periodLabel,
        zonesLabel,
      });
    },
    [
      adjustedBudget,
      prixTotal,
      formData.campaignName,
      eventFromState?.name,
      startDate,
      endDate,
      geographicZones,
    ],
  );

  // handleDateChange + validateStep2 (the misnamed dates validator): moved
  //   into Step3.tsx. Step3 owns its own dateErrors/dateTouched and the
  //   cross-field re-validation logic.


  // Charger les vidéos approuvées au montage du composant
  // (loadAllScreens removed in Commit 9 — fed only the dead _allScreens trio).
  useEffect(() => {
    loadMyApprovedVideos();
  }, []);

  // Redirection si campagne événement sans événement en state
  useEffect(() => {
    if (location.pathname === '/new-event-campaign' && !eventFromState) {
      navigate('/evenements', { replace: true });
    }
  }, [location.pathname, eventFromState, navigate]);

  // Charger la vidéo existante en mode édition
  useEffect(() => {
    const loadExistingVideo = async () => {
      if (editMode && campaignToEdit?.video_id) {
        try {
          const { data: videoData } = await supabase
            .from('videos')
            .select('*')
            .eq('id', campaignToEdit.video_id)
            .single();

          if (videoData) {
            setUploadedVideoId(videoData.id);
            setUploadedVideoUrl(videoData.url);
            setMyApprovedVideos((prev) => {
              if (!prev.find((v) => v.id === videoData.id)) {
                return [...prev, videoData];
              }
              return prev;
            });
            setExistingVideoId(videoData.id);
          }
        } catch (error) {
          log.error({ error }, 'Erreur chargement vidéo');
        }
      }
    };

    loadExistingVideo();
  }, [editMode, campaignToEdit?.video_id]);

  // Charger les zones (campaign_locations) en mode édition pour restaurer la sélection
  useEffect(() => {
    const loadCampaignZones = async () => {
      if (!editMode || !campaignToEdit?.id) return;
      try {
        const { data: campaignLocs, error } = await supabase
          .from('campaign_locations')
          .select('location_id')
          .eq('campaign_id', campaignToEdit.id);
        if (error || !campaignLocs?.length) return;
        const locationIds = campaignLocs.map((r: { location_id: string }) => r.location_id);
        const locations = await campaignScreensService.getLocationsByIds(locationIds);
        if (locations.length === 0) return;
        const withCoords = locations.filter(
          (loc) =>
            loc.coordinates &&
            typeof loc.coordinates.lat === 'number' &&
            typeof loc.coordinates.lng === 'number',
        );
        const latAvg = withCoords.length
          ? withCoords.reduce((s, l) => s + l.coordinates!.lat, 0) / withCoords.length
          : 36.8;
        const lngAvg = withCoords.length
          ? withCoords.reduce((s, l) => s + l.coordinates!.lng, 0) / withCoords.length
          : 10.2;
        const radiusM = withCoords.length
          ? Math.max(
              1000,
              ...withCoords.map((l) => {
                const lat = l.coordinates!.lat;
                const lng = l.coordinates!.lng;
                const R = 6371000;
                const dLat = ((lat - latAvg) * Math.PI) / 180;
                const dLng = ((lng - lngAvg) * Math.PI) / 180;
                const a =
                  Math.sin(dLat / 2) ** 2 +
                  Math.cos((latAvg * Math.PI) / 180) *
                    Math.cos((lat * Math.PI) / 180) *
                    Math.sin(dLng / 2) ** 2;
                return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
              }),
            )
          : 5000;
        setGeographicZones([
          {
            id: 'edit-restored',
            name: 'Sélection existante',
            location: { lat: latAvg, lng: lngAvg },
            radius: Math.round(radiusM),
            locations,
          },
        ]);
      } catch (err) {
        log.error({ err }, 'Erreur chargement zones campagne');
      }
    };
    loadCampaignZones();
  }, [editMode, campaignToEdit?.id]);

  const loadMyApprovedVideos = async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from('videos')
        .select('*')
        .eq('uploaded_by', user.id)
        .eq('validation_status', 'approved')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setMyApprovedVideos(data || []);
    } catch (error) {
      log.error({ error }, 'Erreur chargement vidéos validées');
    }
  };

  // loadAllScreens removed (Commit 9): wrote only to the dead _allScreens
  //   useState trio (already write-only pre-Commit-9; trio deleted alongside).

  // Charger les parcs disponibles (owners ayant des écrans actifs)
  const loadAvailableParcs = async () => {
    setLoadingParcs(true);
    try {
      const { data: screens } = await supabase
        .from('screens')
        .select('id, owner_id')
        .eq('status', 'active');

      if (!screens || screens.length === 0) {
        setAvailableParcs([]);
        return;
      }

      const ownerScreenMap = new Map<string, string[]>();
      screens.forEach((s) => {
        const list = ownerScreenMap.get(s.owner_id) || [];
        list.push(s.id);
        ownerScreenMap.set(s.owner_id, list);
      });

      const ownerIds = [...ownerScreenMap.keys()];
      const { data: owners } = await supabase
        .from('business_profiles')
        .select('user_id, business_name, logo_url')
        .in('user_id', ownerIds);

      const parcs: ParcTV[] = ownerIds
        .map((oid) => {
          const profile = owners?.find((o) => o.user_id === oid);
          return {
            ownerId: oid,
            name: profile?.business_name || 'Parc inconnu',
            logo: profile?.logo_url || undefined,
            screenCount: ownerScreenMap.get(oid)?.length || 0,
            screenIds: ownerScreenMap.get(oid) || [],
          };
        })
        .filter((p) => p.screenCount > 0);

      setAvailableParcs(parcs);
    } catch (error) {
      log.error({ error }, 'Erreur chargement parcs');
    } finally {
      setLoadingParcs(false);
    }
  };

  useEffect(() => {
    if (diffusionType === 'parc_tv') loadAvailableParcs();
  }, [diffusionType]);

  // handleParcToggle: removed (Step2.tsx owns the toggle via setSelectedParcIds prop).

  // Single-zone _locationsInZone effect, distanceKm, normalizeCategoryName,
  // filteredMapLocations memo, tempZoneLocations memo, allMapLocations /
  // loadingMapLocations useState, isZonesStep, loadAllMapLocations effect:
  // all moved into Step4.tsx (Commit 9). The single-zone effect fed the
  // pre-existing dead _locationsInZone slot; deleted alongside the trio.

  // Charger les zones prédéfinies
  useEffect(() => {
    const loadPredefinedZones = async () => {
      try {
        setLoadingPredefinedZones(true);
        const zones = await predefinedZonesService.getAll();
        setPredefinedZones(zones);
      } catch (_error) {
        toast.error('Impossible de charger les zones prédéfinies');
      } finally {
        setLoadingPredefinedZones(false);
      }
    };
    loadPredefinedZones();
  }, []);

  // Zone-related handlers moved into Step4.tsx (Commit 9):
  // handleApplyPredefinedZone (dead — only called from dead modal),
  // getLocationsForPredefinedZone, getEstimatedVisitorsForPredefinedZone,
  // isPredefinedZoneSelected, handleTogglePredefinedZone, handleSaveZone
  // (dead), handleDeleteZone, geolocation-at-mount effect (fed only
  // selectedLocation which only feeds saveDraft fallback — fallback now
  // relies on center.lat/center.lng unchanged), getCitySuggestions (dead).

  const steps = isEventCampaign
    ? [
        { id: 1, title: 'Zones géographiques', icon: MapPin },
        { id: 2, title: 'Votre spot', icon: Film },
        { id: 3, title: 'Validation', icon: CheckCircle },
      ]
    : [
        { id: 1, title: 'Nom et type de campagne', icon: Megaphone },
        {
          id: 2,
          title: diffusionType === 'parc_tv' ? 'Choix du parc' : 'Catégorie(s)',
          icon: LayoutList,
        },
        { id: 3, title: 'Période', icon: Calendar },
        { id: 4, title: 'Zones géographiques', icon: MapPin },
        { id: 5, title: 'Votre spot', icon: Film },
        { id: 6, title: 'Validation', icon: DollarSign },
      ];

  // Juste avant le rendu du composant
  // Date minimum : aujourd'hui
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return (
    <div className="w-full mx-auto space-y-8">
      {/* Header Section — masqué à l'étape panier */}
      {!showPostCartStep && (
        <div className="bg-white rounded-xl p-8">
          <div className="flex items-start justify-between gap-4 mb-8">
            <div className="min-w-0">
              <h1 className="text-xl font-semibold mb-0.5 text-gray-900">
                {editMode
                  ? `Modifier: ${campaignToEdit?.name}`
                  : isEventCampaign
                    ? `Campagne événement : ${eventFromState?.name}`
                    : 'Lancer une campagne'}
              </h1>
              <p className="text-sm text-gray-600">
                {editMode
                  ? 'Modifiez les paramètres de votre campagne'
                  : isEventCampaign
                    ? 'Zones, spot et validation pour cet événement'
                    : 'Créez et configurez votre campagne publicitaire'}
              </p>
              {editMode && (
                <div className="mt-2 flex items-center space-x-2 text-sm text-gray-500">
                  <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded-full font-medium">
                    Mode Édition
                  </span>
                  <span
                    className={`px-2 py-1 rounded-full font-medium ${
                      campaignToEdit?.status === 'draft'
                        ? 'bg-gray-100 text-gray-800'
                        : campaignToEdit?.status === 'pending'
                          ? 'bg-yellow-100 text-yellow-800'
                          : 'bg-green-100 text-green-800'
                    }`}
                  >
                    {campaignToEdit?.status}
                  </span>
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => navigate('/my-campaigns')}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors flex-shrink-0"
            >
              <X className="h-5 w-5" />
              <span>Annuler</span>
            </button>
          </div>

          {/* Progress Steps — étalés sur toute la largeur */}
          <div className="w-full flex items-start">
            {steps.map((step, index) => {
              const isClickable = wiz.canGoToStep(step.id);
              const isCurrentStep = currentStep === step.id;
              const isCompleted = currentStep > step.id;

              return (
                <React.Fragment key={step.id}>
                  <div className="flex-1 flex flex-col items-center justify-center min-w-0">
                    <div
                      onClick={() => {
                        if (isClickable) wiz.goToStep(step.id);
                      }}
                      className={`flex flex-col items-center transition-all w-full ${
                        isClickable
                          ? 'cursor-pointer hover:opacity-90'
                          : 'cursor-default opacity-70'
                      }`}
                    >
                      <div className="flex items-center justify-center flex-shrink-0 transition-all">
                        <img
                          src={
                            isCompleted ? ARIANE_ICONS_DONE[step.id - 1] : ARIANE_ICONS[step.id - 1]
                          }
                          alt=""
                          className="w-14 h-14 object-contain"
                        />
                      </div>
                      <span
                        className={`mt-2 text-center text-xs max-w-[100px] leading-tight ${
                          isCurrentStep
                            ? 'text-gray-900 font-semibold'
                            : 'text-gray-500 font-normal'
                        }`}
                      >
                        {step.title}
                      </span>
                    </div>
                  </div>
                  {index < steps.length - 1 && (
                    <ChevronRight
                      className="h-5 w-5 text-gray-300 flex-shrink-0 mt-5"
                      aria-hidden
                    />
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main Form */}
        <div className="lg:col-span-3 space-y-6">
          {/* Step 1: Informations de base — extracted to ./new-campaign/Step1NameType */}
          {currentStep === 1 && !isEventCampaign && (
            <Step1NameType
              campaignName={state.campaignName}
              diffusionType={diffusionType}
              setCampaignName={setCampaignName}
              setDiffusionType={setDiffusionType}
              onNext={() => wiz.nextStep()}
              isFirst={true}
            />
          )}

          {/* Step 2: Catégorie / Choix du parc — extracted to ./new-campaign/Step2 */}
          {currentStep === 2 && !isEventCampaign && (
            <Step2
              diffusionType={diffusionType}
              categoryChoices={categoryChoices}
              selectedCategories={state.categories}
              setSelectedCategories={setCategories}
              shouldShowClientField={shouldShowClientField}
              client={state.client}
              setClient={setClient}
              availableParcs={availableParcs}
              loadingParcs={loadingParcs}
              selectedParcIds={selectedParcIds}
              setSelectedParcIds={setSelectedParcIds}
              onNext={() => wiz.nextStep()}
              onBack={() => wiz.prevStep()}
            />
          )}

          {/* Step 3: Planification (Période) — extracted to ./new-campaign/Step3 */}
          {currentStep === 3 && !isEventCampaign && (
            <Step3
              startDate={startDate}
              endDate={endDate}
              setStartDate={setStartDate}
              setEndDate={setEndDate}
              onNext={() => wiz.nextStep()}
              onBack={() => wiz.prevStep()}
            />
          )}

          {/* Step 4: Zones géographiques — extracted to ./new-campaign/Step4 */}
          {((currentStep === 4 && !isEventCampaign) || (currentStep === 1 && isEventCampaign)) && (
            <Step4
              geographicZones={geographicZones}
              setGeographicZones={setGeographicZones}
              diffusionType={diffusionType}
              categories={state.categories}
              predefinedZones={predefinedZones}
              loadingPredefinedZones={loadingPredefinedZones}
              onNext={() => wiz.nextStep()}
              onBack={() => wiz.prevStep()}
            />
          )}

          {/* Step 5: Contenu média (étape 2 en mode campagne événement) — extracted to ./new-campaign/Step5 */}
          {((currentStep === 5 && !isEventCampaign) || (currentStep === 2 && isEventCampaign)) && (
            <Step5
              uploadedVideoId={uploadedVideoId}
              uploadedVideoUrl={uploadedVideoUrl}
              existingVideoId={existingVideoId}
              setUploadedVideoId={setUploadedVideoId}
              setUploadedVideoUrl={setUploadedVideoUrl}
              setExistingVideoId={setExistingVideoId}
              myApprovedVideos={myApprovedVideos}
              selectedExistingVideo={selectedExistingVideo}
              setMyApprovedVideos={setMyApprovedVideos}
              onNext={() => wiz.nextStep()}
              onBack={() => wiz.prevStep()}
            />
          )}

          {/* Step 6: Validation unified — Récapitulatif + Ajuster impact */}

          {/* Step 6: Validation unified (étape 3 en mode campagne événement) */}
          {((currentStep === 6 && !isEventCampaign) || (currentStep === 3 && isEventCampaign)) &&
            !showPostCartStep && (
              <div className="bg-white rounded-2xl shadow-lg overflow-hidden border border-gray-100">
                <div className="p-6 border-b border-gray-200">
                  <h2 className="text-lg font-bold text-gray-900">Validation</h2>
                  <p className="text-sm text-gray-500">Vérifiez et confirmez votre campagne</p>
                </div>

                <div className="p-6">
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    {/* ── Left: Récapitulatif ── */}
                    <div className="border border-gray-200 rounded-xl p-5 space-y-5">
                      <h3 className="text-base font-bold text-gray-900">Récapitulatif</h3>

                      <div>
                        <p className="text-xs font-medium text-gray-500 mb-1">Nom de la campagne</p>
                        <p className="text-sm font-semibold text-gray-900">
                          {formData.campaignName || '—'}
                        </p>
                      </div>

                      {!isEventCampaign && (
                        <div>
                          <p className="text-xs font-medium text-gray-500 mb-2">
                            Type de la campagne
                          </p>
                          <div className="flex gap-2">
                            <span
                              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium ${diffusionType === 'toodooh' ? 'border-[#76E6AB] bg-[#76E6AB]/5 text-gray-900' : 'border-gray-200 text-gray-400'}`}
                            >
                              <Target className="h-3.5 w-3.5" /> Réseau Toodooh
                            </span>
                            <span
                              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium ${diffusionType === 'parc_tv' ? 'border-[#76E6AB] bg-[#76E6AB]/5 text-gray-900' : 'border-gray-200 text-gray-400'}`}
                            >
                              <Monitor className="h-3.5 w-3.5" /> Parc TV
                            </span>
                          </div>
                        </div>
                      )}

                      <div>
                        <p className="text-xs font-medium text-gray-500 mb-2">
                          {diffusionType === 'parc_tv' ? 'Parc(s)' : 'Catégorie(s)'}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {diffusionType === 'parc_tv' ? (
                            selectedParcIds.length > 0 ? (
                              availableParcs
                                .filter((p) => selectedParcIds.includes(p.ownerId))
                                .map((p) => (
                                  <span
                                    key={p.ownerId}
                                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[#76E6AB] bg-[#76E6AB]/5 text-xs font-medium text-gray-900"
                                  >
                                    {p.logo && (
                                      <img src={p.logo} alt="" className="w-5 h-5 object-contain" />
                                    )}
                                    {p.name}
                                    <Check className="h-3 w-3 text-[#76E6AB]" />
                                  </span>
                                ))
                            ) : (
                              <span className="text-sm text-gray-400">—</span>
                            )
                          ) : (formData.categories?.length ?? 0) > 0 ? (
                            (formData.categories || []).map((c) => (
                              <span
                                key={c}
                                className="px-3 py-1 rounded-lg border border-gray-200 text-xs font-medium text-gray-700"
                              >
                                {c}
                              </span>
                            ))
                          ) : (
                            <span className="text-sm text-gray-400">
                              {formData.category || '—'}
                            </span>
                          )}
                        </div>
                      </div>

                      <div>
                        <p className="text-xs font-medium text-gray-500 mb-1">Période</p>
                        <div className="flex flex-wrap items-center gap-4 text-sm text-gray-900">
                          <span>
                            Début: <strong>{startDate?.toLocaleDateString('fr-FR') || '—'}</strong>
                          </span>
                          <span>
                            Fin: <strong>{endDate?.toLocaleDateString('fr-FR') || '—'}</strong>
                          </span>
                          <span>
                            Durée:{' '}
                            <strong>
                              {nbJours > 0 ? `${nbJours} jour${nbJours > 1 ? 's' : ''}` : '—'}
                            </strong>
                          </span>
                        </div>
                      </div>

                      <div>
                        <p className="text-xs font-medium text-gray-500 mb-1">
                          Zones géographiques
                        </p>
                        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-gray-900">
                          <span>
                            Nombre de zones : <strong>{geographicZones.length}</strong>
                          </span>
                          <span>
                            Zone couverte :{' '}
                            <strong>
                              {(() => {
                                const totalArea = geographicZones.reduce(
                                  (sum, z) => sum + Math.PI * Math.pow(z.radius / 1000, 2),
                                  0,
                                );
                                return totalArea.toFixed(1);
                              })()}{' '}
                              km²
                            </strong>
                          </span>
                          {calculateBudgetAndImpressions.impressions > 0 && (
                            <span>
                              Plan max (impressions) :{' '}
                              <strong>
                                {calculateBudgetAndImpressions.impressions.toLocaleString('fr-FR')}
                              </strong>
                            </span>
                          )}
                        </div>
                      </div>

                      <div>
                        <p className="text-xs font-medium text-gray-500 mb-2">Spot</p>
                        {uploadedVideoUrl || selectedExistingVideo ? (
                          <div className="rounded-xl overflow-hidden border border-gray-200 bg-black aspect-video relative">
                            <video
                              src={uploadedVideoUrl || selectedExistingVideo?.url || ''}
                              className="w-full h-full object-cover"
                              controls
                            />
                            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-3 flex items-end justify-between pointer-events-none">
                              <span className="text-white text-xs font-medium">
                                Spot publicitaire
                              </span>
                            </div>
                          </div>
                        ) : (
                          <p className="text-sm text-gray-400">Aucune vidéo sélectionnée</p>
                        )}
                      </div>
                    </div>

                    {/* ── Right: Ajuster votre impact ── Impressions totales (sélection) + Montant = impressions/1000*2,5 */}
                    <div className="space-y-5">
                      <div>
                        <h3 className="text-base font-bold text-gray-900">Ajuster votre impact</h3>
                        <p className="text-xs text-gray-500 mt-0.5">
                          Déplacez le curseur pour ajuster votre budget et vos impressions estimées
                        </p>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div
                          className="border border-[#eef7f1] rounded-xl p-4"
                          style={{ backgroundColor: '#f5fcf7' }}
                        >
                          <div className="mb-1">
                            <div className="w-8 h-8 rounded-full bg-white/80 flex items-center justify-center mb-2">
                              <DollarSign className="h-4 w-4 text-gray-400" />
                            </div>
                            <span className="block text-xs text-gray-500 font-medium">
                              Montant estimé
                            </span>
                          </div>
                          <p className="text-lg font-bold" style={{ color: '#355f43' }}>
                            {calculateBudgetAndImpressions.impressions > 0
                              ? adjustedBudget.toLocaleString('fr-FR', {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })
                              : '0,00'}{' '}
                            TND
                          </p>
                        </div>
                        <div
                          className="border border-[#e7e9fb] rounded-xl p-4"
                          style={{ backgroundColor: '#f0f1fd' }}
                        >
                          <div className="mb-1">
                            <div className="w-8 h-8 rounded-full bg-white/80 flex items-center justify-center mb-2">
                              <TrendingUp className="h-4 w-4 text-gray-400" />
                            </div>
                            <span className="block text-xs text-gray-500 font-medium">
                              Plan final (impressions)
                            </span>
                          </div>
                          <p className="text-lg font-bold" style={{ color: '#3d438f' }}>
                            {calculateBudgetAndImpressions.impressions > 0
                              ? impressionsForCurrentBudget.toLocaleString('fr-FR')
                              : '0'}
                          </p>
                        </div>
                      </div>

                      {/* Budget slider — calcul selon sélection (zones + période), curseur pour ajuster budget et impressions */}
                      <div className="border border-gray-200 rounded-xl p-5 space-y-4">
                        {(() => {
                          const impressionsFromSelection =
                            calculateBudgetAndImpressions.impressions;
                          const hasSelectionBasedEstimate = impressionsFromSelection > 0;
                          const defaultMaxAmount = hasSelectionBasedEstimate
                            ? (impressionsFromSelection / 1000) * cpmTnd
                            : 0;
                          const defaultMinAmount = hasSelectionBasedEstimate ? BUDGET_MIN : 0;
                          const effectiveMin =
                            customMinBudget !== null ? customMinBudget : defaultMinAmount;
                          const effectiveMax =
                            customMaxBudget !== null ? customMaxBudget : defaultMaxAmount;
                          const safeMin = hasSelectionBasedEstimate
                            ? Math.min(effectiveMin, effectiveMax - 1)
                            : 0;
                          const safeMax = hasSelectionBasedEstimate
                            ? Math.max(effectiveMax, safeMin + 1)
                            : 0;
                          const rangeMin = safeMin;
                          const rangeMax = safeMax;
                          const currentAmount = hasSelectionBasedEstimate
                            ? Math.max(rangeMin, Math.min(rangeMax, adjustedBudget))
                            : 0;
                          const percentage =
                            rangeMax > rangeMin
                              ? ((currentAmount - rangeMin) / (rangeMax - rangeMin)) * 100
                              : 100;
                          return (
                            <>
                              {!hasSelectionBasedEstimate && (
                                <p className="text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                                  Aucune capacité estimée : ajoutez des zones avec des localités (ou
                                  des parcs TV) et des dates de campagne. Le plafond suit le moteur
                                  DOOH horaire (affluence × répétitions autorisées par créneau,
                                  selon la configuration globale et la durée du spot).
                                </p>
                              )}
                              {doohEstimateLoading && hasSelectionBasedEstimate && (
                                <p className="text-xs text-gray-500">
                                  Mise à jour de l&apos;estimation DOOH…
                                </p>
                              )}
                              {doohEstimateError && (
                                <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                                  {doohEstimateError}
                                </p>
                              )}
                              <p className="text-center text-2xl font-bold text-gray-900">
                                {currentAmount.toLocaleString('fr-FR', {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}{' '}
                                TND
                              </p>

                              <div className="flex items-center justify-between text-[11px] text-gray-500">
                                <span>
                                  MIN:{' '}
                                  {rangeMin.toLocaleString('fr-FR', { minimumFractionDigits: 2 })}{' '}
                                  TND
                                </span>
                                <span>
                                  MAX:{' '}
                                  {rangeMax.toLocaleString('fr-FR', { minimumFractionDigits: 2 })}{' '}
                                  TND
                                </span>
                              </div>

                              <input
                                type="range"
                                min={rangeMin}
                                max={rangeMax}
                                step="any"
                                value={currentAmount}
                                onChange={(e) => {
                                  const v = Math.max(
                                    rangeMin,
                                    Math.min(rangeMax, Number(e.target.value)),
                                  );
                                  setAdjustedBudget(v);
                                }}
                                onInput={(e) => {
                                  const v = Math.max(
                                    rangeMin,
                                    Math.min(
                                      rangeMax,
                                      Number((e.target as HTMLInputElement).value),
                                    ),
                                  );
                                  setAdjustedBudget(v);
                                }}
                                className="w-full h-2 rounded-lg appearance-none cursor-pointer accent-[#76E6AB]"
                                style={{
                                  background: `linear-gradient(to right, #76E6AB 0%, #76E6AB ${percentage}%, #e5e7eb ${percentage}%, #e5e7eb 100%)`,
                                }}
                              />

                              <div className="grid grid-cols-2 gap-3">
                                <div>
                                  <label className="block text-xs text-gray-500 mb-1">
                                    Montant minimum (TND)
                                  </label>
                                  <input
                                    type="number"
                                    value={customMinBudget !== null ? customMinBudget : ''}
                                    onChange={(e) => {
                                      const val = e.target.value ? Number(e.target.value) : null;
                                      setCustomMinBudget(val);
                                      if (val !== null && adjustedBudget < val)
                                        setAdjustedBudget(val);
                                    }}
                                    placeholder={`Min: ${rangeMin.toFixed(2)} TND`}
                                    min={0}
                                    step={50}
                                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#76E6AB]/40 focus:border-[#76E6AB]"
                                  />
                                </div>
                                <div>
                                  <label className="block text-xs text-gray-500 mb-1">
                                    Montant maximum (TND)
                                  </label>
                                  <input
                                    type="number"
                                    value={customMaxBudget !== null ? customMaxBudget : ''}
                                    onChange={(e) => {
                                      const val = e.target.value ? Number(e.target.value) : null;
                                      setCustomMaxBudget(val);
                                      if (val !== null && adjustedBudget > val)
                                        setAdjustedBudget(val);
                                    }}
                                    placeholder={`Max: ${rangeMax.toFixed(2)} TND`}
                                    min={0}
                                    step={50}
                                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#76E6AB]/40 focus:border-[#76E6AB]"
                                  />
                                </div>
                              </div>
                            </>
                          );
                        })()}
                      </div>

                      {/* Note */}
                      <div className="flex gap-2.5 p-4 bg-gray-50 rounded-xl border border-gray-200">
                        <Info className="h-4 w-4 text-gray-400 flex-shrink-0 mt-0.5" />
                        <p className="text-xs text-gray-500 leading-relaxed">
                          <strong className="text-gray-600">Note:</strong> Le curseur ajuste le plan
                          final après le calcul du plan max. Le plan final (budget + impressions +
                          répétitions horaires) devient la référence officielle soumise aux
                          propriétaires et injectée en planification horaire.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

          {showPostCartStep && (
            <div className="bg-white rounded-2xl shadow-lg overflow-hidden border border-gray-100">
              <div className="p-6 md:p-8">
                <div className="flex flex-col items-center text-center">
                  <div className="w-24 h-24 flex items-center justify-center">
                    <img src={panierPng} alt="" className="h-full w-full object-contain" />
                  </div>
                  <p className="mt-5 text-xl font-medium text-gray-700 leading-snug">
                    Votre campagne a ete ajoutee au panier
                  </p>
                </div>

                <div className="mt-7">
                  <h3 className="text-lg font-semibold text-center text-gray-900 mb-6 leading-snug">
                    Augmentez votre impact en diffusant votre spot lors d'evenements prevus dans la
                    meme periode
                  </h3>

                  {loadingRecommendedEvents ? (
                    <div className="flex justify-center py-10">
                      <div className="animate-spin rounded-full h-10 w-10 border-2 border-[#00B3A6] border-t-transparent" />
                    </div>
                  ) : recommendedEventsInPeriod.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      {recommendedEventsInPeriod.map((event) => {
                        const typeConfig: Record<
                          string,
                          { bg: string; text: string; label: string }
                        > = {
                          sport: { bg: 'bg-blue-100', text: 'text-blue-800', label: 'Sport' },
                          ramadan: { bg: 'bg-amber-100', text: 'text-amber-900', label: 'Ramadan' },
                          culture: {
                            bg: 'bg-purple-100',
                            text: 'text-purple-800',
                            label: 'Culture',
                          },
                          concert: {
                            bg: 'bg-purple-100',
                            text: 'text-purple-800',
                            label: 'Concert',
                          },
                          festival: { bg: 'bg-pink-100', text: 'text-pink-800', label: 'Festival' },
                          conference: {
                            bg: 'bg-indigo-100',
                            text: 'text-indigo-800',
                            label: 'Conference',
                          },
                          exposition: {
                            bg: 'bg-green-100',
                            text: 'text-green-800',
                            label: 'Exposition',
                          },
                          salon: { bg: 'bg-orange-100', text: 'text-orange-800', label: 'Salon' },
                          autre: { bg: 'bg-gray-100', text: 'text-gray-800', label: 'Autre' },
                        };
                        const typeStyle = typeConfig[event.event_type] || typeConfig.autre;
                        const start = new Date(event.start_date);
                        const end = new Date(event.end_date);
                        const dateStr = start.toLocaleDateString('fr-FR', {
                          day: 'numeric',
                          month: 'short',
                        });
                        const timeStr = `${start.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} - ${end.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
                        const impressions =
                          event.expected_attendance != null
                            ? event.expected_attendance.toLocaleString('fr-FR')
                            : '184 500';

                        return (
                          <div
                            key={event.id}
                            className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden flex flex-col"
                          >
                            <div className="aspect-[16/10] bg-gray-200 overflow-hidden">
                              {event.image_url ? (
                                <img
                                  src={event.image_url}
                                  alt={event.name}
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-gray-100 to-gray-200">
                                  <Megaphone className="h-12 w-12 text-gray-400" />
                                </div>
                              )}
                            </div>
                            <div className="p-4 flex flex-col flex-1">
                              <div className="flex items-start justify-between gap-2 mb-2">
                                <h4 className="text-base font-bold text-gray-900 flex-1">
                                  {event.name}
                                </h4>
                                <span
                                  className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium flex-shrink-0 ${typeStyle.bg} ${typeStyle.text}`}
                                >
                                  {typeStyle.label}
                                </span>
                              </div>
                              <div className="flex flex-wrap gap-1.5 mb-2">
                                <span className="inline-flex px-2 py-0.5 rounded bg-gray-100 text-gray-700 text-xs">
                                  Restaurants
                                </span>
                                <span className="inline-flex px-2 py-0.5 rounded bg-gray-100 text-gray-700 text-xs">
                                  Salles de sport
                                </span>
                              </div>
                              <div className="flex items-center gap-1.5 text-sm text-gray-600 mb-1">
                                <Calendar className="h-4 w-4 flex-shrink-0" />
                                <span>
                                  {dateStr} | {timeStr}
                                </span>
                              </div>
                              <div className="flex items-center gap-1.5 text-sm text-gray-600 mb-2">
                                <TrendingUp className="h-4 w-4 flex-shrink-0" />
                                <span>~ {impressions} impressions</span>
                              </div>
                              <p className="text-xs text-gray-500 mb-4">
                                (En incluant automatiquement toutes les categories de commerces qui
                                diffusent pendant l'evenement)
                              </p>
                              <button
                                type="button"
                                onClick={() =>
                                  navigate('/new-event-campaign', { state: { event } })
                                }
                                className="mt-auto w-full py-2.5 rounded-xl bg-[#1f1f1f] hover:bg-black text-white text-sm font-medium transition-colors"
                              >
                                Je me positionne
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-center py-10 text-gray-500 border border-gray-200 rounded-2xl bg-gray-50">
                      Aucun evenement actif ne chevauche la periode selectionnee.
                    </div>
                  )}
                </div>

                <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-6">
                  <button
                    type="button"
                    onClick={() => navigate('/dashboard')}
                    className="w-full py-3 rounded-xl border border-gray-300 bg-white hover:bg-gray-50 text-gray-700 font-medium"
                  >
                    Dashboard
                  </button>
                  <button
                    type="button"
                    onClick={() => navigate('/evenements')}
                    className="w-full py-3 rounded-xl text-gray-900 font-medium"
                    style={{ background: '#8de7a6' }}
                  >
                    Voir tous les evenements
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Navigation Buttons — gated to the final step only, because
              Steps 1-5 (std) and event Steps 1-2 (= Step 4/5 components)
              render their own Retour + Suivant. Only Step 6 (std) /
              Step 3 (event) reaches this footer for the Enregistrer +
              Ajouter au panier actions. (Also fixes a Commit-9 oversight
              where the gate stayed at currentStep > 3 even though Step 4
              already had its own footer.) */}
          {!showPostCartStep && (isEventCampaign ? currentStep > 2 : currentStep > 5) && (
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => wiz.prevStep()}
                disabled={currentStep === 1}
                className="flex items-center gap-2 px-5 py-3 border border-gray-300 rounded-xl text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-all text-sm font-medium"
              >
                <ArrowRight className="h-4 w-4 rotate-180" />
                Retour
              </button>

              {/* Step 6 / final step: Enregistrer + Ajouter au panier */}
              {((currentStep === 6 && !isEventCampaign) ||
                (currentStep === 3 && isEventCampaign)) && (
                <div className="flex flex-col items-end gap-2">
                  {(!canProceedToStep6() ||
                    adjustedBudget <= 0 ||
                    impressionsForCurrentBudget <= 0) && (
                    <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                      La campagne doit être supérieure à 0 dinar et à 0 impression pour pouvoir être
                      validée.
                    </p>
                  )}
                  <div className="flex items-center gap-3">
                    {/* Enregistrer (brouillon) */}
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          if (!draftCampaignId) {
                            const videoId = uploadedVideoId || selectedExistingVideo?.id;
                            if (!videoId) {
                              toast.error("Veuillez sélectionner ou uploader une vidéo d'abord");
                              return;
                            }
                            await saveCampaignDraft(videoId, false);
                          } else {
                            const { error } = await supabase
                              .from('campaigns')
                              .update({ status: 'draft' })
                              .eq('id', draftCampaignId);
                            if (error) {
                              log.error(
                                { error, campaignId: draftCampaignId },
                                'failed to save draft',
                              );
                              toast.error(
                                getErrorMessage(error) ||
                                  'Erreur lors de la sauvegarde du brouillon',
                              );
                              return;
                            }
                          }
                          toast.success('Campagne sauvegardée en brouillon');
                          navigate('/my-campaigns?status=draft');
                        } catch (error) {
                          log.error({ err: error }, 'unexpected error during save-draft flow');
                          toast.error(getErrorMessage(error) || 'Erreur lors de la sauvegarde');
                        }
                      }}
                      className="px-5 py-3 border border-gray-300 rounded-xl text-gray-700 hover:bg-gray-50 transition-all text-sm font-medium"
                    >
                      Enregistrer
                    </button>

                    {/* Ajouter au panier */}
                    <button
                      type="button"
                      disabled={
                        addingToCart ||
                        !canProceedToStep6() ||
                        adjustedBudget <= 0 ||
                        impressionsForCurrentBudget <= 0
                      }
                      onClick={async () => {
                        if (addingToCart) return;
                        if (
                          !canProceedToStep6() ||
                          adjustedBudget <= 0 ||
                          impressionsForCurrentBudget <= 0
                        ) {
                          toast.error(
                            'La campagne doit être supérieure à 0 dinar et à 0 impression.',
                          );
                          return;
                        }
                        setAddingToCart(true);
                        try {
                          let campaignId = draftCampaignId;
                          if (!campaignId) {
                            const videoId = uploadedVideoId || selectedExistingVideo?.id;
                            if (!videoId) {
                              toast.error("Veuillez sélectionner ou uploader une vidéo d'abord");
                              return;
                            }
                            const campaign = await saveCampaignDraft(videoId, false);
                            campaignId = campaign.id;
                          }

                          const balanceCheck =
                            await balanceService.checkCampaignBalance(campaignId);
                          if (balanceCheck && !balanceCheck.has_sufficient_balance) {
                            const { error: revertError } = await supabase
                              .from('campaigns')
                              .update({ status: 'draft' })
                              .eq('id', campaignId);
                            if (revertError) {
                              log.error(
                                { error: revertError, campaignId },
                                'failed to revert campaign to draft on insufficient balance',
                              );
                              toast.error(
                                getErrorMessage(revertError) ||
                                  'Solde insuffisant et erreur lors de la mise à jour de la campagne',
                              );
                              return;
                            }
                            toast.error('Solde insuffisant pour activer la campagne', {
                              duration: 5000,
                            });
                            toast(
                              (_t) => (
                                <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4">
                                  <p className="font-bold text-yellow-800 mb-2">
                                    Votre campagne est sauvegardée en brouillon
                                  </p>
                                  <div className="text-xs text-yellow-600 space-y-1">
                                    <p>
                                      Solde disponible:{' '}
                                      <strong>
                                        {balanceService.formatAmount(
                                          balanceCheck.available_balance,
                                        )}
                                      </strong>
                                    </p>
                                    <p>
                                      Coût campagne:{' '}
                                      <strong>
                                        {balanceService.formatAmount(balanceCheck.campaign_cost)}
                                      </strong>
                                    </p>
                                  </div>
                                </div>
                              ),
                              { duration: 6000 },
                            );
                            setTimeout(() => navigate('/my-recharges'), 3000);
                            return;
                          }

                          // Tant que l'utilisateur n'a pas validé depuis le panier,
                          // la campagne reste en brouillon.
                          const { error: updateError } = await supabase
                            .from('campaigns')
                            .update({ status: 'draft', content_validation_status: 'pending' })
                            .eq('id', campaignId);
                          if (updateError) {
                            log.error(
                              { error: updateError, campaignId },
                              'failed to update campaign for cart add',
                            );
                            toast.error(
                              getErrorMessage(updateError) || 'Erreur lors de la finalisation',
                            );
                            return;
                          }

                          if (isEventCampaign && eventFromState?.id) {
                            const { error: linkError } = await supabase.rpc(
                              'link_campaign_to_event',
                              {
                                p_campaign_id: campaignId,
                                p_event_id: eventFromState.id,
                              },
                            );
                            if (linkError) {
                              // Event-campaigns require the link to be functional; without it the
                              // campaign exists but isn't tied to its event. Surface the failure
                              // and stop — do not proceed to cart-add. User can retry.
                              log.error(
                                { error: linkError, campaignId, eventId: eventFromState.id },
                                'failed to link event campaign to event',
                              );
                              toast.error(
                                getErrorMessage(linkError) ||
                                  "Erreur lors du lien à l'événement — veuillez réessayer",
                              );
                              return;
                            }
                          }

                          pushCampaignToSidebarCart(campaignId);
                          await loadRecommendedEventsForSelectedPeriod();
                          setShowPostCartStep(true);
                          toast.success(
                            "Campagne ajoutee au panier. Activez-la depuis le panier pour qu'elle soit diffusée.",
                          );
                        } catch (error) {
                          log.error({ err: error }, 'unexpected error during cart-add flow');
                          toast.error(getErrorMessage(error) || 'Erreur lors de la finalisation');
                        } finally {
                          setAddingToCart(false);
                        }
                      }}
                      className="flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-sm text-white shadow-lg transition-all hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed"
                      style={{ background: '#76E6AB' }}
                    >
                      <span>{addingToCart ? 'Ajout en cours...' : 'Ajouter au panier'}</span>
                      <ArrowRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )}

              {/* Suivant button: removed. The outer footer gate restricts
                  this block to the final step (6 std / 3 event), so the
                  Suivant branch (currentStep < final) was unreachable
                  post Commit 10. Step navigation for Steps 1-5 (std) /
                  Steps 1-2 (event) lives in the extracted step components'
                  own Suivant buttons. */}
            </div>
          )}
        </div>

        {/* Sidebar with Dynamic Stats */}
        <div className="space-y-6 hidden">
          {/* Campaign Stats */}
          <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-100">
            <h3 className="text-lg font-bold text-[#00263A] mb-4">Estimation dynamique</h3>
            <div className="space-y-4">
              {/* Nombre d'écrans sélectionnés */}
              <div className="hidden flex items-center justify-between p-3 bg-gradient-to-r from-green-50 to-green-100 rounded-xl border border-green-200">
                <div className="flex items-center space-x-3">
                  <Monitor className="h-5 w-5 text-green-600" />
                  <span className="text-sm text-gray-600">Écrans sélectionnés</span>
                </div>
                <span className="font-bold text-green-600">{nbEcransSelected}</span>
              </div>

              <div className="flex items-center justify-between p-3 bg-gradient-to-r from-[#00263A]/10 to-[#004466]/10 rounded-xl border border-[#00263A]/20">
                <div className="flex items-center space-x-3">
                  <Users className="h-5 w-5 text-[#00263A]" />
                  <span className="text-sm text-gray-600">Nombre d'impressions</span>
                </div>
                <span className="font-bold text-[#00263A]">
                  {currentStep >= 5 && calculatedImpressions > 0
                    ? calculatedImpressions.toLocaleString('fr-FR')
                    : canEstimate
                      ? nbImpressions.toLocaleString('fr-FR')
                      : 0}
                </span>
              </div>

              <div className="flex items-center justify-between p-3 bg-gradient-to-r from-[#00263A]/10 to-[#004466]/10 rounded-xl border border-[#00263A]/20">
                <div className="flex items-center space-x-3">
                  <Clock className="h-5 w-5 text-[#00263A]" />
                  <span className="text-sm text-gray-600">Nombre de jours</span>
                </div>
                <span className="font-bold text-[#00263A]">{canEstimate ? nbJours : 0}</span>
              </div>
              <div className="p-3 bg-gradient-to-r from-[#00B3A6]/10 to-[#00D4C4]/10 rounded-xl border border-[#00B3A6]/20">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-3">
                    <DollarSign className="h-5 w-5 text-[#00B3A6]" />
                    <span className="text-sm text-gray-600">Prix total</span>
                  </div>
                  <span className="font-bold text-[#00B3A6] text-lg">
                    {currentStep >= 5 && adjustedBudget > 0
                      ? adjustedBudget.toLocaleString('fr-FR', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })
                      : canEstimate
                        ? prixTotal.toLocaleString('fr-FR', {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })
                        : '0.00'}{' '}
                    TND
                  </span>
                </div>
                {currentStep >= 5 && calculatedImpressions > 0 ? (
                  <p className="text-xs text-gray-500 text-right">
                    ({(calculatedImpressions / 1000).toFixed(1)}k impressions)
                  </p>
                ) : (
                  canEstimate &&
                  nbImpressions > 0 && (
                    <p className="text-xs text-gray-500 text-right">
                      ({(nbImpressions / 1000).toFixed(1)}k impressions × {cpmTnd} TND)
                    </p>
                  )
                )}
              </div>
              <div className="flex items-center justify-between p-3 bg-gradient-to-r from-purple-50 to-purple-100 rounded-xl border border-purple-200">
                <div className="flex items-center space-x-3">
                  <TrendingUp className="h-5 w-5 text-purple-600" />
                  <span className="text-sm text-gray-600">CPM (Coût pour 1000)</span>
                </div>
                <span className="font-bold text-purple-600">{cpmTnd.toFixed(2)} TND</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* showZoneModal && (<ZoneModal />) — entire modal block removed in
          Commit 9 (setShowZoneModal(true) was never called; unreachable UI). */}

      {/* Modal Événements Spéciaux */}
      {showEventsModal && detectedEvents.length > 0 && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:block sm:p-0">
            {/* Overlay */}
            <div
              className="fixed inset-0 transition-opacity bg-gray-500 bg-opacity-75"
              onClick={() => setShowEventsModal(false)}
            ></div>

            {/* Modal */}
            <div className="inline-block align-bottom bg-white rounded-2xl text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-2xl sm:w-full">
              {/* Header */}
              <div className="bg-gradient-to-r from-[#00B3A6] to-[#00D4C4] px-6 py-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className="p-2 bg-white rounded-xl">
                      <PartyPopper className="h-6 w-6 text-[#00B3A6]" />
                    </div>
                    <div>
                      <h3 className="text-xl font-bold text-white">
                        Événements Spéciaux Détectés !
                      </h3>
                      <p className="text-sm text-white/90 mt-1">
                        Profitez d'une visibilité accrue pendant ces événements
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setShowEventsModal(false)}
                    className="p-2 hover:bg-white/20 rounded-lg transition-colors"
                  >
                    <X className="h-5 w-5 text-white" />
                  </button>
                </div>
              </div>

              {/* Content */}
              <div className="px-6 py-5">
                <div className="mb-5">
                  <div className="flex items-start space-x-3 p-4 bg-blue-50 border border-blue-200 rounded-xl">
                    <Sparkles className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
                    <div className="text-sm text-blue-900">
                      <p className="font-semibold mb-1">🎯 Opportunité exceptionnelle !</p>
                      <p>
                        Nous avons détecté{' '}
                        <strong>
                          {detectedEvents.length} événement{detectedEvents.length > 1 ? 's' : ''}{' '}
                          spécial{detectedEvents.length > 1 ? 'aux' : ''}
                        </strong>{' '}
                        durant la période de votre campagne. Associer votre annonce à{' '}
                        {detectedEvents.length > 1 ? 'ces événements' : 'cet événement'} vous
                        permettra de bénéficier d'une <strong>audience plus large</strong> et d'une{' '}
                        <strong>meilleure visibilité</strong>.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Liste des événements */}
                <div className="space-y-3 max-h-[400px] overflow-y-auto">
                  {detectedEvents.map((event) => (
                    <div
                      key={event.id}
                      className={`p-4 border-2 rounded-xl cursor-pointer transition-all ${
                        selectedEvents.includes(event.id)
                          ? 'border-[#00B3A6] bg-[#00B3A6]/5'
                          : 'border-gray-200 hover:border-[#00B3A6]/50'
                      }`}
                      onClick={() => {
                        setSelectedEvents((prev) =>
                          prev.includes(event.id)
                            ? prev.filter((id) => id !== event.id)
                            : [...prev, event.id],
                        );
                      }}
                    >
                      <div className="flex items-start space-x-3">
                        <div
                          className={`p-2 rounded-lg ${
                            selectedEvents.includes(event.id) ? 'bg-[#00B3A6]' : 'bg-gray-100'
                          }`}
                        >
                          <Calendar
                            className={`h-5 w-5 ${
                              selectedEvents.includes(event.id) ? 'text-white' : 'text-gray-600'
                            }`}
                          />
                        </div>
                        <div className="flex-1">
                          <div className="flex items-start justify-between">
                            <div>
                              <h4 className="font-bold text-gray-900">{event.name}</h4>
                              {event.description && (
                                <p className="text-sm text-gray-600 mt-1">{event.description}</p>
                              )}
                            </div>
                            {event.pricing_multiplier > 1 && (
                              <span className="px-2 py-1 bg-yellow-100 text-yellow-800 text-xs font-semibold rounded-lg">
                                x{event.pricing_multiplier}
                              </span>
                            )}
                          </div>
                          <div className="mt-2 flex flex-wrap gap-2 text-xs text-gray-600">
                            <span className="flex items-center">
                              📍 {event.location} • {event.city}
                            </span>
                            <span className="flex items-center">
                              📅 {new Date(event.start_date).toLocaleDateString('fr-FR')} -{' '}
                              {new Date(event.end_date).toLocaleDateString('fr-FR')}
                            </span>
                            {event.expected_attendance && (
                              <span className="flex items-center">
                                👥 {event.expected_attendance.toLocaleString()} visiteurs attendus
                              </span>
                            )}
                          </div>
                          {event.target_audience && (
                            <p className="mt-2 text-xs text-gray-500 italic">
                              🎯 {event.target_audience}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Footer */}
              <div className="bg-gray-50 px-6 py-4 flex items-center justify-between">
                <div className="text-sm text-gray-600">
                  {selectedEvents.length > 0 ? (
                    <span className="font-semibold text-[#00B3A6]">
                      {selectedEvents.length} événement{selectedEvents.length > 1 ? 's' : ''}{' '}
                      sélectionné{selectedEvents.length > 1 ? 's' : ''}
                    </span>
                  ) : (
                    <span>Sélectionnez les événements qui vous intéressent</span>
                  )}
                </div>
                <div className="flex space-x-3">
                  <button
                    onClick={() => {
                      setShowEventsModal(false);
                      setSelectedEvents([]);
                    }}
                    className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-100 transition-colors font-medium"
                  >
                    Plus tard
                  </button>
                  <button
                    onClick={() => {
                      setShowEventsModal(false);
                      if (selectedEvents.length > 0) {
                        toast.success(
                          `${selectedEvents.length} événement${selectedEvents.length > 1 ? 's' : ''} sélectionné${selectedEvents.length > 1 ? 's' : ''} !`,
                        );
                      }
                    }}
                    className="px-4 py-2 bg-gradient-to-r from-[#00B3A6] to-[#00D4C4] text-white rounded-lg hover:shadow-lg transition-all font-medium"
                  >
                    {selectedEvents.length > 0
                      ? 'Confirmer la sélection'
                      : 'Continuer sans événements'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
