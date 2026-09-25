import { useState } from 'react';

import { useVenueScreens } from '@/features/admin/hooks/useAdminSimulator';

// SIM-6 phase 3 — a whole venue off or on at once, and « mort depuis N jours » (its screens'
// last_seen_at moved back on the virtual clock — what redispatch and the installed rule read).

export function VenueScreensControl({
  simulationId,
  venueId,
  anyOnline,
}: {
  simulationId: string;
  venueId: string;
  anyOnline: boolean;
}) {
  const screens = useVenueScreens(simulationId);
  const [deadDays, setDeadDays] = useState(0);
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1 text-xs">
      <button
        type="button"
        disabled={screens.isPending}
        onClick={() =>
          screens.mutate({
            venueId,
            online: !anyOnline,
            ...(!anyOnline || deadDays < 1 ? {} : { dead_days: deadDays }),
          })
        }
        className="rounded border px-1.5 py-0.5 text-gray-700 disabled:opacity-50"
      >
        {anyOnline ? 'Tout éteindre' : 'Tout rallumer'}
      </button>
      {anyOnline && (
        <label className="flex items-center gap-1 text-gray-500">
          mort depuis
          <input
            type="number"
            min={0}
            max={365}
            value={deadDays}
            onChange={(e) => setDeadDays(Number(e.target.value))}
            className="w-12 rounded border px-1"
          />
          j
        </label>
      )}
    </div>
  );
}
