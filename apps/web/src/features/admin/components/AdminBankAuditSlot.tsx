import { useQuery } from '@tanstack/react-query';
import { History } from 'lucide-react';

import { adminUserService } from '@/features/admin/services/admin-user.service';

/**
 * REV1 — the INTERNAL trail of an owner's payout-coordinate changes, admin-only.
 *
 * There is deliberately no owner-facing counterpart: the spec keeps no history on the owner's
 * side, and the trail exists to be read by someone OTHER than whoever might have moved the money.
 * Rendered read-only; nothing here can edit or delete a row.
 */
export default function AdminBankAuditSlot({ userId }: { userId: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin', 'users', userId, 'bank-audit'],
    queryFn: () => adminUserService.getBankAudit(userId),
    enabled: Boolean(userId),
  });

  const rows = data ?? [];

  return (
    <div className="bg-gray-50 p-4 rounded-lg">
      <h4 className="font-semibold text-gray-900 mb-3 flex items-center">
        <History className="h-5 w-5 mr-2 text-brand-primary" />
        Historique des coordonnées bancaires
      </h4>
      <p className="text-xs text-gray-500 mb-3">Journal interne — non visible par le Screenhost.</p>

      {isLoading && <p className="text-sm text-gray-600">Chargement…</p>}
      {isError && <p className="text-sm text-red-600">Historique indisponible.</p>}

      {!isLoading && !isError && rows.length === 0 && (
        <p data-testid="bank-audit-empty" className="text-sm text-gray-600">
          Aucune modification enregistrée.
        </p>
      )}

      {rows.length > 0 && (
        <ul data-testid="bank-audit-list" className="space-y-3">
          {rows.map((entry) => (
            <li key={entry.id} className="rounded-lg border border-gray-200 bg-white p-3 text-sm">
              <p className="text-xs text-gray-500 mb-2">
                {new Date(entry.created_at).toLocaleString('fr-FR')}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <span className="block text-xs font-medium text-gray-500 mb-1">Avant</span>
                  <p className="font-mono text-xs text-gray-700 break-all">
                    {entry.before.bank_rib ?? '—'}
                  </p>
                  <p className="font-mono text-xs text-gray-700 break-all">
                    {entry.before.bank_iban ?? '—'}
                  </p>
                  <p className="text-xs text-gray-700">{entry.before.bank_account_holder ?? '—'}</p>
                </div>
                <div>
                  <span className="block text-xs font-medium text-gray-500 mb-1">Après</span>
                  <p className="font-mono text-xs text-gray-900 break-all">
                    {entry.after.bank_rib ?? '—'}
                  </p>
                  <p className="font-mono text-xs text-gray-900 break-all">
                    {entry.after.bank_iban ?? '—'}
                  </p>
                  <p className="text-xs text-gray-900">{entry.after.bank_account_holder ?? '—'}</p>
                </div>
              </div>
              {entry.before.bank_document_id !== entry.after.bank_document_id && (
                <p className="mt-2 text-xs text-amber-700">
                  Le relevé d&apos;identité bancaire a également été remplacé.
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
