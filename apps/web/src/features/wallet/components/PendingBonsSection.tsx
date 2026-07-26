import { Download, FileSignature, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'react-hot-toast';

import {
  JUSTIFICATIF_ACCEPT,
  isJustificatifTooLarge,
} from '@/features/wallet/lib/recharge-document';
import {
  type RechargeRow,
  bonFilename,
  walletService,
} from '@/features/wallet/services/wallet.service';

interface PendingBonsSectionProps {
  /** The caller's 'bon_issued' rows — bons generated, awaiting their signed copy. */
  bons: RechargeRow[];
  depositing: boolean;
  onDepositSigned: (id: string, file: File) => void;
}

/**
 * FCT1 (US-FCT-7) — the dedicated signed-bon deposit sub-section under « Recharge rapide »: one
 * row per « Bon émis » demande with the bon download and the « Déposer le bon signé » upload
 * (PDF/JPEG/PNG ≤ 10 Mo — the justificatif accept set). One shared hidden input serves every row
 * (the MyInvoices idiom); the deposit flips the demande to « Bon retourné signé ».
 */
export default function PendingBonsSection({
  bons,
  depositing,
  onDepositSigned,
}: PendingBonsSectionProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const targetIdRef = useRef<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  if (bons.length === 0) return null;

  const handleDownload = async (bon: RechargeRow) => {
    try {
      setDownloadingId(bon.id);
      const blob = await walletService.downloadBon(bon.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = bonFilename(bon.reference);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (_error) {
      toast.error('Erreur lors du téléchargement du bon de commande');
    } finally {
      setDownloadingId(null);
    }
  };

  const handlePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0] ?? null;
    const targetId = targetIdRef.current;
    e.target.value = '';
    targetIdRef.current = null;
    if (!picked || !targetId) return;
    if (isJustificatifTooLarge(picked)) {
      toast.error('Le bon signé ne doit pas dépasser 10 Mo');
      return;
    }
    onDepositSigned(targetId, picked);
  };

  return (
    <div className="bg-white rounded-2xl border border-blue-200 p-5">
      <div className="flex items-center gap-2 mb-1">
        <FileSignature className="h-4 w-4 text-blue-600" />
        <p className="text-sm font-semibold text-gray-900">Bons de commande à retourner signés</p>
      </div>
      <p className="text-xs text-gray-500 mb-4">
        Imprimez, signez puis redéposez chaque bon pour finaliser votre demande de recharge.
      </p>
      <input
        ref={inputRef}
        type="file"
        accept={JUSTIFICATIF_ACCEPT}
        onChange={handlePick}
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
      />
      <ul className="space-y-3">
        {bons.map((bon) => (
          <li
            key={bon.id}
            className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-gray-200 px-4 py-3"
          >
            <div>
              <p className="text-sm font-semibold text-gray-900">{bon.reference}</p>
              <p className="text-xs text-gray-500">
                {bon.amount_tnd.toLocaleString('fr-FR')} TND —{' '}
                {new Date(bon.created_at).toLocaleDateString('fr-FR')}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => void handleDownload(bon)}
                disabled={downloadingId === bon.id}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                <Download className="h-4 w-4" />
                Télécharger le bon
              </button>
              <button
                onClick={() => {
                  targetIdRef.current = bon.id;
                  inputRef.current?.click();
                }}
                disabled={depositing}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold text-brand-deep bg-[#76E6AB] hover:opacity-90 transition-all disabled:opacity-50"
              >
                <Upload className="h-4 w-4" />
                Déposer le bon signé
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
