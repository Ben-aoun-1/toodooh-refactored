import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  ArrowDown,
  ArrowUp,
  Calendar,
  Clock3,
  Eye,
  MapPin,
  Monitor,
  Users,
  Wallet,
} from 'lucide-react';
import OwnerNavigation from '../components/OwnerNavigation';
import OwnerNotificationsBell from '../components/OwnerNotificationsBell';
import { useAuthStore } from '../stores/auth.store';
import { supabase } from '../lib/supabase';
import { performanceService } from '../services/performance.service';
import type {
  PerformanceCategoryPoint,
  PerformanceDataset,
  PerformanceFilters,
  PerformanceKpis,
  PerformancePeriodPreset,
  PerformanceTrendPoint,
} from '../types/performance';
import performanceIntroIcon from '../assets/performance/1.png';

const presetButtons: { key: PerformancePeriodPreset; label: string }[] = [
  { key: 'month', label: 'Ce mois' },
  { key: 'quarter', label: 'Trimestre' },
  { key: 'year', label: 'Année' },
  { key: 'custom', label: 'Personnalisé' },
];

const safeNumber = (value: unknown): number => {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
};

const formatInt = (value: number) => safeNumber(value).toLocaleString('fr-FR').replace(/\s/g, ' ');
const formatCurrency = (value: number) =>
  `${safeNumber(value).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} TND`;
const formatDuration = (seconds: number) => {
  const s = Math.max(0, Math.round(safeNumber(seconds)));
  const hours = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
};

const statusBadgeClass = (status: string) => {
  if (status === 'Active') return 'bg-[#DDF7E5] text-[#2F9E63]';
  if (status === 'Passée') return 'bg-gray-100 text-gray-500';
  return 'bg-gray-100 text-gray-600';
};

const percentageDiff = (current: number, previous: number) => {
  const safeCurrent = safeNumber(current);
  const safePrevious = safeNumber(previous);
  if (safePrevious === 0) return safeCurrent === 0 ? 0 : 100;
  return safeNumber(((safeCurrent - safePrevious) / safePrevious) * 100);
};

const toIsoDate = (date: Date) => date.toISOString().split('T')[0];
const getPresetRange = (preset: PerformancePeriodPreset) => {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (preset === 'year')
    return { startDate: toIsoDate(new Date(today.getFullYear(), 0, 1)), endDate: toIsoDate(today) };
  if (preset === 'quarter') {
    const quarterStartMonth = Math.floor(today.getMonth() / 3) * 3;
    return {
      startDate: toIsoDate(new Date(today.getFullYear(), quarterStartMonth, 1)),
      endDate: toIsoDate(today),
    };
  }
  return {
    startDate: toIsoDate(new Date(today.getFullYear(), today.getMonth(), 1)),
    endDate: toIsoDate(today),
  };
};

type TemporalGranularity = 'hour' | 'day' | 'week' | 'month';
type AgeSegment = 'all' | 'u25' | '25_40' | '40_60' | '60p';
type SexSegment = 'all' | 'male' | 'female';

function KpiCard({
  title,
  value,
  diff,
  icon,
}: {
  title: string;
  value: string;
  diff: number;
  icon: React.ReactNode;
}) {
  const positive = safeNumber(diff) >= 0;
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-semibold text-gray-700">{title}</p>
        <span className="text-gray-500">{icon}</span>
      </div>
      <p className="text-3xl font-medium leading-none tracking-tight text-gray-900">{value}</p>
      <div className="mt-3 flex items-center gap-1">
        {positive ? (
          <ArrowUp className="h-4 w-4 text-emerald-500" />
        ) : (
          <ArrowDown className="h-4 w-4 text-rose-500" />
        )}
        <span
          className={`text-sm font-semibold ${positive ? 'text-emerald-500' : 'text-rose-500'}`}
        >
          {`${positive ? '+' : ''}${safeNumber(diff).toFixed(0)}%`}
        </span>
        <span className="text-sm text-gray-500">Le mois dernier</span>
      </div>
    </div>
  );
}

export default function OwnerPerformance() {
  const navigate = useNavigate();
  const { user, needsApproval, validationStatus } = useAuthStore();
  const isDisabled = needsApproval && validationStatus === 'pending';

  const [filters, setFilters] = useState<PerformanceFilters>(
    performanceService.buildDefaultFilters(),
  );
  const [dataset, setDataset] = useState<PerformanceDataset | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [ownerCampaignIds, setOwnerCampaignIds] = useState<string[]>([]);
  const [temporalGranularity, setTemporalGranularity] = useState<TemporalGranularity>('day');
  const [ageSegment, setAgeSegment] = useState<AgeSegment>('all');
  const [sexSegment, setSexSegment] = useState<SexSegment>('all');

  useEffect(() => {
    const loadOwnerScope = async () => {
      if (!user?.id) return;
      const [{ data: ownerLocations }, { data: ownerScreens }, { data: ownerApprovals }] =
        await Promise.all([
          supabase.from('locations').select('id').eq('owner_id', user.id),
          supabase.from('screens').select('id').eq('owner_id', user.id),
          supabase.from('campaign_owner_approvals').select('campaign_id').eq('owner_id', user.id),
        ]);

      const locationIds = (ownerLocations || []).map((r: { id: string }) => r.id);
      const screenIds = (ownerScreens || []).map((r: { id: string }) => r.id);
      const [ownerCampaignLocRes, ownerCampaignScreenRes] = await Promise.all([
        locationIds.length
          ? supabase.from('campaign_locations').select('campaign_id').in('location_id', locationIds)
          : Promise.resolve({ data: [], error: null }),
        screenIds.length
          ? supabase.from('campaign_screens').select('campaign_id').in('screen_id', screenIds)
          : Promise.resolve({ data: [], error: null }),
      ]);

      const ids = Array.from(
        new Set(
          [
            ...((ownerCampaignLocRes.data || []) as Array<{ campaign_id: string }>).map(
              (r) => r.campaign_id,
            ),
            ...((ownerCampaignScreenRes.data || []) as Array<{ campaign_id: string }>).map(
              (r) => r.campaign_id,
            ),
            ...((ownerApprovals || []) as Array<{ campaign_id: string }>).map((r) => r.campaign_id),
          ].filter(Boolean),
        ),
      );
      setOwnerCampaignIds(ids);
    };

    loadOwnerScope();
  }, [user?.id]);

  const loadData = async (nextFilters: PerformanceFilters) => {
    try {
      setLoading(true);
      setError('');
      const data = await performanceService.getDataset(nextFilters, {
        campaignIds: ownerCampaignIds,
      });
      setDataset(data);
      setFilters(data.filters);
    } catch (e) {
      console.error(e);
      setError('Impossible de charger les performances pour le moment.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!user?.id) return;
    loadData(filters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, ownerCampaignIds.join('|')]);

  const onFilterChange = (key: keyof PerformanceFilters, value: string) =>
    setFilters((prev) => ({ ...prev, [key]: value }));
  const applyPreset = (preset: PerformancePeriodPreset) => {
    if (preset === 'month' || preset === 'quarter' || preset === 'year') {
      const range = getPresetRange(preset);
      setFilters((prev) => ({
        ...prev,
        preset,
        startDate: range.startDate,
        endDate: range.endDate,
      }));
      return;
    }
    setFilters((prev) => ({ ...prev, preset }));
  };

  const kpiValues = useMemo(() => {
    const current: PerformanceKpis = dataset?.kpis || {
      diffusionSeconds: 0,
      impressions: 0,
      affluence: 0,
      activeScreens: 0,
      spend: 0,
    };
    const previous = dataset?.previousKpis || current;
    return [
      {
        title: 'Durée de diffusion',
        value: formatDuration(current.diffusionSeconds),
        diff: percentageDiff(current.diffusionSeconds, previous.diffusionSeconds),
        icon: <Clock3 className="h-4 w-4" />,
      },
      {
        title: 'Impressions générées',
        value: formatInt(current.impressions),
        diff: percentageDiff(current.impressions, previous.impressions),
        icon: <Eye className="h-4 w-4" />,
      },
      {
        title: "Analyse de l'affluence",
        value: formatInt(current.affluence),
        diff: percentageDiff(current.affluence, previous.affluence),
        icon: <Users className="h-4 w-4" />,
      },
      {
        title: 'Écrans actifs',
        value: formatInt(current.activeScreens),
        diff: percentageDiff(current.activeScreens, previous.activeScreens),
        icon: <Monitor className="h-4 w-4" />,
      },
      {
        title: 'Dépenses ce mois',
        value: formatCurrency(current.spend),
        diff: percentageDiff(current.spend, previous.spend),
        icon: <Wallet className="h-4 w-4" />,
      },
    ];
  }, [dataset]);

  const showCustomDate = filters.preset === 'custom';

  const trendData = useMemo<PerformanceTrendPoint[]>(() => {
    const base = dataset?.trend || [];
    if (base.length === 0) return [];

    if (temporalGranularity === 'day') return base;

    if (temporalGranularity === 'week') {
      const result: PerformanceTrendPoint[] = [];
      for (let i = 0; i < base.length; i += 7) {
        const chunk = base.slice(i, i + 7);
        result.push({
          label: `S${Math.floor(i / 7) + 1}`,
          current: chunk.reduce((sum, p) => sum + safeNumber(p.current), 0),
          previous: chunk.reduce((sum, p) => sum + safeNumber(p.previous), 0),
        });
      }
      return result;
    }

    if (temporalGranularity === 'month') {
      const byMonth = new Map<string, { current: number; previous: number }>();
      base.forEach((p) => {
        const month = String(p.label || '').split('/')[1] || p.label;
        const agg = byMonth.get(month) || { current: 0, previous: 0 };
        agg.current += safeNumber(p.current);
        agg.previous += safeNumber(p.previous);
        byMonth.set(month, agg);
      });
      return Array.from(byMonth.entries()).map(([month, agg]) => ({
        label: month,
        current: agg.current,
        previous: agg.previous,
      }));
    }

    const totalCurrent = base.reduce((sum, p) => sum + safeNumber(p.current), 0);
    const totalPrevious = base.reduce((sum, p) => sum + safeNumber(p.previous), 0);
    const avgCurrentHour = totalCurrent / (base.length * 24);
    const avgPreviousHour = totalPrevious / (base.length * 24);
    return Array.from({ length: 24 }).map((_, h) => ({
      label: `${String(h).padStart(2, '0')}h`,
      current: avgCurrentHour,
      previous: avgPreviousHour,
    }));
  }, [dataset?.trend, temporalGranularity]);

  const segmentedCategoryData = useMemo<PerformanceCategoryPoint[]>(() => {
    const base = dataset?.categoryPerformance || [];
    if (base.length === 0) return [];

    let filtered = base;

    if (ageSegment !== 'all') {
      const agePatterns: Record<Exclude<AgeSegment, 'all'>, RegExp> = {
        u25: /-?\s*25|moins de 25|u25|<\s*25/i,
        '25_40': /25\s*[-<]\s*40|25\s*-\s*40|25\s*à\s*40/i,
        '40_60': /40\s*[-<]\s*60|40\s*-\s*60|40\s*à\s*60/i,
        '60p': /60\s*\+|60 ans|plus de 60/i,
      };
      const ageFiltered = filtered.filter((item) => agePatterns[ageSegment].test(item.category));
      if (ageFiltered.length > 0) filtered = ageFiltered;
    }

    if (sexSegment !== 'all') {
      const sexPattern = sexSegment === 'male' ? /homme|male|masculin/i : /femme|female|feminin/i;
      const sexFiltered = filtered.filter((item) => sexPattern.test(item.category));
      if (sexFiltered.length > 0) filtered = sexFiltered;
    }

    return filtered;
  }, [dataset?.categoryPerformance, ageSegment, sexSegment]);

  return (
    <div className="min-h-screen bg-white">
      <div className="flex h-screen">
        <OwnerNavigation isDisabled={isDisabled} />
        <div className="flex-1 flex flex-col overflow-hidden">
          <header className="bg-white border-b border-[#EBEBEB]">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h1 className="text-xl font-semibold text-[#171717]">Mes performances</h1>
                  <p className="text-sm text-[#5C5C5C]">
                    Analysez la performance de vos campagnes en un coup d&apos;oeil
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => navigate('/owner-calendar-devices')}
                    className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-2xl bg-[#9AE2B0] hover:bg-[#85D99E] text-[#101010] text-sm font-semibold transition-colors"
                  >
                    <Calendar className="h-4 w-4" />
                    Piloter mon calendrier de diffusion
                  </button>
                  <OwnerNotificationsBell userId={user?.id} />
                </div>
              </div>
            </div>
          </header>

          <div className="flex-1 overflow-y-auto">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
              <div className="rounded-2xl border border-gray-200 bg-white p-5">
                <div className="mb-5 flex items-center gap-2 text-sm font-semibold text-gray-800">
                  <img src={performanceIntroIcon} alt="" className="h-10 w-10 object-contain" />
                  <span>Sélectionnez vos paramètres pour analyser vos performances</span>
                </div>

                <div className="rounded-2xl border border-gray-100 p-4 mb-4">
                  <h3 className="text-xl font-medium text-gray-900 mb-4">Par Campagne</h3>
                  <p className="mb-2 text-sm font-semibold text-gray-800">Période d&apos;analyse</p>
                  <div className="flex flex-wrap gap-2 mb-4">
                    {presetButtons.map((button) => (
                      <button
                        key={button.key}
                        type="button"
                        onClick={() => applyPreset(button.key)}
                        className={`rounded-lg px-4 py-1.5 text-sm font-medium transition ${
                          filters.preset === button.key
                            ? 'bg-white text-gray-900 ring-1 ring-gray-300'
                            : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                        }`}
                      >
                        {button.label}
                      </button>
                    ))}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
                    <div>
                      <label className="mb-1 block text-sm font-semibold text-gray-700">
                        Campagne
                      </label>
                      <select
                        value={filters.campaignId}
                        onChange={(e) => onFilterChange('campaignId', e.target.value)}
                        className="h-11 w-full rounded-lg border border-gray-200 px-3 text-sm"
                      >
                        <option value="">Toutes</option>
                        {(dataset?.options.campaigns || []).map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-semibold text-gray-700">
                        Date de début
                      </label>
                      <input
                        type="date"
                        value={filters.startDate}
                        onChange={(e) => onFilterChange('startDate', e.target.value)}
                        disabled={!showCustomDate}
                        className="h-11 w-full rounded-lg border border-gray-200 px-3 text-sm disabled:bg-gray-50"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-semibold text-gray-700">
                        Date de fin
                      </label>
                      <input
                        type="date"
                        value={filters.endDate}
                        onChange={(e) => onFilterChange('endDate', e.target.value)}
                        disabled={!showCustomDate}
                        className="h-11 w-full rounded-lg border border-gray-200 px-3 text-sm disabled:bg-gray-50"
                      />
                    </div>
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => loadData(filters)}
                        className="inline-flex items-center rounded-lg bg-[#76E6AB] px-4 py-2 text-sm font-medium text-[#165f2c] hover:bg-[#64d99b]"
                      >
                        Actualiser la recherche
                      </button>
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-gray-100 p-4 mb-4">
                  <h3 className="text-xl font-medium text-gray-900 mb-4">Par Établissement</h3>
                  <p className="mb-2 text-sm font-semibold text-gray-800">Période d&apos;analyse</p>
                  <div className="flex flex-wrap gap-2 mb-4">
                    {presetButtons.map((button) => (
                      <button
                        key={`loc-${button.key}`}
                        type="button"
                        onClick={() => applyPreset(button.key)}
                        className={`rounded-lg px-4 py-1.5 text-sm font-medium transition ${
                          filters.preset === button.key
                            ? 'bg-white text-gray-900 ring-1 ring-gray-300'
                            : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                        }`}
                      >
                        {button.label}
                      </button>
                    ))}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
                    <div>
                      <label className="mb-1 block text-sm font-semibold text-gray-700">
                        Établissement
                      </label>
                      <select
                        value={filters.locationId}
                        onChange={(e) => onFilterChange('locationId', e.target.value)}
                        className="h-11 w-full rounded-lg border border-gray-200 px-3 text-sm"
                      >
                        <option value="">Toutes</option>
                        {(dataset?.options.locations || []).map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-semibold text-gray-700">
                        Date de début
                      </label>
                      <input
                        type="date"
                        value={filters.startDate}
                        onChange={(e) => onFilterChange('startDate', e.target.value)}
                        disabled={!showCustomDate}
                        className="h-11 w-full rounded-lg border border-gray-200 px-3 text-sm disabled:bg-gray-50"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-semibold text-gray-700">
                        Date de fin
                      </label>
                      <input
                        type="date"
                        value={filters.endDate}
                        onChange={(e) => onFilterChange('endDate', e.target.value)}
                        disabled={!showCustomDate}
                        className="h-11 w-full rounded-lg border border-gray-200 px-3 text-sm disabled:bg-gray-50"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-semibold text-gray-700">Zone</label>
                      <select
                        value={filters.zoneId}
                        onChange={(e) => onFilterChange('zoneId', e.target.value)}
                        className="h-11 w-full rounded-lg border border-gray-200 px-3 text-sm"
                      >
                        <option value="">Toutes</option>
                        {(dataset?.options.zones || []).map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => loadData(filters)}
                        className="inline-flex items-center rounded-lg bg-[#76E6AB] px-4 py-2 text-sm font-medium text-[#165f2c] hover:bg-[#64d99b]"
                      >
                        Actualiser la recherche
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {error ? <p className="text-sm font-medium text-rose-500">{error}</p> : null}
              {loading ? (
                <p className="text-sm text-gray-500">Chargement des performances...</p>
              ) : null}

              {!loading && !error ? (
                <>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
                    {kpiValues.map((kpi) => (
                      <KpiCard
                        key={kpi.title}
                        title={kpi.title}
                        value={kpi.value}
                        diff={kpi.diff}
                        icon={kpi.icon}
                      />
                    ))}
                  </div>

                  <div className="rounded-2xl border border-gray-200 bg-white p-4">
                    <h3 className="text-lg font-medium text-gray-900 mb-4">Filtres</h3>
                    <div className="flex flex-wrap gap-2 mb-3">
                      <button
                        type="button"
                        className="rounded-lg px-4 py-1.5 text-sm font-medium bg-[#dfe8ff] text-[#2c4c8a]"
                      >
                        Evolution temporel
                      </button>
                      <button
                        type="button"
                        onClick={() => setTemporalGranularity('hour')}
                        className={`rounded-lg px-4 py-1.5 text-sm font-medium border ${temporalGranularity === 'hour' ? 'bg-white border-gray-300 text-gray-800' : 'bg-white border-gray-200 text-gray-500'}`}
                      >
                        Par heure
                      </button>
                      <button
                        type="button"
                        onClick={() => setTemporalGranularity('day')}
                        className={`rounded-lg px-4 py-1.5 text-sm font-medium border ${temporalGranularity === 'day' ? 'bg-white border-gray-300 text-gray-800' : 'bg-white border-gray-200 text-gray-500'}`}
                      >
                        Par jour
                      </button>
                      <button
                        type="button"
                        onClick={() => setTemporalGranularity('week')}
                        className={`rounded-lg px-4 py-1.5 text-sm font-medium border ${temporalGranularity === 'week' ? 'bg-white border-gray-300 text-gray-800' : 'bg-white border-gray-200 text-gray-500'}`}
                      >
                        Par semaine
                      </button>
                      <button
                        type="button"
                        onClick={() => setTemporalGranularity('month')}
                        className={`rounded-lg px-4 py-1.5 text-sm font-medium border ${temporalGranularity === 'month' ? 'bg-white border-gray-300 text-gray-800' : 'bg-white border-gray-200 text-gray-500'}`}
                      >
                        Par mois
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-2 mb-3">
                      <button
                        type="button"
                        className="rounded-lg px-4 py-1.5 text-sm font-medium bg-[#dfe8ff] text-[#2c4c8a]"
                      >
                        Segmentation par âge
                      </button>
                      <button
                        type="button"
                        onClick={() => setAgeSegment('u25')}
                        className={`rounded-lg px-4 py-1.5 text-sm font-medium border ${ageSegment === 'u25' ? 'bg-white border-gray-300 text-gray-800' : 'bg-white border-gray-200 text-gray-500'}`}
                      >
                        - 25 ans
                      </button>
                      <button
                        type="button"
                        onClick={() => setAgeSegment('25_40')}
                        className={`rounded-lg px-4 py-1.5 text-sm font-medium border ${ageSegment === '25_40' ? 'bg-white border-gray-300 text-gray-800' : 'bg-white border-gray-200 text-gray-500'}`}
                      >
                        25&lt;40 ans
                      </button>
                      <button
                        type="button"
                        onClick={() => setAgeSegment('40_60')}
                        className={`rounded-lg px-4 py-1.5 text-sm font-medium border ${ageSegment === '40_60' ? 'bg-white border-gray-300 text-gray-800' : 'bg-white border-gray-200 text-gray-500'}`}
                      >
                        40&lt;60 ans
                      </button>
                      <button
                        type="button"
                        onClick={() => setAgeSegment('60p')}
                        className={`rounded-lg px-4 py-1.5 text-sm font-medium border ${ageSegment === '60p' ? 'bg-white border-gray-300 text-gray-800' : 'bg-white border-gray-200 text-gray-500'}`}
                      >
                        60 ans et +
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-2 mb-4">
                      <button
                        type="button"
                        className="rounded-lg px-4 py-1.5 text-sm font-medium bg-[#dfe8ff] text-[#2c4c8a]"
                      >
                        Segmentation par sexe
                      </button>
                      <button
                        type="button"
                        onClick={() => setSexSegment('male')}
                        className={`rounded-lg px-4 py-1.5 text-sm font-medium border ${sexSegment === 'male' ? 'bg-white border-gray-300 text-gray-800' : 'bg-white border-gray-200 text-gray-500'}`}
                      >
                        Hommes
                      </button>
                      <button
                        type="button"
                        onClick={() => setSexSegment('female')}
                        className={`rounded-lg px-4 py-1.5 text-sm font-medium border ${sexSegment === 'female' ? 'bg-white border-gray-300 text-gray-800' : 'bg-white border-gray-200 text-gray-500'}`}
                      >
                        Femmes
                      </button>
                      <button
                        type="button"
                        onClick={() => setSexSegment('all')}
                        className={`rounded-lg px-4 py-1.5 text-sm font-medium border ${sexSegment === 'all' ? 'bg-white border-gray-300 text-gray-800' : 'bg-white border-gray-200 text-gray-500'}`}
                      >
                        Tous
                      </button>
                      <button
                        type="button"
                        onClick={() => setAgeSegment('all')}
                        className={`rounded-lg px-4 py-1.5 text-sm font-medium border ${ageSegment === 'all' ? 'bg-white border-gray-300 text-gray-800' : 'bg-white border-gray-200 text-gray-500'}`}
                      >
                        Tous âges
                      </button>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                      <div>
                        <label className="mb-1 block text-sm font-semibold text-gray-700">
                          Campagne
                        </label>
                        <select
                          value={filters.campaignId}
                          onChange={(e) => onFilterChange('campaignId', e.target.value)}
                          className="h-11 w-full rounded-lg border border-gray-200 px-3 text-sm"
                        >
                          <option value="">Toutes</option>
                          {(dataset?.options.campaigns || []).map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="mb-1 block text-sm font-semibold text-gray-700">
                          Date de début
                        </label>
                        <input
                          type="date"
                          value={filters.startDate}
                          onChange={(e) => onFilterChange('startDate', e.target.value)}
                          disabled={!showCustomDate}
                          className="h-11 w-full rounded-lg border border-gray-200 px-3 text-sm disabled:bg-gray-50"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-sm font-semibold text-gray-700">
                          Date de fin
                        </label>
                        <input
                          type="date"
                          value={filters.endDate}
                          onChange={(e) => onFilterChange('endDate', e.target.value)}
                          disabled={!showCustomDate}
                          className="h-11 w-full rounded-lg border border-gray-200 px-3 text-sm disabled:bg-gray-50"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-sm font-semibold text-gray-700">
                          Zone
                        </label>
                        <select
                          value={filters.zoneId}
                          onChange={(e) => onFilterChange('zoneId', e.target.value)}
                          className="h-11 w-full rounded-lg border border-gray-200 px-3 text-sm"
                        >
                          <option value="">Toutes</option>
                          {(dataset?.options.zones || []).map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                    <div className="rounded-2xl border border-gray-200 bg-white p-4">
                      <h3 className="text-lg font-medium text-gray-900">
                        Évolution de l&apos;audience
                      </h3>
                      <p className="mb-4 text-sm text-gray-500">Comparaison entre deux périodes</p>
                      <div className="h-[270px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={trendData}>
                            <defs>
                              <linearGradient id="ownerCurrentArea" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#8D95F8" stopOpacity={0.35} />
                                <stop offset="95%" stopColor="#8D95F8" stopOpacity={0.05} />
                              </linearGradient>
                              <linearGradient id="ownerPreviousArea" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#CBD5E1" stopOpacity={0.25} />
                                <stop offset="95%" stopColor="#CBD5E1" stopOpacity={0.03} />
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="#eef2ff" />
                            <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} />
                            <YAxis tick={{ fontSize: 11, fill: '#64748b' }} />
                            <Tooltip />
                            <Area
                              type="monotone"
                              dataKey="current"
                              stroke="#8D95F8"
                              strokeWidth={2}
                              fill="url(#ownerCurrentArea)"
                              name="2025"
                            />
                            <Area
                              type="monotone"
                              dataKey="previous"
                              stroke="#94A3B8"
                              strokeWidth={2}
                              fill="url(#ownerPreviousArea)"
                              name="2026"
                            />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                    <div className="rounded-2xl border border-gray-200 bg-white p-4">
                      <h3 className="text-lg font-medium text-gray-900">
                        {sexSegment !== 'all' ? 'Impact par sexe' : 'Impact par âge'}
                      </h3>
                      <p className="mb-4 text-sm text-gray-500">Impressions générées par âge</p>
                      <div className="h-[270px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={segmentedCategoryData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#eef2ff" />
                            <XAxis dataKey="category" tick={{ fontSize: 11, fill: '#64748b' }} />
                            <YAxis tick={{ fontSize: 11, fill: '#64748b' }} />
                            <Tooltip />
                            <Bar dataKey="impressions" fill="#8D95F8" radius={[8, 8, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    className="rounded-lg bg-[#76E6AB] px-4 py-2 text-sm font-medium text-[#165f2c] hover:bg-[#64d99b]"
                  >
                    Générer rapport de la recherche
                  </button>

                  <h3 className="text-xl font-medium text-gray-900">Vos performances globales</h3>
                  <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                    <div className="rounded-2xl border border-gray-200 bg-white p-4">
                      <h4 className="text-lg font-medium text-gray-900">Top campagnes</h4>
                      <p className="mb-4 text-sm text-gray-500">Meilleures performances par ROI</p>
                      <div className="space-y-3">
                        {(dataset?.topCampaigns || []).map((campaign, idx) => (
                          <div
                            key={campaign.id}
                            className="rounded-xl border border-gray-100 px-3 py-3 flex items-center justify-between"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="h-7 w-7 rounded-full bg-gray-100 flex items-center justify-center text-sm font-semibold">
                                {idx + 1}
                              </div>
                              <div className="min-w-0">
                                <p className="truncate text-base font-medium text-gray-900">
                                  {campaign.name}
                                </p>
                                <div className="mt-1 flex items-center gap-2 text-xs text-gray-500">
                                  <span
                                    className={`rounded-full px-2 py-0.5 font-semibold ${statusBadgeClass(campaign.status)}`}
                                  >
                                    {campaign.status}
                                  </span>
                                  <span>{formatInt(campaign.impressions)} impressions</span>
                                </div>
                              </div>
                            </div>
                            <p className="text-lg font-medium text-[#1FC16B]">
                              {campaign.roi.toFixed(1)} TND
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="rounded-2xl border border-gray-200 bg-white p-4">
                      <h4 className="text-lg font-medium text-gray-900">
                        Audience globale par sexe
                      </h4>
                      <p className="mb-4 text-sm text-gray-500">Distribution géographique</p>
                      <div className="space-y-3">
                        {(dataset?.zonePerformance || []).map((zone) => (
                          <div key={zone.zoneId} className="rounded-xl border border-gray-100 p-3">
                            <div className="mb-2 flex items-center justify-between">
                              <div className="flex items-center gap-2 text-sm font-semibold">
                                <MapPin className="h-4 w-4" />
                                {zone.zoneName}
                              </div>
                              <div className="text-sm text-gray-500">
                                {zone.sharePercent.toFixed(1)}%
                              </div>
                            </div>
                            <div className="text-sm font-semibold text-gray-900 mb-2">
                              {formatInt(zone.impressions)} impressions
                            </div>
                            <div className="h-2 rounded-full bg-gray-100">
                              <div
                                className="h-2 rounded-full bg-[#9EEBB5]"
                                style={{
                                  width: `${Math.max(0, Math.min(100, zone.sharePercent))}%`,
                                }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-[#96E3B0] bg-[#F5FAF8] p-4">
                    <h4 className="text-lg font-medium text-gray-900">Métriques détaillées</h4>
                    <p className="mb-4 text-sm text-gray-500">
                      Indicateurs de performance complémentaires
                    </p>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                      <div className="rounded-xl border border-[#76E6AB] bg-white p-4">
                        <p className="text-xs font-semibold text-gray-900">Durée moyenne</p>
                        <p className="mt-2 text-2xl font-medium">
                          {formatInt(dataset?.detailedMetrics.averageDurationDays || 0)} jours
                        </p>
                        <p className="mt-2 text-sm text-gray-500">Campagne en 2026</p>
                      </div>
                      <div className="rounded-xl border border-[#76E6AB] bg-white p-4">
                        <p className="text-xs font-semibold text-gray-900">Impressions touchés</p>
                        <p className="mt-2 text-2xl font-medium">
                          {formatInt(dataset?.kpis.impressions || 0)}
                        </p>
                        <p className="mt-2 text-sm text-gray-500">Personnes</p>
                      </div>
                      <div className="rounded-xl border border-[#76E6AB] bg-white p-4">
                        <p className="text-xs font-semibold text-gray-900">Revenu total</p>
                        <p className="mt-2 text-2xl font-medium">
                          {formatCurrency(dataset?.detailedMetrics.totalBudget || 0)}
                        </p>
                        <p className="mt-2 text-sm text-gray-500">En 2026</p>
                      </div>
                      <div className="rounded-xl border border-[#76E6AB] bg-white p-4">
                        <p className="text-xs font-semibold text-gray-900">
                          Taux d&apos;occupation
                        </p>
                        <p className="mt-2 text-2xl font-medium">
                          {safeNumber(dataset?.detailedMetrics.completionRate || 0).toFixed(0)}%
                        </p>
                        <p className="mt-2 text-sm text-gray-500">Ecrans disponibles</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="mt-4 rounded-lg bg-[#76E6AB] px-4 py-2 text-sm font-medium text-[#165f2c] hover:bg-[#64d99b]"
                    >
                      Générer rapport global
                    </button>
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
