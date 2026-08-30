import { Calendar, Loader2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';

import PageHeader from '@/components/PageHeader';
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
import { RevenueSection } from '../components/performance/RevenueSection';
import { SpsSection } from '../components/performance/SpsSection';
import {
  useOwnerEarnings,
  useVenueImpressionsDaily,
  useVenueMonthlyStats,
  useVenueAudience,
  useVenuePistes,
  useVenueProfile,
  useVenueReports,
  useVenueSps,
} from '../hooks/usePerformanceReads';
import { useScreenhostAffluence } from '../hooks/useScreenhostAffluence';
import { useScreenhostsMine } from '../hooks/useScreenhostsMine';
import { lineImpressions, sumLineImpressions } from '../lib/impressions-display';
import { downloadMonthlyReport } from '../lib/monthly-report';
import {
  audienceKpis,
  campaignStatut,
  campaignTypeLabel,
  categoryLabel,
  cumulativeSeries,
  demographicBreakdown,
  formatTndCellFr,
  hasCastData,
  hasHostData,
  impressionsOfMonth,
  lineInPeriod,
  linesEndingInMonth,
  openHours,
  venueReadsState,
  zeroFillDays,
} from '../lib/performance-derive';
import {
  type PeriodKey,
  formatDateFr,
  formatGeneratedAtFr,
  formatTablePeriod,
  impressionsFetchWindow,
  inRange,
  isoDate,
  resolvePeriodRange,
  tunisToday,
} from '../lib/performance-period';
import {
  OUT_OF_WINDOW,
  type PreparedReport,
  ReportDownloadError,
  clampRangeForReport,
  fetchPeriodReport,
  reportErrorMessageFr,
  savePreparedReport,
} from '../lib/period-report';

const log = logger.child({ module: 'OwnerPerformance' });

/** Stable idle-query default so the S02 props never churn between renders. */
const EMPTY_COUNTS = { measured: 0, backup: 0 } as const;

/**
 * "Mes performances" (Lane F) — rebuilt per the two design mockups, entirely on the engine's
 * owner reads (profile / monthly-stats / impressions-daily / earnings / affluence). NO Supabase.
 * Every section is per-selected-venue; the period pills filter CLIENT-SIDE below them.
 */
export default function OwnerPerformance() {
  const navigate = useNavigate();
  const { user, needsApproval, validationStatus } = useAuthStore();
  const isDisabled = needsApproval && validationStatus === 'pending';

  // "today" is anchored ONCE per mount on the TUNIS calendar day (R8 — the server buckets
  // impressions on Africa/Tunis days; a browser-local anchor shifted edge-of-day points).
  const today = useMemo(() => tunisToday(), []);
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
  // PERF-QA1 — the three new owner reads: the generated-reports listing (R1, THE month
  // authority), the live SPS breakdown (R6) and the period pistes (R5).
  const reports = useVenueReports(selectedId);
  const sps = useVenueSps(selectedId);

  // Period pills — custom only applies on "Actualiser la recherche".
  const [period, setPeriod] = useState<PeriodKey>('28d');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [appliedCustom, setAppliedCustom] = useState<{ from: string; to: string } | undefined>();
  const range = useMemo(
    () => resolvePeriodRange(period, today, appliedCustom),
    [period, today, appliedCustom],
  );
  // R4 — the active range clamped to the api's 400-day bound (Tunis-anchored); null = the whole
  // period is older than the window. Feeds BOTH the period-report download and the pistes read
  // (the pistes endpoint carries the same bound).
  const reportRange = useMemo(() => clampRangeForReport(range, today), [range, today]);
  const pistes = useVenuePistes(
    reportRange ? selectedId : null,
    reportRange?.range.from ?? '',
    reportRange?.range.to ?? '',
  );
  // PERF-R1 — S01/S04 read the MERGED période audience from the api (PAX day first, the
  // affluence grid otherwise — one server-side rule, shared with the PDF twin). Carries the
  // ACTIVE période on the wire and re-fetches when the pills change, like the pistes read.
  const audience = useVenueAudience(selectedId, range.from, range.to);
  // PERF-R2 — the heatmap read carries the période too: the api masks the weekdays the période
  // does not contain (a 7+-day période keeps the whole week).
  const affluence = useScreenhostAffluence(selectedId, range);

  // ── Per-venue datasets ──────────────────────────────────────────────────────
  const months = useMemo(() => monthlyStats.data?.months ?? [], [monthlyStats.data]);
  const days = useMemo(() => impressions.data?.days ?? [], [impressions.data]);
  const venueLines = useMemo(
    () => (earnings.data?.lines ?? []).filter((l) => l.screenhost_id === selectedId),
    [earnings.data, selectedId],
  );

  // R1 — the generated-reports listing is THE month authority: card = newest row, Historique =
  // the rest. monthly_stats only DECORATES a report month with its audience figure (a hub-pushed
  // stats month with no stored report is no longer surfaced as a report).
  const reportRows = useMemo(() => reports.data?.reports ?? [], [reports.data]);
  const latestReport = reportRows[0] ?? null;
  const latestMonth = useMemo(() => {
    if (!latestReport) return null;
    const stat = months.find((m) => m.month === latestReport.month);
    return { month: latestReport.month, total_audience: stat?.total_audience ?? 0 };
  }, [latestReport, months]);

  // ── HOST/CAST first-data flags (Mejri ruling) — they NEVER gate each other's sections ─────────
  const affluenceGrid = useMemo(() => affluence.data?.grid ?? [], [affluence.data]);
  const hostHasData = useMemo(() => hasHostData(months, affluenceGrid), [months, affluenceGrid]);
  const castHasData = useMemo(() => hasCastData(venueLines, days), [venueLines, days]);
  const historyRows = useMemo(
    () =>
      reportRows.slice(1).map((r) => ({
        month: r.month,
        totalAudience: months.find((m) => m.month === r.month)?.total_audience ?? 0,
        impressions: impressionsOfMonth(days, r.month),
        generatedAtLabel: formatGeneratedAtFr(r.generated_at),
      })),
    [reportRows, months, days],
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
  const periodAudience = useMemo(() => audience.data?.days ?? [], [audience.data]);
  // PERF-R2 (supersedes AFF1's « never the période ») — S02 renders the hub's MERGED PAX-first
  // grid WITH provenance, MASKED api-side to the weekdays the période contains (colour = level,
  // outline = source, unchanged).
  const affluenceSources = useMemo(() => affluence.data?.sources ?? [], [affluence.data]);
  const affluenceCounts = affluence.data?.counts ?? EMPTY_COUNTS;
  // R9 — real venue hours; 14 h is ONLY the null/degenerate fallback and is flagged as such.
  const hoursInfo = useMemo(
    () => openHours(profile.data?.opening_hour ?? null, profile.data?.closing_hour ?? null),
    [profile.data],
  );
  const kpis = useMemo(
    () => audienceKpis(periodAudience, hoursInfo.hours),
    [periodAudience, hoursInfo],
  );
  // S03 days: zero-filled over the period∩fetch-window UNCONDITIONALLY (R8 — 0 = day without
  // data, on the server's Tunis calendar); the section's pending placeholder still gates on
  // castHasData, so the pre-first-deal state is unchanged.
  const periodDays = useMemo(() => {
    const inWindow = days.filter((d) => inRange(d.date, range));
    const clamped = {
      from: range.from > fetchWindow.from ? range.from : fetchWindow.from,
      to: range.to < fetchWindow.to ? range.to : fetchWindow.to,
    };
    return zeroFillDays(inWindow, clamped);
  }, [days, range, fetchWindow]);
  const category = categoryLabel(
    profile.data?.business_sector ?? null,
    profile.data?.class ?? null,
  );
  const breakdown = useMemo(
    () => (profile.data?.ratios ? demographicBreakdown(profile.data.ratios, kpis.global) : null),
    [profile.data, kpis.global],
  );
  const campaignRows: CampaignTableRow[] = useMemo(
    () =>
      periodLines.map((l) => ({
        id: `${l.campaign_id}-${l.screenhost_id}`,
        name: l.campaign_name,
        period: formatTablePeriod(l.campaign_start, l.campaign_end),
        typeLabel: campaignTypeLabel(l.campaign_type),
        statut: campaignStatut(l, todayIso),
        // R10 — every line-derived impressions figure routes through the ONE display home.
        impressions: lineImpressions(l),
        revenueLabel: formatTndCellFr(l.earnings_tnd),
      })),
    [periodLines, todayIso],
  );
  const top3 = useMemo(
    () =>
      [...periodLines]
        .sort((a, b) => lineImpressions(b) - lineImpressions(a))
        .slice(0, 3)
        .map((l) => l.campaign_name),
    [periodLines],
  );
  const cumulativeImpressions = useMemo(() => sumLineImpressions(periodLines), [periodLines]);

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
      // R4 — per-class copy (storage vs render vs the generic default), never one blind toast.
      toast.error(reportErrorMessageFr(err instanceof ReportDownloadError ? err.code : null));
    } finally {
      setDownloading(false);
    }
  };
  // R1 — the bottom CTA: the ON-DEMAND period report over the ACTIVE filter range, CLAMPED to
  // the api's 400-day bound (R4 — « Depuis le début » works instead of round-tripping to a
  // guaranteed 400; the clamp is announced under the button). The monthly card/history buttons
  // above keep their stored-artifact URLs.
  //
  // PERF-DL1 — TWO-PHASE: « Télécharger » runs the ~30 s render and HOLDS the blob; the save
  // happens on the SECOND click (« Enregistrer ») so the anchor download carries fresh user
  // activation — a save fired from the long await gets silently canceled by the browser (the
  // downloads-DB-verified defect). The prepared blob dies on any venue/range change.
  const [periodPhase, setPeriodPhase] = useState<'idle' | 'generating' | 'ready'>('idle');
  const [preparedReport, setPreparedReport] = useState<PreparedReport | null>(null);
  const periodRequestSeq = useRef(0);
  useEffect(() => {
    // Venue or applied range changed: the held blob no longer matches what the CTA describes.
    periodRequestSeq.current += 1;
    setPeriodPhase('idle');
    setPreparedReport(null);
  }, [selectedId, range.from, range.to]);
  const generatePeriod = async () => {
    if (!selectedId || periodPhase === 'generating') return;
    if (!reportRange) {
      toast.error(reportErrorMessageFr(OUT_OF_WINDOW));
      return;
    }
    const seq = (periodRequestSeq.current += 1);
    setPeriodPhase('generating');
    setPreparedReport(null);
    try {
      const prepared = await fetchPeriodReport(selectedId, reportRange.range);
      if (periodRequestSeq.current !== seq) return; // venue/range changed mid-render — stale
      setPreparedReport(prepared);
      setPeriodPhase('ready');
      toast.success('Votre rapport est prêt.');
    } catch (err) {
      log.error({ err }, 'period report generation failed');
      toast.error(reportErrorMessageFr(err instanceof ReportDownloadError ? err.code : null));
      if (periodRequestSeq.current === seq) setPeriodPhase('idle');
    }
  };
  const savePeriod = () => {
    if (!preparedReport) return;
    try {
      savePreparedReport(preparedReport);
      toast.success('Téléchargement lancé.');
      setPeriodPhase('idle');
      setPreparedReport(null);
    } catch (err) {
      log.error({ err }, 'period report save failed');
      toast.error(reportErrorMessageFr(null));
    }
  };
  // R4 — when the active period exceeds the api window, say EXACTLY what the PDF will cover.
  const clampNote = reportRange?.clamped
    ? `Le PDF couvrira la période du ${formatDateFr(reportRange.range.from)} au ${formatDateFr(reportRange.range.to)} (fenêtre de rapport : 400 derniers jours).`
    : null;

  // INV-1 — the surface gate: sections (and the first-data flags they read) render only from
  // SETTLED per-venue reads. A pending or failed read otherwise collapses to `?? []` defaults
  // and masquerades as « En attente du premier deal » / « Aucun rapport généré ». sps/pistes
  // stay outside the gate — their sections carry their own inline error states.
  const perfReads = [profile, monthlyStats, impressions, earnings, affluence, reports];
  const readsState = venueReadsState(
    perfReads.map((r) => ({ pending: r.isPending, error: r.isError })),
  );
  const retryFailedReads = () => {
    for (const read of perfReads) {
      if (read.isError) void read.refetch();
    }
  };

  return (
    <div className="perf-page min-h-screen bg-perf-page">
      <div className="flex h-screen">
        <OwnerNavigation isDisabled={isDisabled} />
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto">
            {/* PERF-QA2 — the page's top chrome is WHITE, edge to edge, over the grey page
                (Mes Performances design reference). The bar spans the scroller; its contents stay
                on the 1180px content column so nothing shifts sideways. */}
            <header className="border-b border-perf-line bg-white">
              <div className="mx-auto flex w-full max-w-[1180px] flex-col justify-between gap-4 px-5 py-[22px] sm:flex-row sm:items-center sm:gap-6 sm:px-10">
                <PageHeader
                  title="Mes performances"
                  subtitle="Analysez l'activité de votre établissement et développez vos revenus"
                />
                <div className="flex flex-shrink-0 flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => navigate('/owner-calendar-devices')}
                    className="inline-flex items-center gap-[9px] whitespace-nowrap rounded-full bg-brand-primary px-5 py-3 text-[13.5px] font-semibold text-[#0D2B1F] shadow-[0_1px_2px_rgba(13,43,31,0.06)] transition-colors hover:bg-[#65DCA0]"
                  >
                    <Calendar className="h-[15px] w-[15px] flex-shrink-0" aria-hidden />
                    <span>Piloter mon calendrier de diffusion</span>
                  </button>
                  <OwnerNotificationsBell userId={user?.id} />
                </div>
              </div>
            </header>
            <div className="mx-auto w-full max-w-[1180px] px-5 pb-16 pt-7 sm:px-10 sm:pb-24">
              {screenhosts.isLoading ? (
                <div className="flex items-center justify-center gap-2 py-16 text-perf-mist">
                  <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
                  <span className="text-sm">Chargement…</span>
                </div>
              ) : venues.length === 0 ? (
                <div className="rounded-xl border border-dashed border-perf-line bg-white px-6 py-16 text-center text-sm text-perf-grey">
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
                            className={`rounded-full px-[17px] py-[9px] text-[13px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary ${
                              active
                                ? 'border border-brand-primary bg-brand-primary font-semibold text-[#0D2B1F]'
                                : 'border border-perf-line bg-white font-medium text-perf-grey hover:border-perf-green hover:text-perf-ink'
                            }`}
                          >
                            {v.name}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {readsState === 'error' ? (
                    <div className="mt-7 rounded-xl border border-rose-200 bg-rose-50/60 px-6 py-14 text-center">
                      <p className="text-sm font-medium text-rose-600">
                        Impossible de charger les performances pour le moment.
                      </p>
                      <button
                        type="button"
                        onClick={retryFailedReads}
                        className="mt-4 rounded-full border border-rose-300 bg-white px-5 py-2 text-[13px] font-semibold text-rose-600 transition-colors hover:bg-rose-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"
                      >
                        Réessayer
                      </button>
                    </div>
                  ) : readsState === 'loading' ? (
                    <div className="flex items-center justify-center gap-2 py-16 text-perf-mist">
                      <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
                      <span className="text-sm">Chargement…</span>
                    </div>
                  ) : (
                    <>
                      <MonthlyReportCard
                        latestMonth={latestMonth}
                        generatedAtLabel={
                          latestReport ? formatGeneratedAtFr(latestReport.generated_at) : null
                        }
                        monthImpressions={
                          latestMonth ? impressionsOfMonth(days, latestMonth.month) : 0
                        }
                        campaignsCount={
                          latestMonth ? linesEndingInMonth(venueLines, latestMonth.month).length : 0
                        }
                        hasHostData={hostHasData}
                        hasCastData={castHasData}
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
                        hasHostData={hostHasData}
                        hasCastData={castHasData}
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
                        hasCastData={castHasData}
                      />

                      <AudienceKpisSection
                        kpis={kpis}
                        hasHostData={hostHasData}
                        hoursEstimated={hoursInfo.estimated}
                      />

                      <PeakHoursHeatmap
                        grid={affluenceGrid}
                        sources={affluenceSources}
                        hasData={affluence.data?.has_data ?? false}
                        counts={affluenceCounts}
                        openingHour={profile.data?.opening_hour ?? null}
                        closingHour={profile.data?.closing_hour ?? null}
                      />

                      <ImpressionsChartSection days={periodDays} hasCastData={castHasData} />

                      <DemographicsSection
                        breakdown={breakdown}
                        category={category}
                        hasHostData={hostHasData}
                      />

                      <RevenueSection
                        total={periodLines.reduce((sum, l) => sum + l.earnings_tnd, 0)}
                        count={periodLines.length}
                        hasCastData={castHasData}
                      />

                      <CampaignsSection
                        count={periodLines.length}
                        cumulativeImpressions={cumulativeImpressions}
                        top3={top3}
                        rows={campaignRows}
                        hasCastData={castHasData}
                      />

                      <OptimisationSection pistes={pistes.data?.pistes} isError={pistes.isError} />

                      <SpsSection sps={sps.data} isError={sps.isError} />

                      <DownloadCta
                        hasData={hostHasData || castHasData}
                        phase={periodPhase}
                        onGenerate={() => void generatePeriod()}
                        onSave={savePeriod}
                        clampNote={clampNote}
                      />
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
