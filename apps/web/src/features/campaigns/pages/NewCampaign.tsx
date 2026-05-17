import 'react-datepicker/dist/react-datepicker.css';
import {
  MapPin,
  Calendar,
  Film,
  DollarSign,
  CheckCircle,
  X,
  Megaphone,
  LayoutList,
  ChevronRight,
} from 'lucide-react';
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { toast } from 'react-hot-toast';
import { useNavigate, useLocation } from 'react-router-dom';

import ariane1 from '@/assets/ariane/1.png';
import ariane1s from '@/assets/ariane/1s.png';
import ariane2 from '@/assets/ariane/2.png';
import ariane2s from '@/assets/ariane/2s.png';
import ariane3 from '@/assets/ariane/3.png';
import ariane3s from '@/assets/ariane/3s.png';
import ariane4 from '@/assets/ariane/4.png';
import ariane4s from '@/assets/ariane/4s.png';
import ariane5 from '@/assets/ariane/5.png';
import ariane5s from '@/assets/ariane/5s.png';
import ariane6 from '@/assets/ariane/6.png';
import ariane6s from '@/assets/ariane/6s.png';
import { useAdvertiserGlobalConfig } from '@/features/advertiser/hooks/useAdvertiserGlobalConfig';
import { useOwnerBusinessSectors } from '@/features/auth/hooks/useOwnerBusinessSectors';
import { useAuthStore } from '@/features/auth/stores/auth.store';
import { useCampaignWizard } from '@/features/campaigns/hooks/new-campaign/useCampaignWizard';
import { buildInitialWizardState } from '@/features/campaigns/hooks/new-campaign/wizard-init';
import type {
  GeographicZone,
  UseCampaignWizardOptions,
  WizardState,
} from '@/features/campaigns/hooks/new-campaign/wizard-types';
import { useCampaignCategories } from '@/features/campaigns/hooks/useCampaignCategories';
import { useCampaignMutations } from '@/features/campaigns/hooks/useCampaignMutations';
import {
  useCampaignLocations,
  useScreenIdsByLocations,
} from '@/features/campaigns/hooks/useCampaignScreens';
import { useCampaignZonesForEdit } from '@/features/campaigns/hooks/useCampaignZonesForEdit';
import { useMyApprovedVideos } from '@/features/campaigns/hooks/useMyApprovedVideos';
import { useRecommendedEventsForPeriod } from '@/features/campaigns/hooks/useRecommendedEventsForPeriod';
import { useVideoById } from '@/features/campaigns/hooks/useVideoById';
import { parseCampaignUiDate, toLocalDateOnlyString } from '@/features/campaigns/lib/wizard-dates';
import { zonesLabel } from '@/features/campaigns/lib/wizard-zones';
import PostCartStep from '@/features/campaigns/pages/new-campaign/PostCartStep';
import Step1NameType from '@/features/campaigns/pages/new-campaign/Step1NameType';
import Step2 from '@/features/campaigns/pages/new-campaign/Step2';
import Step3 from '@/features/campaigns/pages/new-campaign/Step3';
import Step4 from '@/features/campaigns/pages/new-campaign/Step4';
import Step5, { type ApprovedVideo } from '@/features/campaigns/pages/new-campaign/Step5';
import Step6 from '@/features/campaigns/pages/new-campaign/Step6';
import {
  buildWizardLocationScheduleMap,
  computeNewCampaignDoohMaxImpressions,
} from '@/features/campaigns/services/dooh-new-campaign-estimate.service';
import { useCartStore } from '@/features/campaigns/stores/cart.store';
import type { SpecialEvent } from '@/features/events/types/event';
import { useAvailableParcs } from '@/features/screens/hooks/useAvailableParcs';
import { usePredefinedZones } from '@/features/screens/hooks/usePredefinedZones';
import { useUnavailabilityPeriods } from '@/features/screens/hooks/useUnavailabilityPeriods';
import { getErrorMessage } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { balanceService } from '@/services/balance.service';

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
  const { profileType, user } = useAuthStore();

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
    customMinBudget,
    customMaxBudget,
    uploadedVideoId,
    uploadedVideoUrl,
    existingVideoId,
    draftCampaignId,
  } = state;
  // `categories` is read directly via `state.categories` at the few
  // remaining call sites (post Commit 12 formData-facade removal).
  // `calculatedImpressions` is read directly via `state.calculatedImpressions`
  // where needed; it was previously destructured but never referenced
  // top-level after Commit 11's Step 6 extraction.
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
  // `radius`: edit-mode initial value, never changed at runtime (no setter
  // is called). Reads: saveCampaignDraft fallback + loadCampaignZones
  // edit-mode hydration. `_searchQuery` / `_budget` / `_budgetPercentage`
  // (formerly nearby) were write-only or never-used dead state — deleted.
  const radius = campaignToEdit?.location_radius || 1000;

  // Parcs TV — server read via React Query (Commit 7b), gated on parc_tv mode.
  const { parcs: availableParcs, loading: loadingParcs } = useAvailableParcs({
    enabled: diffusionType === 'parc_tv',
  });

  // --- Legacy formData stub. The migrated fields (campaignName, client,
  //     categories) now live in WizardState. The remaining slots
  //     (budget, nbImpressions, nbEcrans) feed only the dead
  // legacyFormData + formData useMemo facade: removed in Commit 12. The
  // facade was kept across Commits 6-11 so that ~30 `formData.X` read
  // sites could stay unchanged during step extractions. All reads are
  // now converted to `state.X` directly; the spread of `legacyFormData`
  // (budget/nbImpressions/nbEcrans) was dead since Commit 8 deleted its
  // sole consumer (campaignEstimations memo).
  // Owner business sectors → campaign category choices. Reuses the auth
  // feature's `useOwnerBusinessSectors` query (5c1); the wizard derives the
  // sector-name list from the cached rows (Commit 7a).
  const { data: ownerSectors } = useOwnerBusinessSectors();
  const campaignCategories = useMemo(
    () =>
      (ownerSectors ?? [])
        .map((sector) => sector.name)
        .filter((name): name is string => Boolean(name && name.trim())),
    [ownerSectors],
  );

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
  // Predefined zones: one React Query cache entry (`usePredefinedZones`,
  // Commit 7a) shared with GeographicZonesManagement. The hook returns every
  // zone (active + inactive); the wizard renders active-only, sorted by name —
  // behaviour-identical to the former `getAll()` server filter.
  const {
    zones: allPredefinedZones,
    loading: loadingPredefinedZones,
    isError: predefinedZonesError,
  } = usePredefinedZones();
  const predefinedZones = useMemo(
    () =>
      allPredefinedZones
        .filter((zone) => zone.is_active)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [allPredefinedZones],
  );
  // Campaign-write mutations (Commit 7a): the campaign draft save + the
  // status patches + the event link. `saveCampaignDraft` / `handleSaveDraft` /
  // `handleAddToCart` drive these via `mutateAsync`.
  const { saveDraft, updateCampaign, linkToEvent } = useCampaignMutations();
  // Commit 7b folded-in reads: the advertiser's approved-videos picker source
  // and the two edit-mode hydration reads (existing video + saved zones).
  const { videos: approvedVideosData } = useMyApprovedVideos(user?.id);
  const editModeVideoId =
    editMode && campaignToEdit?.video_id ? campaignToEdit.video_id : undefined;
  const { video: existingVideoRecord } = useVideoById(editModeVideoId);
  const editModeCampaignId = editMode && campaignToEdit?.id ? campaignToEdit.id : undefined;
  const { zones: editModeZones } = useCampaignZonesForEdit(editModeCampaignId);
  // zoneFilterCountry / zoneFilterRegion: moved into Step4.tsx as local state.
  // screenIdsFromSelectedLocations / unavailabilityPeriods / freshLocations-
  // ForEstimate: migrated to React Query reads (Commit 7a) — the hooks are
  // called below, once `allSelectedLocations` / `effectiveScreenIds` exist.

  // BUDGET_MIN: floor of the budget slider's adjustable range. Used by
  // canProceedToStep6 + the budget-recentering effects. The _budget /
  // _budgetPercentage useState slots that lived here were dead state
  // (never read or write-only) — deleted in Commit 12.
  const BUDGET_MIN = 0;
  // adjustedBudget / calculatedImpressions / customMinBudget / customMaxBudget
  // are in WizardState; their setters are shimmed at the top of the
  // component to preserve the setX(value|updater) API at all call sites.
  /** Plafond impressions (moteur DOOH horaire), aligné injectCampaignPublicationSchedule */
  const [doohMaxImpressions, setDoohMaxImpressions] = useState(0);
  const [doohEstimateLoading, setDoohEstimateLoading] = useState(false);
  const [doohEstimateError, setDoohEstimateError] = useState<string | null>(null);

  // Calcul dynamique des jours
  const nbJours =
    startDate && endDate
      ? Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)))
      : 0;

  // canEstimate + nbEcransSelected: deleted in Commit 12. Sole consumer
  // was the hidden sidebar block (className="space-y-6 hidden"), which
  // also deleted in Commit 12 per CSS-gated dead-UI detection.

  // Mémoriser : un flatMap à chaque rendu créait une nouvelle référence → useMemo/useEffect en boucle + carte bloquée
  const allSelectedLocations = useMemo(
    () => geographicZones.flatMap((zone) => zone.locations || []),
    [geographicZones],
  );

  // Server reads for the DOOH estimate (Commit 7a): hydrated locations + the
  // active screen IDs of the wizard's current location selection. The key
  // factory deduplicates + sorts the ID list, so the per-render `.map` array
  // identity does not churn the cache.
  const selectedLocationIds = useMemo(
    () => allSelectedLocations.map((loc) => loc.id),
    [allSelectedLocations],
  );
  const { locations: freshLocationsForEstimate } = useCampaignLocations(selectedLocationIds);
  const { screenIds: screenIdsFromSelectedLocations } =
    useScreenIdsByLocations(selectedLocationIds);

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

  // Unavailability periods for every screen in the current selection
  // (Commit 7a) — the React Query read replaces the per-screen fetch loop.
  const { periods: unavailabilityPeriods } = useUnavailabilityPeriods(effectiveScreenIds);

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
  const [myApprovedVideos, setMyApprovedVideos] = useState<ApprovedVideo[]>([]);
  const selectedExistingVideo = useMemo(
    () =>
      existingVideoId
        ? (myApprovedVideos.find((v) => v?.id === existingVideoId) ?? null)
        : null,
    [existingVideoId, myApprovedVideos],
  );
  const setExistingVideoId = useCallback(
    (value: string | null) =>
      setState((prev) => ({ ...prev, existingVideoId: value })),
    [setState],
  );
  const [showPostCartStep, setShowPostCartStep] = useState(false);
  // Post-cart recommended events — the React Query read fires once the
  // post-cart step shows (Commit 7b; replaces the imperatively-called fetch).
  const { events: recommendedEvents, loading: loadingRecommendedEvents } =
    useRecommendedEventsForPeriod(startDate, endDate, eventFromState?.id ?? null, {
      enabled: showPostCartStep,
    });
  const [addingToCart, setAddingToCart] = useState(false);

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

  // Events modal state (detectedEvents, showEventsModal, selectedEvents)
  // deleted in Commit 12: the modal was rendered gated on
  // `showEventsModal && detectedEvents.length > 0`, but neither
  // setShowEventsModal(true) nor _setDetectedEvents was ever called
  // anywhere in the file — the modal never opened. Setter-to-true
  // verification (Commit 9 methodology) surfaced it; the ~175-line JSX
  // block was deleted alongside the state slots.

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

  // Campagne événement : pré-remplir avec la 1ère catégorie une fois les
  // secteurs chargés (Commit 7a — derive-from-query seed; CF-16(c): guarded on
  // the cached data being present).
  useEffect(() => {
    if (!isEventCampaign || campaignCategories.length === 0) return;
    setState((prev) => {
      if (prev.categories.length > 0) return prev;
      return { ...prev, categories: [campaignCategories[0] as string] };
    });
  }, [isEventCampaign, campaignCategories, setState]);

  // En mode édition, restaurer les catégories multiples depuis
  // campaign_categories (Commit 7a — `useCampaignCategories` query is disabled
  // outside edit mode; the seed effect derives the display names once the
  // cached rows arrive).
  const { categories: editModeCategories } = useCampaignCategories(
    editMode && draftCampaignId ? draftCampaignId : undefined,
  );
  useEffect(() => {
    if (!editMode || editModeCategories.length === 0) return;
    const displayNames = editModeCategories.map((c) => categoryReverseMapping[c] || c);
    setState((prev) => ({ ...prev, categories: displayNames }));
    // categoryReverseMapping is a component-local const (defined above), stable
    // by reference between renders within a session; setState is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editMode, editModeCategories, setState]);

  const categoryChoices = useMemo(() => {
    const base =
      campaignCategories.length > 0
        ? [...campaignCategories]
        : Array.from(new Set(Object.values(categoryReverseMapping)));

    for (const selected of state.categories) {
      if (!base.includes(selected)) base.push(selected);
    }
    return base;
  }, [campaignCategories, state.categories]);

  const saveCampaignDraft = async (videoId?: string, _isVideoValidated: boolean = false) => {
    try {
      // Validation des champs obligatoires
      if (!state.campaignName || state.campaignName.trim() === '') {
        throw new Error('Le nom de la campagne est obligatoire');
      }

      if (diffusionType !== 'parc_tv' && !state.categories.length) {
        throw new Error('Sélectionnez au moins une catégorie');
      }

      if (!startDate || !endDate) {
        throw new Error('Les dates de début et fin sont obligatoires');
      }

      const mappedCategories =
        diffusionType === 'parc_tv'
          ? ['parc']
          : state.categories.map((c) => categoryMapping[c] || c);
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

      const campaign = await saveDraft.mutateAsync({
        data: {
          name: state.campaignName,
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
        campaignId: draftCampaignId || undefined,
      });

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
      // setBudgetPercentage call removed in Commit 12 — wrote to dead state.
    } else {
      setCalculatedImpressions(0);
    }
  }, [adjustedBudget, calculateBudgetAndImpressions.impressions, cpmTnd]);

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

  // Les événements recommandés post-panier sont fournis par
  // `useRecommendedEventsForPeriod` (Commit 7b) — la lecture déclenchée
  // impérativement a été remplacée par une query gatée sur `showPostCartStep`.

  // recommendedEventsInPeriod memo moved into PostCartStep.tsx — it was
  // only consumed by the post-cart UI.

  const pushCampaignToSidebarCart = useCallback(
    (campaignId: string) => {
      const amount = adjustedBudget > 0 ? adjustedBudget : prixTotal;
      const periodLabel =
        startDate && endDate
          ? `${startDate.toLocaleDateString('fr-FR')} – ${endDate.toLocaleDateString('fr-FR')}`
          : undefined;
      useCartStore.getState().addItem({
        id: campaignId,
        name: state.campaignName || eventFromState?.name || 'Nom de la campagne',
        amount,
        periodLabel,
        zonesLabel: zonesLabel(geographicZones),
      });
    },
    [
      adjustedBudget,
      prixTotal,
      state.campaignName,
      eventFromState?.name,
      startDate,
      endDate,
      geographicZones,
    ],
  );

  // Save / AddToCart parent handlers — passed to Step6.tsx as onSaveDraft /
  // onAddToCart props. Inline behavior preserved from the previous parent
  // footer onClicks (pre-Commit-11). Hook adoption is tracked in Issue #20.
  const handleSaveDraft = async (): Promise<void> => {
    try {
      if (!draftCampaignId) {
        const videoId = uploadedVideoId || selectedExistingVideo?.id;
        if (!videoId) {
          toast.error("Veuillez sélectionner ou uploader une vidéo d'abord");
          return;
        }
        await saveCampaignDraft(videoId, false);
      } else {
        try {
          await updateCampaign.mutateAsync({
            id: draftCampaignId,
            patch: { status: 'draft' },
          });
        } catch (error) {
          log.error({ error, campaignId: draftCampaignId }, 'failed to save draft');
          toast.error(getErrorMessage(error) || 'Erreur lors de la sauvegarde du brouillon');
          return;
        }
      }
      toast.success('Campagne sauvegardée en brouillon');
      navigate('/my-campaigns?status=draft');
    } catch (error) {
      log.error({ err: error }, 'unexpected error during save-draft flow');
      toast.error(getErrorMessage(error) || 'Erreur lors de la sauvegarde');
    }
  };

  const handleAddToCart = async (): Promise<void> => {
    if (addingToCart) return;
    if (
      !canProceedToStep6() ||
      adjustedBudget <= 0 ||
      impressionsForCurrentBudget <= 0
    ) {
      toast.error('La campagne doit être supérieure à 0 dinar et à 0 impression.');
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

      const balanceCheck = await balanceService.checkCampaignBalance(campaignId);
      if (balanceCheck && !balanceCheck.has_sufficient_balance) {
        try {
          await updateCampaign.mutateAsync({ id: campaignId, patch: { status: 'draft' } });
        } catch (revertError) {
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
        toast.error('Solde insuffisant pour activer la campagne', { duration: 5000 });
        toast(
          (_t) => (
            <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4">
              <p className="font-bold text-yellow-800 mb-2">
                Votre campagne est sauvegardée en brouillon
              </p>
              <div className="text-xs text-yellow-600 space-y-1">
                <p>
                  Solde disponible:{' '}
                  <strong>{balanceService.formatAmount(balanceCheck.available_balance)}</strong>
                </p>
                <p>
                  Coût campagne:{' '}
                  <strong>{balanceService.formatAmount(balanceCheck.campaign_cost)}</strong>
                </p>
              </div>
            </div>
          ),
          { duration: 6000 },
        );
        setTimeout(() => navigate('/my-recharges'), 3000);
        return;
      }

      try {
        await updateCampaign.mutateAsync({
          id: campaignId,
          patch: { status: 'draft', content_validation_status: 'pending' },
        });
      } catch (updateError) {
        log.error(
          { error: updateError, campaignId },
          'failed to update campaign for cart add',
        );
        toast.error(getErrorMessage(updateError) || 'Erreur lors de la finalisation');
        return;
      }

      if (isEventCampaign && eventFromState?.id) {
        try {
          await linkToEvent.mutateAsync({ campaignId, eventId: eventFromState.id });
        } catch (linkError) {
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
      // `useRecommendedEventsForPeriod` fetches once `showPostCartStep` flips.
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
  };

  // handleDateChange + validateStep2 (the misnamed dates validator): moved
  //   into Step3.tsx. Step3 owns its own dateErrors/dateTouched and the
  //   cross-field re-validation logic.


  // Approved-videos mirror (Commit 7b). Seeded from the `useMyApprovedVideos`
  // query and merged with the edit-mode existing video; kept as local state
  // because Step5 patches a row's duration after a successful write.
  useEffect(() => {
    let merged = approvedVideosData;
    if (existingVideoRecord && !merged.some((v) => v.id === existingVideoRecord.id)) {
      merged = [
        ...merged,
        {
          id: existingVideoRecord.id,
          url: existingVideoRecord.url,
          filename: existingVideoRecord.filename,
          duration_seconds: existingVideoRecord.duration_seconds ?? null,
        },
      ];
    }
    setMyApprovedVideos(merged);
  }, [approvedVideosData, existingVideoRecord]);

  // Edit-mode existing video — seed the wizard's video slots once the
  // `useVideoById` read resolves (CF-16 derive-from-query, guarded).
  useEffect(() => {
    if (!existingVideoRecord) return;
    setUploadedVideoId(existingVideoRecord.id);
    setUploadedVideoUrl(existingVideoRecord.url);
    setExistingVideoId(existingVideoRecord.id);
  }, [existingVideoRecord, setUploadedVideoId, setUploadedVideoUrl, setExistingVideoId]);

  // Redirection si campagne événement sans événement en state
  useEffect(() => {
    if (location.pathname === '/new-event-campaign' && !eventFromState) {
      navigate('/evenements', { replace: true });
    }
  }, [location.pathname, eventFromState, navigate]);

  // Edit-mode geographic zones — seed the wizard once `useCampaignZonesForEdit`
  // resolves (CF-16 derive-from-query, guarded on the cached data being present).
  useEffect(() => {
    if (editModeZones.length > 0) {
      setGeographicZones(editModeZones);
    }
  }, [editModeZones, setGeographicZones]);

  // handleParcToggle: removed (Step2.tsx owns the toggle via setSelectedParcIds prop).

  // Single-zone _locationsInZone effect, distanceKm, normalizeCategoryName,
  // filteredMapLocations memo, tempZoneLocations memo, allMapLocations /
  // loadingMapLocations useState, isZonesStep, loadAllMapLocations effect:
  // all moved into Step4.tsx (Commit 9). The single-zone effect fed the
  // pre-existing dead _locationsInZone slot; deleted alongside the trio.

  // Predefined-zones fetch failure surfacing — preserves the error toast the
  // former `loadPredefinedZones` effect raised (Commit 7a; the fetch itself is
  // now the `usePredefinedZones` query).
  useEffect(() => {
    if (predefinedZonesError) {
      toast.error('Impossible de charger les zones prédéfinies');
    }
  }, [predefinedZonesError]);

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

  /**
   * Renders the single active step component for the current wizard
   * position. Mutually-exclusive: only one return path fires per render.
   * Step 4/5/6 each handle both standard and event-mode campaigns —
   * standard mapping is steps 4/5/6, event mapping is steps 1/2/3 of
   * the abbreviated event flow.
   */
  function renderActiveStep(): React.ReactElement | null {
    if (showPostCartStep) {
      return (
        <PostCartStep
          loadingRecommendedEvents={loadingRecommendedEvents}
          recommendedEvents={recommendedEvents}
          startDate={startDate}
          endDate={endDate}
          onGoToDashboard={() => navigate('/dashboard')}
          onGoToEvents={() => navigate('/evenements')}
          onJeMePositionne={(event) =>
            navigate('/new-event-campaign', { state: { event } })
          }
        />
      );
    }
    if (currentStep === 1 && !isEventCampaign) {
      return (
        <Step1NameType
          campaignName={state.campaignName}
          diffusionType={diffusionType}
          setCampaignName={setCampaignName}
          setDiffusionType={setDiffusionType}
          onNext={() => wiz.nextStep()}
          isFirst={true}
        />
      );
    }
    if (currentStep === 2 && !isEventCampaign) {
      return (
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
      );
    }
    if (currentStep === 3 && !isEventCampaign) {
      return (
        <Step3
          startDate={startDate}
          endDate={endDate}
          setStartDate={setStartDate}
          setEndDate={setEndDate}
          onNext={() => wiz.nextStep()}
          onBack={() => wiz.prevStep()}
        />
      );
    }
    if (
      (currentStep === 4 && !isEventCampaign) ||
      (currentStep === 1 && isEventCampaign)
    ) {
      return (
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
      );
    }
    if (
      (currentStep === 5 && !isEventCampaign) ||
      (currentStep === 2 && isEventCampaign)
    ) {
      return (
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
      );
    }
    if (
      (currentStep === 6 && !isEventCampaign) ||
      (currentStep === 3 && isEventCampaign)
    ) {
      return (
        <Step6
          wizardState={state}
          setAdjustedBudget={setAdjustedBudget}
          setCustomMinBudget={setCustomMinBudget}
          setCustomMaxBudget={setCustomMaxBudget}
          isEventCampaign={isEventCampaign}
          availableParcs={availableParcs}
          selectedParcIds={selectedParcIds}
          cpmTnd={cpmTnd}
          maxImpressionsFromSelection={calculateBudgetAndImpressions.impressions}
          impressionsForCurrentBudget={impressionsForCurrentBudget}
          doohEstimateLoading={doohEstimateLoading}
          doohEstimateError={doohEstimateError}
          selectedExistingVideo={selectedExistingVideo}
          nbJours={nbJours}
          onBack={() => wiz.prevStep()}
          onSaveDraft={handleSaveDraft}
          onAddToCart={handleAddToCart}
          canFinalize={
            canProceedToStep6() &&
            adjustedBudget > 0 &&
            impressionsForCurrentBudget > 0
          }
          addingToCart={addingToCart}
        />
      );
    }
    return null;
  }

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
        <div className="lg:col-span-3 space-y-6">{renderActiveStep()}
        </div>

      </div>

      {/* showZoneModal && (<ZoneModal />) — entire modal block removed in
          Commit 9 (setShowZoneModal(true) was never called; unreachable UI). */}

    </div>
  );
}
