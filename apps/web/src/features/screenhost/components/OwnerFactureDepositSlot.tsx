import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, FileText, UploadCloud, X } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { toast } from 'react-hot-toast';

import { useAuthStore } from '@/features/auth/stores/auth.store';
import { screenhostKeys } from '@/features/screenhost/hooks/queryKeys';
import {
  REPLACE_NOTICE,
  depositHistory,
  depositPayload,
  factureChoices,
  formatDateFr,
} from '@/features/screenhost/lib/facture-view';
import {
  SIGNED_DEPOSIT_ACCEPT,
  facturesService,
} from '@/features/screenhost/services/factures.service';
import { getErrorMessage } from '@/lib/errors';

// REV2 — « Déposer votre facture signée », on Mes Revenus between the revenue block and the
// transactions history. The owner prints the facture, signs and stamps it, and returns it here.
//
// THE POPUP ASKS WHICH FACTURE FIRST, on purpose. A file dropped without that answer would have to
// be guessed onto a month, and guessing wrong attaches a signed document to the wrong facture. So
// the flow is: « Uploader » → « Choisir la facture concernée » (his factures, by name) → the drop
// zone → the file attaches to THAT facture → the popup closes.
//
// NO STATUS ANYWHERE (US-REV §5). The previous-deposits list shows the facture's NAME and the DATE
// it was received — never « en vérification ». The owner is told about status by the bell.
//
// Lives in its own file rather than inline in OwnerRevenue: that page is already 800+ lines, and
// this is one concept.

type Step = 'choose' | 'drop';

export default function OwnerFactureDepositSlot() {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const facturesKey = screenhostKeys.factures(user?.id ?? '');

  const facturesQuery = useQuery({
    queryKey: facturesKey,
    queryFn: () => facturesService.list(),
    enabled: !!user?.id,
  });
  const rows = facturesQuery.data ?? [];
  const choices = factureChoices(rows);
  const history = depositHistory(rows);

  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>('choose');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selected = choices.find((c) => c.id === selectedId) ?? null;

  const closePopup = useCallback(() => {
    setOpen(false);
    setStep('choose');
    setSelectedId(null);
    setDragging(false);
  }, []);

  const deposit = useMutation({
    mutationFn: ({ id, file }: { id: string; file: File }) =>
      facturesService.depositSigned(id, file),
    onSuccess: async () => {
      toast.success('Votre facture signée a bien été reçue.');
      closePopup();
      await queryClient.invalidateQueries({ queryKey: facturesKey });
    },
    onError: (error: unknown) => {
      toast.error(getErrorMessage(error) || 'Le dépôt a échoué. Merci de réessayer.');
    },
  });

  // The pairing rule lives in the lib (depositPayload) so it can be pinned: the id is the owner's
  // step-1 answer, never anything read off the drop event.
  const submitFile = useCallback(
    (file: File | undefined) => {
      const payload = depositPayload(selectedId, file);
      if (payload) deposit.mutate(payload);
    },
    [deposit, selectedId],
  );

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="p-5 sm:p-6 border-b border-gray-100 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Déposer votre facture signée</h2>
          <p className="text-sm text-gray-500 mt-1">
            Imprimez votre facture, signez-la, cachetez-la puis déposez-la ici. {REPLACE_NOTICE}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-brand-primary hover:bg-brand-primary/90 text-gray-900 text-sm font-semibold transition-colors whitespace-nowrap"
        >
          <UploadCloud className="w-4 h-4" />
          Uploader
        </button>
      </div>

      <div className="p-5 sm:p-6">
        <h3 className="text-sm font-semibold text-gray-900 mb-3">Dépôts précédents</h3>
        {history.length === 0 ? (
          <p className="text-sm text-gray-500">Aucune facture signée déposée pour le moment.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {history.map((entry) => (
              <li key={entry.id} className="py-3 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {entry.designation}
                    </p>
                    <p className="text-xs text-gray-500 truncate">{entry.venueName}</p>
                  </div>
                </div>
                <span className="text-sm text-gray-600 tabular-nums flex-shrink-0">
                  {formatDateFr(entry.depositedAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between gap-4 p-5 border-b border-gray-100">
              <h2 className="text-base font-bold text-gray-900">
                {step === 'choose' ? 'Choisir la facture concernée' : 'Déposer le fichier signé'}
              </h2>
              <button
                type="button"
                onClick={closePopup}
                aria-label="Fermer"
                className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {step === 'choose' ? (
              <div className="p-5 overflow-y-auto">
                {choices.length === 0 ? (
                  <p className="text-sm text-gray-500">Aucune facture à déposer pour le moment.</p>
                ) : (
                  <ul className="space-y-2">
                    {choices.map((choice) => (
                      <li key={choice.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedId(choice.id);
                            setStep('drop');
                          }}
                          className="w-full text-left px-4 py-3 rounded-xl border border-gray-200 hover:border-brand-primary hover:bg-gray-50 transition-colors"
                        >
                          <span className="flex items-center gap-3">
                            <FileText className="w-4 h-4 text-gray-400 flex-shrink-0" />
                            <span className="min-w-0">
                              <span className="block text-sm font-medium text-gray-900 truncate">
                                {choice.designation}
                              </span>
                              <span className="block text-xs text-gray-500 truncate">
                                {choice.venueName} ({choice.reference})
                              </span>
                            </span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <div className="p-5 overflow-y-auto">
                <p className="text-sm text-gray-600 mb-4">
                  Facture sélectionnée :{' '}
                  <span className="font-semibold text-gray-900">{selected?.designation}</span>
                  {selected ? <span className="text-gray-500"> — {selected.venueName}</span> : null}
                </p>

                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragging(true);
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragging(false);
                    submitFile(e.dataTransfer.files[0]);
                  }}
                  className={`rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-colors ${
                    dragging ? 'border-brand-primary bg-brand-primary/5' : 'border-gray-300'
                  }`}
                >
                  <UploadCloud className="w-8 h-8 text-gray-400 mx-auto mb-3" />
                  <p className="text-sm text-gray-700 font-medium">
                    Glissez votre facture signée ici
                  </p>
                  <p className="text-xs text-gray-500 mt-1">PDF, JPEG ou PNG — 10 Mo maximum</p>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={deposit.isPending}
                    className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-gray-200 bg-white text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors disabled:opacity-50"
                  >
                    {deposit.isPending ? 'Envoi…' : 'Parcourir mes fichiers'}
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={SIGNED_DEPOSIT_ACCEPT}
                    className="hidden"
                    onChange={(e) => submitFile(e.target.files?.[0])}
                  />
                </div>

                <p className="text-xs text-gray-500 mt-4">{REPLACE_NOTICE}</p>

                <button
                  type="button"
                  onClick={() => {
                    setSelectedId(null);
                    setStep('choose');
                  }}
                  className="mt-4 text-sm text-gray-600 hover:text-gray-900 transition-colors"
                >
                  ← Choisir une autre facture
                </button>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
