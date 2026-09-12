import { Loader2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'react-hot-toast';
import { useSearchParams } from 'react-router-dom';

import { useAuthStore } from '@/features/auth/stores/auth.store';
import { logger } from '@/lib/logger';

import { AnalysisFilterBar } from '../components/performances/AnalysisFilterBar';
import { AnalysisSections } from '../components/performances/AnalysisSections';
import { FootprintSection } from '../components/performances/FootprintSection';
import { HistorySection } from '../components/performances/HistorySection';
import { LastReportCard } from '../components/performances/LastReportCard';
import { LiveCampaignsSection } from '../components/performances/LiveCampaignsSection';
import { OpportunitiesSection } from '../components/performances/OpportunitiesSection';
import { WaitingCard } from '../components/performances/shared';
import {
  useAnalysis,
  useClosedCampaigns,
  useFootprint,
  useLiveCampaigns,
} from '../hooks/usePerformances';
import {
  WAITING_ANALYSIS,
  WAITING_TITLE,
  awaitingFirstClosure,
  readsState,
} from '../lib/performances-derive';
import {
  type NatureFilter,
  type PeriodKey,
  type Scope,
  defaultScope,
  parseScope,
  resolveRange,
  writeScope,
} from '../lib/performances-period';
import { type ClosedCampaignWire, performancesService } from '../services/performances.service';

const log = logger.child({ module: 'AdvertiserPerformances' });

/**
 * SC-P — « Mes performances » (Screencaster), Mejri's v2 user stories (ruled THE spec
 * 2026-09-12). Section order = simulator A: epic 1 live cards → epic 3 last report → epic 4
 * history → epic 5 footprint → epic 6 filter + epic 7 sections 01–04 (or the ONE waiting
 * message, US-6.6) → epic 9 static opportunities. Section 05 is out.
 *
 * The analysed scope lives in the URL (`?campaign=` | `?periode=…`) so Consulter, the bell's
 * deep link and the filter-bar selector are the same mechanism (US-4.2 / US-2.1 / US-6.4).
 * INV-1: nothing renders as data until every read settled; one error card, one retry.
 */
export default function AdvertiserPerformances() {
  const user = useAuthStore((s) => s.user);
  const userId = user?.id;
  const [searchParams, setSearchParams] = useSearchParams();

  const closedQ = useClosedCampaigns(userId);
  const liveQ = useLiveCampaigns(userId);
  const footprintQ = useFootprint(userId);

  const closed = useMemo(() => closedQ.data?.campaigns ?? [], [closedQ.data]);
  const awaiting = awaitingFirstClosure(closed.length);

  // The scope: URL first, else the retained hypothesis (last closed campaign).
  const urlScope = useMemo(() => parseScope(searchParams), [searchParams]);
  const scope: Scope = urlScope ?? defaultScope(closed);
  const activeCampaignId = scope.mode === 'campaign' ? scope.campaignId : null;

  const analysisQuery = useMemo(() => {
    if (awaiting) return null;
    if (scope.mode === 'campaign') return { campaignId: scope.campaignId };
    const range = resolveRange(scope);
    if (range.incomplete) return null;
    return { from: range.from, to: range.to, nature: scope.nature };
  }, [awaiting, scope]);
  const analysisQ = useAnalysis(userId, analysisQuery);

  const state = readsState([
    { pending: closedQ.isPending, error: closedQ.isError },
    { pending: liveQ.isPending, error: liveQ.isError },
    { pending: footprintQ.isPending, error: footprintQ.isError },
  ]);

  const setScope = useCallback(
    (next: Scope) => setSearchParams(writeScope(searchParams, next), { replace: true }),
    [searchParams, setSearchParams],
  );

  // Consulter (US-4.2) — Campaign mode + scroll to the detail block; the history row highlights.
  const analysisRef = useRef<HTMLDivElement>(null);
  const [pendingScroll, setPendingScroll] = useState(false);
  const consult = useCallback(
    (id: string) => {
      setScope({ mode: 'campaign', campaignId: id });
      setPendingScroll(true);
    },
    [setScope],
  );
  useEffect(() => {
    if (!pendingScroll) return;
    analysisRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setPendingScroll(false);
  }, [pendingScroll, activeCampaignId]);

  // The bell's deep link lands with ?campaign=: scroll once the data is there (US-2.1).
  const deepLinked = useRef(false);
  useEffect(() => {
    if (deepLinked.current || state !== 'ready' || !urlScope || urlScope.mode !== 'campaign')
      return;
    deepLinked.current = true;
    analysisRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [state, urlScope]);

  const periodScope = (
    period: PeriodKey,
    nature: NatureFilter,
    custom = { from: null as string | null, to: null as string | null },
  ): Scope => ({
    mode: 'period',
    period,
    nature,
    custom,
  });
  const currentNature: NatureFilter = scope.mode === 'period' ? scope.nature : 'all';
  const currentPeriod: PeriodKey = scope.mode === 'period' ? scope.period : '90d';
  const currentCustom = scope.mode === 'period' ? scope.custom : { from: null, to: null };

  // Download (US-3.3 / US-4.2) — the api renders the PDF on the fly; save through an anchor.
  const [downloading, setDownloading] = useState<string | null>(null);
  const download = useCallback(async (campaign: ClosedCampaignWire) => {
    setDownloading(campaign.id);
    try {
      const blob = await performancesService.downloadReport(campaign.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `rapport-${campaign.closed_on}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      log.error({ error }, 'Erreur lors du téléchargement du rapport de campagne');
      toast.error('Erreur lors du téléchargement du rapport. Veuillez réessayer.');
    } finally {
      setDownloading(null);
    }
  }, []);

  const retry = () => {
    void closedQ.refetch();
    void liveQ.refetch();
    void footprintQ.refetch();
  };

  return (
    <div className="perf-page w-full pt-2">
      {state === 'loading' ? (
        <div className="flex items-center justify-center gap-2 py-24 text-perf-mist">
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
          <span className="text-sm">Chargement…</span>
        </div>
      ) : state === 'error' ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50/60 px-6 py-14 text-center">
          <p className="text-sm text-rose-700">
            Impossible de charger vos performances pour le moment.
          </p>
          <button
            type="button"
            onClick={retry}
            className="mt-4 rounded-full bg-brand-primary px-5 py-2 text-[13.5px] font-semibold text-[#0D2B1F] hover:bg-[#65DCA0]"
          >
            Réessayer
          </button>
        </div>
      ) : (
        <>
          <LiveCampaignsSection campaigns={liveQ.data?.campaigns ?? []} />

          <LastReportCard
            latest={closed[0] ?? null}
            onConsult={consult}
            onDownload={(c) => void download(c)}
            downloading={downloading}
          />

          <HistorySection
            campaigns={closed}
            activeId={activeCampaignId}
            onConsult={consult}
            onDownload={(c) => void download(c)}
            downloading={downloading}
          />

          <FootprintSection
            footprint={footprintQ.data ?? { points: [], totals: { impressions: 0, hours: 0 } }}
          />

          <div ref={analysisRef} className="scroll-mt-4">
            {awaiting ? (
              <section className="mb-[64px]">
                <WaitingCard title={WAITING_TITLE} text={WAITING_ANALYSIS} />
              </section>
            ) : (
              <>
                <AnalysisFilterBar
                  scope={scope}
                  closed={closed}
                  campaignCount={
                    analysisQ.data?.mode === 'period' ? analysisQ.data.overview.campaign_count : 0
                  }
                  onSelectPeriod={(key) => setScope(periodScope(key, currentNature))}
                  onSelectNature={(nature) =>
                    setScope(periodScope(currentPeriod, nature, currentCustom))
                  }
                  onSelectCampaign={consult}
                  onApplyCustom={(from, to) =>
                    setScope(periodScope('custom', currentNature, { from, to }))
                  }
                />
                {analysisQuery === null ? (
                  <p className="mb-[64px] text-[13.5px] italic text-perf-mist">
                    Renseignez une date de début et une date de fin, puis actualisez la recherche.
                  </p>
                ) : analysisQ.isError ? (
                  <div className="mb-[64px] rounded-xl border border-rose-200 bg-rose-50/60 px-6 py-10 text-center">
                    <p className="text-sm text-rose-700">
                      {scope.mode === 'campaign'
                        ? 'Cette campagne est introuvable parmi vos campagnes clôturées.'
                        : 'Impossible de générer l’analyse pour ce périmètre.'}
                    </p>
                    <button
                      type="button"
                      onClick={() => setScope(defaultScope(closed))}
                      className="mt-4 rounded-full bg-brand-primary px-5 py-2 text-[13.5px] font-semibold text-[#0D2B1F] hover:bg-[#65DCA0]"
                    >
                      Revenir à la dernière campagne clôturée
                    </button>
                  </div>
                ) : analysisQ.data ? (
                  <div
                    className={
                      analysisQ.isFetching ? 'opacity-70 transition-opacity' : 'transition-opacity'
                    }
                  >
                    <AnalysisSections analysis={analysisQ.data} />
                  </div>
                ) : (
                  <div className="mb-[64px] flex items-center justify-center gap-2 py-16 text-perf-mist">
                    <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
                    <span className="text-sm">Génération de l’analyse…</span>
                  </div>
                )}
              </>
            )}
          </div>

          <OpportunitiesSection />

          <footer className="flex flex-col gap-1 border-t border-perf-line pt-5 text-[12px] text-perf-mist sm:flex-row sm:justify-between">
            <span>Toodooh · Mes performances · Screencaster</span>
            <span className="perf-mono">Jump into Smarter Advertising</span>
          </footer>
        </>
      )}
    </div>
  );
}
