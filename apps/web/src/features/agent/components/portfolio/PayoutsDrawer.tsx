import { Upload, X } from 'lucide-react';
import { useRef } from 'react';
import { toast } from 'react-hot-toast';

import Drawer from '@/components/Drawer';
import { useAgentWallet, useUploadPayoutInvoice } from '@/features/agent/hooks/useAgentPortfolio';
import { frDate } from '@/features/agent/lib/agent-portfolio';
import { getErrorMessage } from '@/lib/errors';
import { tndLabel } from '@/lib/money';

const STATUS_FR = { en_preparation: 'En préparation', effectue: 'Effectué' } as const;

const monthFr = (month: string) =>
  new Date(`${month}-01T12:00:00`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

/**
 * AGT-3 (spec §10 « Versements ») — « Mes versements », opened from the Revenu actuel card: month,
 * amount, transfer date, status. A Screencaster agent uploads the month's invoice here (Q5 A).
 */
export function PayoutsDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const wallet = useAgentWallet(open);
  const upload = useUploadPayoutInvoice();
  const input = useRef<HTMLInputElement>(null);
  const target = useRef<string | null>(null);
  const payouts = wallet.data?.payouts ?? [];

  const pick = (id: string) => {
    target.current = id;
    input.current?.click();
  };
  const onFile = async (file: File | undefined) => {
    if (!file || !target.current) return;
    try {
      await upload.mutateAsync({ payoutId: target.current, file });
      toast.success('Facture déposée');
    } catch (e) {
      toast.error(getErrorMessage(e) || 'Dépôt impossible');
    } finally {
      if (input.current) input.current.value = '';
    }
  };

  return (
    <Drawer open={open} onClose={onClose} width={480}>
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between border-b px-6 py-5">
          <h2 className="text-lg font-semibold">Mes versements</h2>
          <button type="button" onClick={onClose} aria-label="Fermer">
            <X className="h-5 w-5" />
          </button>
        </div>
        <input
          ref={input}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={(e) => void onFile(e.target.files?.[0])}
        />
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {payouts.length === 0 ? (
            <p className="py-10 text-center text-sm text-gray-500">
              Aucun versement pour le moment.
            </p>
          ) : (
            <ul className="divide-y">
              {payouts.map((p) => (
                <li key={p.id} className="py-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-medium capitalize">{monthFr(p.month)}</span>
                    <span className="font-semibold">{tndLabel(p.amount_tnd)}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between text-gray-500">
                    <span>
                      {STATUS_FR[p.status]}
                      {p.transfer_date ? ` — virement du ${frDate(p.transfer_date)}` : ''}
                    </span>
                    {wallet.data?.invoice_required && p.status === 'en_preparation' && (
                      <button
                        type="button"
                        onClick={() => pick(p.id)}
                        disabled={upload.isPending}
                        className="inline-flex items-center gap-1 font-medium text-brand-primary"
                      >
                        <Upload className="h-4 w-4" />
                        {p.invoice_file_name ? 'Remplacer la facture' : 'Déposer ma facture'}
                      </button>
                    )}
                  </div>
                  {p.invoice_file_name && (
                    <p className="mt-1 text-xs text-gray-400">Facture : {p.invoice_file_name}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Drawer>
  );
}
