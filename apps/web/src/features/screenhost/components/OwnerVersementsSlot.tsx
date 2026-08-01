import { useQuery } from '@tanstack/react-query';
import { Banknote, Calendar, CreditCard } from 'lucide-react';

import { useAuthStore } from '@/features/auth/stores/auth.store';
import { screenhostKeys } from '@/features/screenhost/hooks/queryKeys';
import { formatDateFr, formatTnd } from '@/features/screenhost/lib/facture-view';
import { versementsService } from '@/features/screenhost/services/versements.service';

// REV3 — « Historique des versements » on Mes Revenus, below the signed-facture deposit slot.
//
// FOUR COLUMNS, FROZEN, AND NOTHING ELSE. Désignation, Montant, Date, Mode de versement. No Voir,
// no status, no filter — a versement is a closed fact, not a workflow: there is nothing to open,
// nothing in progress, and (§5) no lifecycle an owner reads on a line. The absence of actions here
// is the design, not an unfinished state.
//
// A LINE APPEARS ONLY WHEN MONEY MOVED — at the admin's validation, or at the paper action. It is
// never written by the sweep, never by a deposit, and never edited afterwards: « Marquer payée »
// deliberately leaves it alone, because the payment it records already happened at validation.
//
// The mode is a MASKED LABEL frozen at write. An owner who changes their RIB still sees the account
// a past versement actually went to — that is the whole reason the row stores a label instead of
// the screen deriving one.
export default function OwnerVersementsSlot() {
  const { user } = useAuthStore();
  const versementsQuery = useQuery({
    queryKey: screenhostKeys.versements(user?.id ?? ''),
    queryFn: () => versementsService.list(),
    enabled: !!user?.id,
  });
  const rows = versementsQuery.data ?? [];

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="p-5 sm:p-6 border-b border-gray-100">
        <h2 className="text-lg font-bold text-gray-900">Historique des versements</h2>
        <p className="text-sm text-gray-500 mt-1">
          Les paiements que Toodooh vous a versés, avec le mode utilisé.
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px]">
          <thead>
            <tr className="bg-gray-100/90 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">
              <th className="px-5 py-3 pl-6">Désignation</th>
              <th className="px-5 py-3">
                <span className="inline-flex items-center gap-1.5">
                  <Banknote className="w-3.5 h-3.5" />
                  Montant
                </span>
              </th>
              <th className="px-5 py-3">
                <span className="inline-flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5" />
                  Date
                </span>
              </th>
              <th className="px-5 py-3 pr-6">
                <span className="inline-flex items-center gap-1.5">
                  <CreditCard className="w-3.5 h-3.5" />
                  Mode de versement
                </span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-6 py-12 text-center text-gray-500 text-sm">
                  {versementsQuery.isLoading
                    ? 'Chargement...'
                    : 'Aucun versement pour le moment. Vos versements apparaîtront ici une fois vos factures validées.'}
                </td>
              </tr>
            ) : (
              rows.map((row, index) => (
                // The wire carries exactly the four frozen fields — no id to key on, by design.
                // The list is read-only and never reordered, so the index is a stable key.
                <tr key={`${row.created_at}-${index}`} className="hover:bg-gray-50/80">
                  <td className="px-5 py-4 pl-6 text-sm font-medium text-gray-900">
                    {row.designation}
                  </td>
                  <td className="px-5 py-4 text-sm font-medium text-gray-900 tabular-nums">
                    {formatTnd(row.montant_ttc)}
                  </td>
                  <td className="px-5 py-4 text-sm text-gray-700 tabular-nums">
                    {formatDateFr(row.created_at)}
                  </td>
                  <td className="px-5 py-4 pr-6 text-sm text-gray-700">{row.mode_label_masked}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
