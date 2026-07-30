import { ArrowRight, CalendarClock } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

/**
 * EV3 (voie 2) — the dashboard's Événements entry: one tile straight to the catalogue where
 * « Je me positionne » opens the positioning parcours.
 */
export default function EventsEntryCard() {
  const navigate = useNavigate();
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-brand-primary/40 bg-brand-primary/5 p-5">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-white">
          <CalendarClock className="h-5 w-5 text-brand-deep" />
        </div>
        <div className="min-w-0">
          <h2 className="text-base font-bold text-gray-900">Événements sportifs</h2>
          <p className="text-sm text-gray-600">
            Positionnez votre marque sur la fenêtre de diffusion d’un match — 1 h avant, pendant, 1
            h après.
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={() => navigate('/evenements')}
        className="inline-flex flex-shrink-0 items-center gap-2 rounded-xl bg-brand-primary px-4 py-2.5 text-sm font-semibold text-brand-deep transition-colors hover:bg-brand-primary/90"
      >
        Je me positionne
        <ArrowRight className="h-4 w-4" />
      </button>
    </div>
  );
}
