import { ChevronLeft } from 'lucide-react';
import { Link } from 'react-router-dom';

import { EVENTS_CRUMB_LABEL, EVENTS_PATHS } from '../../lib/events-home';

/** « ‹ Tous les événements » — back to the Événements home (Youssef's design, .crumb). */
export default function EventsCrumb() {
  return (
    <nav aria-label="Fil d’Ariane" className="flex">
      <Link
        to={EVENTS_PATHS.home}
        className="inline-flex min-h-[40px] items-center gap-2 rounded-full border border-[#E1EAE5] pl-2.5 pr-3.5 text-sm font-semibold text-[#0D2B1F] hover:bg-[#F2F9F5]"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        {EVENTS_CRUMB_LABEL}
      </Link>
    </nav>
  );
}
