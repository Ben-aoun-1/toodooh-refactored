import { Banknote, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'react-hot-toast';

import { useAdjustWallet, useWalletAdjustments } from '@/features/admin/hooks/useRecharges';
import {
  ADJUSTMENT_AMOUNT_ERROR,
  ADJUSTMENT_CONSEQUENCE_LINE,
  ADJUSTMENT_REASON_ERROR,
  type AdjustmentSign,
  parseAdjustmentAmount,
  signedAmountLabel,
} from '@/features/admin/lib/wallet-adjustment';
import { getErrorMessage } from '@/lib/errors';

interface AdjustWalletModalProps {
  advertiserId: string;
  advertiserName: string;
  onClose: () => void;
}

/**
 * FCT2 (US-FCT-9) — the « Ajuster le solde » modal: a SIGNED montant (+/− toggle + magnitude),
 * an OBLIGATOIRE raison (client mirror of the server gate — no reason, no adjustment), the
 * chartered consequence line, and the audit trail of previous adjustments for this screencaster.
 */
export default function AdjustWalletModal({
  advertiserId,
  advertiserName,
  onClose,
}: AdjustWalletModalProps) {
  const [sign, setSign] = useState<AdjustmentSign>('credit');
  const [amountInput, setAmountInput] = useState('');
  const [reason, setReason] = useState('');
  const adjust = useAdjustWallet();
  const audit = useWalletAdjustments(advertiserId);

  const handleConfirm = async () => {
    const amount = parseAdjustmentAmount(amountInput, sign);
    if (amount === null) {
      toast.error(ADJUSTMENT_AMOUNT_ERROR);
      return;
    }
    if (!reason.trim()) {
      toast.error(ADJUSTMENT_REASON_ERROR);
      return;
    }
    try {
      await adjust.mutateAsync({ advertiserId, amountTnd: amount, reason: reason.trim() });
      toast.success(`Solde ajusté de ${signedAmountLabel(amount)}`);
      onClose();
    } catch (e: unknown) {
      toast.error(getErrorMessage(e) || "Erreur lors de l'ajustement du solde");
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <h3 className="text-2xl font-bold text-[#00263A] mb-1 inline-flex items-center gap-2">
            <Banknote className="h-6 w-6" />
            Ajuster le solde
          </h3>
          <p className="text-sm text-gray-500 mb-4">{advertiserName}</p>

          <div className="mb-4">
            <span className="block text-sm font-medium text-gray-700 mb-2">Sens</span>
            <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm w-fit">
              <button
                type="button"
                onClick={() => setSign('credit')}
                className={`px-4 py-2 font-medium transition-colors ${
                  sign === 'credit' ? 'bg-green-600 text-white' : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                + Créditer
              </button>
              <button
                type="button"
                onClick={() => setSign('debit')}
                className={`px-4 py-2 font-medium transition-colors ${
                  sign === 'debit' ? 'bg-red-600 text-white' : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                − Débiter
              </button>
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2" htmlFor="adjust-amount">
              Montant (TND) *
            </label>
            <input
              id="adjust-amount"
              type="number"
              min="0.01"
              step="0.01"
              value={amountInput}
              onChange={(e) => setAmountInput(e.target.value)}
              placeholder="Entrez le montant"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-primary focus:border-transparent"
            />
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2" htmlFor="adjust-reason">
              Raison *
            </label>
            <textarea
              id="adjust-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="Indiquer la raison de l'ajustement..."
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-primary focus:border-transparent"
              required
            />
          </div>

          <div className="mb-4 bg-amber-50 border border-amber-200 rounded-lg p-3">
            <p className="text-sm text-amber-800">{ADJUSTMENT_CONSEQUENCE_LINE}</p>
          </div>

          {/* The audit — every previous adjustment for this screencaster (US-FCT-9: always audited). */}
          {(audit.data?.length ?? 0) > 0 && (
            <div className="mb-4">
              <p className="text-sm font-medium text-gray-700 mb-2">Ajustements précédents</p>
              <ul className="space-y-1 max-h-36 overflow-y-auto">
                {(audit.data ?? []).map((a) => (
                  <li key={a.id} className="text-xs text-gray-600 bg-gray-50 rounded-lg px-3 py-2">
                    <span className={a.amount_tnd > 0 ? 'text-green-700' : 'text-red-700'}>
                      {signedAmountLabel(a.amount_tnd)}
                    </span>{' '}
                    — {a.reason}{' '}
                    <span className="text-gray-400">
                      ({new Date(a.created_at).toLocaleDateString('fr-FR')})
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex justify-end space-x-3">
            <button
              onClick={onClose}
              className="px-6 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 transition-colors"
            >
              Fermer
            </button>
            <button
              onClick={() => void handleConfirm()}
              disabled={!reason.trim() || adjust.isPending}
              className="px-6 py-2 bg-[#00263A] text-white rounded-lg hover:opacity-90 transition-colors flex items-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {adjust.isPending ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Banknote className="h-5 w-5" />
              )}
              <span>Confirmer l&apos;ajustement</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
