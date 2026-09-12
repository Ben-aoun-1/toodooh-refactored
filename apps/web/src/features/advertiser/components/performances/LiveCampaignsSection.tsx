import { ChevronDown } from 'lucide-react';
import { useState } from 'react';

import { formatIntFr } from '@/features/screenhost/lib/performance-derive';
import { formatDateFr } from '@/features/screenhost/lib/performance-period';

import { LIVE_EMPTY, liveFold, voirPlusLabel } from '../../lib/performances-derive';
import type { LiveCampaignWire } from '../../services/performances.service';

import { SectionHeading } from './shared';

/**
 * Epic 1 — « Vos campagnes en cours » (US-1.1 / US-1.2): one card per campaign en diffusion,
 * three live counters, 3 shown then « Voir plus (n) ». Independent of clôture and of the filter.
 * Audience null = no affluence source behind the credited hours → « — » with a note, never 0.
 */
export function LiveCampaignsSection({ campaigns }: { campaigns: LiveCampaignWire[] }) {
  const [expanded, setExpanded] = useState(false);
  const { visible, hidden } = liveFold(campaigns, expanded);
  const anyUnknownAudience = campaigns.some((c) => c.audience === null);

  return (
    <section className="mb-[64px]" aria-labelledby="live-title">
      <SectionHeading
        num="Temps réel"
        title="Vos campagnes en cours"
        lead="Le suivi en direct de vos campagnes actuellement diffusées, dès leur lancement — avant même leur clôture."
      />
      <span id="live-title" className="sr-only">
        Vos campagnes en cours
      </span>
      {campaigns.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-perf-line bg-white px-6 py-8 text-center text-[13.5px] italic text-perf-mist">
          {LIVE_EMPTY}
        </div>
      ) : (
        <>
          <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {visible.map((c) => (
              <article
                key={c.id}
                className="rounded-[14px] border border-perf-line bg-white p-5 transition-shadow hover:shadow-[0_4px_18px_rgba(16,37,26,0.05)]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="text-[15px] font-semibold leading-[1.3] text-perf-ink">
                    {c.name}
                  </div>
                  <span className="perf-mono inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[#E4F9EB] px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-[#0D2B1F]">
                    <span
                      className="h-1.5 w-1.5 animate-pulse rounded-full bg-perf-green"
                      aria-hidden
                    />
                    En cours
                  </span>
                </div>
                <div className="mt-1.5 text-[12.5px] text-perf-grey">
                  {c.launched_on ? `Lancée le ${formatDateFr(c.launched_on)}` : 'Lancée'}
                </div>
                <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-perf-line pt-4">
                  <div>
                    <dd className="text-[20px] font-semibold tracking-[-0.02em] text-perf-ink">
                      {c.audience === null ? '—' : formatIntFr(c.audience)}
                    </dd>
                    <dt className="perf-mono mt-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-perf-mist">
                      Audience
                    </dt>
                  </div>
                  <div>
                    <dd className="text-[20px] font-semibold tracking-[-0.02em] text-perf-ink">
                      {formatIntFr(c.plays)}
                    </dd>
                    <dt className="perf-mono mt-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-perf-mist">
                      Passages spot
                    </dt>
                  </div>
                  <div>
                    <dd className="text-[20px] font-semibold tracking-[-0.02em] text-perf-ink">
                      {formatIntFr(c.venues)}
                    </dd>
                    <dt className="perf-mono mt-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-perf-mist">
                      Établ. touchés
                    </dt>
                  </div>
                </dl>
              </article>
            ))}
          </div>
          {anyUnknownAudience ? (
            <p className="mt-3 text-[12px] italic text-perf-mist">
              « — » : l’audience mesurée n’est pas encore disponible pour les lieux de cette
              campagne.
            </p>
          ) : null}
          {hidden > 0 || expanded ? (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-perf-line bg-white px-4 py-2 text-[13px] font-medium text-perf-grey transition-colors hover:border-perf-green hover:text-perf-ink"
            >
              {expanded ? 'Voir moins' : voirPlusLabel(hidden)}
              <ChevronDown
                className={`h-4 w-4 transition-transform ${expanded ? 'rotate-180' : ''}`}
                aria-hidden
              />
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}
