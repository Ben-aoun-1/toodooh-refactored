import { Download, FileText, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'react-hot-toast';

import {
  type RechargeRow,
  bonFilename,
  walletService,
} from '@/features/wallet/services/wallet.service';

interface BonReadyModalProps {
  recharge: RechargeRow;
  onClose: () => void;
}

/**
 * FCT1 (US-FCT-6) — the « Votre bon de commande est prêt » popup, opened right after the server
 * generates the bon. Download rides the api-streamed blob (the facture <a download> dance); the
 * sign invite copy mirrors the persisted notification. The signed copy comes back through the
 * dedicated sub-section under « Recharge rapide » (PendingBonsSection).
 */
export default function BonReadyModal({ recharge, onClose }: BonReadyModalProps) {
  const [downloading, setDownloading] = useState(false);

  const handleDownload = async () => {
    try {
      setDownloading(true);
      const blob = await walletService.downloadBon(recharge.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = bonFilename(recharge.reference);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (_error) {
      toast.error('Erreur lors du téléchargement du bon de commande');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl p-8 max-w-md w-full shadow-2xl border border-gray-100 text-center">
        <div className="flex justify-end">
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 transition-colors">
            <X className="h-5 w-5 text-gray-400" />
          </button>
        </div>
        <div className="w-14 h-14 rounded-full bg-brand-primary/10 flex items-center justify-center mx-auto mb-4">
          <FileText className="h-7 w-7 text-brand-deep" />
        </div>
        <h3 className="text-xl font-bold text-gray-900 mb-2">Votre bon de commande est prêt</h3>
        <p className="text-sm text-gray-500 mb-1">
          Référence <span className="font-semibold text-gray-900">{recharge.reference}</span>
        </p>
        <p className="text-sm text-gray-600 mb-6">
          Bon de commande à imprimer, signer et redéposer depuis « Recharge rapide ».
        </p>
        <button
          onClick={() => void handleDownload()}
          disabled={downloading}
          className="w-full py-3 px-6 rounded-xl font-semibold text-brand-deep transition-all shadow-sm disabled:opacity-50 bg-[#76E6AB] inline-flex items-center justify-center gap-2"
        >
          <Download className="h-4 w-4" />
          {downloading ? 'Téléchargement...' : 'Télécharger le bon de commande'}
        </button>
        <button
          onClick={onClose}
          className="w-full mt-3 px-4 py-3 border border-gray-300 text-gray-700 rounded-xl hover:bg-gray-50 transition-all font-medium"
        >
          Fermer
        </button>
      </div>
    </div>
  );
}
