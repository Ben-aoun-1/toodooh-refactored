import { Ban, Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'react-hot-toast';

import AdminLayout from '@/features/admin/components/AdminLayout';
import EventFormModal from '@/features/admin/components/EventFormModal';
import { useAdminEvents, useAnnulerEvent } from '@/features/admin/hooks/useAdminEvents';
import type { AdminEventView } from '@/features/admin/services/admin-events.service';
import {
  STATUT_CHIP_CLASSES,
  STATUT_LABELS,
  SUGGESTED_BADGE,
  formatEventDate,
  formatEventHours,
} from '@/features/events/lib/event-display';
import { getErrorMessage } from '@/lib/errors';

/**
 * « Événements » (admin, EV1 — rebuilt per §10 on the live api; the Supabase-era screen is
 * gone). The list carries EVERYTHING (official + suggested + annulé); the modal edits
 * ONLY the kept fields; suggested events are read-only with their badge (annuler stays available
 * as the operator's kill switch); annuler asks for confirmation.
 */
export default function EventManagement() {
  const { events, loading, isError } = useAdminEvents();
  const annuler = useAnnulerEvent();
  const [modal, setModal] = useState<{ open: boolean; event: AdminEventView | null }>({
    open: false,
    event: null,
  });
  const [confirming, setConfirming] = useState<AdminEventView | null>(null);

  const confirmAnnuler = (event: AdminEventView) => {
    annuler.mutate(event.id, {
      onSuccess: () => {
        toast.success(`« ${event.name} » annulé.`);
        setConfirming(null);
      },
      onError: (err) => {
        toast.error(getErrorMessage(err) || "L'annulation a échoué.");
        setConfirming(null);
      },
    });
  };

  return (
    <AdminLayout
      title="Événements"
      subtitle="Le catalogue sportif officiel et les matchs suggérés par les annonceurs"
    >
      <div className="space-y-6">
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setModal({ open: true, event: null })}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-primary text-brand-deep px-4 py-2.5 text-sm font-medium"
          >
            <Plus className="h-4 w-4" />
            Créer un nouvel événement
          </button>
        </div>

        {loading ? (
          <p className="text-sm text-[#5C5C5C]">Chargement…</p>
        ) : isError ? (
          <p className="text-sm text-red-600">La liste des événements n’a pas pu être chargée.</p>
        ) : events.length === 0 ? (
          <p className="text-sm text-[#5C5C5C]">Aucun événement pour le moment.</p>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs uppercase text-gray-500">
                  <th className="px-4 py-3">Nom</th>
                  <th className="px-4 py-3">Catégorie</th>
                  <th className="px-4 py-3">Date et horaire</th>
                  <th className="px-4 py-3">Statut</th>
                  <th className="px-4 py-3">Source</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr
                    key={e.id}
                    className={`border-b border-gray-100 ${e.annule ? 'opacity-50' : ''}`}
                  >
                    <td className="px-4 py-3 font-medium text-[#171717]">{e.name}</td>
                    <td className="px-4 py-3 text-[#5C5C5C]">{e.category ?? '—'}</td>
                    <td className="px-4 py-3 text-[#5C5C5C]">
                      {formatEventDate(e.kickoff_at)} · {formatEventHours(e.kickoff_at, e.ends_at)}
                    </td>
                    <td className="px-4 py-3">
                      {e.annule ? (
                        <span className="px-2 py-0.5 rounded-md text-xs font-medium bg-red-50 text-red-700">
                          Annulé
                        </span>
                      ) : (
                        <span
                          className={`px-2 py-0.5 rounded-md text-xs font-medium ${STATUT_CHIP_CLASSES[e.statut]}`}
                        >
                          {STATUT_LABELS[e.statut]}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {e.source === 'suggested' ? (
                        <span className="px-2 py-0.5 rounded-md text-xs font-medium bg-amber-50 text-amber-800">
                          {SUGGESTED_BADGE}
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-md text-xs bg-gray-100 text-gray-600">
                          Officiel
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        {/* Suggested = read-only (their badge says why); official edits open
                            the §10 modal. Annuler stays available on both until annulé. */}
                        {e.source === 'official' && !e.annule && (
                          <button
                            type="button"
                            title="Modifier"
                            onClick={() => setModal({ open: true, event: e })}
                            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                        )}
                        {!e.annule && (
                          <button
                            type="button"
                            title="Annuler l’événement"
                            onClick={() => setConfirming(e)}
                            className="p-1.5 rounded-lg hover:bg-red-50 text-red-500"
                          >
                            <Ban className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modal.open && (
        <EventFormModal
          event={modal.event}
          onClose={() => setModal({ open: false, event: null })}
        />
      )}

      {confirming !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-5 space-y-4">
            <h2 className="text-base font-semibold text-[#171717]">Annuler cet événement ?</h2>
            <p className="text-sm text-[#5C5C5C]">
              « {confirming.name} » n’apparaîtra plus dans le catalogue. Cette action est
              définitive.
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfirming(null)}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                Retour
              </button>
              <button
                type="button"
                disabled={annuler.isPending}
                onClick={() => confirmAnnuler(confirming)}
                className="rounded-lg bg-red-600 text-white px-4 py-2 text-sm font-medium disabled:opacity-60"
              >
                Confirmer l’annulation
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
