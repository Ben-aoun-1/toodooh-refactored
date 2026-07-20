import { Clock, Paperclip, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'react-hot-toast';

import {
  JUSTIFICATIF_ACCEPT,
  isJustificatifTooLarge,
} from '@/features/wallet/lib/recharge-document';
import { RECHARGE_PAYMENT_METHOD } from '@/features/wallet/lib/wallet-ledger';

interface NewRechargeModalProps {
  /** Preset by the quick-recharge buttons; '' for a blank form. */
  initialAmount: string;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (amount: number, file: File | null) => void;
}

/**
 * The « Nouvelle Recharge » modal, extracted verbatim from MyRecharges (CF-M2). The amount is the
 * only REQUIRED field (the api takes {amount}; the method is fixed — bank transfer). CF-M2 adds
 * the OPTIONAL justificatif de virement: picked here, it is uploaded right after the create — the
 * two-call seam (create survives a document failure) lives in the page, not here.
 */
export default function NewRechargeModal({
  initialAmount,
  submitting,
  onClose,
  onSubmit,
}: NewRechargeModalProps) {
  const [amount, setAmount] = useState(initialAmount);
  const [file, setFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0] ?? null;
    if (picked && isJustificatifTooLarge(picked)) {
      toast.error('Le justificatif ne doit pas dépasser 10 Mo');
      e.target.value = '';
      setFile(null);
      return;
    }
    setFile(picked);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || parseFloat(amount) < 10) {
      toast.error('Le montant minimum est de 10 TND');
      return;
    }
    onSubmit(parseFloat(amount), file);
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl p-8 max-w-md w-full shadow-2xl border border-gray-100">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h3 className="text-xl font-bold text-gray-900">Nouvelle Recharge</h3>
            <p className="text-sm text-gray-500">Rechargez votre compte</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 transition-colors">
            <X className="h-5 w-5 text-gray-400" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2" htmlFor="amount">
              Montant (TND) *
            </label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-brand-primary/40 focus:border-brand-primary transition-all"
              placeholder="Entrez le montant"
              min="10"
              step="0.01"
              required
              id="amount"
            />
            <p className="text-xs text-gray-400 mt-1">Montant minimum : 10 TND</p>
          </div>

          {/* CF-U1 item 8 — the method is FIXED (bank transfer): a static line, not a control.
              The old select/description inputs collected values the api never received. */}
          <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
            <span className="text-sm font-medium text-gray-700">Méthode de paiement</span>
            <span className="text-sm font-semibold text-gray-900">{RECHARGE_PAYMENT_METHOD}</span>
          </div>

          {/* CF-M2 — the OPTIONAL justificatif de virement. The recharge is created either way;
              the document rides a second call and stays attachable later from Mes factures. */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2" htmlFor="justificatif">
              Justificatif de virement (PDF ou image){' '}
              <span className="font-normal text-gray-400">(optionnel)</span>
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept={JUSTIFICATIF_ACCEPT}
              onChange={handleFileChange}
              className="w-full text-sm text-gray-600 file:mr-3 file:px-4 file:py-2 file:rounded-lg file:border-0 file:bg-gray-100 file:text-sm file:font-medium file:text-gray-700 hover:file:bg-gray-200 file:transition-colors file:cursor-pointer"
              id="justificatif"
            />
            {file && (
              <p className="text-xs text-gray-500 mt-1 inline-flex items-center gap-1">
                <Paperclip className="h-3 w-3" />
                {file.name}
              </p>
            )}
            <p className="text-xs text-gray-400 mt-1">
              PDF, JPEG ou PNG — 10 Mo max. Vous pourrez aussi l&apos;ajouter plus tard depuis Mes
              factures.
            </p>
          </div>

          <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4">
            <div className="flex items-start gap-3">
              <Clock className="h-5 w-5 text-yellow-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm text-yellow-800 font-medium">En attente de validation</p>
                <p className="text-xs text-yellow-700 mt-1">
                  Votre recharge sera validée par un administrateur avant d&apos;être créditée sur
                  votre compte.
                </p>
              </div>
            </div>
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-3 border border-gray-300 text-gray-700 rounded-xl hover:bg-gray-50 transition-all font-medium"
              disabled={submitting}
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 py-3 px-6 rounded-xl font-semibold text-brand-deep transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed bg-[#76E6AB]"
            >
              {submitting ? 'Envoi en cours...' : 'Confirmer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
