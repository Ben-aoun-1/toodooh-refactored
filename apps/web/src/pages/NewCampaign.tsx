import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { MapContainer, TileLayer, Circle, useMapEvents, Marker, Popup } from 'react-leaflet';
import 'react-datepicker/dist/react-datepicker.css';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import {
  Upload,
  MapPin,
  Calendar,
  Film,
  Search,
  Target,
  Users,
  DollarSign,
  ArrowRight,
  Check,
  CheckCircle,
  TrendingUp,
  Clock,
  AlertCircle,
  Info,
  Monitor,
  Sparkles,
  X,
  PartyPopper,
  Megaphone,
  LayoutList,
  ChevronRight,
  Flame,
} from 'lucide-react';
import DatePicker from 'react-datepicker';
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
  type CampaignScreen,
  type CampaignLocation,
} from '../services/campaign-screens.service';
import { campaignService } from '../services/campaign.service';
import {
  buildWizardLocationScheduleMap,
  computeNewCampaignDoohMaxImpressions,
} from '../services/dooh-new-campaign-estimate.service';
import { predefinedZonesService, type PredefinedZone } from '../services/predefined-zones.service';
import { screensService, type UnavailabilityPeriod } from '../services/screens.service';
import {
  videoUploadService,
  readVideoDurationFromFile,
  readVideoDurationFromUrl,
  type UploadProgress,
} from '../services/video-upload.service';
import { useAuthStore } from '../stores/auth.store';
import { useCartStore } from '../stores/cart.store';
import type { BusinessSector } from '../types/auth';
import type { SpecialEvent } from '../types/event';

import Step1NameType from './new-campaign/Step1NameType';
import Step2 from './new-campaign/Step2';

const log = logger.child({ module: 'NewCampaign' });

const ARIANE_ICONS = [ariane1, ariane2, ariane3, ariane4, ariane5, ariane6] as const;
const ARIANE_ICONS_DONE = [ariane1s, ariane2s, ariane3s, ariane4s, ariane5s, ariane6s] as const;

// Fix pour les icônes Leaflet
// TODO(phase-1): typed source [leaflet] — see #15
// eslint-disable-next-line @typescript-eslint/no-explicit-any
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

const categoryMultipliers = {
  'Publicité commerciale': 1.2,
  'Événement culturel': 0.8,
  'Promotion spéciale': 1.0,
  'Annonce institutionnelle': 1.5,
};


const center = {
  lat: 36.8065,
  lng: 10.1815, // Tunis center coordinates
};

// Composant pour gérer les événements de la carte
function MapEvents({ onLocationSelect }: { onLocationSelect: (lat: number, lng: number) => void }) {
  useMapEvents({
    // TODO(phase-1): typed source [supabase] — see #15
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    click: (e: any) => {
      onLocationSelect(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

// Villes tunisiennes pour les suggestions de recherche
const TUNISIA_CITIES = [
  { name: 'Tunis', lat: 36.8065, lng: 10.1815 },
  { name: 'Sousse', lat: 35.8333, lng: 10.6333 },
  { name: 'Sfax', lat: 34.7475, lng: 10.7667 },
  { name: 'Ariana', lat: 36.8663, lng: 10.1647 },
  { name: 'Bizerte', lat: 37.2744, lng: 9.8739 },
  { name: 'Gabès', lat: 33.8818, lng: 10.0982 },
  { name: 'Mahdia', lat: 35.5047, lng: 11.0622 },
  { name: 'Nabeul', lat: 36.4518, lng: 10.7357 },
  { name: 'Monastir', lat: 35.7771, lng: 10.8266 },
  { name: 'Kairouan', lat: 35.6781, lng: 10.0963 },
  { name: 'Gafsa', lat: 34.4258, lng: 8.7842 },
  { name: 'Tozeur', lat: 33.9197, lng: 8.1336 },
  { name: 'Béja', lat: 36.7256, lng: 9.1817 },
  { name: 'Jendouba', lat: 36.5011, lng: 8.7803 },
  { name: 'Kasserine', lat: 35.1667, lng: 8.8333 },
  { name: 'Sidi Bouzid', lat: 35.0381, lng: 9.4847 },
  { name: 'Kébili', lat: 33.7042, lng: 8.9694 },
  { name: 'Tataouine', lat: 32.9297, lng: 10.4517 },
  { name: 'Médenine', lat: 33.3547, lng: 10.5053 },
  { name: 'Zaghouan', lat: 36.4028, lng: 10.1428 },
];

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
  const [selectedLocation, setSelectedLocation] = useState(
    campaignToEdit?.location_lat && campaignToEdit?.location_lng
      ? { lat: campaignToEdit.location_lat, lng: campaignToEdit.location_lng }
      : center,
  );
  const [radius, _setRadius] = useState(campaignToEdit?.location_radius || 1000);
  const [_searchQuery, _setSearchQuery] = useState('');
  const [selectedVideo, setSelectedVideo] = useState<File | null>(null);

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

  // États pour la validation
  // errors/touched: removed in Commit 7 (Step1NameType + Step2 own their
  //   own local errors/touched; Step3-6 will follow the same pattern).
  // dateErrors/dateTouched still used by inline Step 3 (Période); will be
  //   internalized when Step 3 extracts in Commit 8.
  const [dateErrors, setDateErrors] = useState<{ [key: string]: string }>({});
  const [dateTouched, setDateTouched] = useState<{ [key: string]: boolean }>({});

  // États pour les écrans / localités (zone unique : localités dans le cercle)
  const [_allScreens, setAllScreens] = useState<CampaignScreen[]>([]);
  const [_locationsInZone, setLocationsInZone] = useState<CampaignLocation[]>([]);
  const [_loadingScreens, setLoadingScreens] = useState(false);

  const [showZoneModal, setShowZoneModal] = useState(false);
  const [editingZone, setEditingZone] = useState<GeographicZone | null>(null);
  const [tempZoneLocation, setTempZoneLocation] = useState(center);
  const [tempZoneRadius, setTempZoneRadius] = useState(1000);
  const [tempZoneSearchQuery, setTempZoneSearchQuery] = useState('');
  const [predefinedZones, setPredefinedZones] = useState<PredefinedZone[]>([]);
  const [loadingPredefinedZones, setLoadingPredefinedZones] = useState(false);
  const [zoneFilterCountry, setZoneFilterCountry] = useState<string>('');
  const [zoneFilterRegion, setZoneFilterRegion] = useState<string>('');
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

  // Calculs dynamiques des estimations
  const campaignEstimations = useMemo(() => {
    const baseReach = Math.round((radius / 1000) * 1500); // Base: 1500 personnes par km
    const baseCost = Math.round((radius / 1000) * 500); // Base: 500 TND par km

    // Multiplicateur selon la catégorie
    const categoryMultiplier =
      categoryMultipliers[
        (formData.categories[0] || formData.category) as keyof typeof categoryMultipliers
      ] || 1;

    // Multiplicateur selon la durée
    const durationDays =
      startDate && endDate
        ? Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))
        : 1;
    const durationMultiplier = Math.min(durationDays / 7, 2); // Max 2x pour 2 semaines

    // Multiplicateur selon le budget
    const budgetMultiplier = formData.budget ? Math.min(parseFloat(formData.budget) / 1000, 3) : 1; // Max 3x pour 3000 TND

    const estimatedReach = Math.round(
      baseReach * categoryMultiplier * durationMultiplier * budgetMultiplier,
    );
    const estimatedCost = Math.round(baseCost * categoryMultiplier * durationMultiplier);
    const estimatedViews = Math.round(estimatedReach * 0.7); // 70% des personnes verront la pub
    const estimatedEngagement = Math.round(estimatedViews * 0.15); // 15% d'engagement

    // Calcul de la zone couverte (approximation)
    const areaCovered = Math.PI * Math.pow(radius / 1000, 2);

    return {
      reach: estimatedReach,
      cost: estimatedCost,
      views: estimatedViews,
      engagement: estimatedEngagement,
      area: areaCovered,
      duration: durationDays,
      efficiency: estimatedReach / estimatedCost, // personnes par TND
    };
  }, [radius, formData.categories, formData.budget, startDate, endDate]);


  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  // uploadedVideoUrl / uploadedVideoId / draftCampaignId are in WizardState;
  // their setters are shimmed at the top of the component.
  const [_uploadedVideoPath, setUploadedVideoPath] = useState<string>('');
  // TODO(phase-1): typed source [supabase] — see #15
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [myApprovedVideos, setMyApprovedVideos] = useState<any[]>([]);
  // selectedExistingVideo: derived from existingVideoId via the
  // myApprovedVideos catalogue (we only persist the id). setSelectedExistingVideo
  // is a value-form shim — all current call sites pass either null or a video
  // object (no updater-form usage in this file).
  const selectedExistingVideo = useMemo(
     
    () =>
      existingVideoId
        ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (myApprovedVideos.find((v: any) => v?.id === existingVideoId) ?? null)
        : null,
    [existingVideoId, myApprovedVideos],
  );
  const setSelectedExistingVideo = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (video: any) =>
      setState((prev) => ({ ...prev, existingVideoId: video?.id ?? null })),
    [setState],
  );
  const [_videoTab, setVideoTab] = useState<'upload' | 'existing'>('existing');
  const MAX_VIDEO_DURATION_SECONDS = 30;
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

  const handleVideoUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const durationSeconds = await readVideoDurationFromFile(file);
      if (durationSeconds != null && durationSeconds > MAX_VIDEO_DURATION_SECONDS) {
        toast.error(
          'La vidéo ne doit pas dépasser 30 secondes. Veuillez choisir une vidéo plus courte.',
        );
        event.target.value = '';
        return;
      }

      setUploading(true);
      setSelectedVideo(file);
      setSelectedExistingVideo(null);

      // Upload la vidéo
      const result = await videoUploadService.uploadVideo(file, (progress) => {
        setUploadProgress(progress);
      });

      setUploadedVideoUrl(result.url);
      setUploadedVideoPath(result.path);

      // Créer l'entrée vidéo dans la table videos
      const videoEntry = await videoUploadService.createVideoEntry(
        result.url,
        result.path,
        file.name,
        file.size,
        durationSeconds,
      );
      setUploadedVideoId(videoEntry.id);

      if ((durationSeconds == null || durationSeconds <= 0) && result.url) {
        const fromUrl = await readVideoDurationFromUrl(result.url);
        if (fromUrl != null) {
          try {
            await videoUploadService.updateVideoDurationSeconds(videoEntry.id, fromUrl);
          } catch {
            /* colonne absente ou RLS : le moteur DOOH utilisera la durée par défaut */
          }
        }
      }

      // Ne pas créer la campagne automatiquement, elle sera créée lors de la validation finale
      toast.success('Vidéo uploadée avec succès !');
    } catch (error) {
      toast.error(getErrorMessage(error) || "Erreur lors de l'upload");
      setSelectedVideo(null);
    } finally {
      setUploading(false);
      setUploadProgress(null);
    }
  };

  const handleSelectExistingVideo = (id: string) => {
    if (!id) {
      setSelectedExistingVideo(null);
      setUploadedVideoId('');
      setUploadedVideoUrl('');
      return;
    }

    const video = (myApprovedVideos || []).find((v) => v.id === id);
    if (!video) return;

    const ds = Number(video.duration_seconds);
    if (Number.isFinite(ds) && ds > MAX_VIDEO_DURATION_SECONDS) {
      toast.error('La vidéo ne doit pas dépasser 30 secondes. Veuillez en sélectionner une autre.');
      setSelectedExistingVideo(null);
      setUploadedVideoId('');
      setUploadedVideoUrl('');
      return;
    }

    setSelectedExistingVideo(video);
    setUploadedVideoId(video.id);
    setUploadedVideoUrl(video.url);
    setSelectedVideo(null);
    toast.success('Vidéo sélectionnée !');

    if (video.url && (!Number.isFinite(ds) || ds <= 0)) {
      void (async () => {
        const d = await readVideoDurationFromUrl(video.url);
        if (d == null) return;
        if (d > MAX_VIDEO_DURATION_SECONDS) {
          toast.error(
            'La vidéo ne doit pas dépasser 30 secondes. Veuillez en sélectionner une autre.',
          );
          setSelectedExistingVideo(null);
          setUploadedVideoId('');
          setUploadedVideoUrl('');
          return;
        }
        try {
          await videoUploadService.updateVideoDurationSeconds(video.id, d);
          const patched = { ...video, duration_seconds: d };
          setSelectedExistingVideo(patched);
          setMyApprovedVideos((prev) => prev.map((v) => (v.id === video.id ? patched : v)));
        } catch {
          /* ignore */
        }
      })();
    }
  };

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
  const validateDate = (dateType: 'start' | 'end', date: Date | null) => {
    let error = '';

    if (!date) {
      error =
        dateType === 'start'
          ? 'La date de début est obligatoire'
          : 'La date de fin est obligatoire';
    } else if (dateType === 'start' && endDate && date >= endDate) {
      error = 'La date de début doit être antérieure à la date de fin';
    } else if (dateType === 'end' && startDate && date <= startDate) {
      error = 'La date de fin doit être postérieure à la date de début';
    }
    // Note: La validation minDate est gérée directement par le DatePicker avec minDate={tomorrow} (J+2)

    return error;
  };

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

  const handleDateChange = (dateType: 'start' | 'end', date: Date | null) => {
    if (dateType === 'start') {
      setStartDate(date);
    } else {
      setEndDate(date);
    }

    // Marquer le champ comme touché
    setDateTouched({ ...dateTouched, [dateType]: true });

    // Valider le champ
    const error = validateDate(dateType, date);
    setDateErrors({ ...dateErrors, [dateType]: error });

    // Détection des événements spéciaux désactivée (popup masquée)
    // const newStartDate = dateType === 'start' ? date : startDate;
    // const newEndDate = dateType === 'end' ? date : endDate;
    // if (newStartDate && newEndDate && newStartDate < newEndDate) {
    //   checkSpecialEvents(newStartDate, newEndDate);
    // }

    // Valider aussi l'autre date si elle existe
    if (dateType === 'start' && endDate) {
      const endError = validateDate('end', endDate);
      setDateErrors({ ...dateErrors, [dateType]: error, end: endError });
    } else if (dateType === 'end' && startDate) {
      const startError = validateDate('start', startDate);
      setDateErrors({ ...dateErrors, [dateType]: error, start: startError });
    }
  };

  const validateStep2 = () => {
    const newErrors: { [key: string]: string } = {};
    const newTouched: { [key: string]: boolean } = {};

    // Valider les dates
    newTouched.start = true;
    newTouched.end = true;
    newErrors.start = validateDate('start', startDate);
    newErrors.end = validateDate('end', endDate);

    setDateTouched(newTouched);
    setDateErrors(newErrors);

    // Vérifier s'il y a des erreurs
    return !Object.values(newErrors).some((error) => error !== '');
  };


  // Charger les écrans au montage du composant
  useEffect(() => {
    loadAllScreens();
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
            setSelectedExistingVideo(videoData);
            setVideoTab('existing');
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

  // Charger tous les écrans de la base de données
  const loadAllScreens = async () => {
    setLoadingScreens(true);
    try {
      const screens = await campaignScreensService.getAllScreens();
      setAllScreens(screens);
    } catch (error) {
      log.error({ error }, 'Erreur lors du chargement des écrans');
    } finally {
      setLoadingScreens(false);
    }
  };

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

  // Mettre à jour les localités dans la zone (cercle unique) quand centre ou rayon change
  useEffect(() => {
    if (selectedLocation && radius > 0) {
      campaignScreensService
        .getLocationsInArea(selectedLocation.lat, selectedLocation.lng, radius / 1000)
        .then(setLocationsInZone)
        .catch(() => setLocationsInZone([]));
    } else {
      setLocationsInZone([]);
    }
  }, [selectedLocation, radius]);

  // ===== FONCTIONS DE GESTION DES ZONES MULTIPLES =====

  // Obtenir les IDs des localités déjà utilisées dans d'autres zones
  const getUsedLocationIds = (excludeZoneId?: string): string[] => {
    return geographicZones
      .filter((zone) => zone.id !== excludeZoneId)
      .flatMap((zone) => (zone.locations || []).map((loc) => loc.id));
  };

  // Toutes les localités pour la carte (affichées en permanence, indépendamment du cercle)
  const [allMapLocations, setAllMapLocations] = useState<CampaignLocation[]>([]);
  const [loadingMapLocations, setLoadingMapLocations] = useState(false);

  // Distance en km (Haversine) pour filtrer les localités dans le cercle
  const distanceKm = useCallback((lat1: number, lng1: number, lat2: number, lng2: number) => {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLng / 2) *
        Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }, []);

  const normalizeCategoryName = useCallback((value?: string) => {
    if (!value) return '';
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
  }, []);

  // Filtrage catégorie -> n'afficher que les localités des propriétaires de la(les) catégorie(s) sélectionnée(s).
  const filteredMapLocations = useMemo(() => {
    if (diffusionType === 'parc_tv') return allMapLocations;
    if (!Array.isArray(allMapLocations) || allMapLocations.length === 0) return [];
    if (!formData.categories || formData.categories.length === 0) return allMapLocations;

    const selected = new Set(formData.categories.map((c) => normalizeCategoryName(c)));
    return allMapLocations.filter((loc) => {
      return selected.has(normalizeCategoryName(loc.owner_category || ''));
    });
  }, [allMapLocations, diffusionType, formData.categories, normalizeCategoryName]);

  // Localités dans le cercle actuel (dérivé de allMapLocations), excluant celles déjà dans d'autres zones
  const tempZoneLocations = useMemo(() => {
    if (
      !tempZoneLocation ||
      tempZoneRadius <= 0 ||
      !Array.isArray(filteredMapLocations) ||
      filteredMapLocations.length === 0
    )
      return [];
    const radiusKm = tempZoneRadius / 1000;
    const usedIds = getUsedLocationIds(editingZone?.id);
    return filteredMapLocations.filter((loc) => {
      const c = loc?.coordinates;
      if (
        !c ||
        typeof c.lat !== 'number' ||
        typeof c.lng !== 'number' ||
        Number.isNaN(c.lat) ||
        Number.isNaN(c.lng)
      )
        return false;
      const d = distanceKm(tempZoneLocation.lat, tempZoneLocation.lng, c.lat, c.lng);
      return d <= radiusKm && !usedIds.includes(loc.id);
    });
  }, [
    filteredMapLocations,
    tempZoneLocation,
    tempZoneRadius,
    editingZone?.id,
    geographicZones,
    distanceKm,
  ]);

  const isZonesStep =
    (currentStep === 4 && !isEventCampaign) || (currentStep === 1 && isEventCampaign);
  // Charger toutes les localités quand on est sur l’étape zones (carte dans la page) ou à l’ouverture de la modale
  useEffect(() => {
    if (!isZonesStep && !showZoneModal) return;
    setLoadingMapLocations(true);
    campaignScreensService
      .getAllLocationsForMap()
      .then(setAllMapLocations)
      .catch(() => setAllMapLocations([]))
      .finally(() => setLoadingMapLocations(false));
  }, [isZonesStep, showZoneModal]);

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

  // Appliquer une zone prédéfinie (dans la modale : préremplit le formulaire)
  const handleApplyPredefinedZone = async (zone: PredefinedZone) => {
    setTempZoneLocation({ lat: zone.latitude, lng: zone.longitude });
    setTempZoneRadius(zone.radius);
    setTempZoneSearchQuery(zone.name);
    toast.success(`Zone "${zone.name}" appliquée`);
  };

  // Obtenir les localités dans le cercle d’une zone prédéfinie (pour cartes et visiteurs)
  const getLocationsForPredefinedZone = useCallback(
    (zone: PredefinedZone): CampaignLocation[] => {
      if (!filteredMapLocations.length) return [];
      const radiusKm = zone.radius / 1000;
      const usedIds = getUsedLocationIds();
      return filteredMapLocations.filter((loc) => {
        const c = loc?.coordinates;
        if (!c || typeof c.lat !== 'number' || typeof c.lng !== 'number') return false;
        const d = distanceKm(zone.latitude, zone.longitude, c.lat, c.lng);
        return d <= radiusKm && !usedIds.includes(loc.id);
      });
    },
    [filteredMapLocations, geographicZones, distanceKm],
  );

  // Visiteurs attendus pour l’affichage (toutes les localités dans le cercle, sans exclure les déjà sélectionnées)
  const getEstimatedVisitorsForPredefinedZone = useCallback(
    (zone: PredefinedZone): number => {
      if (!filteredMapLocations.length) return 0;
      const radiusKm = zone.radius / 1000;
      const locs = filteredMapLocations.filter((loc) => {
        const c = loc?.coordinates;
        if (!c || typeof c.lat !== 'number' || typeof c.lng !== 'number') return false;
        return distanceKm(zone.latitude, zone.longitude, c.lat, c.lng) <= radiusKm;
      });
      return locs.reduce((sum, loc) => {
        const s = loc.affluence_schedule;
        if (!s?.length) return sum;
        return (
          sum + s.reduce((acc, x) => acc + Math.max(0, Number(x.estimated_impressions) || 0), 0)
        );
      }, 0);
    },
    [filteredMapLocations, distanceKm],
  );

  // Carte prédéfinie : sélection / désélection (toggle)
  const isPredefinedZoneSelected = (zone: PredefinedZone) =>
    geographicZones.some((z) => z.predefinedZoneId === zone.id);

  const handleTogglePredefinedZone = (zone: PredefinedZone) => {
    if (isPredefinedZoneSelected(zone)) {
      setGeographicZones((prev) => prev.filter((z) => z.predefinedZoneId !== zone.id));
      toast.success(`Zone "${zone.name}" retirée`);
      return;
    }
    const locs = getLocationsForPredefinedZone(zone);
    const newZone: GeographicZone = {
      id: `predefined-${zone.id}`,
      name: zone.name,
      location: { lat: zone.latitude, lng: zone.longitude },
      radius: zone.radius,
      locations: locs,
      predefinedZoneId: zone.id,
    };
    setGeographicZones((prev) => [...prev, newZone]);
    toast.success(`Zone "${zone.name}" ajoutée`);
  };

  // Ouvrir la modal pour ajouter une nouvelle zone

  // Ouvrir la modal pour éditer une zone existante

  // Sauvegarder une zone (nouvelle ou éditée)
  const handleSaveZone = () => {
    if (tempZoneLocations.length === 0) {
      toast.error('Aucune localité disponible dans cette zone');
      return;
    }

    const zoneName = tempZoneSearchQuery || `Zone ${geographicZones.length + 1}`;

    if (editingZone) {
      setGeographicZones((prev) =>
        prev.map((zone) =>
          zone.id === editingZone.id
            ? {
                ...zone,
                name: zoneName,
                location: tempZoneLocation,
                radius: tempZoneRadius,
                locations: tempZoneLocations,
              }
            : zone,
        ),
      );
      toast.success('Zone modifiée avec succès');
    } else {
      const newZone: GeographicZone = {
        id: `zone-${Date.now()}`,
        name: zoneName,
        location: tempZoneLocation,
        radius: tempZoneRadius,
        locations: tempZoneLocations,
      };
      setGeographicZones((prev) => [...prev, newZone]);
      toast.success('Zone ajoutée avec succès');
    }

    setShowZoneModal(false);
    setEditingZone(null);
  };

  // Supprimer une zone
  const handleDeleteZone = (zoneId: string) => {
    setGeographicZones((prev) => prev.filter((zone) => zone.id !== zoneId));
    toast.success('Zone supprimée');
  };

  // Géolocalisation au chargement
  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setSelectedLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        },
        () => {},
        { enableHighAccuracy: true },
      );
    }
  }, []);

  // Fonction de recherche améliorée pour la Tunisie

  // Suggestions de villes tunisiennes
  const getCitySuggestions = (query: string) => {
    if (!query.trim()) return [];
    return TUNISIA_CITIES.filter((city) =>
      city.name.toLowerCase().includes(query.toLowerCase()),
    ).slice(0, 5);
  };

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

          {/* Step 3: Planning (Période) */}
          {currentStep === 3 && !isEventCampaign && (
            <div className="bg-white rounded-2xl shadow-lg overflow-hidden border border-gray-100">
              <div className="p-6 border-b border-gray-200">
                <div className="flex items-center space-x-3">
                  <div className="p-2 rounded-lg bg-gradient-to-r from-[#00B3A6] to-[#00D4C4]">
                    <Calendar className="h-5 w-5 text-white" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-[#00263A]">Planification</h2>
                    <p className="text-gray-600">Définissez les dates de diffusion</p>
                  </div>
                </div>
              </div>

              <div className="p-6 space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Date de début <span className="text-red-500">*</span>
                    </label>
                    <DatePicker
                      selected={startDate}
                      onChange={(date: Date | null) => handleDateChange('start', date)}
                      onBlur={() => setDateTouched({ ...dateTouched, start: true })}
                      selectsStart
                      startDate={startDate}
                      endDate={endDate}
                      minDate={today}
                      className={`w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-[#00B3A6] focus:border-transparent transition-all ${
                        dateTouched.start && dateErrors.start
                          ? 'border-red-300 bg-red-50'
                          : 'border-gray-300'
                      }`}
                      placeholderText="Sélectionnez une date"
                      dateFormat="dd/MM/yyyy"
                    />
                    {dateTouched.start && dateErrors.start && (
                      <p className="mt-1 text-sm text-red-600 flex items-center">
                        <AlertCircle className="h-4 w-4 mr-1" />
                        {dateErrors.start}
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Date de fin <span className="text-red-500">*</span>
                    </label>
                    <DatePicker
                      selected={endDate}
                      onChange={(date: Date | null) => handleDateChange('end', date)}
                      onBlur={() => setDateTouched({ ...dateTouched, end: true })}
                      selectsEnd
                      startDate={startDate}
                      endDate={endDate}
                      minDate={startDate || today}
                      className={`w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-[#00B3A6] focus:border-transparent transition-all ${
                        dateTouched.end && dateErrors.end
                          ? 'border-red-300 bg-red-50'
                          : 'border-gray-300'
                      }`}
                      placeholderText="Sélectionnez une date"
                      dateFormat="dd/MM/yyyy"
                    />
                    {dateTouched.end && dateErrors.end && (
                      <p className="mt-1 text-sm text-red-600 flex items-center">
                        <AlertCircle className="h-4 w-4 mr-1" />
                        {dateErrors.end}
                      </p>
                    )}
                  </div>
                </div>

                {campaignEstimations.duration > 0 && (
                  <div className="bg-gradient-to-r from-[#00B3A6]/10 to-[#00D4C4]/10 rounded-xl p-4 border border-[#00B3A6]/20">
                    <div className="flex items-center space-x-2 mb-2">
                      <Clock className="h-5 w-5 text-[#00B3A6]" />
                      <span className="font-medium text-[#00263A]">Durée de la campagne</span>
                    </div>
                    <p className="text-[#00263A]">
                      {campaignEstimations.duration} jour
                      {campaignEstimations.duration > 1 ? 's' : ''}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Step 3: Zones géographiques — design deux colonnes : cartes à gauche, carte à droite */}
          {((currentStep === 4 && !isEventCampaign) || (currentStep === 1 && isEventCampaign)) && (
            <div className="bg-white rounded-2xl shadow-lg overflow-hidden border border-gray-100">
              <div className="p-6 border-b border-gray-200">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <h2 className="text-xl font-bold text-[#00263A]">Zones géographiques</h2>
                  <div className="flex items-center gap-3 flex-wrap">
                    <select
                      value={zoneFilterCountry}
                      onChange={(e) => setZoneFilterCountry(e.target.value)}
                      className="min-w-[240px] px-3 py-2 text-sm border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#00B3A6] focus:border-transparent bg-white"
                    >
                      <option value="">Pays</option>
                      <option value="Tunisie">Tunisie</option>
                    </select>
                    <select
                      value={zoneFilterRegion}
                      onChange={(e) => setZoneFilterRegion(e.target.value)}
                      className="min-w-[240px] px-3 py-2 text-sm border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#00B3A6] focus:border-transparent bg-white"
                    >
                      <option value="">Région</option>
                      {[...new Set(predefinedZones.map((z) => z.region).filter(Boolean))].map(
                        (r) => (
                          <option key={r!} value={r!}>
                            {r}
                          </option>
                        ),
                      )}
                    </select>
                  </div>
                </div>
                <p className="text-gray-600 mt-2">Ajoutez une ou plusieurs zones de diffusion</p>
              </div>

              <div className="flex flex-col lg:flex-row">
                {/* Colonne gauche : 3 zones visibles puis scroll, hauteur = carte */}
                <div className="w-full lg:w-[380px] flex-shrink-0 border-r border-gray-200 flex flex-col bg-gray-50/50">
                  <div className="p-4">
                    <div className="h-[384px] overflow-y-auto space-y-3">
                      {loadingPredefinedZones ? (
                        <div className="flex items-center justify-center py-12">
                          <div className="animate-spin rounded-full h-8 w-8 border-2 border-[#00B3A6] border-t-transparent" />
                        </div>
                      ) : (
                        (() => {
                          const filtered = predefinedZones.filter((z) => {
                            if (zoneFilterCountry && (z.country || '') !== zoneFilterCountry)
                              return false;
                            if (zoneFilterRegion && (z.region || '') !== zoneFilterRegion)
                              return false;
                            return true;
                          });
                          return filtered.length === 0 ? (
                            <p className="text-sm text-gray-500 text-center py-8">
                              Aucune zone prédéfinie
                            </p>
                          ) : (
                            filtered.map((zone) => {
                              const selected = isPredefinedZoneSelected(zone);
                              const visitors = getEstimatedVisitorsForPredefinedZone(zone);
                              return (
                                <button
                                  key={zone.id}
                                  type="button"
                                  onClick={() => handleTogglePredefinedZone(zone)}
                                  className={`w-full text-left rounded-xl border-2 transition-all overflow-hidden ${
                                    selected
                                      ? 'border-[#00B3A6] bg-[#00B3A6]/5 shadow-md'
                                      : 'border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm'
                                  }`}
                                >
                                  <div className="relative h-20 bg-gray-200">
                                    <img
                                      src={
                                        zone.image_url ||
                                        `https://picsum.photos/seed/zone-${zone.id}/400/200`
                                      }
                                      alt=""
                                      className="w-full h-full object-cover"
                                    />
                                    <div
                                      className={`absolute top-3 left-3 w-6 h-6 rounded-md border-2 flex items-center justify-center ${selected ? 'bg-[#00B3A6] border-[#00B3A6]' : 'bg-white border-gray-300'}`}
                                    >
                                      {selected && (
                                        <Check className="w-4 h-4 text-white" strokeWidth={3} />
                                      )}
                                    </div>
                                    {zone.is_hot && (
                                      <span className="absolute top-3 right-3 inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-white border border-red-200 text-red-600 shadow-sm">
                                        <Flame className="w-3 h-3" />
                                        Hot right now
                                      </span>
                                    )}
                                  </div>
                                  <div className="p-2">
                                    <p className="text-sm font-semibold text-gray-900 truncate">
                                      {zone.name}
                                    </p>
                                    <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-600">
                                      <span className="flex items-center gap-1">
                                        <MapPin className="w-3 h-3 flex-shrink-0" />
                                        {(zone.radius / 1000).toFixed(0)} km
                                      </span>
                                      <span className="flex items-center gap-1">
                                        <Users className="w-3 h-3 flex-shrink-0" />~{' '}
                                        {visitors.toLocaleString('fr-FR')} visiteurs attendus
                                      </span>
                                    </div>
                                  </div>
                                </button>
                              );
                            })
                          );
                        })()
                      )}
                    </div>
                  </div>
                </div>

                {/* Colonne droite : carte même hauteur que les 3 zones */}
                <div className="flex-1 bg-white p-4">
                  {loadingMapLocations ? (
                    <div className="h-[384px] flex items-center justify-center rounded-xl border border-gray-200">
                      <div className="animate-spin rounded-full h-10 w-10 border-2 border-[#00B3A6] border-t-transparent" />
                    </div>
                  ) : (
                    <div className="h-[384px] rounded-xl overflow-hidden shadow-lg border border-gray-200">
                      <MapContainer
                        center={
                          geographicZones.length > 0
                            ? [geographicZones[0].location.lat, geographicZones[0].location.lng]
                            : [36.83435, 10.21905]
                        }
                        zoom={geographicZones.length > 0 ? 12 : 11}
                        style={{ height: '100%', width: '100%' }}
                        className="rounded-lg"
                      >
                        <TileLayer
                          url="https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png"
                          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
                          subdomains="abcd"
                          maxZoom={14}
                        />
                        <TileLayer
                          url="https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png"
                          attribution=""
                          opacity={0.5}
                          maxZoom={12}
                          minZoom={8}
                        />
                        {/* Cercles de rayon pour chaque zone sélectionnée */}
                        {geographicZones
                          .filter((z) => z.location?.lat != null && z.location?.lng != null)
                          .map((zone) => (
                            <Circle
                              key={zone.id}
                              center={[zone.location!.lat, zone.location!.lng]}
                              radius={zone.radius}
                              pathOptions={{
                                fillColor: '#00B3A6',
                                fillOpacity: 0.2,
                                color: '#00B3A6',
                                weight: 2,
                              }}
                            />
                          ))}
                        {/* Marqueur centre violet pour chaque zone */}
                        {geographicZones
                          .filter((z) => z.location?.lat != null && z.location?.lng != null)
                          .map((zone) => (
                            <Marker
                              key={`marker-${zone.id}`}
                              position={[zone.location!.lat, zone.location!.lng]}
                              icon={L.icon({
                                iconUrl:
                                  'https://cdn.jsdelivr.net/gh/pointhi/leaflet-color-markers@master/img/marker-icon-2x-violet.png',
                                iconSize: [20, 32],
                                iconAnchor: [10, 32],
                              })}
                            />
                          ))}
                        {/* Localités : vert = dans une zone sélectionnée, gris = hors zone */}
                        {(filteredMapLocations || []).map((loc) => {
                          const c = loc?.coordinates;
                          if (
                            !c ||
                            typeof c.lat !== 'number' ||
                            typeof c.lng !== 'number' ||
                            Number.isNaN(c.lat) ||
                            Number.isNaN(c.lng)
                          )
                            return null;
                          const inZone = geographicZones.some(
                            (z) =>
                              distanceKm(z.location.lat, z.location.lng, c.lat, c.lng) <=
                              z.radius / 1000,
                          );
                          const colorHex = inZone ? '#10b981' : '#6b7280';
                          return (
                            <Marker
                              key={loc.id}
                              position={[c.lat, c.lng]}
                              icon={L.divIcon({
                                className: 'custom-marker',
                                html: `<div style="
                                  width: 12px;
                                  height: 12px;
                                  border-radius: 50%;
                                  background-color: ${colorHex};
                                  border: 2px solid white;
                                  box-shadow: 0 2px 4px rgba(0,0,0,0.3);
                                "></div>`,
                                iconSize: [12, 12],
                                iconAnchor: [6, 6],
                              })}
                            >
                              <Popup>
                                <div className="text-xs">
                                  <strong>{loc.name}</strong>
                                  <span className="text-gray-500 ml-1">
                                    ({loc.screen_count ?? 0} écran
                                    {(loc.screen_count ?? 0) > 1 ? 's' : ''})
                                  </span>
                                  {inZone && (
                                    <span className="text-green-600 ml-2">✓ dans une zone</span>
                                  )}
                                  {!inZone && <span className="text-gray-500 ml-2">Hors zone</span>}
                                </div>
                              </Popup>
                            </Marker>
                          );
                        })}
                      </MapContainer>
                    </div>
                  )}
                </div>
              </div>

              {/* Résumé des zones sélectionnées */}
              {geographicZones.length > 0 && (
                <div className="px-6 py-4 border-t border-gray-200 bg-green-50/50">
                  <div className="flex items-center justify-between flex-wrap gap-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <CheckCircle className="h-5 w-5 text-green-600 flex-shrink-0" />
                      <span className="text-sm font-medium text-gray-900">
                        {geographicZones.length} zone{geographicZones.length > 1 ? 's' : ''}{' '}
                        sélectionnée{geographicZones.length > 1 ? 's' : ''}
                        {' · '}
                        {geographicZones
                          .reduce((sum, z) => sum + Math.PI * Math.pow(z.radius / 1000, 2), 0)
                          .toFixed(1)}{' '}
                        km²
                      </span>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      {geographicZones.map((z) => (
                        <span
                          key={z.id}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white border border-gray-200 text-sm text-gray-700"
                        >
                          {z.name}
                          <button
                            type="button"
                            onClick={() => handleDeleteZone(z.id)}
                            className="p-0.5 rounded hover:bg-gray-100 text-gray-500 hover:text-red-600"
                            title="Retirer"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Step 4: Contenu média (étape 2 en mode campagne événement) — design maquette */}
          {((currentStep === 5 && !isEventCampaign) || (currentStep === 2 && isEventCampaign)) && (
            <div className="bg-white rounded-2xl shadow-lg overflow-hidden border border-gray-100">
              <div className="p-6 border-b border-gray-200">
                <h2 className="text-xl font-bold text-gray-900">Contenu média</h2>
                <p className="text-gray-500 mt-1">
                  Sélectionnez ou uploadez votre spot publicitaire
                </p>
              </div>

              <div className="p-6 space-y-6">
                {/* Spot publicitaire — sélection existant */}
                <div>
                  <label className="block text-sm font-bold text-gray-900 mb-2">
                    Spot publicitaire
                  </label>
                  <select
                    value={selectedExistingVideo?.id ?? ''}
                    onChange={(e) => handleSelectExistingVideo(e.target.value)}
                    className="w-full px-4 py-3 text-sm border border-gray-300 rounded-xl bg-gray-50 text-gray-700 focus:ring-2 focus:ring-[#00B3A6] focus:border-transparent cursor-pointer"
                  >
                    <option value="">Sélectionner un spot existant</option>
                    {(myApprovedVideos || []).map((video) => (
                      <option key={video.id} value={video.id}>
                        {video.filename}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Zone upload — ou uploadez un nouveau spot */}
                {uploading ? (
                  <div className="border-2 border-dashed border-gray-200 rounded-xl p-8 text-center bg-gray-50/50">
                    <div className="animate-spin rounded-full h-10 w-10 border-2 border-[#00B3A6] border-t-transparent mx-auto mb-3" />
                    <p className="text-sm font-medium text-gray-700">Upload en cours...</p>
                    {uploadProgress && (
                      <div className="max-w-xs mx-auto mt-2">
                        <div className="w-full bg-gray-200 rounded-full h-1.5">
                          <div
                            className="bg-[#00B3A6] h-1.5 rounded-full transition-all"
                            style={{ width: `${uploadProgress.progress}%` }}
                          />
                        </div>
                        <p className="text-xs text-gray-500 mt-1">{uploadProgress.message}</p>
                      </div>
                    )}
                  </div>
                ) : selectedVideo && uploadedVideoUrl && !selectedExistingVideo ? (
                  <div className="space-y-3">
                    <div className="border-2 border-dashed border-gray-200 rounded-xl p-6 bg-green-50/50">
                      <div className="flex items-center justify-between flex-wrap gap-3">
                        <div className="flex items-center gap-3">
                          <CheckCircle className="h-5 w-5 text-green-600 flex-shrink-0" />
                          <div>
                            <p className="font-semibold text-gray-900 text-sm">
                              {selectedVideo.name}
                            </p>
                            <p className="text-xs text-gray-600">
                              {(selectedVideo.size / 1024 / 1024).toFixed(2)} MB · Uploadée avec
                              succès
                            </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedVideo(null);
                            setUploadedVideoUrl('');
                            setUploadedVideoId('');
                          }}
                          className="text-sm text-[#00B3A6] hover:underline font-medium"
                        >
                          Changer
                        </button>
                      </div>
                    </div>
                    <div className="rounded-xl overflow-hidden border border-gray-200 bg-black">
                      <video src={uploadedVideoUrl} controls className="w-full max-h-80" />
                    </div>
                  </div>
                ) : (
                  <label className="block border-2 border-dashed border-gray-300 rounded-xl p-8 text-center hover:border-[#00B3A6]/50 hover:bg-gray-50/50 transition-colors cursor-pointer">
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-12 h-12 rounded-full bg-[#00B3A6]/15 flex items-center justify-center">
                        <Upload className="w-6 h-6 text-[#00B3A6]" />
                      </div>
                      <p className="font-bold text-gray-900">Ou uploadez un nouveau spot</p>
                      <p className="text-sm text-gray-500">
                        Formats acceptés : MP4, MOV (max 100MB)
                      </p>
                      <span className="inline-flex items-center px-4 py-2.5 mt-1 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-xl hover:bg-gray-50">
                        Parcourir les fichiers
                      </span>
                    </div>
                    <input
                      type="file"
                      className="sr-only"
                      accept="video/mp4,video/quicktime,video/x-msvideo,.mp4,.mov"
                      onChange={handleVideoUpload}
                    />
                  </label>
                )}

                {/* Spécifications techniques */}
                <div className="flex gap-3 p-4 rounded-xl bg-slate-50/80 border border-slate-100">
                  <div className="flex-shrink-0 w-6 h-6 rounded-full bg-slate-200 flex items-center justify-center">
                    <Info className="w-3.5 h-3.5 text-slate-600" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-gray-900 mb-2">
                      Spécifications techniques
                    </p>
                    <ul className="text-sm text-gray-600 space-y-1">
                      <li>Format : 16:9 (1920×1080px minimum)</li>
                      <li>Durée : 30 secondes maximum</li>
                      <li>Format vidéo : MP4 (H.264)</li>
                    </ul>
                  </div>
                </div>

                {/* Aperçu si spot existant sélectionné */}
                {selectedExistingVideo && (
                  <div className="rounded-xl overflow-hidden border border-gray-200 bg-black">
                    <video src={selectedExistingVideo.url} controls className="w-full max-h-80" />
                  </div>
                )}
              </div>
            </div>
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

          {/* Navigation Buttons — gated off for standard steps 1 and 2
              because Step1NameType and Step2 render their own Suivant.
              Event step 1/2 still uses this footer (those paths aren't
              extracted yet). */}
          {!showPostCartStep && (isEventCampaign || currentStep > 2) && (
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

              {(isEventCampaign ? currentStep < 3 : currentStep < 6) && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    // Step 3 (Période) still surfaces field-level UX via
                    // validateStep2 (the date validator); it mutates
                    // dateTouched/dateErrors as a side effect. Step 2 owns
                    // its own validation now (extracted in Commit 7); this
                    // footer never fires for currentStep === 2 anyway (gated
                    // above on currentStep > 2 for standard).
                    if (!isEventCampaign && currentStep === 3) {
                      if (!validateStep2()) return;
                    }
                    wiz.nextStep();
                  }}
                  disabled={!wiz.canGoToStep(currentStep + 1)}
                  className={`px-6 py-3 rounded-xl font-semibold transition-all flex items-center space-x-2 shadow-lg ${
                    !wiz.canGoToStep(currentStep + 1)
                      ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                      : 'bg-gradient-to-r from-[#00B3A6] to-[#00D4C4] text-white hover:from-[#00A396] hover:to-[#00C4B4]'
                  }`}
                >
                  <span>Suivant</span>
                  <ArrowRight className="h-4 w-4" />
                </button>
              )}
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

      {/* Modal Zone Géographique (Full Screen) */}
      {showZoneModal && (
        <div className="fixed inset-0 z-50 bg-white flex flex-col">
          {/* Header */}
          <div className="bg-gradient-to-r from-[#00263A] to-[#004466] px-6 py-4 flex items-center justify-between shadow-lg">
            <div className="flex items-center space-x-3">
              <MapPin className="h-6 w-6 text-white" />
              <h2 className="text-xl font-bold text-white">
                {editingZone ? 'Modifier la zone' : 'Ajouter une nouvelle zone'}
              </h2>
            </div>
            <button
              onClick={() => setShowZoneModal(false)}
              className="p-2 hover:bg-white/10 rounded-lg transition-colors"
            >
              <X className="h-6 w-6 text-white" />
            </button>
          </div>

          {/* Content - Layout 2 colonnes */}
          <div className="flex-1 overflow-hidden flex">
            {/* Colonne gauche - Contrôles */}
            <div className="w-96 bg-gray-50 border-r border-gray-200 overflow-y-auto p-6 space-y-4">
              {/* Barre de recherche */}
              <div className="bg-white rounded-xl p-4 shadow-lg border border-gray-200">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Rechercher une zone
                </label>
                <div className="relative">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Ville tunisienne..."
                      className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#00B3A6] focus:border-transparent transition-all"
                      value={tempZoneSearchQuery}
                      onChange={(e) => setTempZoneSearchQuery(e.target.value)}
                      onKeyPress={(e) => {
                        if (
                          e.key === 'Enter' &&
                          getCitySuggestions(tempZoneSearchQuery).length > 0
                        ) {
                          const city = getCitySuggestions(tempZoneSearchQuery)[0];
                          setTempZoneSearchQuery(city.name);
                          setTempZoneLocation({ lat: city.lat, lng: city.lng });
                        }
                      }}
                    />
                    <button
                      onClick={() => {
                        const suggestions = getCitySuggestions(tempZoneSearchQuery);
                        if (suggestions.length > 0) {
                          const city = suggestions[0];
                          setTempZoneSearchQuery(city.name);
                          setTempZoneLocation({ lat: city.lat, lng: city.lng });
                        }
                      }}
                      className="px-3 py-2 bg-gradient-to-r from-[#00263A] to-[#004466] text-white rounded-lg hover:shadow-lg transition-all"
                    >
                      <Search className="h-4 w-4" />
                    </button>
                  </div>

                  {/* Suggestions de villes */}
                  {tempZoneSearchQuery && getCitySuggestions(tempZoneSearchQuery).length > 0 && (
                    <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-300 rounded-lg shadow-lg z-10 max-h-60 overflow-y-auto">
                      {getCitySuggestions(tempZoneSearchQuery).map((city, index) => (
                        <button
                          key={index}
                          onClick={() => {
                            setTempZoneSearchQuery(city.name);
                            setTempZoneLocation({ lat: city.lat, lng: city.lng });
                          }}
                          className="w-full px-3 py-2 text-left hover:bg-gray-50 first:rounded-t-lg last:rounded-b-lg"
                        >
                          <div className="flex items-center space-x-2">
                            <MapPin className="h-4 w-4 text-gray-400" />
                            <span className="text-sm text-gray-700">{city.name}</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Curseur de rayon */}
              <div className="bg-white rounded-xl p-4 shadow-lg border border-gray-200">
                <label className="block text-sm font-medium text-gray-700 mb-3">
                  Rayon de diffusion
                </label>
                <div className="text-center mb-3">
                  <span className="text-2xl font-bold text-[#00B3A6]">{tempZoneRadius / 1000}</span>
                  <span className="text-sm text-gray-500 ml-1">km</span>
                </div>
                <input
                  type="range"
                  min="500"
                  max="50000"
                  step="500"
                  value={tempZoneRadius}
                  onChange={(e) => setTempZoneRadius(Number(e.target.value))}
                  className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer slider"
                />
                <div className="flex justify-between text-xs text-gray-500 mt-1">
                  <span>0.5 km</span>
                  <span>50 km</span>
                </div>
              </div>

              {/* Localités dans la zone */}
              <div className="bg-white rounded-xl p-4 shadow-lg border border-gray-200 flex-1 hidden">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Localités: {tempZoneLocations.length}
                </label>
                {tempZoneLocations.length > 0 ? (
                  <div className="space-y-2">
                    <div className="p-2 bg-green-50 border border-green-200 rounded-lg">
                      <p className="text-xs font-semibold text-green-700">
                        ✓ {tempZoneLocations.length} localité
                        {tempZoneLocations.length > 1 ? 's' : ''} (
                        {tempZoneLocations.reduce((s, l) => s + (l.screen_count || 0), 0)} écran
                        {tempZoneLocations.reduce((s, l) => s + (l.screen_count || 0), 0) !== 1
                          ? 's'
                          : ''}
                        )
                      </p>
                    </div>
                    <div className="max-h-96 overflow-y-auto space-y-2 bg-gray-50 border border-gray-200 rounded-lg p-2">
                      {tempZoneLocations.map((loc) => (
                        <div
                          key={loc.id}
                          className="p-2 bg-white rounded-lg hover:bg-gray-50 transition-colors shadow-sm"
                        >
                          <p className="text-xs font-medium text-gray-900 truncate">{loc.name}</p>
                          {loc.address && (
                            <p className="text-xs text-gray-500 truncate">{loc.address}</p>
                          )}
                          <p className="text-xs text-blue-600 mt-1">
                            📺 {loc.screen_count ?? 0} écran{(loc.screen_count ?? 0) > 1 ? 's' : ''}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                    <p className="text-xs text-yellow-700">
                      ⚠️ Aucune localité dans cette zone. Ajustez le rayon.
                    </p>
                    {getUsedLocationIds().length > 0 && (
                      <p className="text-xs text-yellow-600 mt-1">
                        {getUsedLocationIds().length} localité
                        {getUsedLocationIds().length > 1 ? 's' : ''} déjà utilisée
                        {getUsedLocationIds().length > 1 ? 's' : ''} ailleurs.
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Zones prédéfinies */}
              <div className="bg-white rounded-xl p-4 shadow-lg border border-gray-200">
                <label className="block text-sm font-medium text-gray-700 mb-3">
                  Zones prédéfinies
                </label>
                {loadingPredefinedZones ? (
                  <div className="text-center py-4">
                    <p className="text-sm text-gray-500">Chargement...</p>
                  </div>
                ) : predefinedZones.length > 0 ? (
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {predefinedZones.map((zone) => (
                      <button
                        key={zone.id}
                        onClick={() => handleApplyPredefinedZone(zone)}
                        className="w-full p-3 text-left bg-gradient-to-r from-[#00B3A6]/5 to-[#00D4C4]/5 rounded-lg border border-[#00B3A6]/20 hover:border-[#00B3A6] hover:shadow-md transition-all group"
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <p className="text-sm font-semibold text-gray-900 group-hover:text-[#00B3A6] transition-colors">
                              {zone.name}
                            </p>
                            {zone.description && (
                              <p className="text-xs text-gray-500 mt-1">{zone.description}</p>
                            )}
                            <div className="flex items-center space-x-3 mt-2 text-xs text-gray-600">
                              <span className="flex items-center">
                                <MapPin className="h-3 w-3 mr-1" />
                                {zone.radius / 1000} km
                              </span>
                            </div>
                          </div>
                          <div className="ml-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <ArrowRight className="h-4 w-4 text-[#00B3A6]" />
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-4">
                    <p className="text-sm text-gray-500">Aucune zone prédéfinie disponible</p>
                  </div>
                )}
              </div>
            </div>

            {/* Colonne droite - Carte (plus grande) */}
            <div className="flex-1 bg-white p-6">
              <div className="h-full rounded-xl overflow-hidden shadow-lg border border-gray-200">
                <MapContainer
                  center={[
                    tempZoneLocation?.lat ?? center.lat,
                    tempZoneLocation?.lng ?? center.lng,
                  ]}
                  zoom={13}
                  style={{ height: '100%', width: '100%' }}
                  className="rounded-lg"
                >
                  <TileLayer
                    url="https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png"
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
                    subdomains="abcd"
                    maxZoom={14}
                  />
                  <TileLayer
                    url="https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png"
                    attribution=""
                    opacity={0.5}
                    maxZoom={12}
                    minZoom={8}
                  />
                  <MapEvents onLocationSelect={(lat, lng) => setTempZoneLocation({ lat, lng })} />
                  {/* Cercles des zones déjà sélectionnées (grisées) */}
                  {geographicZones
                    .filter(
                      (zone) =>
                        (!editingZone || zone.id !== editingZone.id) &&
                        zone.location?.lat != null &&
                        zone.location?.lng != null,
                    )
                    .map((zone) => (
                      <Circle
                        key={zone.id}
                        center={[zone.location!.lat, zone.location!.lng]}
                        radius={zone.radius}
                        pathOptions={{
                          fillColor: '#9CA3AF',
                          fillOpacity: 0.15,
                          color: '#6B7280',
                          weight: 2,
                          dashArray: '5, 5',
                        }}
                      />
                    ))}
                  {/* Cercle de zone en cours de sélection */}
                  <Circle
                    center={[
                      tempZoneLocation?.lat ?? center.lat,
                      tempZoneLocation?.lng ?? center.lng,
                    ]}
                    radius={tempZoneRadius ?? 1000}
                    pathOptions={{
                      fillColor: '#00B3A6',
                      fillOpacity: 0.2,
                      color: '#00B3A6',
                      weight: 2,
                    }}
                  />
                  {/* Marqueur du centre (simple, sans popup) */}
                  <Marker
                    position={[
                      tempZoneLocation?.lat ?? center.lat,
                      tempZoneLocation?.lng ?? center.lng,
                    ]}
                    icon={L.icon({
                      iconUrl:
                        'https://cdn.jsdelivr.net/gh/pointhi/leaflet-color-markers@master/img/marker-icon-2x-violet.png',
                      iconSize: [20, 32],
                      iconAnchor: [10, 32],
                    })}
                  />
                  {/* Marqueurs : toutes les localités (vert = dans le cercle, rouge = déjà dans une autre zone, gris = hors cercle) */}
                  {(allMapLocations || []).map((loc) => {
                    const c = loc?.coordinates;
                    if (
                      !c ||
                      typeof c.lat !== 'number' ||
                      typeof c.lng !== 'number' ||
                      Number.isNaN(c.lat) ||
                      Number.isNaN(c.lng)
                    )
                      return null;
                    const radiusKm = (tempZoneRadius || 0) / 1000;
                    const inCircle =
                      tempZoneLocation &&
                      radiusKm > 0 &&
                      distanceKm(tempZoneLocation.lat, tempZoneLocation.lng, c.lat, c.lng) <=
                        radiusKm;
                    const usedElsewhere = getUsedLocationIds(editingZone?.id).includes(loc.id);
                    const iconColor = inCircle ? (usedElsewhere ? 'red' : 'green') : 'gray';
                    const colorHex =
                      iconColor === 'green'
                        ? '#10b981'
                        : iconColor === 'red'
                          ? '#ef4444'
                          : '#6b7280';
                    return (
                      <Marker
                        key={loc.id}
                        position={[c.lat, c.lng]}
                        icon={L.divIcon({
                          className: 'custom-marker',
                          html: `<div style="
                            width: 12px;
                            height: 12px;
                            border-radius: 50%;
                            background-color: ${colorHex};
                            border: 2px solid white;
                            box-shadow: 0 2px 4px rgba(0,0,0,0.3);
                          "></div>`,
                          iconSize: [12, 12],
                          iconAnchor: [6, 6],
                        })}
                      >
                        <Popup>
                          <div className="text-xs">
                            <strong>{loc.name}</strong>
                            <span className="text-gray-500 ml-1">
                              ({loc.screen_count ?? 0} écran{(loc.screen_count ?? 0) > 1 ? 's' : ''}
                              )
                            </span>
                            {inCircle && !usedElsewhere && (
                              <span className="text-green-600 ml-2">✓ dans la zone</span>
                            )}
                            {inCircle && usedElsewhere && (
                              <span className="text-red-600 ml-2">✗ déjà dans une autre zone</span>
                            )}
                            {!inCircle && <span className="text-gray-500 ml-2">Hors zone</span>}
                          </div>
                        </Popup>
                      </Marker>
                    );
                  })}
                </MapContainer>
              </div>
            </div>
          </div>

          {/* Footer avec boutons d'action */}
          <div className="bg-white border-t border-gray-200 px-6 py-4 flex justify-between items-center shadow-lg">
            <button
              onClick={() => setShowZoneModal(false)}
              className="px-6 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-100 transition-colors font-medium"
            >
              Annuler
            </button>
            <button
              onClick={handleSaveZone}
              disabled={tempZoneLocations.length === 0}
              className={`px-6 py-3 rounded-lg font-medium transition-all ${
                tempZoneLocations.length === 0
                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  : 'bg-gradient-to-r from-[#00B3A6] to-[#00D4C4] text-white hover:shadow-lg'
              }`}
            >
              {editingZone ? 'Enregistrer les modifications' : 'Ajouter la zone'}
            </button>
          </div>
        </div>
      )}

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
