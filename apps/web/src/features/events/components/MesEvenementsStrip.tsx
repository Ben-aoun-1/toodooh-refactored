import { CalendarClock } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { useAuthStore } from '@/features/auth/stores/auth.store';
import { useMyCampaigns } from '@/features/campaigns/hooks/useMyCampaigns';
import { formatUiDate } from '@/features/campaigns/lib/campaign-summary';

/**
 * EV3 (§6) — « Mes Événements »: the À-VENIR-ONLY strip on top of the Événements page — the
 * advertiser's confirmed positionings waiting for their window (status 'upcoming', event-bound
 * rows). Nothing else shows here (drafts live in Mes campagnes; past positionings in Passées);
 * an empty strip renders nothing at all.
 */
export default function MesEvenementsStrip() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const { campaigns } = useMyCampaigns(user?.id);

  const upcoming = campaigns.filter((c) => c.event_id !== null && c.status === 'upcoming');
  if (upcoming.length === 0) return null;

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5">
      <h2 className="mb-3 text-base font-bold text-gray-900">Mes Événements</h2>
      <div className="flex gap-3 overflow-x-auto pb-1">
        {upcoming.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => navigate('/my-campaigns')}
            className="min-w-[220px] shrink-0 rounded-xl border border-gray-200 p-4 text-left transition-colors hover:border-brand-primary/50 hover:bg-gray-50"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-sm font-semibold text-gray-900">{c.name}</p>
              <span className="shrink-0 rounded-md bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                À venir
              </span>
            </div>
            <p className="mt-1.5 flex items-center gap-1.5 text-xs text-[#5C5C5C]">
              <CalendarClock className="h-3.5 w-3.5 shrink-0" />
              {formatUiDate(c.start_date)} – {formatUiDate(c.end_date)}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
}
