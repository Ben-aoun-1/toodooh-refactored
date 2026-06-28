import statIcon1 from '@/assets/stats/1.png';
import statIcon3 from '@/assets/stats/3.png';

interface StatsGridProps {
  campaignsDiffused: number;
  totalBudget: number;
  loading: boolean;
}

// "Impressions générées" and "Durée totale de diffusion" are delivered-impression
// (reconciliation) metrics with no advertiser read API in the engine yet, so those two
// cards are intentionally omitted rather than shown as fabricated zeros. They return when a
// performance/impressions read endpoint lands.
export default function StatsGrid({ campaignsDiffused, totalBudget, loading }: StatsGridProps) {
  return (
    <div className="dashboard-stats grid grid-cols-1 sm:grid-cols-2 gap-5 mb-8">
      <div className="rounded-xl p-5 min-h-[120px] flex flex-col bg-[#e8f6ed] border border-[#85cc95]/30">
        <div className="flex items-center justify-between gap-2 mb-3 min-h-[1.25rem]">
          <span className="text-xs font-semibold text-[#85cc95] whitespace-nowrap truncate min-w-0">
            Campagnes diffusées
          </span>
          <img src={statIcon1} alt="" className="h-5 w-5 object-contain flex-shrink-0" />
        </div>
        <p className="text-3xl font-bold text-[#1a1a1a] tabular-nums font-sans mt-auto">
          {loading ? '...' : campaignsDiffused}
        </p>
      </div>
      <div className="rounded-xl p-5 min-h-[120px] flex flex-col bg-[#fdfaed] border border-[#edcc7a]/30">
        <div className="flex items-center justify-between gap-2 mb-3 min-h-[1.25rem]">
          <span className="text-xs font-semibold text-[#edcc7a] whitespace-nowrap truncate min-w-0">
            Budget total alloué
          </span>
          <img src={statIcon3} alt="" className="h-5 w-5 object-contain flex-shrink-0" />
        </div>
        <p className="text-3xl font-bold text-[#1a1a1a] tabular-nums font-sans mt-auto">
          {loading
            ? '...'
            : `${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(totalBudget)} TND`}
        </p>
      </div>
    </div>
  );
}
