import { Calendar, DollarSign, MapPin, Rocket, RotateCcw, TrendingUp } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import statIcon5 from '../../../../assets/stats/5.png';
import type { LastCampaign } from '../../hooks/useLastCampaigns';

const STATUS_MAP: Record<string, { label: string; bg: string; text: string; dot: string }> = {
  draft: { label: 'Non validé', bg: 'bg-red-50', text: 'text-red-700', dot: 'bg-red-500' },
  rejected: { label: 'Non validé', bg: 'bg-red-50', text: 'text-red-700', dot: 'bg-red-500' },
  pending: { label: 'En attente', bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-500' },
  active: { label: 'Active', bg: 'bg-green-50', text: 'text-green-700', dot: 'bg-green-500' },
  completed: { label: 'Terminée', bg: 'bg-gray-100', text: 'text-gray-700', dot: 'bg-gray-500' },
  paused: { label: 'En pause', bg: 'bg-gray-100', text: 'text-gray-700', dot: 'bg-gray-500' },
};

interface LastCampaignsGridProps {
  campaigns: LastCampaign[];
  loading: boolean;
}

export default function LastCampaignsGrid({ campaigns, loading }: LastCampaignsGridProps) {
  const navigate = useNavigate();

  return (
    <div className="mb-10 rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      <div className="flex flex-row items-center p-0 gap-6 px-5 py-4 border-b border-gray-200 bg-gray-50/50 min-h-[24px]">
        <h2 className="text-lg font-normal leading-6 text-gray-900 flex-1 order-0">Mes campagnes</h2>
        <button
          type="button"
          onClick={() => navigate('/my-campaigns')}
          className="inline-flex items-center justify-center px-5 py-2.5 rounded-xl border border-gray-200 bg-white text-gray-800 text-sm font-medium hover:bg-gray-50 hover:border-gray-300 transition-colors flex-none shadow-sm"
        >
          Voir mes campagnes
        </button>
      </div>
      <div className="p-5">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {loading
            ? [...Array(5)].map((_, i) => (
                <div
                  key={i}
                  className="rounded-xl bg-gray-100 border border-gray-200 p-5 min-h-[220px] animate-pulse"
                />
              ))
            : campaigns.map((campaign) => {
                const statusConf = STATUS_MAP[campaign.status] || STATUS_MAP.draft;
                const start = campaign.start_date ? new Date(campaign.start_date) : null;
                const end = campaign.end_date ? new Date(campaign.end_date) : null;
                const dateStr =
                  start && end
                    ? `${start.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })} - ${end.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })}`
                    : '—';
                const isActive = campaign.status === 'active';
                return (
                  <div
                    key={campaign.id}
                    className="rounded-xl bg-white border border-gray-200 p-5 shadow-sm flex flex-col"
                  >
                    <div className="flex items-start justify-between gap-2 mb-3">
                      <h3 className="text-base font-semibold text-gray-900 truncate flex-1">
                        {campaign.name}
                      </h3>
                      <span
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium flex-shrink-0 ${statusConf.bg} ${statusConf.text}`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${statusConf.dot}`} />
                        {statusConf.label}
                      </span>
                    </div>
                    <div className="flex items-center flex-wrap gap-x-3 gap-y-1 text-xs text-gray-600 mb-2">
                      <span className="flex items-center gap-1.5">
                        <Calendar className="h-3.5 w-3.5 flex-shrink-0 text-gray-500" />
                        {dateStr}
                      </span>
                      <span className="flex items-center gap-1.5">
                        <MapPin className="h-3.5 w-3.5 flex-shrink-0 text-gray-500" />
                        {campaign.selected_zones && campaign.selected_zones.length > 0
                          ? campaign.selected_zones.join(', ')
                          : '—'}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1.5 mb-3">
                      {(campaign.selected_categories || []).map((cat) => (
                        <span
                          key={cat}
                          className="inline-flex px-2 py-0.5 rounded bg-gray-200 text-gray-700 text-xs"
                        >
                          {cat}
                        </span>
                      ))}
                    </div>
                    <div className="flex items-center justify-between gap-4 mb-4 mt-auto">
                      <div>
                        <div className="flex items-center gap-1 text-xs text-gray-500">
                          <DollarSign className="h-3.5 w-3.5 text-[#60ba76]" />
                          <span>BUDGET</span>
                        </div>
                        <p className="text-base font-bold text-gray-900 tabular-nums">
                          {new Intl.NumberFormat('en-US', {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          }).format(campaign.budget)}{' '}
                          TND
                        </p>
                      </div>
                      <div className="flex items-start gap-1.5 justify-end">
                        <div className="flex flex-col items-start">
                          <TrendingUp className="h-3.5 w-3.5 text-[#7e51f5] flex-shrink-0" />
                          <p className="text-base font-bold text-gray-900 tabular-nums mt-0.5">
                            {(campaign.validated_impressions || 0)
                              .toLocaleString('fr-FR')
                              .replace(/\s/g, ' ')}
                          </p>
                        </div>
                        <div className="text-right text-xs text-gray-500 pt-0.5">IMPRESSIONS</div>
                      </div>
                    </div>
                    <div className="flex gap-2 pt-4 mt-4 border-t border-gray-200 -mx-5 px-5">
                      <button
                        type="button"
                        onClick={() => navigate('/my-campaigns')}
                        className="flex-1 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors"
                      >
                        Consulter
                      </button>
                      <button
                        type="button"
                        onClick={() => navigate('/my-campaigns')}
                        className="flex-1 py-2 rounded-lg bg-[#e3f7ec] text-[#66bc74] text-sm font-medium hover:bg-[#cceee0] transition-colors inline-flex items-center justify-center gap-1.5"
                      >
                        {isActive ? (
                          <>
                            <Rocket className="h-4 w-4" /> Booster
                          </>
                        ) : (
                          <>
                            <RotateCcw className="h-4 w-4" /> Reprendre
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
          {/* Bloc Gagnez du temps */}
          <div className="rounded-xl bg-[#f5f5f5] border border-gray-200 p-5 shadow-sm flex flex-col items-center justify-center text-center">
            <img src={statIcon5} alt="" className="h-12 w-12 object-contain mb-3" />
            <h3 className="text-sm font-bold text-gray-900 mb-1 whitespace-nowrap">Gagnez du temps</h3>
            <p className="text-sm text-gray-600 mb-4">
              Capitalisez sur des campagnes enregistrées ou déjà jouées
            </p>
            <div className="flex flex-col gap-2 w-full">
              <button
                type="button"
                onClick={() => navigate('/my-campaigns?status=completed')}
                className="w-full py-2.5 rounded-lg border border-gray-300 bg-white text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors"
              >
                Rejouer les campagnes passées
              </button>
              <button
                type="button"
                onClick={() => navigate('/my-campaigns?status=draft')}
                className="w-full py-2.5 rounded-lg border border-gray-300 bg-white text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors"
              >
                Reprendre les brouillons
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
