import { supabase } from '../../../lib/supabase';
import type {
  PerformanceDataset,
  PerformanceFilters,
  PerformanceKpis,
  PerformanceTrendPoint,
  PerformanceTopCampaign,
  PerformanceZonePoint,
  PerformanceDetailedMetrics,
} from '../types/performance';

type CampaignRow = {
  id: string;
  name: string | null;
  start_date: string | null;
  end_date: string | null;
  budget: number | string | null;
  views: number | null;
  status: string | null;
  category: string | null;
  event_id: string | null;
  location_lat: number | null;
  location_lng: number | null;
  location_radius: number | null;
  publication_schedule: { hours_per_day?: number } | null;
};

type CampaignScreenRow = {
  campaign_id: string;
  screen_id: string;
  impressions_per_hour: number | null;
};

type ScreenRow = {
  id: string;
  status: string | null;
};

type CampaignLocationRow = {
  campaign_id: string;
  location_id: string;
};

type LocationRow = {
  id: string;
  name: string | null;
  address: string | null;
};

type PredefinedZoneRow = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radius: number;
  is_active: boolean;
};

type OwnerBusinessSectorRow = {
  name: string;
  display_order: number | null;
};

const DEFAULT_HOURS_PER_DAY = 15;
const safeNumber = (value: unknown): number => {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
};
const safeRound = (value: number) => Math.round(safeNumber(value));
const normalizeHoursPerDay = (raw: unknown): number => {
  const value = safeNumber(raw);
  if (value <= 0) return DEFAULT_HOURS_PER_DAY;
  if (value <= 24) return value;
  // Certains anciens payloads peuvent stocker des secondes/jour.
  if (value <= 86400) return Math.max(1, Math.min(24, value / 3600));
  return 24;
};
const EARTH_RADIUS_METERS = 6371000;
const toRadians = (deg: number) => (deg * Math.PI) / 180;
const haversineMeters = (lat1: number, lng1: number, lat2: number, lng2: number) => {
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(a));
};
const circlesOverlap = (
  lat1: number,
  lng1: number,
  radius1: number,
  lat2: number,
  lng2: number,
  radius2: number,
) => haversineMeters(lat1, lng1, lat2, lng2) <= radius1 + radius2;
const statusLabel = (status?: string | null) => {
  const key = (status || '').toLowerCase();
  if (key === 'active') return 'Active';
  if (key === 'completed') return 'Passée';
  if (key === 'paused') return 'En pause';
  if (key === 'pending') return 'En attente';
  if (key === 'draft') return 'Brouillon';
  return 'Campagne';
};

const normalizeDate = (iso: string) => {
  // Supabase peut renvoyer date seule (YYYY-MM-DD) ou timestamp ISO.
  if (!iso) return new Date('1970-01-01T00:00:00');
  const raw = String(iso).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return new Date(`${raw}T00:00:00`);
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    const dateOnly = raw.slice(0, 10);
    return new Date(`${dateOnly}T00:00:00`);
  }
  return parsed;
};
const addDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const getDaysInclusive = (start: Date, end: Date) =>
  Math.max(1, Math.floor((end.getTime() - start.getTime()) / 86400000) + 1);

const clampRange = (campaignStart: Date, campaignEnd: Date, filterStart: Date, filterEnd: Date) => {
  const start = campaignStart > filterStart ? campaignStart : filterStart;
  const end = campaignEnd < filterEnd ? campaignEnd : filterEnd;
  if (start > end) return null;
  return { start, end, days: getDaysInclusive(start, end) };
};

const formatTrendLabel = (date: Date) =>
  `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}`;

const categoryLabel = (category?: string | null) => {
  if (!category) return 'Autre';
  const key = category.toLowerCase();
  const reverse: Record<string, string> = {
    commercial: 'Publicité commerciale',
    cultural: 'Événement culturel',
    promotional: 'Promotion spéciale',
    institutional: 'Annonce institutionnelle',
    parc: 'Parc TV',
  };
  return reverse[key] || category;
};

const toBudget = (value: number | string | null | undefined) => {
  if (typeof value === 'number') return safeNumber(value);
  if (typeof value === 'string') return safeNumber(parseFloat(value));
  return 0;
};

const getDateRangeFromPreset = (
  preset: PerformanceFilters['preset'],
  customStart?: string,
  customEnd?: string,
) => {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (preset === 'custom' && customStart && customEnd) {
    return { start: normalizeDate(customStart), end: normalizeDate(customEnd) };
  }

  if (preset === 'year') {
    const start = new Date(today.getFullYear(), 0, 1);
    return { start, end: today };
  }

  if (preset === 'quarter') {
    const quarterStartMonth = Math.floor(today.getMonth() / 3) * 3;
    const start = new Date(today.getFullYear(), quarterStartMonth, 1);
    return { start, end: today };
  }

  const start = new Date(today.getFullYear(), today.getMonth(), 1);
  return { start, end: today };
};

const computeKpis = (
  campaigns: CampaignRow[],
  campaignScreensByCampaign: Map<string, CampaignScreenRow[]>,
  activeScreenIdsByCampaign: Map<string, Set<string>>,
  rangeStart: Date,
  rangeEnd: Date,
): PerformanceKpis => {
  let diffusionSeconds = 0;
  let impressions = 0;
  let affluence = 0;
  let spend = 0;
  const activeScreens = new Set<string>();

  for (const campaign of campaigns) {
    if (!campaign.start_date || !campaign.end_date) continue;
    const start = normalizeDate(campaign.start_date);
    const end = normalizeDate(campaign.end_date);
    const overlap = clampRange(start, end, rangeStart, rangeEnd);
    if (!overlap) continue;

    const campaignDays = getDaysInclusive(start, end);
    const overlapRatio = safeNumber(overlap.days / campaignDays);
    const totalViews = safeNumber(campaign.views || 0);
    const hoursPerDay = normalizeHoursPerDay(campaign.publication_schedule?.hours_per_day);

    impressions += safeNumber(totalViews * overlapRatio);
    const scheduleSeconds = safeNumber(overlap.days * hoursPerDay * 3600);
    const viewsBasedSeconds = safeNumber(totalViews * overlapRatio * 30);
    // Garde-fou: la durée ne doit pas dépasser la diffusion déduite des vues.
    const campaignDiffusionSeconds =
      viewsBasedSeconds > 0 ? Math.min(scheduleSeconds, viewsBasedSeconds) : scheduleSeconds;
    diffusionSeconds += campaignDiffusionSeconds;
    spend += safeNumber(toBudget(campaign.budget) * overlapRatio);

    const screenRows = campaignScreensByCampaign.get(campaign.id) || [];
    const overlapHours = safeNumber(overlap.days * hoursPerDay);
    for (const screen of screenRows) {
      affluence += safeNumber((screen.impressions_per_hour || 0) * overlapHours);
    }

    const activeForCampaign = activeScreenIdsByCampaign.get(campaign.id);
    if (activeForCampaign) {
      for (const screenId of activeForCampaign) activeScreens.add(screenId);
    }
  }

  return {
    diffusionSeconds: safeRound(diffusionSeconds),
    impressions: safeRound(impressions),
    affluence: safeRound(affluence),
    activeScreens: activeScreens.size,
    spend: safeNumber(Math.round(safeNumber(spend) * 100) / 100),
  };
};

const computeTrend = (
  campaigns: CampaignRow[],
  rangeStart: Date,
  rangeEnd: Date,
  previousStart: Date,
): PerformanceTrendPoint[] => {
  const points: PerformanceTrendPoint[] = [];
  const pointCount = getDaysInclusive(rangeStart, rangeEnd);

  for (let i = 0; i < pointCount; i++) {
    const currentDay = addDays(rangeStart, i);
    const previousDay = addDays(previousStart, i);

    let currentValue = 0;
    let previousValue = 0;

    for (const campaign of campaigns) {
      if (!campaign.start_date || !campaign.end_date) continue;
      const cStart = normalizeDate(campaign.start_date);
      const cEnd = normalizeDate(campaign.end_date);
      const totalViews = safeNumber(campaign.views || 0);
      const days = getDaysInclusive(cStart, cEnd);
      const viewsPerDay = safeNumber(totalViews / days);

      if (currentDay >= cStart && currentDay <= cEnd) currentValue += viewsPerDay;
      if (previousDay >= cStart && previousDay <= cEnd) previousValue += viewsPerDay;
    }

    points.push({
      label: formatTrendLabel(currentDay),
      current: safeRound(currentValue),
      previous: safeRound(previousValue),
    });
  }

  return points;
};

export const performanceService = {
  buildDefaultFilters(): PerformanceFilters {
    const { start, end } = getDateRangeFromPreset('month');
    return {
      preset: 'month',
      startDate: start.toISOString().split('T')[0],
      endDate: end.toISOString().split('T')[0],
      campaignId: '',
      locationId: '',
      campaignType: '',
      category: '',
      zoneId: '',
    };
  },

  async getDataset(
    filters: PerformanceFilters,
    options?: { campaignIds?: string[] },
  ): Promise<PerformanceDataset> {
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) {
      throw new Error('Utilisateur non connecté');
    }

    // Certains environnements peuvent ne pas avoir encore les colonnes geo.
    // On fallback automatiquement pour ne pas bloquer toute la page performances.
    let allCampaigns: CampaignRow[] = [];
    {
      const scopedCampaignIds = options?.campaignIds;
      let withGeoQuery = supabase
        .from('campaigns')
        .select(
          'id, name, start_date, end_date, budget, views, status, category, event_id, location_lat, location_lng, location_radius, publication_schedule',
        )
        .order('created_at', { ascending: false });

      if (Array.isArray(scopedCampaignIds)) {
        if (scopedCampaignIds.length === 0) {
          allCampaigns = [];
        } else {
          withGeoQuery = withGeoQuery.in('id', scopedCampaignIds);
        }
      } else {
        withGeoQuery = withGeoQuery.eq('user_id', authData.user.id);
      }

      const { data: campaignsWithGeo, error: withGeoError } =
        Array.isArray(scopedCampaignIds) && scopedCampaignIds.length === 0
          // TODO(phase-1): typed source [supabase] — see #15
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ? { data: [], error: null as any }
          : await withGeoQuery;

      if (!withGeoError) {
        allCampaigns = (campaignsWithGeo || []) as CampaignRow[];
      } else {
        let baseQuery = supabase
          .from('campaigns')
          .select(
            'id, name, start_date, end_date, budget, views, status, category, event_id, publication_schedule',
          )
          .order('created_at', { ascending: false });
        if (Array.isArray(scopedCampaignIds)) {
          if (scopedCampaignIds.length === 0) {
            allCampaigns = [];
            return {
              filters,
              options: {
                campaigns: [],
                locations: [],
                campaignTypes: [],
                categories: [],
                zones: [],
              },
              kpis: {
                diffusionSeconds: 0,
                impressions: 0,
                affluence: 0,
                activeScreens: 0,
                spend: 0,
              },
              previousKpis: {
                diffusionSeconds: 0,
                impressions: 0,
                affluence: 0,
                activeScreens: 0,
                spend: 0,
              },
              trend: [],
              categoryPerformance: [],
              topCampaigns: [],
              zonePerformance: [],
              detailedMetrics: {
                averageDurationDays: 0,
                placesTouched: 0,
                totalBudget: 0,
                completionRate: 0,
              },
            };
          }
          baseQuery = baseQuery.in('id', scopedCampaignIds);
        } else {
          baseQuery = baseQuery.eq('user_id', authData.user.id);
        }
        const { data: campaignsBase, error: baseError } = await baseQuery;
        if (baseError) throw baseError;
        allCampaigns = (
          (campaignsBase || []) as Array<
            Omit<CampaignRow, 'location_lat' | 'location_lng' | 'location_radius'>
          >
        ).map((row) => ({
          ...row,
          location_lat: null,
          location_lng: null,
          location_radius: null,
        }));
      }
    }
    const campaignIds = allCampaigns.map((c) => c.id);

    let campaignScreens: CampaignScreenRow[] = [];
    const activeScreenIdsByCampaign = new Map<string, Set<string>>();
    let campaignLocations: CampaignLocationRow[] = [];
    let locations: LocationRow[] = [];
    let ownerBusinessSectors: OwnerBusinessSectorRow[] = [];
    let predefinedZones: PredefinedZoneRow[] = [];

    if (campaignIds.length > 0) {
      const [{ data: csData }, { data: clData }] = await Promise.all([
        supabase
          .from('campaign_screens')
          .select('campaign_id, screen_id, impressions_per_hour')
          .in('campaign_id', campaignIds),
        supabase
          .from('campaign_locations')
          .select('campaign_id, location_id')
          .in('campaign_id', campaignIds),
      ]);

      campaignScreens = (csData || []) as CampaignScreenRow[];
      campaignLocations = (clData || []) as CampaignLocationRow[];

      const screenIds = Array.from(new Set(campaignScreens.map((s) => s.screen_id)));
      if (screenIds.length > 0) {
        const { data: screensData } = await supabase
          .from('screens')
          .select('id, status')
          .in('id', screenIds);

        const activeScreenIds = new Set(
          ((screensData || []) as ScreenRow[])
            .filter((s) => s.status === 'active')
            .map((s) => s.id),
        );

        for (const row of campaignScreens) {
          if (!activeScreenIds.has(row.screen_id)) continue;
          const set = activeScreenIdsByCampaign.get(row.campaign_id) || new Set<string>();
          set.add(row.screen_id);
          activeScreenIdsByCampaign.set(row.campaign_id, set);
        }
      }

      const locationIds = Array.from(new Set(campaignLocations.map((c) => c.location_id)));
      if (locationIds.length > 0) {
        const { data: locData } = await supabase
          .from('locations')
          .select('id, name, address')
          .in('id', locationIds);
        locations = (locData || []) as LocationRow[];
      }
    }

    const { data: ownerSectorsData } = await supabase
      .from('owner_business_sectors')
      .select('name, display_order')
      .order('display_order', { ascending: true });
    ownerBusinessSectors = (ownerSectorsData || []) as OwnerBusinessSectorRow[];
    const ownerCategoryNames = ownerBusinessSectors
      .map((row) => row.name)
      .filter((name): name is string => Boolean(name && name.trim()));

    const { data: predefinedZonesData } = await supabase
      .from('predefined_zones')
      .select('id, name, latitude, longitude, radius, is_active')
      .eq('is_active', true)
      .order('name', { ascending: true });
    predefinedZones = (predefinedZonesData || []) as PredefinedZoneRow[];
    const predefinedZoneById = new Map(predefinedZones.map((zone) => [zone.id, zone]));

    const campaignLocationIds = new Map<string, string[]>();
    for (const row of campaignLocations) {
      const list = campaignLocationIds.get(row.campaign_id) || [];
      list.push(row.location_id);
      campaignLocationIds.set(row.campaign_id, list);
    }

    const { start, end } = getDateRangeFromPreset(
      filters.preset,
      filters.startDate,
      filters.endDate,
    );
    const rangeDays = getDaysInclusive(start, end);
    const previousEnd = addDays(start, -1);
    const previousStart = addDays(previousEnd, -(rangeDays - 1));

    const filteredCampaigns = allCampaigns.filter((campaign) => {
      if (!campaign.start_date || !campaign.end_date) return false;
      if (filters.campaignId && campaign.id !== filters.campaignId) return false;
      if (filters.campaignType === 'event' && !campaign.event_id) return false;
      if (filters.campaignType === 'standard' && campaign.event_id) return false;
      if (
        filters.category &&
        campaign.category !== filters.category &&
        categoryLabel(campaign.category) !== filters.category
      )
        return false;
      if (filters.locationId) {
        const linkedLocationIds = campaignLocationIds.get(campaign.id) || [];
        if (!linkedLocationIds.includes(filters.locationId)) return false;
      }
      if (filters.zoneId) {
        const selectedZone = predefinedZoneById.get(filters.zoneId);
        if (!selectedZone) return false;
        const lat = safeNumber(campaign.location_lat);
        const lng = safeNumber(campaign.location_lng);
        const radius = safeNumber(campaign.location_radius);
        if (lat === 0 || lng === 0 || radius <= 0) return false;
        const overlap = circlesOverlap(
          lat,
          lng,
          radius,
          safeNumber(selectedZone.latitude),
          safeNumber(selectedZone.longitude),
          safeNumber(selectedZone.radius),
        );
        if (!overlap) return false;
      }
      const overlap = clampRange(
        normalizeDate(campaign.start_date),
        normalizeDate(campaign.end_date),
        start,
        end,
      );
      return Boolean(overlap);
    });

    const campaignScreensByCampaign = new Map<string, CampaignScreenRow[]>();
    for (const row of campaignScreens) {
      const list = campaignScreensByCampaign.get(row.campaign_id) || [];
      list.push(row);
      campaignScreensByCampaign.set(row.campaign_id, list);
    }

    const kpis = computeKpis(
      filteredCampaigns,
      campaignScreensByCampaign,
      activeScreenIdsByCampaign,
      start,
      end,
    );

    const previousKpis = computeKpis(
      filteredCampaigns,
      campaignScreensByCampaign,
      activeScreenIdsByCampaign,
      previousStart,
      previousEnd,
    );

    const trend = computeTrend(filteredCampaigns, start, end, previousStart);

    const categoryMap = new Map<string, number>();
    for (const campaign of filteredCampaigns) {
      const key = categoryLabel(campaign.category);
      categoryMap.set(
        key,
        safeNumber((categoryMap.get(key) || 0) + safeNumber(campaign.views || 0)),
      );
    }
    const categoryPerformance = Array.from(categoryMap.entries())
      .map(([category, impressions]) => ({ category, impressions: safeRound(impressions) }))
      .sort((a, b) => b.impressions - a.impressions)
      .slice(0, 6);

    const topCampaigns: PerformanceTopCampaign[] = filteredCampaigns
      .map((campaign) => {
        const cStart = normalizeDate(campaign.start_date || '');
        const cEnd = normalizeDate(campaign.end_date || '');
        const overlap = clampRange(cStart, cEnd, start, end);
        const campaignDays = getDaysInclusive(cStart, cEnd);
        const ratio = overlap ? safeNumber(overlap.days / campaignDays) : 0;
        const impressions = safeRound(safeNumber(campaign.views || 0) * ratio);
        const budget = safeNumber(toBudget(campaign.budget) * ratio);
        const roi = budget > 0 ? safeNumber(impressions / budget) : 0;
        return {
          id: campaign.id,
          name: campaign.name || 'Campagne sans nom',
          status: statusLabel(campaign.status),
          impressions,
          roi,
        };
      })
      .sort((a, b) => b.roi - a.roi)
      .slice(0, 4);

    const zoneAgg = new Map<
      string,
      { zoneName: string; impressions: number; screens: Set<string> }
    >();
    for (const zone of predefinedZones) {
      zoneAgg.set(zone.id, { zoneName: zone.name, impressions: 0, screens: new Set<string>() });
    }
    for (const campaign of filteredCampaigns) {
      const lat = safeNumber(campaign.location_lat);
      const lng = safeNumber(campaign.location_lng);
      const radius = safeNumber(campaign.location_radius);
      if (lat === 0 || lng === 0 || radius <= 0) continue;
      const overlaps = predefinedZones.filter((zone) =>
        circlesOverlap(
          lat,
          lng,
          radius,
          safeNumber(zone.latitude),
          safeNumber(zone.longitude),
          safeNumber(zone.radius),
        ),
      );
      if (overlaps.length === 0) continue;
      const cStart = normalizeDate(campaign.start_date || '');
      const cEnd = normalizeDate(campaign.end_date || '');
      const overlap = clampRange(cStart, cEnd, start, end);
      if (!overlap) continue;
      const campaignDays = getDaysInclusive(cStart, cEnd);
      const ratio = safeNumber(overlap.days / campaignDays);
      const splitImpressions = safeNumber((campaign.views || 0) * ratio) / overlaps.length;
      const screenIds = (campaignScreensByCampaign.get(campaign.id) || []).map(
        (row) => row.screen_id,
      );
      for (const zone of overlaps) {
        const agg = zoneAgg.get(zone.id);
        if (!agg) continue;
        agg.impressions += splitImpressions;
        screenIds.forEach((id) => agg.screens.add(id));
      }
    }
    const totalZoneImpressions = Array.from(zoneAgg.values()).reduce(
      (sum, item) => sum + item.impressions,
      0,
    );
    const zonePerformance: PerformanceZonePoint[] = Array.from(zoneAgg.entries())
      .map(([zoneId, agg]) => ({
        zoneId,
        zoneName: agg.zoneName,
        impressions: safeRound(agg.impressions),
        screensCount: agg.screens.size,
        sharePercent:
          totalZoneImpressions > 0 ? safeNumber((agg.impressions / totalZoneImpressions) * 100) : 0,
      }))
      .filter((item) => item.impressions > 0)
      .sort((a, b) => b.impressions - a.impressions)
      .slice(0, 4);

    const placesTouched = new Set<string>();
    filteredCampaigns.forEach((campaign) => {
      (campaignLocationIds.get(campaign.id) || []).forEach((id) => placesTouched.add(id));
    });
    const completedCount = filteredCampaigns.filter(
      (c) => (c.status || '').toLowerCase() === 'completed',
    ).length;
    const detailedMetrics: PerformanceDetailedMetrics = {
      averageDurationDays:
        filteredCampaigns.length > 0
          ? safeRound(
              filteredCampaigns.reduce((sum, campaign) => {
                if (!campaign.start_date || !campaign.end_date) return sum;
                return (
                  sum +
                  getDaysInclusive(
                    normalizeDate(campaign.start_date),
                    normalizeDate(campaign.end_date),
                  )
                );
              }, 0) / filteredCampaigns.length,
            )
          : 0,
      placesTouched: placesTouched.size,
      totalBudget: safeNumber(kpis.spend),
      completionRate:
        filteredCampaigns.length > 0
          ? safeNumber((completedCount / filteredCampaigns.length) * 100)
          : 0,
    };

    const campaignOptions = allCampaigns.map((c) => ({
      value: c.id,
      label: c.name || 'Campagne sans nom',
    }));
    const locationById = new Map<string, LocationRow>(locations.map((loc) => [loc.id, loc]));
    const locationOptions = Array.from(new Set(campaignLocations.map((cl) => cl.location_id)))
      .map((id) => {
        const loc = locationById.get(id);
        return {
          value: id,
          label: loc?.name || loc?.address || 'Établissement',
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
    const categoryOptions = ownerCategoryNames.map((name) => ({ value: name, label: name }));
    if (filters.category && !categoryOptions.some((option) => option.value === filters.category)) {
      categoryOptions.push({ value: filters.category, label: filters.category });
    }
    const zoneOptions = predefinedZones.map((zone) => ({
      value: zone.id,
      label: zone.name,
    }));

    return {
      filters: {
        ...filters,
        startDate: start.toISOString().split('T')[0],
        endDate: end.toISOString().split('T')[0],
      },
      options: {
        campaigns: campaignOptions,
        locations: locationOptions,
        campaignTypes: [
          { value: 'standard', label: 'Standard' },
          { value: 'event', label: 'Événementielle' },
        ],
        categories: categoryOptions,
        zones: zoneOptions,
      },
      kpis,
      previousKpis,
      trend,
      categoryPerformance,
      topCampaigns,
      zonePerformance,
      detailedMetrics,
    };
  },
};
