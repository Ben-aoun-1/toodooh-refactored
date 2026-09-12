import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Filter } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'react-hot-toast';

import AdminLayout from '@/features/admin/components/AdminLayout';
import { adminKeys } from '@/features/admin/hooks/queryKeys';
import {
  SUPPORT_STATUSES,
  roleLabel,
  supportKindLabel,
  supportStatusChip,
  supportStatusLabel,
} from '@/features/admin/lib/support-status';
import {
  type AdminSupportRow,
  adminSupportService,
} from '@/features/admin/services/admin-support.service';
import { formatDateFr } from '@/features/screenhost/lib/facture-view';
import { getErrorMessage } from '@/lib/errors';

// SUP-1 (Mejri 11/09 point 8) — the admin « Support » queue: every message and appointment wish
// the forms send (they used to send nothing), newest first; « Traiter » closes a row once.
export default function SupportManagement() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>('new');

  const query = useQuery({
    queryKey: adminKeys.support(statusFilter),
    queryFn: () => adminSupportService.list(statusFilter),
  });
  const rows = query.data ?? [];

  const handle = useMutation({
    mutationFn: (row: AdminSupportRow) => adminSupportService.markHandled(row.id),
    onSuccess: async () => {
      toast.success('Message traité.');
      await queryClient.invalidateQueries({ queryKey: adminKeys.supportAll() });
    },
    onError: (error: unknown) => {
      toast.error(getErrorMessage(error) || 'L’action a échoué. Merci de réessayer.');
    },
  });

  return (
    <AdminLayout title="Support">
      <div className="space-y-6">
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
            <div>
              <h2 className="text-lg font-bold text-gray-900">
                Messages et demandes de rendez-vous
              </h2>
              <p className="text-sm text-gray-500 mt-1">
                Ce que les annonceurs, screenhosts et agents envoient depuis le bouton « Support ».
              </p>
            </div>
            <div>
              <label
                className="block text-sm font-medium text-gray-700 mb-2"
                htmlFor="status-filter"
              >
                <span className="inline-flex items-center gap-1.5">
                  <Filter className="h-4 w-4" />
                  Filtrer par statut
                </span>
              </label>
              <select
                id="status-filter"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="w-full sm:w-64 px-3 py-2 rounded-xl border border-gray-200 bg-gray-50/80 text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/30"
              >
                <option value="all">Tous</option>
                {SUPPORT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {supportStatusLabel(s)}
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
                  <th className="px-5 py-3 pl-6">Date</th>
                  <th className="px-5 py-3">Compte</th>
                  <th className="px-5 py-3">Type</th>
                  <th className="px-5 py-3">Objectif</th>
                  <th className="px-5 py-3">Message</th>
                  <th className="px-5 py-3">Statut</th>
                  <th className="px-5 py-3 pr-6 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-12 text-center text-gray-500 text-sm">
                      {query.isLoading ? 'Chargement...' : 'Aucun message pour ce filtre.'}
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => (
                    <tr key={row.id} className="hover:bg-gray-50/80 align-top">
                      <td className="px-5 py-4 pl-6 text-sm text-gray-700 tabular-nums">
                        {formatDateFr(row.created_at)}
                      </td>
                      <td className="px-5 py-4">
                        <p className="text-sm font-medium text-gray-900">{row.account_label}</p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {roleLabel(row.user_role)} · {row.user_email}
                        </p>
                      </td>
                      <td className="px-5 py-4 text-sm text-gray-700">
                        {supportKindLabel(row.kind)}
                        {row.appointment_date ? (
                          <p className="text-xs text-gray-500 mt-0.5">
                            souhaité le {row.appointment_date}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-5 py-4 text-sm text-gray-700">
                        {row.objective}
                        {row.other_detail ? (
                          <p className="text-xs text-gray-500 mt-0.5">{row.other_detail}</p>
                        ) : null}
                      </td>
                      <td className="px-5 py-4 text-sm text-gray-700 max-w-md whitespace-pre-wrap">
                        {row.message ?? '—'}
                      </td>
                      <td className="px-5 py-4">
                        <span
                          className={`px-3 py-1 inline-flex text-xs leading-5 font-semibold rounded-full border ${supportStatusChip(row.status)}`}
                        >
                          {supportStatusLabel(row.status)}
                        </span>
                      </td>
                      <td className="px-5 py-4 pr-6 text-right">
                        {row.status === 'new' ? (
                          <button
                            type="button"
                            onClick={() => handle.mutate(row)}
                            disabled={handle.isPending}
                            className="inline-flex items-center px-3 py-2 rounded-lg text-sm font-medium bg-brand-primary hover:bg-brand-primary/90 text-gray-900 disabled:opacity-50"
                          >
                            Traiter
                          </button>
                        ) : (
                          <span className="text-xs text-gray-400">
                            {row.handled_at ? formatDateFr(row.handled_at) : ''}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
