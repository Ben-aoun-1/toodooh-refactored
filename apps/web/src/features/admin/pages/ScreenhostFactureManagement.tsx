import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, FileText, Filter, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'react-hot-toast';

import AdminLayout from '@/features/admin/components/AdminLayout';
import {
  FACTURE_ACTION_LABEL,
  FACTURE_STATUTS,
  MOTIF_REQUIRED_ERROR,
  PAPER_CONFIRM_MESSAGE,
  actionsForFacture,
  factureStatutChip,
  factureStatutLabel,
  isValidMotif,
} from '@/features/admin/lib/screenhost-facture-status';
import {
  type AdminFactureRow,
  adminFacturesService,
} from '@/features/admin/services/admin-factures.service';
import { formatDateFr, formatTnd } from '@/features/screenhost/lib/facture-view';
import { getErrorMessage } from '@/lib/errors';

// REV3 — admin « Factures Screenhost » (US-REV-7..11).
//
// THE ONLY SURFACE IN THE PRODUCT THAT SHOWS A FACTURE STATUS. §5 keeps statuses off every owner
// screen; this table is the stated exception, so the pill lives here and nowhere else.
//
// WHICH BUTTONS APPEAR IS NOT DECIDED IN THIS FILE. actionsForFacture (a pure lib) mirrors the
// api's transition matrix and is unit-tested — apps/web has no render harness, so a matrix left
// inline here would be untestable, and this one decides which money-moving buttons an admin sees.
// The api remains the authority: an out-of-matrix call 409s in French rather than half-applying.
//
// TWO ACTIONS ARE IRREVERSIBLE AND SAY SO. « Valider » writes a versement into the owner's history;
// « Marquer payée (papier) » does both at once and asks for confirmation naming that consequence —
// an admin who thought they were only flipping a status would be wrong.
export default function ScreenhostFactureManagement() {
  const queryClient = useQueryClient();
  const [statutFilter, setStatutFilter] = useState<string>('all');
  const [refusing, setRefusing] = useState<AdminFactureRow | null>(null);
  const [motif, setMotif] = useState('');
  const [motifError, setMotifError] = useState<string | null>(null);

  const listKey = ['admin', 'screenhost-factures', statutFilter] as const;
  const facturesQuery = useQuery({
    queryKey: listKey,
    queryFn: () => adminFacturesService.list(statutFilter),
  });
  const rows = facturesQuery.data ?? [];

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['admin', 'screenhost-factures'] });
  };

  const runAction = useMutation({
    mutationFn: async ({ row, action }: { row: AdminFactureRow; action: string }) => {
      if (action === 'valider') return adminFacturesService.valider(row.id);
      if (action === 'marquer-payee') return adminFacturesService.marquerPayee(row.id);
      if (action === 'paper') return adminFacturesService.paper(row.id);
      throw new Error(`Action inconnue : ${action}`);
    },
    onSuccess: async () => {
      toast.success('Facture mise à jour.');
      await invalidate();
    },
    onError: (error: unknown) => {
      // The api's 409 message is French and names the reason — surface it verbatim.
      toast.error(getErrorMessage(error) || 'L’action a échoué. Merci de réessayer.');
    },
  });

  const refuse = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      adminFacturesService.refuser(id, reason),
    onSuccess: async () => {
      toast.success('Facture refusée. Le screenhost a été notifié du motif.');
      setRefusing(null);
      setMotif('');
      setMotifError(null);
      await invalidate();
    },
    onError: (error: unknown) => {
      toast.error(getErrorMessage(error) || 'Le refus a échoué. Merci de réessayer.');
    },
  });

  const openSigned = async (row: AdminFactureRow) => {
    try {
      const { url } = await adminFacturesService.signedUrl(row.id);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (error) {
      toast.error(getErrorMessage(error) || 'Impossible d’ouvrir le document.');
    }
  };

  const onAction = (row: AdminFactureRow, action: string) => {
    if (action === 'voir') return void openSigned(row);
    if (action === 'refuser') {
      setRefusing(row);
      setMotif('');
      setMotifError(null);
      return;
    }
    if (action === 'paper' && !window.confirm(PAPER_CONFIRM_MESSAGE)) return;
    runAction.mutate({ row, action });
  };

  const submitRefusal = () => {
    // Required client-side too — the api 400s an empty motif, but the admin should learn that
    // before a round trip, and a refusal with no reason is useless to the owner either way.
    if (!isValidMotif(motif)) {
      setMotifError(MOTIF_REQUIRED_ERROR);
      return;
    }
    if (refusing) refuse.mutate({ id: refusing.id, reason: motif.trim() });
  };

  return (
    <AdminLayout title="Factures Screenhost">
      <div className="space-y-6">
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
            <div>
              <h2 className="text-lg font-bold text-gray-900">Factures des screenhosts</h2>
              <p className="text-sm text-gray-500 mt-1">
                Validez, refusez ou marquez payées les factures déposées par les établissements.
              </p>
            </div>
            <div>
              <label
                className="block text-sm font-medium text-gray-700 mb-2"
                htmlFor="statut-filter"
              >
                <span className="inline-flex items-center gap-1.5">
                  <Filter className="h-4 w-4" />
                  Filtrer par statut
                </span>
              </label>
              <select
                id="statut-filter"
                value={statutFilter}
                onChange={(e) => setStatutFilter(e.target.value)}
                className="w-full sm:w-64 px-3 py-2 rounded-xl border border-gray-200 bg-gray-50/80 text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/30"
              >
                <option value="all">Tous les statuts</option>
                {FACTURE_STATUTS.map((s) => (
                  <option key={s} value={s}>
                    {factureStatutLabel(s)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px]">
              <thead>
                <tr className="bg-gray-100/90 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">
                  <th className="px-5 py-3 pl-6">Référence</th>
                  <th className="px-5 py-3">Screenhost</th>
                  <th className="px-5 py-3">Montant</th>
                  <th className="px-5 py-3">Statut</th>
                  <th className="px-5 py-3">Date</th>
                  <th className="px-5 py-3 pr-6 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-gray-500 text-sm">
                      {facturesQuery.isLoading ? 'Chargement...' : 'Aucune facture pour ce filtre.'}
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => (
                    <tr key={row.id} className="hover:bg-gray-50/80">
                      <td className="px-5 py-4 pl-6">
                        <p className="text-sm font-medium text-gray-900">{row.reference}</p>
                        <p className="text-xs text-gray-500 mt-0.5">{row.designation}</p>
                      </td>
                      <td className="px-5 py-4 text-sm text-gray-700">{row.screenhost_name}</td>
                      <td className="px-5 py-4 text-sm font-medium text-gray-900 tabular-nums">
                        {formatTnd(row.montant_ttc)}
                      </td>
                      <td className="px-5 py-4">
                        <span
                          className={`px-3 py-1 inline-flex text-xs leading-5 font-semibold rounded-full border ${factureStatutChip(row.status)}`}
                        >
                          {factureStatutLabel(row.status)}
                        </span>
                        {row.status === 'refusee' && row.refusal_motif ? (
                          <p className="text-xs text-gray-500 mt-1 max-w-xs">{row.refusal_motif}</p>
                        ) : null}
                      </td>
                      <td className="px-5 py-4 text-sm text-gray-700 tabular-nums">
                        {formatDateFr(row.created_at)}
                      </td>
                      <td className="px-5 py-4 pr-6">
                        <div className="flex items-center justify-end gap-2 flex-wrap">
                          {actionsForFacture(row).map((action) => (
                            <button
                              key={action}
                              type="button"
                              onClick={() => onAction(row, action)}
                              disabled={runAction.isPending}
                              className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 ${
                                action === 'valider'
                                  ? 'bg-brand-primary hover:bg-brand-primary/90 text-gray-900'
                                  : action === 'refuser'
                                    ? 'border border-red-200 bg-red-50 text-red-700 hover:bg-red-100'
                                    : 'border border-gray-200 bg-gray-50 text-gray-700 hover:bg-gray-100'
                              }`}
                            >
                              {action === 'voir' ? <Eye className="w-4 h-4" /> : null}
                              {action === 'paper' ? <FileText className="w-4 h-4" /> : null}
                              {FACTURE_ACTION_LABEL[action]}
                            </button>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {refusing ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg">
            <div className="flex items-center justify-between gap-4 p-5 border-b border-gray-100">
              <h2 className="text-base font-bold text-gray-900">
                Refuser la facture {refusing.reference}
              </h2>
              <button
                type="button"
                onClick={() => setRefusing(null)}
                aria-label="Fermer"
                className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5">
              <label className="block text-sm font-medium text-gray-700 mb-2" htmlFor="motif">
                Motif du refus
              </label>
              <textarea
                id="motif"
                value={motif}
                onChange={(e) => {
                  setMotif(e.target.value);
                  if (motifError) setMotifError(null);
                }}
                rows={4}
                placeholder="Ex. : le cachet de l’établissement est absent."
                className="w-full px-3 py-2 rounded-xl border border-gray-200 bg-gray-50/80 text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/30"
              />
              <p className="text-xs text-gray-500 mt-2">
                Ce motif est envoyé au screenhost dans sa notification. Il pourra déposer une
                nouvelle facture signée.
              </p>
              {motifError ? <p className="text-sm text-red-600 mt-2">{motifError}</p> : null}
            </div>
            <div className="flex items-center justify-end gap-2 p-5 border-t border-gray-100">
              <button
                type="button"
                onClick={() => setRefusing(null)}
                className="px-4 py-2 rounded-xl border border-gray-200 bg-white text-gray-700 text-sm font-medium hover:bg-gray-50"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={submitRefusal}
                disabled={refuse.isPending}
                className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold disabled:opacity-50"
              >
                {refuse.isPending ? 'Envoi…' : 'Confirmer le refus'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </AdminLayout>
  );
}
