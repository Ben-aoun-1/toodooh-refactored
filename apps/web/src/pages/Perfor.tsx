import React, { useEffect, useMemo, useState } from 'react';
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
import { Clock3, Eye, Users, Monitor, Wallet, MapPin, ArrowDown, ArrowUp } from 'lucide-react';
import { performanceService } from '../services/performance.service';
import performanceIntroIcon from '../assets/performance/1.png';
import type {
  PerformanceDataset,
  PerformanceFilters,
  PerformanceKpis,
  PerformancePeriodPreset,
} from '../types/performance';

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
  if (safePrevious === 0) {
    if (safeCurrent === 0) return 0;
    return 100;
  }
  return safeNumber(((safeCurrent - safePrevious) / safePrevious) * 100);
};

const toIsoDate = (date: Date) => date.toISOString().split('T')[0];

const getPresetRange = (preset: PerformancePeriodPreset) => {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (preset === 'year') {
    return { startDate: toIsoDate(new Date(today.getFullYear(), 0, 1)), endDate: toIsoDate(today) };
  }
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

type KpiCardProps = {
  title: string;
  value: string;
  diff: number;
  icon: React.ReactNode;
};

function KpiCard({ title, value, diff, icon }: KpiCardProps) {
  const safeDiff = safeNumber(diff);
  const positive = safeDiff >= 0;
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
          {`${positive ? '+' : ''}${safeDiff.toFixed(0)}%`}
        </span>
        <span className="text-sm text-gray-500">Le mois dernier</span>
      </div>
    </div>
  );
}

export default function Perfor() {
  const [filters, setFilters] = useState<PerformanceFilters>(
    performanceService.buildDefaultFilters(),
  );
  const [dataset, setDataset] = useState<PerformanceDataset | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');

  const loadData = async (nextFilters: PerformanceFilters) => {
    try {
      setLoading(true);
      setError('');
      const data = await performanceService.getDataset(nextFilters);
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
    loadData(filters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onFilterChange = (key: keyof PerformanceFilters, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

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

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="rounded-2xl border border-gray-200 bg-white p-5">
        <div className="mb-5 flex items-center gap-2 text-sm font-semibold text-gray-800">
          <img src={performanceIntroIcon} alt="" className="h-10 w-10 object-contain" />
          <span>Sélectionnez vos paramètres pour analyser vos performances</span>
        </div>

        <div className="mb-4">
          <p className="mb-2 text-sm font-semibold text-gray-800">Période d&apos;analyse</p>
          <div className="flex flex-wrap gap-2">
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
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-6">
          <div>
            <label className="mb-1 block text-sm font-semibold text-gray-700">Campagne</label>
            <select
              value={filters.campaignId}
              onChange={(e) => onFilterChange('campaignId', e.target.value)}
              className="h-11 w-full rounded-lg border border-gray-200 px-3 text-sm outline-none focus:border-[#8d95f8]"
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
            <label className="mb-1 block text-sm font-semibold text-gray-700">Date de début</label>
            <input
              type="date"
              value={filters.startDate}
              onChange={(e) => onFilterChange('startDate', e.target.value)}
              disabled={!showCustomDate}
              className="h-11 w-full rounded-lg border border-gray-200 px-3 text-sm outline-none disabled:bg-gray-50 disabled:text-gray-400"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-semibold text-gray-700">Date de fin</label>
            <input
              type="date"
              value={filters.endDate}
              onChange={(e) => onFilterChange('endDate', e.target.value)}
              disabled={!showCustomDate}
              className="h-11 w-full rounded-lg border border-gray-200 px-3 text-sm outline-none disabled:bg-gray-50 disabled:text-gray-400"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-semibold text-gray-700">
              Type de campagne
            </label>
            <select
              value={filters.campaignType}
              onChange={(e) => onFilterChange('campaignType', e.target.value)}
              className="h-11 w-full rounded-lg border border-gray-200 px-3 text-sm outline-none focus:border-[#8d95f8]"
            >
              <option value="">Toutes</option>
              {(dataset?.options.campaignTypes || []).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-semibold text-gray-700">Catégorie</label>
            <select
              value={filters.category}
              onChange={(e) => onFilterChange('category', e.target.value)}
              className="h-11 w-full rounded-lg border border-gray-200 px-3 text-sm outline-none focus:border-[#8d95f8]"
            >
              <option value="">Toutes</option>
              {(dataset?.options.categories || []).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-semibold text-gray-700">Zone</label>
            <select
              value={filters.zoneId}
              onChange={(e) => onFilterChange('zoneId', e.target.value)}
              className="h-11 w-full rounded-lg border border-gray-200 px-3 text-sm outline-none focus:border-[#8d95f8]"
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

        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={() => loadData(filters)}
            className="inline-flex items-center rounded-lg bg-[#76E6AB] px-4 py-2 text-sm font-medium text-[#165f2c] hover:bg-[#64d99b]"
          >
            Actualiser la recherche
          </button>
        </div>
      </div>

      {error ? <p className="text-sm font-medium text-rose-500">{error}</p> : null}
      {loading ? <p className="text-sm text-gray-500">Chargement des performances...</p> : null}

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

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <div className="rounded-2xl border border-gray-200 bg-white p-4">
              <h3 className="text-lg font-medium text-gray-900">Évolution des impressions</h3>
              <p className="mb-4 text-sm text-gray-500">
                Comparaison période actuelle vs précédente
              </p>
              <div className="h-[270px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={dataset?.trend || []}>
                    <defs>
                      <linearGradient id="currentArea" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#8D95F8" stopOpacity={0.35} />
                        <stop offset="95%" stopColor="#8D95F8" stopOpacity={0.05} />
                      </linearGradient>
                      <linearGradient id="previousArea" x1="0" y1="0" x2="0" y2="1">
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
                      fill="url(#currentArea)"
                      name="Période actuelle"
                    />
                    <Area
                      type="monotone"
                      dataKey="previous"
                      stroke="#94A3B8"
                      strokeWidth={2}
                      fill="url(#previousArea)"
                      name="Période précédente"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="rounded-2xl border border-gray-200 bg-white p-4">
              <h3 className="text-lg font-medium text-gray-900">Performance par catégorie</h3>
              <p className="mb-4 text-sm text-gray-500">
                Impressions générées par type de campagne
              </p>
              <div className="h-[270px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dataset?.categoryPerformance || []}>
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

          <div className="pt-2">
            <div className="mb-3">
              <button
                type="button"
                className="rounded-lg bg-[#76E6AB] px-4 py-2 text-sm font-medium text-[#165f2c] hover:bg-[#64d99b]"
              >
                Générer rapport de la recherche
              </button>
            </div>
            <h3 className="mb-4 text-xl font-medium tracking-tight text-gray-900">
              Vos performances globales
            </h3>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <div className="rounded-2xl border border-gray-200 bg-white p-4">
                <h4 className="text-lg font-medium text-gray-900">Top campagnes</h4>
                <p className="mb-4 text-sm text-gray-500">Meilleures performances par ROI</p>
                <div className="space-y-3">
                  {(dataset?.topCampaigns || []).map((campaign, idx) => (
                    <div key={campaign.id} className="rounded-xl border border-gray-100 px-3 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-gray-100 text-sm font-semibold text-gray-700">
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
                        <div className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <ArrowUp className="h-4 w-4 text-[#76E6AB]" />
                            <span
                              className="text-lg font-medium text-[#76E6AB]"
                              style={{ color: '#76E6AB' }}
                            >
                              {campaign.roi.toFixed(1)}
                            </span>
                          </div>
                          <p className="text-xs text-gray-500">impressions/TND</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-gray-200 bg-white p-4">
                <h4 className="text-lg font-medium text-gray-900">Performance par zone</h4>
                <p className="mb-4 text-sm text-gray-500">Distribution géographique</p>
                <div className="space-y-3">
                  {(dataset?.zonePerformance || []).map((zone) => (
                    <div key={zone.zoneId} className="rounded-xl border border-gray-100 p-3">
                      <div className="mb-1 flex items-center justify-between text-gray-800">
                        <div className="flex items-center gap-2">
                          <MapPin className="h-4 w-4" />
                          <span className="text-base font-medium">{zone.zoneName}</span>
                        </div>
                        <div className="flex items-center gap-1 text-sm text-gray-500">
                          <Monitor className="h-4 w-4" />
                          <span>{zone.screensCount} écrans</span>
                        </div>
                      </div>
                      <div className="mb-2 flex items-end justify-between">
                        <p className="text-base font-medium text-gray-900">
                          {formatInt(zone.impressions)} impressions
                        </p>
                        <p className="text-sm text-gray-500">{zone.sharePercent.toFixed(1)}%</p>
                      </div>
                      <div className="h-2 w-full rounded-full bg-gray-100">
                        <div
                          className="h-full rounded-full bg-[#9EEBB5]"
                          style={{ width: `${Math.max(0, Math.min(100, zone.sharePercent))}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div
            className="rounded-2xl border border-[#96E3B0] bg-[#F5FAF8] p-4 shadow-sm"
            style={{ boxShadow: '0px 1px 2px rgba(10, 13, 20, 0.0313726)' }}
          >
            <h4 className="text-lg font-medium text-gray-900">Métriques détaillées</h4>
            <p className="mb-4 text-sm text-gray-500">
              Indicateurs de performance depuis mon inscription
            </p>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div
                className="rounded-xl border border-[#76E6AB] bg-white p-4"
                style={{ boxShadow: '0px 1px 2px rgba(10, 13, 20, 0.0313726)' }}
              >
                <p className="text-xs font-semibold text-gray-900">Durée moyenne</p>
                <p className="mt-2 text-2xl font-medium text-gray-900">
                  {formatInt(dataset?.detailedMetrics.averageDurationDays || 0)} jours
                </p>
                <p className="mt-2 text-sm text-gray-500">Par campagne</p>
              </div>
              <div
                className="rounded-xl border border-[#76E6AB] bg-white p-4"
                style={{ boxShadow: '0px 1px 2px rgba(10, 13, 20, 0.0313726)' }}
              >
                <p className="text-xs font-semibold text-gray-900">Lieux touchés</p>
                <p className="mt-2 text-2xl font-medium text-gray-900">
                  {formatInt(dataset?.detailedMetrics.placesTouched || 0)}
                </p>
                <p className="mt-2 text-sm text-gray-500">Établissements</p>
              </div>
              <div
                className="rounded-xl border border-[#76E6AB] bg-white p-4"
                style={{ boxShadow: '0px 1px 2px rgba(10, 13, 20, 0.0313726)' }}
              >
                <p className="text-xs font-semibold text-gray-900">Budget total</p>
                <p className="mt-2 text-2xl font-medium text-gray-900">
                  {formatCurrency(dataset?.detailedMetrics.totalBudget || 0)}
                </p>
                <p className="mt-2 text-sm text-gray-500">Période analysée</p>
              </div>
              <div
                className="rounded-xl border border-[#76E6AB] bg-white p-4"
                style={{ boxShadow: '0px 1px 2px rgba(10, 13, 20, 0.0313726)' }}
              >
                <p className="text-xs font-semibold text-gray-900">Taux de complétion</p>
                <p className="mt-2 text-2xl font-medium text-gray-900">
                  {safeNumber(dataset?.detailedMetrics.completionRate || 0).toFixed(1)}%
                </p>
                <p className="mt-2 text-sm text-gray-500">Campagnes finalisées</p>
              </div>
            </div>
            <div className="mt-4">
              <button
                type="button"
                className="inline-flex items-center rounded-lg bg-[#76E6AB] px-4 py-2 text-sm font-medium text-[#165f2c] hover:bg-[#64d99b]"
              >
                Générer rapport global
              </button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
