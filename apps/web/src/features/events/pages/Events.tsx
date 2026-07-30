import { ChevronDown, Search } from 'lucide-react';
import { useState } from 'react';

import PageHeader from '@/components/PageHeader';

import EventCard from '../components/EventCard';
import MesEvenementsStrip from '../components/MesEvenementsStrip';
import SuggestMatchForm from '../components/SuggestMatchForm';
import { useEventsCatalogue, useSuggestedEvents } from '../hooks/useEvents';
import { searchEvents } from '../lib/event-display';

/**
 * « Événements » (EV1 — rebuilt on the live api; the Supabase-era RPC page is gone).
 * The official match-card catalogue with équipe/phase search; « Voir plus » unfolds
 * « Ce que les screencasters suggèrent » (the SHARED suggestion list, badged cards) and the
 * « Suggérer un match » form. EV3 — every card's « Je me positionne » opens the parcours, and
 * the « Mes Événements » strip (À-venir-only) sits on top.
 */
export default function Events() {
  const [query, setQuery] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const { data: catalogue, isLoading } = useEventsCatalogue();
  const { data: suggested } = useSuggestedEvents(showSuggestions);

  const visible = searchEvents(catalogue ?? [], query);
  const visibleSuggested = searchEvents(suggested ?? [], query);

  return (
    <div className="w-full space-y-6">
      <PageHeader
        title="Événements"
        subtitle="Profitez des pics d’audience des événements pour amplifier votre impact"
      />

      {/* EV3 (§6) — the advertiser's confirmed positionings, À venir ONLY. */}
      <MesEvenementsStrip />

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Rechercher par équipe ou phase…"
          className="w-full rounded-lg border border-gray-300 pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/40 focus:border-brand-primary"
        />
      </div>

      {isLoading ? (
        <p className="text-sm text-[#5C5C5C]">Chargement des événements…</p>
      ) : visible.length === 0 ? (
        <p className="text-sm text-[#5C5C5C]">
          {query.trim() === ''
            ? 'Aucun événement au catalogue pour le moment.'
            : 'Aucun événement ne correspond à cette recherche.'}
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {visible.map((e) => (
            <EventCard key={e.id} event={e} />
          ))}
        </div>
      )}

      <div className="pt-2">
        <button
          type="button"
          onClick={() => setShowSuggestions((v) => !v)}
          className="flex items-center gap-1.5 text-sm font-medium text-brand-deep hover:underline"
        >
          Voir plus
          <ChevronDown
            className={`h-4 w-4 transition-transform ${showSuggestions ? 'rotate-180' : ''}`}
          />
        </button>
      </div>

      {showSuggestions && (
        <section className="space-y-5">
          <div>
            <h2 className="text-lg font-semibold text-[#171717]">
              Ce que les screencasters suggèrent
            </h2>
            <p className="text-sm text-[#5C5C5C]">
              Les matchs proposés par les annonceurs — visibles par tous, jamais dans le catalogue
              officiel.
            </p>
          </div>
          {visibleSuggested.length === 0 ? (
            <p className="text-sm text-[#5C5C5C]">Aucun match suggéré pour le moment.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {visibleSuggested.map((e) => (
                <EventCard key={e.id} event={e} />
              ))}
            </div>
          )}
          <SuggestMatchForm />
        </section>
      )}
    </div>
  );
}
