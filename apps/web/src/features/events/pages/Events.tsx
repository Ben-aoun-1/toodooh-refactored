import { Calendar, TrendingUp, ChevronLeft, ChevronRight, Search, Rocket } from 'lucide-react';
import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';

import matchImg from '@/assets/match.png';
import { useAuthStore } from '@/features/auth/stores/auth.store';
import { useAllEvents } from '@/features/events/hooks/useAllEvents';
import { useMyEventCampaigns } from '@/features/events/hooks/useMyEventCampaigns';
import type { CampaignForEdit, SpecialEvent } from '@/features/events/types/event';

const PAGE_SIZE = 6;

const typeConfig: Record<string, { bg: string; text: string; label: string }> = {
  sport: { bg: 'bg-blue-100', text: 'text-blue-800', label: 'Sport' },
  ramadan: { bg: 'bg-amber-100', text: 'text-amber-900', label: 'Ramadan' },
  culture: { bg: 'bg-purple-100', text: 'text-purple-800', label: 'Culture' },
  concert: { bg: 'bg-purple-100', text: 'text-purple-800', label: 'Concert' },
  festival: { bg: 'bg-pink-100', text: 'text-pink-800', label: 'Festival' },
  conference: { bg: 'bg-indigo-100', text: 'text-indigo-800', label: 'Conférence' },
  exposition: { bg: 'bg-green-100', text: 'text-green-800', label: 'Exposition' },
  salon: { bg: 'bg-orange-100', text: 'text-orange-800', label: 'Salon' },
  autre: { bg: 'bg-gray-100', text: 'text-gray-800', label: 'Autre' },
};

const filterTabs = [
  { label: 'Tous', value: '' },
  { label: 'Sport', value: 'sport' },
  { label: 'Ramadan', value: 'ramadan' },
  { label: 'Culture', value: 'culture' },
  { label: 'Concert', value: 'concert' },
  { label: 'Festival', value: 'festival' },
  { label: 'Conférence', value: 'conference' },
  { label: 'Exposition', value: 'exposition' },
  { label: 'Salon', value: 'salon' },
  { label: 'Autre', value: 'autre' },
];

function EventCard({
  event,
  isMyEvent = false,
  campaign,
}: {
  event: SpecialEvent;
  isMyEvent?: boolean;
  campaign?: CampaignForEdit;
}) {
  const navigate = useNavigate();
  const typeStyle = typeConfig[event.event_type] || typeConfig.autre;
  const start = new Date(event.start_date);
  const end = new Date(event.end_date);
  const dateStr = start.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
  const timeStr = `${start.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} - ${end.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
  const impressions =
    event.expected_attendance != null
      ? `${event.expected_attendance.toLocaleString('fr-FR').replace(/\s/g, ' ')}`
      : '184 500';

  const handleBoosterClick = () => {
    if (isMyEvent && campaign) {
      navigate('/new-campaign', { state: { editMode: true, campaign } });
    } else if (isMyEvent) {
      navigate('/my-campaigns');
    } else {
      navigate('/new-event-campaign', { state: { event } });
    }
  };

  return (
    <div className="bg-white rounded-t-xl shadow-lg border border-gray-200 overflow-hidden flex flex-col">
      <div className="aspect-[16/10] bg-gray-200 overflow-hidden">
        <img
          src={event.image_url || matchImg}
          alt={event.name}
          className="w-full h-full object-cover"
        />
      </div>
      <div className="p-4 flex flex-col flex-1">
        <div className="flex items-start justify-between gap-2 mb-2">
          <h3 className="text-base font-bold text-gray-900 flex-1">{event.name}</h3>
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium flex-shrink-0 ${typeStyle.bg} ${typeStyle.text}`}
          >
            {typeStyle.label}
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5 mb-2">
          <span className="inline-flex px-2 py-0.5 rounded bg-gray-100 text-gray-700 text-xs">
            Restaurants
          </span>
          <span className="inline-flex px-2 py-0.5 rounded bg-gray-100 text-gray-700 text-xs">
            Salles de sport
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-sm text-gray-600 mb-1">
          <Calendar className="h-4 w-4 flex-shrink-0" />
          <span>
            {dateStr} | {timeStr}
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-sm text-gray-600 mb-2">
          <TrendingUp className="h-4 w-4 flex-shrink-0" />
          <span>~ {impressions} impressions</span>
        </div>
        <p className="text-xs text-gray-500 mb-4">
          (En incluant automatiquement toutes les catégories de commerces susceptibles de diffuser
          l&apos;événement)
        </p>
        <button
          type="button"
          onClick={handleBoosterClick}
          className={`mt-auto w-full py-2.5 rounded-lg text-sm font-medium inline-flex items-center justify-center gap-1.5 transition-colors ${
            isMyEvent
              ? 'bg-[#e3f7ec] text-[#66bc74] hover:bg-[#cceee0]'
              : 'bg-gray-700 hover:bg-gray-800 text-white'
          }`}
        >
          {isMyEvent ? (
            <>
              <Rocket className="h-4 w-4" /> Booster
            </>
          ) : (
            'Je me positionne'
          )}
        </button>
      </div>
    </div>
  );
}

export default function Events() {
  const user = useAuthStore((s) => s.user);
  const { events: allEvents, loading } = useAllEvents();
  const { myEventCampaignsEvents, eventToCampaign, loadingMyEvents } = useMyEventCampaigns(
    user?.id,
  );
  const [search, setSearch] = useState('');
  const [eventType, setEventType] = useState('');
  const [page, setPage] = useState(1);

  const filteredEvents = useMemo(() => {
    return allEvents.filter((ev) => {
      const matchType = !eventType || ev.event_type === eventType;
      const q = search.trim().toLowerCase();
      const matchSearch =
        !q ||
        ev.name?.toLowerCase().includes(q) ||
        (ev.description && ev.description.toLowerCase().includes(q));
      return matchType && matchSearch;
    });
  }, [allEvents, eventType, search]);

  const totalPages = Math.max(1, Math.ceil(filteredEvents.length / PAGE_SIZE));
  const paginatedEvents = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredEvents.slice(start, start + PAGE_SIZE);
  }, [filteredEvents, page]);

  // Reset to page 1 when filters change
  useEffect(() => {
    setPage(1);
  }, [eventType, search]);

  return (
    <div className="w-full space-y-6">
      {/* Mes événements : ceux sur lesquels l'annonceur a lancé une campagne */}
      <div className="rounded-xl bg-white shadow-sm overflow-hidden">
        <div className="pt-2 pb-1">
          <h2 className="text-lg font-normal leading-6 text-gray-900">Mes événements</h2>
        </div>
        <div className="p-5">
          {loadingMyEvents ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="bg-white rounded-t-xl shadow-lg border border-gray-200 overflow-hidden flex flex-col animate-pulse"
                >
                  <div className="aspect-[16/10] bg-gray-200" />
                  <div className="p-4 space-y-2">
                    <div className="h-5 bg-gray-200 rounded w-3/4" />
                    <div className="h-4 bg-gray-100 rounded w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          ) : myEventCampaignsEvents.length === 0 ? (
            <p className="text-sm text-gray-500 py-4">
              Vous n&apos;avez pas encore lancé de campagne sur un événement. Cliquez sur &quot;Je
              me positionne&quot; sur un événement ci-dessous pour en créer une.
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {myEventCampaignsEvents.map((event) => (
                <EventCard
                  key={event.id}
                  event={event}
                  isMyEvent
                  campaign={eventToCampaign.get(event.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="rounded-xl bg-white shadow-sm overflow-hidden">
        <div className="pt-2 pb-1">
          <h2 className="text-lg font-normal leading-6 text-gray-900">
            Les événements à venir et à ne pas manquer
          </h2>
        </div>

        {/* Barre recherche à gauche + filtres à droite */}
        <div className="px-5 py-4">
          <div className="flex flex-col lg:flex-row lg:items-stretch gap-3 lg:gap-4">
            <div className="flex items-center flex-1 min-w-0 lg:min-h-[40px]">
              <div className="relative w-full min-w-0 h-10">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#5C5C5C]" />
                <input
                  type="text"
                  placeholder="Rechercher.."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full h-full pl-9 pr-3 py-2.5 text-sm border border-[#EBEBEB] rounded-md bg-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-primary/30 focus:border-brand-primary"
                />
              </div>
            </div>
            <div className="flex flex-nowrap items-center gap-0.5 p-0.5 rounded-lg bg-[#F5F5F5] min-h-[40px] box-border shrink-0 overflow-x-auto">
              {filterTabs.map(({ label, value }) => (
                <button
                  key={value || 'all'}
                  type="button"
                  onClick={() => setEventType(value)}
                  className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors h-7 flex items-center whitespace-nowrap ${
                    eventType === value
                      ? 'bg-white text-[#171717]'
                      : 'bg-transparent text-[#5C5C5C] hover:text-[#171717]'
                  }`}
                  style={{ lineHeight: '16px' }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="p-5">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {loading
              ? Array.from({ length: PAGE_SIZE }).map((_, i) => (
                  <div
                    key={i}
                    className="bg-white rounded-t-xl shadow-lg border border-gray-200 overflow-hidden flex flex-col animate-pulse"
                  >
                    <div className="aspect-[16/10] bg-gray-200" />
                    <div className="p-4 space-y-2">
                      <div className="h-5 bg-gray-200 rounded w-3/4" />
                      <div className="h-4 bg-gray-100 rounded w-1/2" />
                      <div className="h-4 bg-gray-100 rounded w-2/3" />
                    </div>
                  </div>
                ))
              : paginatedEvents.map((event) => <EventCard key={event.id} event={event} />)}
          </div>

          {!loading && filteredEvents.length === 0 && (
            <p className="text-center text-gray-500 py-8">
              Aucun événement ne correspond à vos critères.
            </p>
          )}

          {!loading && filteredEvents.length > 0 && totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-6">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="p-2 rounded-lg border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                aria-label="Page précédente"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <span className="text-sm text-gray-600 px-3">
                Page {page} sur {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="p-2 rounded-lg border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                aria-label="Page suivante"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
