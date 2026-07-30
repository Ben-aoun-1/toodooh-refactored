import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, ShieldCheck, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'react-hot-toast';

import { adminKeys } from '@/features/admin/hooks/queryKeys';
import {
  type EventAttestationRow,
  adminEventsService,
} from '@/features/admin/services/admin-events.service';
import { getErrorMessage } from '@/lib/errors';

// EV5 — « Respect de l'événement »: the agent/admin verdict per allocated venue. The DEFAULT RULE
// is spelled out on screen — a venue with no verdict counts as RESPECTÉ, because no inspection
// must never read as a sanction. A « non respecté » verdict both lowers the venue's SPS respect
// variable and negates that venue's delivery at settlement (the dual proof).

export const RESPECT_PANEL_TITLE = 'Respect de l’événement';
export const RESPECT_DEFAULT_HINT =
  'Sans attestation, l’établissement est considéré comme ayant respecté l’événement.';
export const RESPECT_YES_LABEL = 'Respecté';
export const RESPECT_NO_LABEL = 'Non respecté';
export const RESPECT_UNATTESTED_LABEL = 'Non attesté (respecté par défaut)';

export default function EventAttestationsPanel({ eventId }: { eventId: string }) {
  const queryClient = useQueryClient();
  const listKey = [...adminKeys.events(), 'attestations', eventId] as const;
  const { data, isLoading } = useQuery({
    queryKey: listKey,
    queryFn: () => adminEventsService.attestations(eventId),
  });
  const [notes, setNotes] = useState<Record<string, string>>({});

  const attest = useMutation({
    mutationFn: (input: { screenhostId: string; respecte: boolean; note?: string | null }) =>
      adminEventsService.attest(eventId, input.screenhostId, {
        respecte: input.respecte,
        note: input.note ?? null,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: listKey });
      toast.success('Attestation enregistrée.');
    },
    onError: (err) => toast.error(getErrorMessage(err) || 'L’attestation a échoué.'),
  });

  const rows: EventAttestationRow[] = data ?? [];

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <h3 className="flex items-center gap-2 text-sm font-bold text-[#171717]">
        <ShieldCheck className="h-4 w-4 text-brand-deep" />
        {RESPECT_PANEL_TITLE}
      </h3>
      <p className="mt-1 text-xs text-[#7A7A7A]">{RESPECT_DEFAULT_HINT}</p>
      {isLoading ? (
        <p className="mt-3 inline-flex items-center gap-2 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Chargement…
        </p>
      ) : rows.length === 0 ? (
        <p className="mt-3 text-sm text-gray-500">
          Aucun établissement ne diffuse encore cet événement.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {rows.map((row) => {
            const busy = attest.isPending && attest.variables?.screenhostId === row.screenhost_id;
            return (
              <li key={row.screenhost_id} className="rounded-lg border border-gray-100 px-3 py-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-[#171717]">
                      {row.screenhost_name}
                    </p>
                    <p className="text-xs text-[#7A7A7A]">
                      {row.respecte === null
                        ? RESPECT_UNATTESTED_LABEL
                        : row.respecte
                          ? RESPECT_YES_LABEL
                          : RESPECT_NO_LABEL}
                      {row.note ? ` — ${row.note}` : ''}
                    </p>
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        attest.mutate({
                          screenhostId: row.screenhost_id,
                          respecte: true,
                          note: notes[row.screenhost_id] ?? null,
                        })
                      }
                      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-50 ${
                        row.respecte === true
                          ? 'bg-green-100 text-green-800'
                          : 'border border-gray-200 text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      <Check className="h-3.5 w-3.5" />
                      {RESPECT_YES_LABEL}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        attest.mutate({
                          screenhostId: row.screenhost_id,
                          respecte: false,
                          note: notes[row.screenhost_id] ?? null,
                        })
                      }
                      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-50 ${
                        row.respecte === false
                          ? 'bg-red-100 text-red-800'
                          : 'border border-gray-200 text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      <X className="h-3.5 w-3.5" />
                      {RESPECT_NO_LABEL}
                    </button>
                  </div>
                </div>
                <input
                  value={notes[row.screenhost_id] ?? row.note ?? ''}
                  onChange={(e) =>
                    setNotes((prev) => ({ ...prev, [row.screenhost_id]: e.target.value }))
                  }
                  placeholder="Note d’inspection (optionnelle)"
                  className="mt-2 w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs focus:border-brand-primary focus:outline-none"
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
