import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, TimerReset } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'react-hot-toast';

import { adminKeys } from '@/features/admin/hooks/queryKeys';
import {
  EXTENSION_PRESETS,
  MAX_EXTENSION,
  MIN_EXTENSION,
  formatExtension,
  isValidExtension,
} from '@/features/admin/lib/event-extension';
import { adminEventsService } from '@/features/admin/services/admin-events.service';
import type { AdminEventView } from '@/features/admin/services/admin-events.service';
import { eventsKeys } from '@/features/events/hooks/queryKeys';
import { formatEventHours } from '@/features/events/lib/event-display';
import { getErrorMessage } from '@/lib/errors';

/**
 * EVT-ET1 (Mariem 26/10, operator 2026-10-27) — « Prolonger »: the admin moves the END of a match
 * later by the minutes they choose, and its « après » ads follow (the automatic extra-time
 * tracker does the same by itself when API-Football reports extra time or penalties). Nobody is
 * notified; every TV gets the new times at once.
 */
export default function EventProlongerModal({
  event,
  onClose,
}: {
  event: AdminEventView;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [minutes, setMinutes] = useState('30');
  const value = Number(minutes);
  const valid = isValidExtension(value);
  const newEnd = valid
    ? new Date(new Date(event.ends_at).getTime() + value * 60_000).toISOString()
    : null;

  const prolonger = useMutation({
    mutationFn: () => adminEventsService.prolonger(event.id, value),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: adminKeys.events() });
      void queryClient.invalidateQueries({ queryKey: eventsKeys.all });
      toast.success(
        `« ${event.name} » prolongé de ${formatExtension(value)} — ${result.positionnements_recalcules} positionnement(s) recalculé(s).`,
      );
      onClose();
    },
    onError: (err) => toast.error(getErrorMessage(err) || 'La prolongation a échoué.'),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md space-y-4 rounded-xl bg-white p-5 shadow-xl">
        <h2 className="flex items-center gap-2 text-base font-semibold text-[#171717]">
          <TimerReset className="h-4 w-4 text-brand-deep" />
          Prolonger le match
        </h2>
        <p className="text-sm text-[#5C5C5C]">
          « {event.name} » — la fin du match et les spots « après » seront décalés d’autant.
        </p>
        <div className="flex flex-wrap gap-2">
          {EXTENSION_PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setMinutes(String(p))}
              className={`rounded-full border px-3 py-1 text-sm ${
                value === p
                  ? 'border-brand-deep bg-brand-deep text-white'
                  : 'border-gray-300 text-gray-700 hover:bg-gray-50'
              }`}
            >
              +{formatExtension(p)}
            </button>
          ))}
        </div>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-gray-700">Durée (minutes)</span>
          <input
            type="number"
            min={MIN_EXTENSION}
            max={MAX_EXTENSION}
            step={5}
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-primary focus:outline-none"
          />
          {!valid && (
            <span className="mt-1 block text-xs text-red-600">
              Entre {MIN_EXTENSION} et {MAX_EXTENSION} minutes, par pas de 5.
            </span>
          )}
        </label>
        {newEnd && (
          <p className="text-sm text-gray-700">
            Horaire après prolongation :{' '}
            <span className="font-medium">{formatEventHours(event.kickoff_at, newEnd)}</span>
          </p>
        )}
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            Retour
          </button>
          <button
            type="button"
            disabled={!valid || prolonger.isPending}
            onClick={() => prolonger.mutate()}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-primary px-4 py-2 text-sm font-medium text-brand-deep disabled:opacity-60"
          >
            {prolonger.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Prolonger
          </button>
        </div>
      </div>
    </div>
  );
}
