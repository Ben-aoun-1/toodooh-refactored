import { MapPin, Target } from 'lucide-react';
import { Link } from 'react-router-dom';

import { PARKS_PATH, parkInitials, parkVenuesLabel } from '@/features/advertiser/lib/park-card';
import type { NetworkPark } from '@/features/advertiser/services/parks.service';

/**
 * One TV park of the dashboard (Mariem's Figma capture): the brand's logo (or its initials), its
 * name, its venues, its category, its dominant target and « Diffuser sur ce parc ».
 */
export default function ParkCard({ park }: { park: NetworkPark }) {
  return (
    <article className="flex flex-col rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="flex items-center gap-3 border-b border-gray-200 px-4 py-3">
        <span className="flex h-10 w-14 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg border border-gray-200 bg-white">
          {park.logo_url ? (
            <img
              src={park.logo_url}
              alt={`Logo ${park.name}`}
              className="max-h-[80%] max-w-[80%] object-contain"
            />
          ) : (
            <span className="text-sm font-bold text-brand-deep">{parkInitials(park.name)}</span>
          )}
        </span>
        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-900">{park.name}</h3>
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <span className="flex items-center gap-1.5 text-xs font-medium text-gray-800">
          <MapPin className="h-3.5 w-3.5 flex-shrink-0 text-gray-500" aria-hidden />
          {parkVenuesLabel(park)}
        </span>
        <span className="self-start rounded border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs text-gray-700">
          {park.category_label}
        </span>
        {park.dominant_age && (
          <div>
            <div className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-gray-500">
              <Target className="h-3.5 w-3.5 text-brand-primary" aria-hidden />
              Cible dominante
            </div>
            <p className="mt-0.5 text-sm font-bold text-gray-900">{park.dominant_age}</p>
          </div>
        )}
        <Link
          to={PARKS_PATH}
          className="mt-auto inline-flex min-h-[40px] w-full items-center justify-center rounded-lg bg-brand-deep px-4 text-sm font-semibold text-white transition-colors hover:bg-brand-deep/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
        >
          Diffuser sur ce parc
        </Link>
      </div>
    </article>
  );
}
