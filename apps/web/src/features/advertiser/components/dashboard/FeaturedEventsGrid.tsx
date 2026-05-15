import { Calendar, Megaphone, TrendingUp } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { useFeaturedEvents } from '../../hooks/useFeaturedEvents';

const TYPE_CONFIG: Record<string, { bg: string; text: string; label: string }> = {
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

export default function FeaturedEventsGrid() {
  const navigate = useNavigate();
  const { events } = useFeaturedEvents(3);

  if (events.length === 0) return null;

  return (
    <div className="mb-8">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {events.map((event) => {
          const typeStyle = TYPE_CONFIG[event.event_type] || TYPE_CONFIG.autre;
          const start = new Date(event.start_date);
          const end = new Date(event.end_date);
          const dateStr = start.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
          const timeStr = `${start.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} - ${end.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
          const impressions =
            event.expected_attendance != null
              ? `${event.expected_attendance.toLocaleString('fr-FR').replace(/\s/g, ' ')}`
              : '184 500';

          return (
            <div
              key={event.id}
              className="bg-white rounded-t-xl shadow-lg border border-gray-200 overflow-hidden flex flex-col"
            >
              <div className="aspect-[16/10] bg-gray-200 overflow-hidden">
                {event.image_url ? (
                  <img src={event.image_url} alt={event.name} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-gray-100 to-gray-200">
                    <Megaphone className="h-12 w-12 text-gray-400" />
                  </div>
                )}
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
                  (En incluant automatiquement toutes les catégories de commerces susceptibles de
                  diffuser l&apos;événement)
                </p>
                <button
                  type="button"
                  onClick={() => navigate('/new-event-campaign', { state: { event } })}
                  className="mt-auto w-full py-2.5 rounded-lg bg-gray-700 hover:bg-gray-800 text-white text-sm font-medium transition-colors"
                >
                  Je me positionne
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
