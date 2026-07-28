import { X } from 'lucide-react';

import { useEventTarification } from '@/features/admin/hooks/useAdminEvents';
import { htTtcOrDash } from '@/lib/money';

interface EventTarificationModalProps {
  eventId: string;
  eventName: string;
  onClose: () => void;
}

const fr = new Intl.NumberFormat('fr-FR');

/**
 * EV2 — the read-only « Tarification » block (the LOG1-adjacent insight surface): C_max_evt in
 * HT (TTC), I_max, the eligible-venue count, the CPM_evt in effect, and the per-venue rows
 * (A_max, blocs disponibles, impressions). Everything arrives computed from the api — the web
 * renders, never re-derives.
 */
export default function EventTarificationModal({
  eventId,
  eventName,
  onClose,
}: EventTarificationModalProps) {
  const { data, isLoading, isError } = useEventTarification(eventId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <div>
            <h2 className="text-lg font-semibold text-[#171717]">Tarification</h2>
            <p className="text-sm text-[#5C5C5C]">{eventName}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="p-1.5 rounded-full hover:bg-gray-100 text-gray-500"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="p-5 space-y-5">
          {isLoading ? (
            <p className="text-sm text-[#5C5C5C]">Calcul de la tarification…</p>
          ) : isError || !data ? (
            <p className="text-sm text-red-600">La tarification n’a pas pu être chargée.</p>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="rounded-xl bg-gray-50 border border-gray-200 p-3">
                  <p className="text-xs text-[#5C5C5C]">Budget maximum (C_max)</p>
                  <p className="mt-1 text-sm font-semibold text-[#171717]">
                    {htTtcOrDash(data.c_max_evt_tnd)}
                  </p>
                </div>
                <div className="rounded-xl bg-gray-50 border border-gray-200 p-3">
                  <p className="text-xs text-[#5C5C5C]">Impressions max (I_max)</p>
                  <p className="mt-1 text-sm font-semibold text-[#171717]">
                    {fr.format(data.i_max)}
                  </p>
                </div>
                <div className="rounded-xl bg-gray-50 border border-gray-200 p-3">
                  <p className="text-xs text-[#5C5C5C]">Éligibilité</p>
                  <p className="mt-1 text-sm font-semibold text-[#171717]">
                    {data.eligible_count} établissement{data.eligible_count > 1 ? 's' : ''} éligible
                    {data.eligible_count > 1 ? 's' : ''}
                  </p>
                </div>
                <div className="rounded-xl bg-gray-50 border border-gray-200 p-3">
                  <p className="text-xs text-[#5C5C5C]">CPM événementiel</p>
                  <p className="mt-1 text-sm font-semibold text-[#171717]">
                    {fr.format(data.cpm_evt_tnd)} TND / 1000
                  </p>
                </div>
              </div>
              {data.venues.length === 0 ? (
                <p className="text-sm text-[#5C5C5C]">
                  Aucun établissement éligible sur la fenêtre de diffusion.
                </p>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-gray-200">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 text-left text-xs uppercase text-gray-500">
                        <th className="px-4 py-2.5">Établissement</th>
                        <th className="px-4 py-2.5 text-right">A_max (pers/h)</th>
                        <th className="px-4 py-2.5 text-right">Blocs disponibles</th>
                        <th className="px-4 py-2.5 text-right">Impressions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.venues.map((v) => (
                        <tr key={v.screenhost_id} className="border-b border-gray-100">
                          <td className="px-4 py-2.5 font-medium text-[#171717]">{v.name}</td>
                          <td className="px-4 py-2.5 text-right text-[#5C5C5C]">
                            {fr.format(v.amax_pph)}
                          </td>
                          <td className="px-4 py-2.5 text-right text-[#5C5C5C]">
                            {v.blocs_disponibles}
                          </td>
                          <td className="px-4 py-2.5 text-right text-[#5C5C5C]">
                            {fr.format(v.impressions)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
