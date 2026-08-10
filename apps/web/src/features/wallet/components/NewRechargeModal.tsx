import { ArrowLeft, FileText, Landmark, Paperclip, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'react-hot-toast';

import { useBankCoordinates } from '@/features/wallet/hooks/useRechargeDemandes';
import {
  JUSTIFICATIF_ACCEPT,
  isJustificatifTooLarge,
} from '@/features/wallet/lib/recharge-document';
import {
  AMOUNT_MIN_ERROR,
  BANK_COORDS_PENDING_LINE,
  JUSTIFICATIF_REQUIRED_ERROR,
  METHOD_LABELS,
  MIN_RECHARGE_TND,
  type RechargeMethod,
  bankCoordsProvided,
  parseRechargeAmount,
} from '@/features/wallet/lib/recharge-methods';

interface NewRechargeModalProps {
  /** Preset by the quick-recharge buttons; '' for a blank form. */
  initialAmount: string;
  submitting: boolean;
  onClose: () => void;
  onSubmitVirement: (amount: number, file: File) => void;
  onSubmitBon: (amount: number) => void;
}

/**
 * FCT1 — the « Nouvelle Recharge » modal, now TWO steps (US-FCT-2): montant (quick-chip preset or
 * free input, 500 TND floor) → méthode. EXACTLY two method cards — virement bancaire and bon de
 * commande; there is no online payment. The virement panel shows the « Pour info » Toodooh
 * coordinates (config-backed; a placeholder line until the operator provisions them) and a
 * MANDATORY justificatif input; the bon panel generates the PDF server-side (the page then opens
 * the « Votre bon de commande est prêt » popup).
 */
export default function NewRechargeModal({
  initialAmount,
  submitting,
  onClose,
  onSubmitVirement,
  onSubmitBon,
}: NewRechargeModalProps) {
  const [step, setStep] = useState<'montant' | 'methode'>('montant');
  const [amount, setAmount] = useState(initialAmount);
  const [method, setMethod] = useState<RechargeMethod | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const coords = useBankCoordinates();

  const parsedAmount = parseRechargeAmount(amount);

  const handleNext = () => {
    if (parsedAmount === null) {
      toast.error(AMOUNT_MIN_ERROR);
      return;
    }
    setStep('methode');
  };

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
    if (parsedAmount === null) {
      toast.error(AMOUNT_MIN_ERROR);
      setStep('montant');
      return;
    }
    if (method === 'virement') {
      if (!file) {
        toast.error(JUSTIFICATIF_REQUIRED_ERROR);
        return;
      }
      onSubmitVirement(parsedAmount, file);
      return;
    }
    if (method === 'bon_de_commande') onSubmitBon(parsedAmount);
  };

  const methodCard = (value: RechargeMethod, icon: React.ReactNode, description: string) => (
    <button
      type="button"
      onClick={() => setMethod(value)}
      className={`flex-1 rounded-xl border-2 p-4 text-left transition-colors ${
        method === value
          ? 'border-brand-primary bg-brand-primary/5'
          : 'border-gray-200 hover:border-gray-300'
      }`}
    >
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <span className="text-sm font-semibold text-gray-900">{METHOD_LABELS[value]}</span>
      </div>
      <p className="text-xs text-gray-500">{description}</p>
    </button>
  );

  const coordLine = (label: string, value: string) => (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-xs font-medium text-gray-500">{label}</span>
      <span className="text-sm font-semibold text-gray-900 text-right break-all">{value}</span>
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl p-8 max-w-md w-full shadow-2xl border border-gray-100 max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h3 className="text-xl font-bold text-gray-900">Nouvelle Recharge</h3>
            <p className="text-sm text-gray-500">
              {step === 'montant' ? 'Étape 1 — Montant' : 'Étape 2 — Méthode de paiement'}
            </p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 transition-colors">
            <X className="h-5 w-5 text-gray-400" />
          </button>
        </div>

        {step === 'montant' ? (
          <div className="space-y-5">
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
                min={MIN_RECHARGE_TND}
                step="0.01"
                required
                id="amount"
              />
              <p className="text-xs text-gray-400 mt-1">Montant minimum : {MIN_RECHARGE_TND} TND</p>
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 px-4 py-3 border border-gray-300 text-gray-700 rounded-xl hover:bg-gray-50 transition-all font-medium"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={handleNext}
                className="flex-1 py-3 px-6 rounded-xl font-semibold text-brand-deep transition-all shadow-sm bg-[#76E6AB]"
              >
                Suivant
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
              <span className="text-sm font-medium text-gray-700">Montant</span>
              <span className="text-sm font-semibold text-gray-900">{amount} TND</span>
            </div>

            {/* The TWO methods — virement bancaire and bon de commande, nothing else. */}
            <div className="flex flex-col sm:flex-row gap-3">
              {methodCard(
                'virement',
                <Landmark className="h-4 w-4 text-brand-deep" />,
                'Virez le montant sur le compte Toodooh et déposez votre justificatif.',
              )}
              {methodCard(
                'bon_de_commande',
                <FileText className="h-4 w-4 text-brand-deep" />,
                'Toodooh génère votre bon de commande à signer et redéposer.',
              )}
            </div>

            {method === 'virement' && (
              <>
                {/* US-FCT-3 — the « Pour info » block: Toodooh's own coordinates, config-backed. */}
                <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 space-y-2">
                  <p className="text-sm font-semibold text-gray-900">
                    Pour info — Coordonnées bancaires Toodooh
                  </p>
                  {coords.data && bankCoordsProvided(coords.data) ? (
                    <>
                      {coordLine('RIB', coords.data.rib)}
                      {coordLine('IBAN', coords.data.iban)}
                      {coordLine('BIC', coords.data.bic)}
                      {coordLine('Domiciliation', coords.data.domiciliation)}
                    </>
                  ) : (
                    <p className="text-sm text-gray-500">{BANK_COORDS_PENDING_LINE}</p>
                  )}
                </div>

                <div>
                  <label
                    className="block text-sm font-medium text-gray-700 mb-2"
                    htmlFor="justificatif"
                  >
                    Justificatif de virement (PDF ou image) *
                  </label>
                  {/* GREEN2 item 7c — the native control (« Choose File / No file chosen »)
                      hides behind a French label; the input stays the real picker. */}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={JUSTIFICATIF_ACCEPT}
                    onChange={handleFileChange}
                    className="hidden"
                    id="justificatif"
                  />
                  <label
                    htmlFor="justificatif"
                    className="inline-block cursor-pointer rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200"
                  >
                    Parcourir les fichiers
                  </label>
                  <p className="text-xs text-gray-500 mt-1 inline-flex items-center gap-1">
                    <Paperclip className="h-3 w-3" />
                    {file ? file.name : 'Aucun fichier sélectionné'}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    PDF, JPEG ou PNG — 10 Mo max. Obligatoire : sans justificatif, la demande ne
                    peut pas être envoyée.
                  </p>
                </div>

                <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4">
                  <p className="text-sm text-yellow-800 font-medium">En attente de réception</p>
                  <p className="text-xs text-yellow-700 mt-1">
                    Votre demande apparaîtra « En attente de réception » jusqu&apos;à la
                    vérification du virement par Toodooh.
                  </p>
                </div>
              </>
            )}

            {method === 'bon_de_commande' && (
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                <p className="text-sm text-gray-700">
                  Un bon de commande PDF sera généré pour ce montant. Imprimez-le, signez-le puis
                  redéposez-le depuis « Recharge rapide » pour finaliser votre demande.
                </p>
              </div>
            )}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setStep('montant')}
                className="flex-1 px-4 py-3 border border-gray-300 text-gray-700 rounded-xl hover:bg-gray-50 transition-all font-medium inline-flex items-center justify-center gap-2"
                disabled={submitting}
              >
                <ArrowLeft className="h-4 w-4" />
                Retour
              </button>
              <button
                type="submit"
                disabled={submitting || method === null}
                className="flex-1 py-3 px-6 rounded-xl font-semibold text-brand-deep transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed bg-[#76E6AB]"
              >
                {submitting
                  ? 'Envoi en cours...'
                  : method === 'bon_de_commande'
                    ? 'Générer le bon de commande'
                    : 'Envoyer la demande'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
