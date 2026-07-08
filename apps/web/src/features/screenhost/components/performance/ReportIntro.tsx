import { type DateRange, formatDateFr } from '../../lib/performance-period';

import { PENDING_LABEL } from './Pending';
import { Var } from './Var';

interface ReportIntroProps {
  venueName: string;
  range: DateRange;
  /** 'business_sector · Class' — '—' when the venue has no sector. */
  category: string;
  campaignsCount: number;
}

/** §7 — the intro strip: Commerce / Période analysée / Catégorie / Campagnes incluses. */
export function ReportIntro({ venueName, range, category, campaignsCount }: ReportIntroProps) {
  const cells: { label: string; value: React.ReactNode }[] = [
    { label: 'Commerce', value: <Var>{venueName}</Var> },
    {
      label: 'Période analysée',
      value: (
        <>
          <Var>{formatDateFr(range.from)}</Var> – <Var>{formatDateFr(range.to)}</Var>
        </>
      ),
    },
    { label: 'Catégorie', value: <Var>{category}</Var> },
    {
      label: 'Campagnes incluses',
      value: campaignsCount > 0 ? <Var>{String(campaignsCount)}</Var> : <Var>{PENDING_LABEL}</Var>,
    },
  ];

  return (
    <div className="mb-16 grid grid-cols-2 gap-y-5 border-y border-perf-line py-[22px] lg:grid-cols-4 lg:gap-y-0">
      {cells.map((cell, idx) => (
        <div
          key={cell.label}
          className={`min-w-0 px-4 odd:pl-0 lg:px-5 lg:first:pl-0 lg:last:border-r-0 ${
            idx < cells.length - 1 ? 'lg:border-r lg:border-r-perf-soft' : ''
          }`}
        >
          <div className="perf-mono text-[10px] uppercase tracking-[0.08em] text-perf-mist">
            {cell.label}
          </div>
          <div className="mt-2 text-[17px] font-semibold tracking-[-0.012em] text-perf-ink">
            {cell.value}
          </div>
        </div>
      ))}
    </div>
  );
}
