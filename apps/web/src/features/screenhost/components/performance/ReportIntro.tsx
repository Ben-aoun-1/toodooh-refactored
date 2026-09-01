import { type DateRange, formatDateFr } from '../../lib/performance-period';
import { coverageLabel, daysInRange } from '../../lib/report-coverage';

import { PENDING_LABEL } from './Pending';
import { Var } from './Var';

interface ReportIntroProps {
  venueName: string;
  range: DateRange;
  /** 'business_sector · Class' — '—' when the venue has no sector. */
  category: string;
  campaignsCount: number;
  /** CAST first-data flag — once true, "Campagnes incluses" shows the count, 0 included. */
  hasCastData: boolean;
  /** RPT-COV1 — days of the période that carry data (the merge's own days). */
  coverageDays: number;
}

/** §7 — the intro strip: Commerce / Période analysée / Catégorie / Campagnes incluses. */
export function ReportIntro({
  venueName,
  range,
  category,
  campaignsCount,
  hasCastData,
  coverageDays,
}: ReportIntroProps) {
  // RPT-COV1 — « 1 jour de données sur 31 » under the période, so a thin report says so on its
  // face. Same rule and same words as the PDF (lib/report-coverage is a byte-pinned twin).
  const coverage = coverageLabel({
    daysWithData: coverageDays,
    daysInPeriod: daysInRange(range.from, range.to),
  });
  const cells: { label: string; value: React.ReactNode; note?: string }[] = [
    { label: 'Commerce', value: <Var>{venueName}</Var> },
    {
      label: 'Période analysée',
      value: (
        <>
          <Var>{formatDateFr(range.from)}</Var> – <Var>{formatDateFr(range.to)}</Var>
        </>
      ),
      ...(coverage === null ? {} : { note: coverage }),
    },
    { label: 'Catégorie', value: <Var>{category}</Var> },
    {
      label: 'Campagnes incluses',
      value: hasCastData ? <Var>{String(campaignsCount)}</Var> : <Var>{PENDING_LABEL}</Var>,
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
          {cell.note !== undefined && (
            <div className="perf-mono mt-1.5 text-[10.5px] text-perf-mist">{cell.note}</div>
          )}
        </div>
      ))}
    </div>
  );
}
