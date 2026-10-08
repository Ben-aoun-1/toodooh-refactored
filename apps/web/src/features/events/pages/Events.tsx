import { ChevronDown, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';

import PageHeader from '@/components/PageHeader';
import { getErrorMessage } from '@/lib/errors';
import { logger } from '@/lib/logger';

import CatalogueEventCard from '../components/catalogue/CatalogueEventCard';
import SelectionPanel from '../components/catalogue/SelectionPanel';
import MesEvenementsStrip from '../components/MesEvenementsStrip';
import SuggestMatchForm from '../components/SuggestMatchForm';
import {
  useEventsCatalogue,
  usePositionner,
  usePositionnerMultiple,
  useSuggestedEvents,
} from '../hooks/useEvents';
import {
  SEARCH_EMPTY,
  SEARCH_PLACEHOLDER,
  eventsCountLabel,
  layoutCatalogue,
  searchEvents,
} from '../lib/event-catalogue';
import { groupPositioningPath } from '../lib/event-group';

const log = logger.child({ module: 'Events' });

/**
 * « Événements » — EVT-CAT2 (operator rulings 2026-10-06): Youssef's validated design in the
 * Toodooh fonts. « À la une » (the hero + pinned cards), then the matches month by month, each
 * card « Ajouter à ma sélection » + « Je me positionne »; « Ma sélection » sums the selection's
 * maximum impressions and opens the multi-match parcours (one big minutes slider, one small one
 * per match). Under it, unchanged: « Mes Événements » and the screencasters' suggestions.
 * The search (ruling 2026-10-08, 1 A) filters the catalogue and the suggestions; « Ma sélection »
 * keeps what was picked even when a search hides it.
 */
export default function Events() {
  const navigate = useNavigate();
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selection, setSelection] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const { data: catalogue, isLoading } = useEventsCatalogue();
  const { data: suggested } = useSuggestedEvents(showSuggestions);
  const positionner = usePositionner();
  const positionnerMultiple = usePositionnerMultiple();

  const layout = useMemo(
    () => layoutCatalogue(searchEvents(catalogue ?? [], query)),
    [catalogue, query],
  );
  const visibleSuggested = searchEvents(suggested ?? [], query);
  const byId = useMemo(() => new Map((catalogue ?? []).map((e) => [e.id, e])), [catalogue]);
  const selected = selection.flatMap((id) => {
    const e = byId.get(id);
    return e ? [e] : [];
  });

  const toggle = (id: string) =>
    setSelection((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const go = async () => {
    try {
      if (selected.length === 1 && selected[0]) {
        const created = await positionner.mutateAsync(selected[0].id);
        navigate(`/evenements/positionnement/${created.id}`);
        return;
      }
      const created = await positionnerMultiple.mutateAsync(selected.map((e) => e.id));
      navigate(groupPositioningPath(created.positionings.map((p) => p.id)));
    } catch (error) {
      toast.error(getErrorMessage(error) || 'Le positionnement n’a pas pu être créé.');
      log.error({ err: error }, 'positionner selection failed');
    }
  };

  const card = (id: string) => {
    const e = byId.get(id);
    return e ? (
      <CatalogueEventCard
        key={e.id}
        event={e}
        selected={selection.includes(e.id)}
        onToggle={toggle}
      />
    ) : null;
  };

  return (
    <div className="w-full space-y-8 pb-24 xl:pb-0">
      <PageHeader
        title="Événements"
        subtitle="Profitez des pics d’audience des grands matchs pour amplifier votre impact"
      />

      <div className="relative max-w-xl">
        <Search
          className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#4F6B60]"
          aria-hidden="true"
        />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={SEARCH_PLACEHOLDER}
          aria-label="Rechercher un événement"
          className="min-h-[46px] w-full rounded-xl border border-[#E1EAE5] bg-white pl-10 pr-3.5 text-sm text-[#0D2B1F] placeholder:text-[#8AA197] focus:border-brand-primary focus:outline-none focus:ring-2 focus:ring-brand-primary/40"
        />
      </div>

      <div className="grid grid-cols-1 items-start gap-8 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-10">
          {isLoading ? (
            <p className="text-sm text-[#5C5C5C]">Chargement des événements…</p>
          ) : (catalogue ?? []).length === 0 ? (
            <p className="text-sm text-[#5C5C5C]">Aucun événement au catalogue pour le moment.</p>
          ) : !layout.hero && layout.pinned.length === 0 && layout.months.length === 0 ? (
            <p className="text-sm text-[#5C5C5C]">{SEARCH_EMPTY}</p>
          ) : (
            <>
              {(layout.hero || layout.pinned.length > 0) && (
                <section className="flex flex-col gap-5">
                  <div className="border-b border-[#E1EAE5] pb-2.5">
                    <h2 className="text-[26px] font-bold tracking-tight text-[#0D2B1F]">
                      À la une
                    </h2>
                  </div>
                  {layout.hero && (
                    <CatalogueEventCard
                      event={layout.hero}
                      variant="hero"
                      selected={selection.includes(layout.hero.id)}
                      onToggle={toggle}
                    />
                  )}
                  {layout.pinned.length > 0 && (
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-6">
                      {layout.pinned.map((e) => card(e.id))}
                    </div>
                  )}
                </section>
              )}
              {layout.months.map((month) => (
                <section key={month.key} className="flex flex-col gap-5">
                  <div className="flex items-baseline gap-3.5 border-b border-[#E1EAE5] pb-2.5">
                    <h2 className="text-[26px] font-bold tracking-tight text-[#0D2B1F]">
                      {month.label}
                    </h2>
                    <span className="font-mono text-[13px] text-[#4F6B60]">
                      {eventsCountLabel(month.events.length)}
                    </span>
                  </div>
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-6">
                    {month.events.map((e) => card(e.id))}
                  </div>
                </section>
              ))}
            </>
          )}
        </div>

        <SelectionPanel
          selected={selected}
          onRemove={toggle}
          onClear={() => setSelection([])}
          onGo={() => void go()}
          going={positionner.isPending || positionnerMultiple.isPending}
        />
      </div>

      {/* Kept under the new design (operator ruling): the screencaster's own positionings … */}
      <MesEvenementsStrip />

      {/* … and the screencasters' suggestions + « Suggérer un match ». */}
      <div>
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
          <h2 className="text-lg font-semibold text-[#171717]">
            Ce que les screencasters suggèrent
          </h2>
          <p className="text-sm text-[#5C5C5C]">
            Les matchs proposés par les annonceurs — visibles par tous, jamais dans le catalogue
            officiel.
          </p>
          {(suggested ?? []).length === 0 ? (
            <p className="text-sm text-[#5C5C5C]">Aucun match suggéré pour le moment.</p>
          ) : visibleSuggested.length === 0 ? (
            <p className="text-sm text-[#5C5C5C]">{SEARCH_EMPTY}</p>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-6">
              {visibleSuggested.map((e) => (
                <CatalogueEventCard key={e.id} event={e} />
              ))}
            </div>
          )}
          <SuggestMatchForm />
        </section>
      )}

      {/* Phones: the selection sits under the cards — a bar jumps to it. */}
      {selected.length > 0 && (
        <a
          href="#ma-selection"
          className="fixed inset-x-3 bottom-3 z-20 flex min-h-[50px] items-center justify-center rounded-[14px] bg-[#0D2B1F] text-[15px] font-bold text-white shadow-[0_14px_30px_-12px_rgba(3,6,15,.5)] xl:hidden"
        >
          Voir ma sélection ({selected.length})
        </a>
      )}
    </div>
  );
}
