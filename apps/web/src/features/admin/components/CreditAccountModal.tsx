import { Gift, Loader2, Wallet } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'react-hot-toast';

import { useAdvertiserWallet, useRecordPayment } from '@/features/admin/hooks/useRecharges';
import {
  PAYMENT_AMOUNT_ERROR,
  PAYMENT_CONSEQUENCE_LINE,
  PAYMENT_MODE_OPTIONS,
  parsePaymentAmount,
} from '@/features/admin/lib/admin-credit';
import type { AdminPaymentMode } from '@/features/admin/services/admin-recharges.service';
import { getErrorMessage } from '@/lib/errors';
import { formatTnd } from '@/lib/money';

interface CreditAccountModalProps {
  advertiserId: string;
  advertiserName: string;
  onClose: () => void;
  /** « Crédit offert » — hands over to the FCT2 adjustment modal. */
  onOfferCredit: () => void;
}

/**
 * ADM-CREDIT1 (operator 18/11) — « Créditer le compte », from the users list: the screencaster's
 * solde, then either « Crédit offert » (the audited adjustment) or « Paiement reçu » (money paid
 * outside the platform, recorded as a recharge the admin confirms at once).
 */
export default function CreditAccountModal({
  advertiserId,
  advertiserName,
  onClose,
  onOfferCredit,
}: CreditAccountModalProps) {
  const wallet = useAdvertiserWallet(advertiserId);
  const record = useRecordPayment(advertiserId);
  const [amountInput, setAmountInput] = useState('');
  const [mode, setMode] = useState<AdminPaymentMode>('especes');
  const [note, setNote] = useState('');

  const handleConfirm = async () => {
    const amount = parsePaymentAmount(amountInput);
    if (amount === null) {
      toast.error(PAYMENT_AMOUNT_ERROR);
      return;
    }
    try {
      const payment = await record.mutateAsync({ amountTnd: amount, mode, note: note.trim() });
      toast.success(`${formatTnd(payment.amount_tnd)} TND crédités (réf. ${payment.reference})`);
      onClose();
    } catch (e: unknown) {
      toast.error(getErrorMessage(e) || "Erreur lors de l'enregistrement du paiement");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white shadow-2xl">
        <div className="space-y-5 p-6">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Créditer le compte</h3>
            <p className="text-sm text-gray-500">{advertiserName}</p>
          </div>

          <div className="grid grid-cols-3 gap-2 rounded-lg bg-gray-50 p-3 text-center text-sm">
            {wallet.isLoading ? (
              <div className="col-span-3 flex justify-center py-2 text-gray-400">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
            ) : wallet.data ? (
              <>
                <div>
                  <div className="text-xs text-gray-500">Solde</div>
                  <div className="font-semibold">{formatTnd(wallet.data.balance_tnd)} TND</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">Engagé</div>
                  <div className="font-semibold">{formatTnd(wallet.data.engaged_tnd)} TND</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">Disponible</div>
                  <div className="font-semibold text-brand-deep">
                    {formatTnd(wallet.data.spendable_tnd)} TND
                  </div>
                </div>
              </>
            ) : (
              <div className="col-span-3 text-gray-400">Solde indisponible</div>
            )}
          </div>

          <button
            type="button"
            onClick={onOfferCredit}
            className="flex w-full items-center gap-3 rounded-lg border border-gray-200 p-3 text-left hover:border-brand-primary"
          >
            <Gift className="h-5 w-5 text-brand-accent" />
            <span>
              <span className="block text-sm font-semibold text-gray-900">Crédit offert</span>
              <span className="block text-xs text-gray-500">
                Geste commercial, compensation : un ajustement avec sa raison.
              </span>
            </span>
          </button>

          <div className="space-y-3 rounded-lg border border-gray-200 p-3">
            <div className="flex items-center gap-3">
              <Wallet className="h-5 w-5 text-brand-deep" />
              <span>
                <span className="block text-sm font-semibold text-gray-900">Paiement reçu</span>
                <span className="block text-xs text-gray-500">
                  Argent payé hors de la plateforme (espèces, chèque, virement).
                </span>
              </span>
            </div>
            <label className="block text-sm">
              <span className="text-gray-700">Montant (TND)</span>
              <input
                inputMode="decimal"
                value={amountInput}
                onChange={(e) => setAmountInput(e.target.value)}
                placeholder="0,00"
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
              />
            </label>
            <label className="block text-sm">
              <span className="text-gray-700">Mode de paiement</span>
              <select
                value={mode}
                onChange={(e) => {
                  const next = PAYMENT_MODE_OPTIONS.find((o) => o.value === e.target.value);
                  if (next) setMode(next.value);
                }}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
              >
                {PAYMENT_MODE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="text-gray-700">Note pour le screencaster (facultatif)</span>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={500}
                rows={2}
                placeholder="Ex. : reçu n° 42"
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
              />
            </label>
            <p className="text-xs text-gray-500">{PAYMENT_CONSEQUENCE_LINE}</p>
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={() => void handleConfirm()}
              disabled={record.isPending}
              className="flex items-center gap-2 rounded-lg bg-brand-primary px-4 py-2 text-sm font-semibold text-brand-deep disabled:opacity-50"
            >
              {record.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Enregistrer le paiement
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
