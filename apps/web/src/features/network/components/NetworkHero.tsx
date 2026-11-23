import type { ReactNode } from 'react';

import type { NetworkCopy } from '@/features/network/lib/network-copy';
import type { NetworkCell } from '@/features/network/lib/network-entries';

import CountUp from './CountUp';

interface NetworkHeroProps {
  copy: NetworkCopy;
  /** The counters and the « dans votre réseau » strip; omitted while a page has nothing yet. */
  summary?: {
    stats: Array<{ label: string; value: number | null }>;
    mine: { main: string; sub: string };
    cells: NetworkCell[];
  };
  /** Right-hand column: the map. */
  aside?: ReactNode;
  /** Shown under the lede in place of the summary (« Bientôt disponible »). */
  children?: ReactNode;
}

/** The dark hero of both pages: headline, lede, four counters, the network strip and the map. */
export default function NetworkHero({ copy, summary, aside, children }: NetworkHeroProps) {
  return (
    <section className="hero" aria-label={copy.heroLabel}>
      <div>
        <h2>
          <span>{copy.headline}</span>
          <em>{copy.headlineAccent}</em>
        </h2>
        <p className="lede">{copy.lede}</p>
        {summary && (
          <>
            <div className="stats">
              {summary.stats.map((s) => (
                <div key={s.label}>
                  <b>
                    <CountUp value={s.value} />
                  </b>
                  <span>{s.label}</span>
                </div>
              ))}
            </div>
            <div className="mine">
              <div className="row">
                <strong>{summary.mine.main}</strong>
                <small>{summary.mine.sub}</small>
              </div>
              <div className="cells" aria-hidden="true">
                {summary.cells.map((cell, i) => (
                  // The strip is positional: one cell per spot, in list order.
                  <i key={i} className={cell || undefined} />
                ))}
              </div>
            </div>
          </>
        )}
        {children}
      </div>
      {aside}
    </section>
  );
}
