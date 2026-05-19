import { toast } from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';

import smart3Icon from '@/assets/smart3.png';

interface BalanceCardProps {
  balance: string;
  loading: boolean;
  isDisabled: boolean;
}

const DISABLED_MESSAGE =
  '⚠️ Veuillez compléter vos informations pour accéder à cette fonctionnalité';

export default function BalanceCard({ balance, loading, isDisabled }: BalanceCardProps) {
  const navigate = useNavigate();

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {/* Carte Solde disponible */}
      <div className="rounded-xl bg-gradient-to-tr from-[#3db39a] via-[#1a6b5a] to-[#0a3d32] p-5 shadow-lg">
        <p className="text-base font-medium text-white/95 mb-2">Solde disponible</p>
        <p className="text-2xl sm:text-3xl font-bold text-white mb-5 tracking-tight tabular-nums font-sans">
          {loading ? '...' : balance}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => {
              if (isDisabled) {
                toast.error(DISABLED_MESSAGE);
                return;
              }
              navigate('/my-recharges');
            }}
            disabled={isDisabled}
            className="px-5 py-3 rounded-lg bg-brand-primary hover:bg-brand-primary/90 text-gray-900 font-semibold text-base transition-colors disabled:opacity-50"
          >
            Recharger
          </button>
          <button
            type="button"
            onClick={() => navigate('/my-recharges')}
            className="text-white/95 hover:text-white hover:underline text-sm font-medium transition-colors"
          >
            Voir l&apos;historique
          </button>
        </div>
      </div>
      {/* Carte Prêt à démarrer */}
      <div className="rounded-xl border border-brand-primary/50 bg-[#f6faf8] p-5 shadow-lg flex flex-col items-center text-center">
        <div className="w-14 h-14 flex items-center justify-center mb-3">
          <img src={smart3Icon} alt="" className="h-14 w-auto object-contain" />
        </div>
        <h3 className="text-base font-bold text-gray-900 mb-1 whitespace-nowrap">
          Prêt à démarrer ?
        </h3>
        <p className="text-sm text-gray-600 mb-4">
          Diffusez votre campagne publicitaire en quelques clics
        </p>
        <button
          type="button"
          onClick={() => {
            if (isDisabled) {
              toast.error(DISABLED_MESSAGE);
              return;
            }
            navigate('/new-campaign');
          }}
          disabled={isDisabled}
          className="w-full px-4 py-3 rounded-lg bg-brand-primary hover:bg-brand-primary/90 text-gray-900 font-medium text-sm transition-colors disabled:opacity-50"
        >
          Lancer une nouvelle campagne
        </button>
      </div>
    </div>
  );
}
