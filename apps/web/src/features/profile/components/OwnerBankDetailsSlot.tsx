import { Check, FileText, Trash2 } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { toast } from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';

import type { BusinessProfile } from '@/features/auth/types/auth';
import { useSaveBankDetails } from '@/features/wallet/hooks/useSaveBankDetails';
import { supabase } from '@/lib/supabase';

interface OwnerBankDetailsSlotProps {
  profile: BusinessProfile;
  userId: string;
}

const INPUT_CLASS =
  'w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-brand-primary focus:border-brand-primary bg-white';

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Owner-only "Mes coordonnées bancaires" sub-tab, passed to the shared
 * `ProfileSettings` via its `bankSlot` prop (slice-2 B4b). Owns the bank form,
 * the `useSaveBankDetails` write, and the on-demand signed-URL view — the sole
 * direct-supabase use, relocated here so the OwnerSettings wrapper carries no
 * direct supabase import.
 */
export default function OwnerBankDetailsSlot({ profile, userId }: OwnerBankDetailsSlotProps) {
  const navigate = useNavigate();
  const saveBankDetailsMutation = useSaveBankDetails();

  const [bankDocFile, setBankDocFile] = useState<File | null>(null);
  const [bankForm, setBankForm] = useState({
    bank_account_holder: '',
    bank_rib: '',
    bank_iban: '',
  });
  const [existingBankDocPath, setExistingBankDocPath] = useState<string | null>(null);
  const [existingBankDocUrl, setExistingBankDocUrl] = useState<string | null>(null);

  useEffect(() => {
    setBankForm({
      bank_account_holder: profile.bank_account_holder ?? '',
      bank_rib: profile.bank_rib ?? '',
      bank_iban: profile.bank_iban ?? '',
    });
    setExistingBankDocPath(profile.bank_doc_path ?? null);
    setExistingBankDocUrl(profile.bank_doc_url ?? null);
  }, [profile]);

  const hasBankDocument = !!bankDocFile || !!profile.bank_doc_path || !!profile.bank_doc_url;

  const openBankDocumentForView = async () => {
    if (bankDocFile) {
      const url = URL.createObjectURL(bankDocFile);
      window.open(url, '_blank', 'noopener,noreferrer');
      URL.revokeObjectURL(url);
      return;
    }
    if (profile.bank_doc_path) {
      try {
        const { data: signed, error } = await supabase.storage
          .from('registres')
          .createSignedUrl(profile.bank_doc_path, 3600);
        if (error || !signed?.signedUrl) throw error;
        window.open(signed.signedUrl, '_blank', 'noopener,noreferrer');
      } catch (err: unknown) {
        const m = err instanceof Error ? err.message : "Impossible d'ouvrir le document bancaire";
        toast.error(m);
      }
      return;
    }
    if (profile.bank_doc_url) {
      window.open(profile.bank_doc_url, '_blank', 'noopener,noreferrer');
    }
  };

  const handleSaveBankDetails = async (e: FormEvent) => {
    e.preventDefault();
    const holder = bankForm.bank_account_holder.trim();
    const rib = bankForm.bank_rib.trim();
    const iban = bankForm.bank_iban.trim();
    if (!holder || !rib || !iban) {
      toast.error('Nom, RIB et IBAN sont obligatoires');
      return;
    }
    if (!bankDocFile && !existingBankDocPath && !existingBankDocUrl) {
      toast.error("Ajoutez le relevé d'identité bancaire");
      return;
    }
    if (bankDocFile && bankDocFile.size > 5 * 1024 * 1024) {
      toast.error('Fichier trop volumineux (max 5 Mo)');
      return;
    }

    try {
      await saveBankDetailsMutation.mutateAsync({
        userId,
        name: holder,
        rib,
        iban,
        bankDocFile,
        existingBankDocPath,
      });
      setBankDocFile(null);
      toast.success('Coordonnées bancaires enregistrées');
      navigate('/owner-dashboard');
    } catch (err: unknown) {
      const m = err instanceof Error ? err.message : 'Erreur lors de la mise à jour bancaire';
      toast.error(m);
    }
  };

  return (
    <form onSubmit={handleSaveBankDetails} className="p-6 space-y-5 max-w-3xl">
      <div>
        <label
          className="block text-sm font-medium text-gray-700 mb-1"
          htmlFor="bank-account-holder"
        >
          Nom et prénom du titulaire <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          value={bankForm.bank_account_holder}
          onChange={(e) => setBankForm((p) => ({ ...p, bank_account_holder: e.target.value }))}
          className={INPUT_CLASS}
          placeholder="Nom et prénom"
          id="bank-account-holder"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="bank-rib">
          RIB <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          value={bankForm.bank_rib}
          onChange={(e) => setBankForm((p) => ({ ...p, bank_rib: e.target.value }))}
          className={INPUT_CLASS}
          placeholder="RIB"
          id="bank-rib"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="bank-iban">
          IBAN <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          value={bankForm.bank_iban}
          onChange={(e) => setBankForm((p) => ({ ...p, bank_iban: e.target.value }))}
          className={INPUT_CLASS}
          placeholder="IBAN"
          id="bank-iban"
        />
      </div>

      <div className="border-2 border-dashed border-gray-300 rounded-xl p-6 flex flex-col items-center justify-center gap-3 bg-gray-50/50">
        <p className="text-sm font-medium text-gray-800 text-center">
          Ajouter le relevé d&apos;identité bancaire de votre établissement
        </p>
        <p className="text-xs text-gray-500">Formats acceptés : PDF, JPG, JPEG, PNG (Max 5 MB)</p>
        <label className="px-4 py-2.5 rounded-xl text-sm font-medium text-gray-700 cursor-pointer hover:bg-gray-100 border border-gray-300 bg-white">
          Parcourir les fichiers
          <input
            type="file"
            accept=".pdf,.jpg,.jpeg,.png"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && setBankDocFile(e.target.files[0])}
          />
        </label>
      </div>

      {hasBankDocument && (
        <div className="flex items-center gap-4 p-4 bg-white rounded-xl border border-gray-200 shadow-sm">
          <button
            type="button"
            onClick={openBankDocumentForView}
            className="flex flex-1 items-center gap-4 min-w-0 text-left rounded-lg hover:bg-gray-50 transition-colors"
          >
            <div className="flex-shrink-0 rounded-lg p-2 bg-gray-100">
              <FileText className="h-6 w-6 text-gray-600" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">
                {bankDocFile ? bankDocFile.name : 'Document bancaire enregistré'}
              </p>
              <p className="text-xs text-gray-500">
                {bankDocFile ? formatFileSize(bankDocFile.size) : 'Fichier validé'}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <Check className="h-5 w-5 text-green-600" />
              <span className="text-sm text-gray-600">Enregistré</span>
            </div>
          </button>
          <button
            type="button"
            onClick={() => setBankDocFile(null)}
            className="p-2 text-gray-400 hover:text-red-600 rounded-lg hover:bg-red-50 flex-shrink-0"
            title="Retirer"
          >
            <Trash2 className="h-5 w-5" />
          </button>
        </div>
      )}

      <div className="flex gap-3 pt-2 justify-end">
        <button
          type="button"
          onClick={() => {
            setBankDocFile(null);
            setBankForm({
              bank_account_holder: profile.bank_account_holder ?? '',
              bank_rib: profile.bank_rib ?? '',
              bank_iban: profile.bank_iban ?? '',
            });
          }}
          className="px-5 py-2.5 border border-gray-300 rounded-xl text-gray-700 font-medium hover:bg-gray-50"
        >
          Annuler
        </button>
        <button
          type="submit"
          disabled={saveBankDetailsMutation.isPending}
          className="px-5 py-2.5 rounded-xl font-medium text-brand-deep hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed"
          style={{ background: '#76E6AB' }}
        >
          {saveBankDetailsMutation.isPending ? 'Enregistrement...' : 'Enregistrer'}
        </button>
      </div>
    </form>
  );
}
