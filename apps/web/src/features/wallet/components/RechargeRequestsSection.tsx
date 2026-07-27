import { ReceiptText } from 'lucide-react';

import { methodLabel, statusChipClass, statusLabel } from '@/features/wallet/lib/recharge-methods';
import type { RechargeRow } from '@/features/wallet/services/wallet.service';

interface RechargeRequestsSectionProps {
  recharges: RechargeRow[];
  loading: boolean;
}

/**
 * FCT1 (US-FCT-8) — the screencaster's demandes list with the PER-METHOD status chips: a virement
 * runs « En attente de réception » → « Créditée » | « Annulée », a bon « Bon émis » → « Bon
 * retourné signé » → « Fonds reçus » | « Annulée »; legacy rows keep their as-found labels. Reads
 * the same recharges cache as the ledger/factures — no extra wire call.
 */
export default function RechargeRequestsSection({
  recharges,
  loading,
}: RechargeRequestsSectionProps) {
  if (loading || recharges.length === 0) return null;

  return (
    <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
      <div className="p-5 border-b border-gray-100 flex items-center gap-2">
        <ReceiptText className="h-4 w-4 text-gray-500" />
        <div>
          <h2 className="text-base font-bold text-gray-900">Mes demandes de recharge</h2>
          <p className="text-xs text-gray-500">Suivi de vos demandes par méthode et statut</p>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="px-5 py-3 text-left text-xs font-medium text-gray-500">Référence</th>
              <th className="px-5 py-3 text-left text-xs font-medium text-gray-500">Méthode</th>
              <th className="px-5 py-3 text-left text-xs font-medium text-gray-500">Montant</th>
              <th className="px-5 py-3 text-left text-xs font-medium text-gray-500">Statut</th>
              <th className="px-5 py-3 text-left text-xs font-medium text-gray-500">Date</th>
            </tr>
          </thead>
          <tbody>
            {recharges.map((r) => (
              <tr
                key={r.id}
                className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors"
              >
                <td className="px-5 py-3 text-sm font-medium text-gray-900">{r.reference}</td>
                <td className="px-5 py-3 text-sm text-gray-600">{methodLabel(r.method)}</td>
                <td className="px-5 py-3 text-sm font-semibold text-gray-900 tabular-nums">
                  {r.amount_tnd.toLocaleString('fr-FR')} TND
                </td>
                <td className="px-5 py-3">
                  <span
                    className={`px-3 py-1 inline-flex text-xs leading-5 font-semibold rounded-full border ${statusChipClass(r.status)}`}
                  >
                    {statusLabel(r.method, r.status)}
                  </span>
                </td>
                <td className="px-5 py-3 text-sm text-gray-500">
                  {new Date(r.created_at).toLocaleDateString('fr-FR')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
