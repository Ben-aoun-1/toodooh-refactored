import { Download, ReceiptText } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'react-hot-toast';

import { monthlyInvoiceDesignation } from '@/features/wallet/lib/wallet-ledger';
import {
  type MonthlyInvoiceRow,
  invoiceFilename,
  walletService,
} from '@/features/wallet/services/wallet.service';
import { formatTnd } from '@/lib/money';

interface MonthlyInvoicesSectionProps {
  invoices: MonthlyInvoiceRow[];
  loading: boolean;
}

/**
 * FCT2 (US-FCT-11..12) — « Factures mensuelles »: the ONE real invoice per month, consolidated on
 * proof-verified consumption (server-generated + stored PDF). A month with zero consumption has
 * no facture — the empty state says so instead of pretending. Recharges never appear here (their
 * document is the « Récapitulatif de commande » below).
 */
export default function MonthlyInvoicesSection({ invoices, loading }: MonthlyInvoicesSectionProps) {
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const handleDownload = async (invoice: MonthlyInvoiceRow) => {
    try {
      setDownloadingId(invoice.id);
      const blob = await walletService.downloadInvoice(invoice.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = invoiceFilename(invoice.reference);
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (_error) {
      toast.error('Erreur lors du téléchargement de la facture. Veuillez réessayer.');
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
      <div className="p-5 border-b border-gray-100 flex items-center gap-2">
        <ReceiptText className="h-4 w-4 text-gray-500" />
        <div>
          <h2 className="text-base font-bold text-gray-900">Factures mensuelles</h2>
          <p className="text-xs text-gray-500">
            Une facture consolidée par mois, établie sur votre consommation réelle
          </p>
        </div>
      </div>
      {loading ? (
        <div className="p-8 text-center text-sm text-gray-500">Chargement...</div>
      ) : invoices.length === 0 ? (
        <div className="p-8 text-center text-sm text-gray-500">
          Aucune facture pour le moment — votre première facture sera émise après un mois de
          diffusion.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="px-5 py-3 text-left text-xs font-medium text-gray-500">
                  Désignation
                </th>
                <th className="px-5 py-3 text-left text-xs font-medium text-gray-500">
                  Montant HT
                </th>
                <th className="px-5 py-3 text-left text-xs font-medium text-gray-500">Total TTC</th>
                <th className="px-5 py-3 text-left text-xs font-medium text-gray-500">Émise le</th>
                <th className="px-5 py-3 text-right text-xs font-medium text-gray-500"></th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((invoice) => (
                <tr
                  key={invoice.id}
                  className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors"
                >
                  <td className="px-5 py-4">
                    <p className="text-sm font-semibold text-gray-900">
                      {monthlyInvoiceDesignation(invoice.month)}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">{invoice.reference}</p>
                  </td>
                  {/* The invoice states its own TVA breakdown — plain HT and TTC columns, not
                      the htTtcLabel composite (the TTC is a real printed line here). */}
                  <td className="px-5 py-4 text-sm font-semibold text-gray-900 tabular-nums">
                    {formatTnd(invoice.total_ht)} TND
                  </td>
                  <td className="px-5 py-4 text-sm text-gray-900 tabular-nums">
                    {formatTnd(invoice.total_ttc)} TND
                  </td>
                  <td className="px-5 py-4 text-sm text-gray-500">
                    {new Date(invoice.created_at).toLocaleDateString('fr-FR')}
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex justify-end">
                      <button
                        onClick={() => void handleDownload(invoice)}
                        disabled={downloadingId === invoice.id}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50"
                      >
                        <Download className="h-3.5 w-3.5" />
                        Télécharger
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
