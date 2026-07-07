import { type DateRange, formatDateFr } from '../../lib/performance-period';

import { PENDING_LABEL } from './Pending';

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
    { label: 'Commerce', value: venueName },
    {
      label: 'Période analysée',
      value: `${formatDateFr(range.from)} – ${formatDateFr(range.to)}`,
    },
    { label: 'Catégorie', value: category },
    {
      label: 'Campagnes incluses',
      value:
        campaignsCount > 0 ? (
          String(campaignsCount)
        ) : (
          <span className="text-sm font-medium italic text-gray-400">{PENDING_LABEL}</span>
        ),
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-3 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-4">
      {cells.map((cell) => (
        <div key={cell.label} className="min-w-0">
          <div className="text-xs font-medium uppercase tracking-wider text-gray-400">
            {cell.label}
          </div>
          <div className="mt-1 truncate font-semibold text-brand-deep">{cell.value}</div>
        </div>
      ))}
    </div>
  );
}
