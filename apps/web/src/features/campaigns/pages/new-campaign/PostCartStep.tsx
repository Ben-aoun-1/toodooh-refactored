import { Calendar, Megaphone, TrendingUp } from 'lucide-react';
import { useMemo } from 'react';

import panierPng from '@/assets/panier.png';
import type { SpecialEvent } from '@/features/events/types/event';

interface PostCartStepProps {
  loadingRecommendedEvents: boolean;
  recommendedEvents: SpecialEvent[];
  startDate: Date | null;
  endDate: Date | null;
  onGoToDashboard: () => void;
  onGoToEvents: () => void;
  onJeMePositionne: (event: SpecialEvent) => void;
}

const EVENT_TYPE_STYLE: Record<string, { bg: string; text: string; label: string }> = {
  sport: { bg: 'bg-blue-100', text: 'text-blue-800', label: 'Sport' },
  ramadan: { bg: 'bg-amber-100', text: 'text-amber-900', label: 'Ramadan' },
  culture: { bg: 'bg-purple-100', text: 'text-purple-800', label: 'Culture' },
  concert: { bg: 'bg-purple-100', text: 'text-purple-800', label: 'Concert' },
  festival: { bg: 'bg-pink-100', text: 'text-pink-800', label: 'Festival' },
  conference: { bg: 'bg-indigo-100', text: 'text-indigo-800', label: 'Conference' },
  exposition: { bg: 'bg-green-100', text: 'text-green-800', label: 'Exposition' },
  salon: { bg: 'bg-orange-100', text: 'text-orange-800', label: 'Salon' },
  autre: { bg: 'bg-gray-100', text: 'text-gray-800', label: 'Autre' },
};

/**
 * Post-cart success screen rendered after AddToCart succeeds: confirms the
 * campaign was added to the cart and surfaces up to 3 special events that
 * overlap the campaign's date range as "Augmentez votre impact" suggestions.
 *
 * Extracted from NewCampaign.tsx (formerly the `showPostCartStep && (...)`
 * JSX block at lines ~1829-1988). Mutually exclusive with Step6 — parent
 * picks which to render via the showPostCartStep flag.
 *
 * Figma divergence: Figma's `Mon panier.png` places the analogous
 * recommendations on `/panier`, not in the wizard. Tracked in Issue #21.
 */
export default function PostCartStep({
  loadingRecommendedEvents,
  recommendedEvents,
  startDate,
  endDate,
  onGoToDashboard,
  onGoToEvents,
  onJeMePositionne,
}: PostCartStepProps) {
  const recommendedEventsInPeriod = useMemo(() => {
    if (!startDate || !endDate || !recommendedEvents.length) return recommendedEvents;
    const start = startDate.getTime();
    const end = endDate.getTime();
    return recommendedEvents.filter((ev) => {
      const evStart = new Date(ev.start_date).getTime();
      const evEnd = new Date(ev.end_date).getTime();
      return evStart <= end && evEnd >= start;
    });
  }, [recommendedEvents, startDate, endDate]);

  return (
    <div className="bg-white rounded-2xl shadow-lg overflow-hidden border border-gray-100">
      <div className="p-6 md:p-8">
        <div className="flex flex-col items-center text-center">
          <div className="w-24 h-24 flex items-center justify-center">
            <img src={panierPng} alt="" className="h-full w-full object-contain" />
          </div>
          <p className="mt-5 text-xl font-medium text-gray-700 leading-snug">
            Votre campagne a ete ajoutee au panier
          </p>
        </div>

        <div className="mt-7">
          <h3 className="text-lg font-semibold text-center text-gray-900 mb-6 leading-snug">
            Augmentez votre impact en diffusant votre spot lors d&apos;evenements prevus dans la
            meme periode
          </h3>

          {loadingRecommendedEvents ? (
            <div className="flex justify-center py-10">
              <div className="animate-spin rounded-full h-10 w-10 border-2 border-brand-primary border-t-transparent" />
            </div>
          ) : recommendedEventsInPeriod.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {recommendedEventsInPeriod.map((event) => {
                const typeStyle = EVENT_TYPE_STYLE[event.event_type] ?? EVENT_TYPE_STYLE.autre;
                const start = new Date(event.start_date);
                const end = new Date(event.end_date);
                const dateStr = start.toLocaleDateString('fr-FR', {
                  day: 'numeric',
                  month: 'short',
                });
                const timeStr = `${start.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} - ${end.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
                const impressions =
                  event.expected_attendance != null
                    ? event.expected_attendance.toLocaleString('fr-FR')
                    : '184 500';

                return (
                  <div
                    key={event.id}
                    className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden flex flex-col"
                  >
                    <div className="aspect-[16/10] bg-gray-200 overflow-hidden">
                      {event.image_url ? (
                        <img
                          src={event.image_url}
                          alt={event.name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-gray-100 to-gray-200">
                          <Megaphone className="h-12 w-12 text-gray-400" />
                        </div>
                      )}
                    </div>
                    <div className="p-4 flex flex-col flex-1">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <h4 className="text-base font-bold text-gray-900 flex-1">{event.name}</h4>
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
                        (En incluant automatiquement toutes les categories de commerces qui
                        diffusent pendant l&apos;evenement)
                      </p>
                      <button
                        type="button"
                        onClick={() => onJeMePositionne(event)}
                        className="mt-auto w-full py-2.5 rounded-xl bg-[#1f1f1f] hover:bg-black text-white text-sm font-medium transition-colors"
                      >
                        Je me positionne
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-10 text-gray-500 border border-gray-200 rounded-2xl bg-gray-50">
              Aucun evenement actif ne chevauche la periode selectionnee.
            </div>
          )}
        </div>

        <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-6">
          <button
            type="button"
            onClick={onGoToDashboard}
            className="w-full py-3 rounded-xl border border-gray-300 bg-white hover:bg-gray-50 text-gray-700 font-medium"
          >
            Dashboard
          </button>
          <button
            type="button"
            onClick={onGoToEvents}
            className="w-full py-3 rounded-xl text-gray-900 font-medium"
            style={{ background: '#8de7a6' }}
          >
            Voir tous les evenements
          </button>
        </div>
      </div>
    </div>
  );
}
