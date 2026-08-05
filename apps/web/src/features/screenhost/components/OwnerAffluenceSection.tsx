import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertCircle,
  CalendarDays,
  Clock,
  Download,
  Loader2,
  TrendingUp,
  Users,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { useAuthStore } from '@/features/auth/stores/auth.store';
import { logger } from '@/lib/logger';

import { useVenueReports } from '../hooks/usePerformanceReads';
import { useScreenhostAffluence } from '../hooks/useScreenhostAffluence';
import { useScreenhostsMine } from '../hooks/useScreenhostsMine';
import { DAY_LABELS, DAY_LABELS_SHORT, formatHour, summarize } from '../lib/affluence-grid';
import { downloadMonthlyReport } from '../lib/monthly-report';
import { monthLabelFr } from '../lib/performance-period';
import { ReportDownloadError, reportErrorMessageFr } from '../lib/period-report';

const log = logger.child({ module: 'OwnerAffluenceSection' });

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-4">
      <div className="flex items-center gap-2 text-gray-500">
        {icon}
        <span className="text-xs font-medium">{label}</span>
      </div>
      <p className="mt-2 text-2xl font-bold tracking-tight text-brand-deep tabular-nums">{value}</p>
    </div>
  );
}

// Owner-dashboard "Votre audience" section: the venue's typical-week affluence (weekday × hour
// heatmap + summary). fleet_owner gets a venue selector; individual_owner has one venue. Self-
// contained — reads the session + fetches its own data. Hidden entirely when the owner has no venue.
export function OwnerAffluenceSection() {
  const { user, profileType } = useAuthStore();
  const screenhosts = useScreenhostsMine(user?.id);
  const venues = useMemo(() => screenhosts.data ?? [], [screenhosts.data]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => {
    if (selectedId === null && venues.length > 0) setSelectedId(venues[0]?.id ?? null);
  }, [venues, selectedId]);

  const affluence = useScreenhostAffluence(selectedId);
  const grid = useMemo(() => affluence.data?.grid ?? [], [affluence.data]);
  const hasData = affluence.data?.has_data ?? false;
  const summary = useMemo(() => summarize(grid), [grid]);

  // Monthly-report download (SEPARATE table from affluence — gated on selectedId only, never on
  // affluence has_data). PERF-QA1 R1 — the free <input type=month> guess is REPLACED by the
  // generated-reports LISTING: only months a report actually exists for are offered, defaulting
  // to the newest.
  const reports = useVenueReports(selectedId);
  const reportRows = useMemo(() => reports.data?.reports ?? [], [reports.data]);
  const [month, setMonth] = useState<string | null>(null);
  useEffect(() => {
    // Default to the newest generated report; re-resolve when the venue (hence the listing)
    // changes or the selected month is no longer offered.
    if (month === null || !reportRows.some((r) => r.month === month)) {
      setMonth(reportRows[0]?.month ?? null);
    }
  }, [reportRows, month]);
  const [downloading, setDownloading] = useState(false);
  const [reportNotice, setReportNotice] = useState<{ kind: 'info' | 'error'; text: string } | null>(
    null,
  );

  // Clear any stale "no report" / error notice when the owner switches venue. This does NOT fetch —
  // the binary report is only ever requested on an explicit button click.
  useEffect(() => {
    setReportNotice(null);
  }, [selectedId]);

  const handleDownloadReport = async () => {
    if (!selectedId || !month || downloading) return;
    setReportNotice(null);
    setDownloading(true);
    try {
      const result = await downloadMonthlyReport(selectedId, month);
      if (result === 'no-data') {
        setReportNotice({ kind: 'info', text: 'Pas encore de rapport pour ce mois.' });
      }
    } catch (err) {
      log.error({ err }, 'monthly report download failed');
      // PERF-QA1 R4 — per-class copy (storage vs render vs generic), never one blind toast.
      setReportNotice({
        kind: 'error',
        text: reportErrorMessageFr(err instanceof ReportDownloadError ? err.code : null),
      });
    } finally {
      setDownloading(false);
    }
  };

  // Hide the whole section while we don't yet know the venues, or when there are none.
  if (screenhosts.isLoading) {
    return (
      <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-center gap-2 py-10 text-gray-400">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm">Chargement…</span>
        </div>
      </section>
    );
  }
  if (venues.length === 0) return null;

  const isFleet = profileType === 'fleet_owner';
  const peakDay = summary.peakDayIndex !== null ? (DAY_LABELS[summary.peakDayIndex] ?? '—') : '—';
  const peakHour = summary.peakHourIndex !== null ? formatHour(summary.peakHourIndex) : '—';

  return (
    <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
      <header className="mb-1 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-brand-deep">Votre audience</h2>
          <p className="text-sm text-gray-500">
            Votre semaine type (moyenne glissante sur les 4 dernières semaines), par jour et par
            heure.
          </p>
        </div>

        {selectedId && (
          <div className="flex flex-col gap-1 sm:items-end">
            <div className="flex items-center gap-2">
              <select
                value={month ?? ''}
                onChange={(e) => setMonth(e.target.value || null)}
                disabled={reportRows.length === 0}
                aria-label="Mois du rapport mensuel"
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary disabled:cursor-not-allowed disabled:opacity-50"
              >
                {reportRows.length === 0 ? (
                  <option value="">Aucun rapport généré</option>
                ) : (
                  reportRows.map((r) => (
                    <option key={r.month} value={r.month}>
                      {monthLabelFr(r.month)}
                    </option>
                  ))
                )}
              </select>
              <button
                type="button"
                onClick={handleDownloadReport}
                disabled={downloading || !month}
                className="inline-flex items-center gap-1.5 rounded-lg bg-brand-deep px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-deep/90 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
              >
                {downloading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                Télécharger le rapport mensuel
              </button>
            </div>
            {reportNotice && (
              <p
                className={`text-xs ${
                  reportNotice.kind === 'error' ? 'text-red-500' : 'text-gray-500'
                }`}
                role="status"
              >
                {reportNotice.text}
              </p>
            )}
          </div>
        )}
      </header>

      {isFleet && venues.length > 1 && (
        <div className="mt-4 flex flex-wrap gap-2">
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

      <div className="mt-6">
        <AnimatePresence mode="wait">
          <motion.div
            key={selectedId ?? 'none'}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            {affluence.isLoading ? (
              <div className="flex items-center justify-center gap-2 py-12 text-gray-400">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="text-sm">Chargement de l’affluence…</span>
              </div>
            ) : affluence.isError ? (
              <div className="flex items-center justify-center gap-2 py-12 text-red-500">
                <AlertCircle className="h-5 w-5" />
                <span className="text-sm">Impossible de charger l’affluence.</span>
              </div>
            ) : !hasData ? (
              <div className="rounded-2xl border-2 border-dashed border-gray-200 px-6 py-12 text-center">
                <Users className="mx-auto h-8 w-8 text-gray-300" />
                <p className="mt-3 font-medium text-brand-deep">
                  Pas encore de données d’affluence
                </p>
                <p className="mt-1 text-sm text-gray-500">
                  Les données d’affluence apparaîtront ici dès que votre écran commence à collecter.
                </p>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <StatCard
                    icon={<CalendarDays className="h-4 w-4" />}
                    label="Jour le plus fréquenté"
                    value={peakDay}
                  />
                  <StatCard
                    icon={<Clock className="h-4 w-4" />}
                    label="Heure de pointe"
                    value={peakHour}
                  />
                  <StatCard
                    icon={<Users className="h-4 w-4" />}
                    label="Audience moyenne / jour"
                    value={summary.dailyAverage.toLocaleString('fr-FR')}
                  />
                  <StatCard
                    icon={<TrendingUp className="h-4 w-4" />}
                    label="Audience hebdomadaire"
                    value={summary.weeklyTotal.toLocaleString('fr-FR')}
                  />
                </div>
                <div>
                  <h3 className="mb-3 text-sm font-semibold text-gray-500">Affluence par jour</h3>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
                    {DAY_LABELS_SHORT.map((label, day) => {
                      const total = summary.dayTotals[day] ?? 0;
                      const isPeak = day === summary.peakDayIndex && total > 0;
                      return (
                        <div
                          key={label}
                          className={`rounded-xl border p-3 text-center ${
                            isPeak
                              ? 'border-brand-primary bg-brand-primary/10'
                              : 'border-gray-100 bg-gray-50/60'
                          }`}
                        >
                          <p className="text-xs font-medium text-gray-500">{label}</p>
                          <p className="mt-1 text-lg font-bold tabular-nums text-brand-deep">
                            {total.toLocaleString('fr-FR')}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </section>
  );
}
