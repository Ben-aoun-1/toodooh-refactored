import { Calendar, Loader2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';

import { useAuthStore } from '@/features/auth/stores/auth.store';
import { logger } from '@/lib/logger';

import OwnerNavigation from '../components/OwnerNavigation';
import OwnerNotificationsBell from '../components/OwnerNotificationsBell';
import { AudienceKpisSection } from '../components/performance/AudienceKpisSection';
import {
  CampaignsSection,
  type CampaignTableRow,
} from '../components/performance/CampaignsSection';
import { DemographicsSection } from '../components/performance/DemographicsSection';
import { DownloadCta } from '../components/performance/DownloadCta';
import { ImpressionsChartSection } from '../components/performance/ImpressionsChartSection';
import { MonthlyReportCard } from '../components/performance/MonthlyReportCard';
import { OptimisationSection } from '../components/performance/OptimisationSection';
import { PeakHoursHeatmap } from '../components/performance/PeakHoursHeatmap';
import { PeriodFilters } from '../components/performance/PeriodFilters';
import { ProgressHero } from '../components/performance/ProgressHero';
import { ReportIntro } from '../components/performance/ReportIntro';
import { ReportsHistorySection } from '../components/performance/ReportsHistorySection';
import { RevenueSection, type RevenueRow } from '../components/performance/RevenueSection';
import { SpsSection } from '../components/performance/SpsSection';
import {
  useOwnerEarnings,
  useVenueImpressionsDaily,
  useVenueMonthlyStats,
  useVenueProfile,
} from '../hooks/usePerformanceReads';
import { useScreenhostAffluence } from '../hooks/useScreenhostAffluence';
import { useScreenhostsMine } from '../hooks/useScreenhostsMine';
import { downloadMonthlyReport } from '../lib/monthly-report';
import {
  audienceKpis,
  campaignStatut,
  categoryLabel,
  cumulativeSeries,
  dailyAudienceWithin,
  demographicBreakdown,
  formatTndCellFr,
  formatTndFr,
  impressionsOfMonth,
  lineInPeriod,
  linesEndingInMonth,
  openHoursPerDay,
} from '../lib/performance-derive';
import {
  type PeriodKey,
  formatCompactPeriod,
  formatTablePeriod,
  impressionsFetchWindow,
  inRange,
  isoDate,
  resolvePeriodRange,
} from '../lib/performance-period';

const log = logger.child({ module: 'OwnerPerformance' });

const typeLabelFr = (raw: string): string =>
  raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : '—';

/**
 * "Mes performances" (Lane F) — rebuilt per the two design mockups, entirely on the engine's
 * owner reads (profile / monthly-stats / impressions-daily / earnings / affluence). NO Supabase.
 * Every section is per-selected-venue; the period pills filter CLIENT-SIDE below them.
 */
export default function OwnerPerformance() {
  const navigate = useNavigate();
  const { user, needsApproval, validationStatus } = useAuthStore();
  const isDisabled = needsApproval && validationStatus === 'pending';

  // "today" is anchored once per mount; all date maths live in the lib.
  const today = useMemo(() => new Date(), []);
  const todayIso = isoDate(today);
  const fetchWindow = useMemo(() => impressionsFetchWindow(today), [today]);

  const screenhosts = useScreenhostsMine(user?.id);
  const venues = useMemo(() => screenhosts.data ?? [], [screenhosts.data]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => {
    if (selectedId === null && venues.length > 0) setSelectedId(venues[0]?.id ?? null);
  }, [venues, selectedId]);

  const profile = useVenueProfile(selectedId);
  const monthlyStats = useVenueMonthlyStats(selectedId);
  const impressions = useVenueImpressionsDaily(selectedId, fetchWindow.from, fetchWindow.to);
  const earnings = useOwnerEarnings(user?.id);
  const affluence = useScreenhostAffluence(selectedId);

  // Period pills — custom only applies on "Actualiser la recherche".
  const [period, setPeriod] = useState<PeriodKey>('28d');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [appliedCustom, setAppliedCustom] = useState<{ from: string; to: string } | undefined>();
  const range = useMemo(
    () => resolvePeriodRange(period, today, appliedCustom),
    [period, today, appliedCustom],
  );

  // ── Per-venue datasets ──────────────────────────────────────────────────────
  const months = useMemo(() => monthlyStats.data?.months ?? [], [monthlyStats.data]);
  const days = useMemo(() => impressions.data?.days ?? [], [impressions.data]);
  const venueLines = useMemo(
    () => (earnings.data?.lines ?? []).filter((l) => l.screenhost_id === selectedId),
    [earnings.data, selectedId],
  );

  const latestMonth = months[0] ?? null;
  const historyRows = useMemo(
    () =>
      months.slice(1).map((m) => ({
        month: m.month,
        totalAudience: m.total_audience,
        impressions: impressionsOfMonth(days, m.month),
      })),
    [months, days],
  );

  // ── Hero (unfiltered, "depuis le début") ────────────────────────────────────
  const revenueTotal = useMemo(
    () => venueLines.reduce((sum, l) => sum + l.earnings_tnd, 0),
    [venueLines],
  );
  const revenueSeries = useMemo(
    () =>
      cumulativeSeries(
        venueLines.map((l) => ({
          date: l.campaign_end ?? l.reconciled_at.slice(0, 10),
          value: l.earnings_tnd,
        })),
      ),
    [venueLines],
  );
  const audienceTotal = useMemo(
    () => months.reduce((sum, m) => sum + m.total_audience, 0),
    [months],
  );
  const audienceSeries = useMemo(
    () => cumulativeSeries(months.map((m) => ({ date: `${m.month}-01`, value: m.total_audience }))),
    [months],
  );

  // ── Period-driven derivations ───────────────────────────────────────────────
  const periodLines = useMemo(
    () => venueLines.filter((l) => lineInPeriod(l, range)),
    [venueLines, range],
  );
  const periodAudience = useMemo(() => dailyAudienceWithin(months, range), [months, range]);
  const kpis = useMemo(
    () =>
      audienceKpis(
        periodAudience,
        openHoursPerDay(profile.data?.opening_hour ?? null, profile.data?.closing_hour ?? null),
      ),
    [periodAudience, profile.data],
  );
  const periodDays = useMemo(() => days.filter((d) => inRange(d.date, range)), [days, range]);
  const category = categoryLabel(
    profile.data?.business_sector ?? null,
    profile.data?.class ?? null,
  );
  const breakdown = useMemo(
    () => (profile.data?.ratios ? demographicBreakdown(profile.data.ratios, kpis.global) : null),
    [profile.data, kpis.global],
  );
  const revenueRows: RevenueRow[] = useMemo(
    () =>
      periodLines.map((l) => ({
        id: `${l.campaign_id}-${l.screenhost_id}`,
        name: l.campaign_name,
        period: formatCompactPeriod(l.campaign_start, l.campaign_end),
        amountLabel: `${formatTndFr(l.earnings_tnd)} TND`,
      })),
    [periodLines],
  );
  const campaignRows: CampaignTableRow[] = useMemo(
    () =>
      periodLines.map((l) => ({
        id: `${l.campaign_id}-${l.screenhost_id}`,
        name: l.campaign_name,
        period: formatTablePeriod(l.campaign_start, l.campaign_end),
        typeLabel: typeLabelFr(l.campaign_type),
        statut: campaignStatut(l, todayIso),
        impressions: l.delivered_imp,
        revenueLabel: formatTndCellFr(l.earnings_tnd),
      })),
    [periodLines, todayIso],
  );
  const top3 = useMemo(
    () =>
      [...periodLines]
        .sort((a, b) => b.delivered_imp - a.delivered_imp)
        .slice(0, 3)
        .map((l) => l.campaign_name),
    [periodLines],
  );
  const cumulativeImpressions = useMemo(
    () => periodLines.reduce((sum, l) => sum + l.delivered_imp, 0),
    [periodLines],
  );

  // ── Monthly report actions ──────────────────────────────────────────────────
  const [downloading, setDownloading] = useState(false);
  const consultMonth = (month: string) => {
    if (!selectedId) return;
    window.open(
      `/api/screenhosts/${selectedId}/monthly-report?month=${encodeURIComponent(month)}`,
      '_blank',
      'noopener',
    );
  };
  const downloadMonth = async (month: string) => {
    if (!selectedId || downloading) return;
    setDownloading(true);
    try {
      const result = await downloadMonthlyReport(selectedId, month);
      if (result === 'no-data') toast('Pas encore de rapport pour ce mois.');
    } catch (err) {
      log.error({ err }, 'monthly report download failed');
      toast.error('Échec du téléchargement. Veuillez réessayer.');
    } finally {
      setDownloading(false);
    }
  };

  const anyError =
    profile.isError || monthlyStats.isError || impressions.isError || earnings.isError;

  return (
    <div className="min-h-screen bg-white">
      <div className="flex h-screen">
        <OwnerNavigation isDisabled={isDisabled} />
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <header className="border-b border-gray-100 bg-white">
            <div className="w-full px-4 py-3 sm:px-6 lg:px-8">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <h1 className="text-xl font-semibold text-brand-deep">Mes performances</h1>
                  <p className="hidden text-sm text-gray-500 sm:block">
                    Analysez l'activité de votre établissement et développez vos revenus
                  </p>
                </div>
                <div className="flex flex-shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => navigate('/owner-calendar-devices')}
                    aria-label="Piloter mon calendrier de diffusion"
                    title="Piloter mon calendrier de diffusion"
                    className="inline-flex flex-shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-2xl bg-brand-primary px-4 py-2.5 text-sm font-semibold text-brand-deep transition-colors hover:bg-brand-primary/90"
                  >
                    <Calendar className="h-4 w-4 flex-shrink-0" aria-hidden />
                    <span className="hidden lg:inline">Piloter mon calendrier de diffusion</span>
                  </button>
                  <OwnerNotificationsBell userId={user?.id} />
                </div>
              </div>
            </div>
          </header>

          <div className="flex-1 overflow-y-auto">
            <div className="w-full space-y-6 px-4 py-6 sm:px-6 lg:px-8">
              {screenhosts.isLoading ? (
                <div className="flex items-center justify-center gap-2 py-16 text-gray-400">
                  <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
                  <span className="text-sm">Chargement…</span>
                </div>
              ) : venues.length === 0 ? (
                <div className="rounded-2xl border-2 border-dashed border-gray-200 px-6 py-16 text-center text-sm text-gray-500">
                  Aucun établissement associé à votre compte.
                </div>
              ) : (
                <>
                  {venues.length > 1 && (
                    <div className="flex flex-wrap gap-2">
                      {venues.map((v) => {
                        const active = v.id === selectedId;
                        return (
                          <button
                            key={v.id}
                            type="button"
                            onClick={() => setSelectedId(v.id)}
                            aria-pressed={active}
                            className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary ${
                              active
                                ? 'bg-brand-deep text-white'
                                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                            }`}
                          >
                            {v.name}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {anyError && (
                    <p className="text-sm font-medium text-rose-500">
                      Impossible de charger les performances pour le moment.
                    </p>
                  )}

                  <MonthlyReportCard
                    latestMonth={latestMonth}
                    monthImpressions={latestMonth ? impressionsOfMonth(days, latestMonth.month) : 0}
                    campaignsCount={
                      latestMonth ? linesEndingInMonth(venueLines, latestMonth.month).length : 0
                    }
                    onConsult={() => latestMonth && consultMonth(latestMonth.month)}
                    onDownload={() => latestMonth && void downloadMonth(latestMonth.month)}
                    downloading={downloading}
                  />

                  <ReportsHistorySection
                    rows={historyRows}
                    onConsult={consultMonth}
                    onDownload={(month) => void downloadMonth(month)}
                  />

                  <ProgressHero
                    revenueTotal={revenueTotal}
                    revenueSeries={revenueSeries}
                    audienceTotal={audienceTotal}
                    audienceSeries={audienceSeries}
                  />

                  <PeriodFilters
                    active={period}
                    onSelect={setPeriod}
                    customFrom={customFrom}
                    customTo={customTo}
                    onCustomFromChange={setCustomFrom}
                    onCustomToChange={setCustomTo}
                    onApplyCustom={() => setAppliedCustom({ from: customFrom, to: customTo })}
                  />

                  <ReportIntro
                    venueName={venues.find((v) => v.id === selectedId)?.name ?? '—'}
                    range={range}
                    category={category}
                    campaignsCount={periodLines.length}
                  />

                  <AudienceKpisSection kpis={kpis} />

                  <PeakHoursHeatmap
                    grid={affluence.data?.grid ?? []}
                    hasData={affluence.data?.has_data ?? false}
                    openingHour={profile.data?.opening_hour ?? null}
                    closingHour={profile.data?.closing_hour ?? null}
                  />

                  <ImpressionsChartSection days={periodDays} />

                  <DemographicsSection breakdown={breakdown} category={category} />

                  <RevenueSection
                    total={periodLines.reduce((sum, l) => sum + l.earnings_tnd, 0)}
                    count={periodLines.length}
                    rows={revenueRows}
                  />

                  <CampaignsSection
                    count={periodLines.length}
                    cumulativeImpressions={cumulativeImpressions}
                    top3={top3}
                    rows={campaignRows}
                  />

                  <OptimisationSection />

                  <SpsSection />

                  <DownloadCta
                    latestMonth={latestMonth?.month ?? null}
                    downloading={downloading}
                    onDownload={() => latestMonth && void downloadMonth(latestMonth.month)}
                  />
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
