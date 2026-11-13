import type { ReactNode } from 'react';

interface ImpactTilesProps {
  /** « Montant estimé » — already formatted (HT, lib/money). */
  amount: ReactNode;
  /** « Impressions prévues » — the dry-run's figure. */
  impressions: ReactNode;
}

const RING =
  'pointer-events-none absolute -bottom-4 -right-4 h-14 w-14 rounded-full border-[1.5px] border-white/35';

/** The récap's two figures, as the mockup's green and violet tiles. */
export default function ImpactTiles({ amount, impressions }: ImpactTilesProps) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="relative overflow-hidden rounded-lg bg-stadium-cta px-4 py-3">
        <p className="text-sm text-pitch-ink">Montant estimé</p>
        <p className="mt-1 text-2xl font-semibold text-pitch-ink">{amount}</p>
        <div aria-hidden="true" className={RING} />
      </div>
      <div className="relative overflow-hidden rounded-lg bg-stadium-violet px-4 py-3">
        <p className="text-sm text-white/90">Impressions prévues</p>
        <p className="mt-1 text-2xl font-semibold text-white">{impressions}</p>
        <div aria-hidden="true" className={RING} />
      </div>
    </div>
  );
}
