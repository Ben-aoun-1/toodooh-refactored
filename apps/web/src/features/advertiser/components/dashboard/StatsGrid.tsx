import statIcon1 from '@/assets/stats/1.png';
import statIcon2 from '@/assets/stats/2.png';
import statIcon3 from '@/assets/stats/3.png';
import statIcon4 from '@/assets/stats/4.png';
import { htTtcOrDash } from '@/lib/money';

interface StatsGridProps {
  campaignsDiffused: number;
  totalViews: number;
  totalDurationSeconds: number;
  totalBudget: number;
  loading: boolean;
}

function formatDuration(totalSeconds: number) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function StatsGrid({
  campaignsDiffused,
  totalViews,
  totalDurationSeconds,
  totalBudget,
  loading,
}: StatsGridProps) {
  return (
    <div className="dashboard-stats grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-8">
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
      <div className="rounded-xl p-5 min-h-[120px] flex flex-col bg-[#edf1fe] border border-[#6e82f6]/30">
        <div className="flex items-center justify-between gap-2 mb-3 min-h-[1.25rem]">
          <span className="text-xs font-semibold text-[#6e82f6] whitespace-nowrap truncate min-w-0">
            Impressions prévues
          </span>
          <img src={statIcon4} alt="" className="h-5 w-5 object-contain flex-shrink-0" />
        </div>
        <p className="text-3xl font-bold text-[#1a1a1a] tabular-nums font-sans mt-auto">
          {loading ? '...' : totalViews.toLocaleString('fr-FR').replace(/\s/g, ' ')}
        </p>
      </div>
      <div className="rounded-xl p-5 min-h-[120px] flex flex-col bg-[#eeecfd] border border-[#a08cf0]/30">
        <div className="flex items-center justify-between gap-2 mb-3 min-h-[1.25rem]">
          <span className="text-xs font-semibold text-[#a08cf0] whitespace-nowrap truncate min-w-0">
            Durée totale de diffusion
          </span>
          <img src={statIcon2} alt="" className="h-5 w-5 object-contain flex-shrink-0" />
        </div>
        <p className="text-3xl font-bold text-[#1a1a1a] tabular-nums font-sans mt-auto font-mono">
          {loading ? '...' : formatDuration(totalDurationSeconds)}
        </p>
      </div>
      <div className="rounded-xl p-5 min-h-[120px] flex flex-col bg-[#fdfaed] border border-[#edcc7a]/30">
        <div className="flex items-center justify-between gap-2 mb-3 min-h-[1.25rem]">
          <span className="text-xs font-semibold text-[#edcc7a] whitespace-nowrap truncate min-w-0">
            Budget total alloué
          </span>
          <img src={statIcon3} alt="" className="h-5 w-5 object-contain flex-shrink-0" />
        </div>
        {/* CF-U4 — the montant rides the house formatter (fr locale, HT (TTC)); the raw
            US-locale Intl retired. The other three tiles are counts/durations — no money there. */}
        <p className="text-2xl font-bold text-[#1a1a1a] tabular-nums font-sans mt-auto">
          {loading ? '...' : htTtcOrDash(totalBudget)}
        </p>
      </div>
    </div>
  );
}
