import { ArrowRight } from 'lucide-react';
import { useMemo } from 'react';
import { Link } from 'react-router-dom';

import { dashboardEventCards } from '@/features/advertiser/lib/dashboard-events';
import FootballScene from '@/features/events/components/scenes/FootballScene';
import RamadanScene from '@/features/events/components/scenes/RamadanScene';
import { useEventsCatalogue } from '@/features/events/hooks/useEvents';
import { COMING_SOON_LABEL, EVENTS_PATHS, RAMADAN_OFFER } from '@/features/events/lib/events-home';

import DashboardEventCard, { EVENT_CARD_ACTION_CLASS } from './DashboardEventCard';
import DashboardMatchCard from './DashboardMatchCard';

const SCENE_CLASS = 'relative h-[228px] overflow-hidden bg-gray-900';

/** The Ramadan offer, as its own page shows it: presented, not sold yet. */
function RamadanCard() {
  return (
    <DashboardEventCard
      visual={
        <Link
          to={EVENTS_PATHS.ramadan}
          aria-label={RAMADAN_OFFER.doorCta}
          className={`${SCENE_CLASS} block`}
        >
          <RamadanScene />
        </Link>
      }
      title={RAMADAN_OFFER.cardTitle}
      badge={{ label: RAMADAN_OFFER.title, tone: 'ramadan' }}
      chips={[RAMADAN_OFFER.chip, `${RAMADAN_OFFER.nights} soirées`]}
      date={RAMADAN_OFFER.shortRange}
      hours={`${RAMADAN_OFFER.window.from} – ${RAMADAN_OFFER.window.to}`}
      note={RAMADAN_OFFER.cardBadge}
      action={
        <button type="button" disabled className={EVENT_CARD_ACTION_CLASS}>
          {COMING_SOON_LABEL}
        </button>
      }
    />
  );
}

/** Shown when no match is open: the way into the events catalogue. */
function CatalogueCard() {
  return (
    <DashboardEventCard
      visual={
        <div className={SCENE_CLASS}>
          <FootballScene />
        </div>
      }
      title="Soirs de match"
      badge={{ label: 'Sport', tone: 'sport' }}
      note="Aucun match n’est ouvert au positionnement pour le moment. Consultez le catalogue des événements."
      action={
        <Link to={EVENTS_PATHS.football} className={EVENT_CARD_ACTION_CLASS}>
          Voir le catalogue
        </Link>
      }
    />
  );
}

/**
 * The dashboard's « Événements à venir » row (Mariem's Figma capture): the next matches of the
 * catalogue and the Ramadan offer, three cards at most (lib/dashboard-events). While the catalogue
 * loads, or if its read fails, the row shows what needs no data: Ramadan and the catalogue card.
 */
export default function DashboardEventsRow() {
  const { data: catalogue, isLoading } = useEventsCatalogue();
  const cards = useMemo(() => dashboardEventCards(catalogue ?? []), [catalogue]);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-normal leading-6 text-gray-900">Événements à venir</h2>
        <Link
          to={EVENTS_PATHS.home}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-deep hover:underline"
        >
          Voir tous les événements
          <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      </div>
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
        {isLoading
          ? [0, 1, 2].map((i) => (
              <div
                key={i}
                className="min-h-[420px] animate-pulse rounded-xl border border-gray-200 bg-gray-100"
              />
            ))
          : cards.map((card) =>
              card.kind === 'match' ? (
                <DashboardMatchCard key={card.event.id} event={card.event} />
              ) : card.kind === 'ramadan' ? (
                <RamadanCard key="ramadan" />
              ) : (
                <CatalogueCard key="catalogue" />
              ),
            )}
      </div>
    </section>
  );
}
