import { format } from 'date-fns';
import { ExternalLink } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'react-hot-toast';

import {
  useAgentPayouts,
  useMarkPayoutPaid,
  usePreparePayouts,
} from '@/features/admin/hooks/useAdminAgents';
import {
  PAYOUT_STATUS_FR,
  defaultPayoutMonth,
  payoutBlocker,
} from '@/features/admin/lib/agent-payouts';
import { adminAgentsService } from '@/features/admin/services/admin-agents.service';
import { getErrorMessage } from '@/lib/errors';
import { tndLabel } from '@/lib/money';

/**
 * AGT-3 (agent specs v1.0 §10 « Versements ») — the month's agent payouts: prepare the month
 * (every positive balance with a validated RIB, no threshold), open a Screencaster agent's
 * invoice, mark a transfer done (which debits the agent wallet and notifies the agent).
 */
export function AgentPayoutsPanel() {
  const [month, setMonth] = useState(() => defaultPayoutMonth(new Date()));
  const [transferDate, setTransferDate] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const payouts = useAgentPayouts(month);
  const prepare = usePreparePayouts();
  const markPaid = useMarkPayoutPaid();
  const rows = payouts.data?.payouts ?? [];

  const runPrepare = async () => {
    try {
      const r = await prepare.mutateAsync(month);
      toast.success(
        `${r.prepared.length} versement(s) préparé(s)` +
          (r.waiting_rib.length ? ` — ${r.waiting_rib.length} en attente de RIB validé` : ''),
      );
    } catch (e) {
      toast.error(getErrorMessage(e) || 'Préparation impossible');
    }
  };

  const openInvoice = async (id: string) => {
    try {
      const { url } = await adminAgentsService.payoutInvoiceUrl(id);
      window.open(url, '_blank', 'noopener');
    } catch (e) {
      toast.error(getErrorMessage(e) || 'Facture indisponible');
    }
  };

  const pay = async (id: string) => {
    try {
      await markPaid.mutateAsync({ id, transferDate });
      toast.success('Versement marqué effectué');
    } catch (e) {
      toast.error(getErrorMessage(e) || 'Action impossible');
    }
  };

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="block text-gray-600">Mois</span>
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="mt-1 rounded-lg border px-3 py-2"
          />
        </label>
        <button
          type="button"
          onClick={() => void runPrepare()}
          disabled={prepare.isPending || !month}
          className="rounded-lg bg-brand-primary px-4 py-2 text-sm font-medium text-brand-deep disabled:opacity-50"
        >
          Préparer les versements du mois
        </button>
        <label className="text-sm">
          <span className="block text-gray-600">Date du virement</span>
          <input
            type="date"
            value={transferDate}
            onChange={(e) => setTransferDate(e.target.value)}
            className="mt-1 rounded-lg border px-3 py-2"
          />
        </label>
      </div>

      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-gray-500">Aucun versement pour ce mois.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-3">Agent</th>
                <th className="px-4 py-3">Montant</th>
                <th className="px-4 py-3">Facture</th>
                <th className="px-4 py-3">Statut</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((p) => {
                const blocker = payoutBlocker(p);
                return (
                  <tr key={p.id}>
                    <td className="px-4 py-3">
                      <p className="font-medium">{p.agent_name}</p>
                      <p className="font-mono text-gray-500">{p.agent_code}</p>
                    </td>
                    <td className="px-4 py-3">{tndLabel(p.amount_tnd)}</td>
                    <td className="px-4 py-3">
                      {!p.invoice_required ? (
                        <span className="text-gray-400">Non requise</span>
                      ) : p.invoice_uploaded_at ? (
                        <button
                          type="button"
                          onClick={() => void openInvoice(p.id)}
                          className="flex items-center gap-1 text-brand-primary"
                        >
                          <ExternalLink className="h-4 w-4" />
                          {p.invoice_file_name ?? 'Facture'}
                        </button>
                      ) : (
                        <span className="text-amber-700">En attente</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {PAYOUT_STATUS_FR[p.status]}
                      {p.transfer_date && (
                        <p className="text-gray-500">
                          Virement du {p.transfer_date.split('-').reverse().join('/')}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {p.status === 'en_preparation' &&
                        (blocker ? (
                          <span className="text-xs text-gray-500">{blocker}</span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => void pay(p.id)}
                            disabled={markPaid.isPending || !transferDate}
                            className="rounded-lg border px-3 py-2 text-sm disabled:opacity-50"
                          >
                            Marquer effectué
                          </button>
                        ))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
