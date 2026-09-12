import { Download, Eye, Loader2, Megaphone } from 'lucide-react';

import { formatIntFr } from '@/features/screenhost/lib/performance-derive';
import { formatDateFr, monthLabelFr } from '@/features/screenhost/lib/performance-period';

import { WAITING_LAST_REPORT, WAITING_TITLE } from '../../lib/performances-derive';
import type { ClosedCampaignWire } from '../../services/performances.service';

import { WaitingCard } from './shared';

/**
 * Epic 3 — « Votre dernier rapport de campagne » (RG-PERF-05/06/07): the newest clôture, its
 * three key figures, Consulter + Télécharger. Filter-independent (RG-PERF-03). US-3.2: before
 * any clôture the card shows the waiting state — never zeros presented as results.
 */
export function LastReportCard({
  latest,
  onConsult,
  onDownload,
  downloading,
}: {
  latest: ClosedCampaignWire | null;
  onConsult: (id: string) => void;
  onDownload: (campaign: ClosedCampaignWire) => void;
  downloading: string | null;
}) {
  return (
    <section className="relative isolate mb-[64px] overflow-hidden rounded-[20px] border border-perf-line bg-[linear-gradient(155deg,#ECEDFD_0%,#FFFFFF_55%,#F5F6F8_100%)] p-[22px] sm:p-10">
      <div
        className="pointer-events-none absolute -top-[100px] right-[-80px] z-0 h-[280px] w-[280px] rounded-full bg-[radial-gradient(circle_at_35%_35%,#9195F8,transparent_72%)] opacity-[0.16] blur-[42px]"
        aria-hidden
      />
      <div className="perf-mono relative z-10 inline-flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-brand-accent">
        <Megaphone className="h-[13px] w-[13px]" aria-hidden />
        Rapports de campagne
      </div>
      <h2 className="relative z-10 mt-4 text-[26px] font-bold tracking-[-0.015em] text-perf-ink sm:text-[27px]">
        Votre dernier <em className="not-italic text-brand-accent">rapport de campagne</em>
      </h2>
      <p className="relative z-10 mt-3 max-w-[680px] text-[15px] leading-[1.6] text-perf-grey">
        À la clôture de chaque campagne, son rapport d’impact est disponible et vous êtes notifié.
        Consultez le dernier et retrouvez tout l’historique juste en dessous, à télécharger à tout
        moment.
      </p>

      <div className="relative z-10 mt-7">
        {latest === null ? (
          <WaitingCard title={WAITING_TITLE} text={WAITING_LAST_REPORT} />
        ) : (
          <div className="rounded-[14px] border border-perf-line bg-white p-5 sm:p-6">
            <div className="flex flex-wrap items-center gap-3">
              <span className="perf-mono rounded-full bg-brand-primary px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-[#0D2B1F]">
                Nouveau
              </span>
              <span className="text-[13px] text-perf-grey">
                Campagne clôturée le{' '}
                <span className="perf-mono font-semibold text-perf-ink">
                  {formatDateFr(latest.closed_on)}
                </span>
              </span>
            </div>
            <div className="mt-4 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
              <div className="min-w-0 flex-1">
                <div className="perf-mono text-[10.5px] font-semibold uppercase tracking-[0.1em] text-perf-mist">
                  Dernier rapport de campagne
                </div>
                <div className="mt-1.5 text-[20px] font-semibold leading-[1.25] text-perf-ink">
                  {latest.name} · {monthLabelFr(latest.closed_on.slice(0, 7))}
                </div>
                <dl className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div>
                    <dd className="text-[28px] font-semibold tracking-[-0.02em] text-perf-ink">
                      {formatIntFr(latest.impressions)}
                    </dd>
                    <dt className="mt-1 text-[12.5px] text-perf-grey">Impressions générées</dt>
                  </div>
                  <div>
                    <dd className="text-[28px] font-semibold tracking-[-0.02em] text-perf-ink">
                      {formatIntFr(latest.venues)}
                    </dd>
                    <dt className="mt-1 text-[12.5px] text-perf-grey">Établissements diffuseurs</dt>
                  </div>
                  <div>
                    <dd className="text-[28px] font-semibold tracking-[-0.02em] text-perf-ink">
                      {formatIntFr(latest.hours)}
                      <span className="ml-1 text-[14px] font-medium text-perf-mist">h</span>
                    </dd>
                    <dt className="mt-1 text-[12.5px] text-perf-grey">Heures de diffusion</dt>
                  </div>
                </dl>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2.5">
                <button
                  type="button"
                  onClick={() => onConsult(latest.id)}
                  className="inline-flex items-center gap-2 rounded-full bg-brand-primary px-[18px] py-[10px] text-[13.5px] font-semibold text-[#0D2B1F] transition-colors hover:bg-[#65DCA0]"
                >
                  <Eye className="h-4 w-4" aria-hidden />
                  Consulter
                </button>
                <button
                  type="button"
                  onClick={() => onDownload(latest)}
                  disabled={downloading === latest.id}
                  className="inline-flex items-center gap-2 rounded-full border border-perf-line bg-white px-[18px] py-[10px] text-[13.5px] font-semibold text-perf-ink transition-colors hover:border-perf-green disabled:opacity-60"
                >
                  {downloading === latest.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  ) : (
                    <Download className="h-4 w-4" aria-hidden />
                  )}
                  Télécharger
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
