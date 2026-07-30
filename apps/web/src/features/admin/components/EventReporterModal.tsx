import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'react-hot-toast';

import { adminKeys } from '@/features/admin/hooks/queryKeys';
import { adminEventsService } from '@/features/admin/services/admin-events.service';
import type { AdminEventView } from '@/features/admin/services/admin-events.service';
import { eventsKeys } from '@/features/events/hooks/queryKeys';
import { getErrorMessage } from '@/lib/errors';

// EV5 (R4) — « Reporter »: move a match. The window is re-derived, every live positioning is
// re-snapshotted, each allocation's blocs are remapped onto the same relative slots and the
// reservations are rewritten — the operator is told exactly that before confirming.

export const REPORTER_TITLE = 'Reporter cet événement';
export const REPORTER_NOTICE = 'Les positionnements et créneaux seront recalculés.';

/** `2027-06-10T20:00:00+01:00` → the two datetime-local field values (Tunis wall-clock). */
const toLocalInput = (iso: string): string => {
  const d = new Date(iso);
  const tunis = new Date(d.getTime() + 60 * 60 * 1000); // UTC+1, no DST
  return tunis.toISOString().slice(0, 16);
};

/** A datetime-local value is Tunis wall-clock — stamp it back as +01:00. */
const toInstant = (local: string): string => new Date(`${local}:00+01:00`).toISOString();

interface EventReporterModalProps {
  event: AdminEventView;
  onClose: () => void;
}

export default function EventReporterModal({ event, onClose }: EventReporterModalProps) {
  const queryClient = useQueryClient();
  const [kickoff, setKickoff] = useState(() => toLocalInput(event.kickoff_at));
  const [ends, setEnds] = useState(() => toLocalInput(event.ends_at));

  const reporter = useMutation({
    mutationFn: () =>
      adminEventsService.reporter(event.id, {
        kickoff_at: toInstant(kickoff),
        ends_at: toInstant(ends),
      }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: adminKeys.events() });
      void queryClient.invalidateQueries({ queryKey: eventsKeys.all });
      toast.success(
        `« ${event.name} » reporté — ${result.positionnements_recalcules} positionnement(s) recalculé(s).`,
      );
      onClose();
    },
    onError: (err) => toast.error(getErrorMessage(err) || 'Le report a échoué.'),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md space-y-4 rounded-xl bg-white p-5 shadow-xl">
        <h2 className="flex items-center gap-2 text-base font-semibold text-[#171717]">
          <CalendarClock className="h-4 w-4 text-brand-deep" />
          {REPORTER_TITLE}
        </h2>
        <p className="text-sm text-[#5C5C5C]">
          « {event.name} » — {REPORTER_NOTICE}
        </p>
        <div className="space-y-3">
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-gray-700">Nouveau coup d’envoi</span>
            <input
              type="datetime-local"
              value={kickoff}
              onChange={(e) => setKickoff(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-primary focus:outline-none"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-gray-700">Nouvelle fin</span>
            <input
              type="datetime-local"
              value={ends}
              onChange={(e) => setEnds(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-primary focus:outline-none"
            />
          </label>
        </div>
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
            disabled={reporter.isPending}
            onClick={() => reporter.mutate()}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-primary px-4 py-2 text-sm font-medium text-brand-deep disabled:opacity-60"
          >
            {reporter.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Confirmer le report
          </button>
        </div>
      </div>
    </div>
  );
}
