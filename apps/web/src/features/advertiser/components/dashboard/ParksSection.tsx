import { useEffect } from 'react';
import { Link } from 'react-router-dom';

import { useNetworkParks } from '@/features/advertiser/hooks/useNetworkParks';
import { DASHBOARD_PARKS, PARKS_PATH } from '@/features/advertiser/lib/park-card';
import { logger } from '@/lib/logger';

import ParkCard from './ParkCard';

const log = logger.child({ module: 'ParksSection' });

/**
 * The dashboard's « Diffusez votre spot publicitaire sur une même enseigne » section (Mariem's
 * Figma capture): three TV parks at most and « Voir tous les parcs ». With no park yet the section
 * stays, « Bientôt disponible »; if the read fails it hides (logged), the dashboard carries on.
 */
export default function ParksSection() {
  const { data: parks, isLoading, isError, error } = useNetworkParks();

  useEffect(() => {
    if (isError) log.error({ err: error }, 'network parks read failed');
  }, [isError, error]);

  if (isError) return null;
  const shown = (parks ?? []).slice(0, DASHBOARD_PARKS);

  return (
    <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center gap-4 border-b border-gray-200 bg-gray-50/50 px-5 py-4">
        <h2 className="min-w-0 flex-1 text-lg font-normal leading-6 text-gray-900">
          Diffusez votre spot publicitaire sur une même enseigne
        </h2>
        <Link
          to={PARKS_PATH}
          className="inline-flex flex-none items-center justify-center rounded-xl border border-gray-200 bg-white px-5 py-2.5 text-sm font-medium text-gray-800 shadow-sm transition-colors hover:border-gray-300 hover:bg-gray-50"
        >
          Voir tous les parcs
        </Link>
      </div>
      <div className="p-5">
        {isLoading ? (
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="min-h-[200px] animate-pulse rounded-xl border border-gray-200 bg-gray-100"
              />
            ))}
          </div>
        ) : shown.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-5 py-6 text-center">
            <p className="text-sm font-semibold text-gray-900">Bientôt disponible</p>
            <p className="mt-1 text-sm text-gray-600">
              Les parcs TV des enseignes partenaires seront proposés ici.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
            {shown.map((park) => (
              <ParkCard key={park.id} park={park} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
