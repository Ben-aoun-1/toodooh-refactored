import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CheckCircle,
  XCircle,
  Clock,
  Monitor,
  Calendar,
  RefreshCw,
  Search,
  ShieldCheck,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useAuthStore } from '../stores/auth.store';
import {
  campaignOwnerApprovalService,
  PendingCampaign,
} from '../services/campaign-owner-approval.service';
import OwnerNavigation from '../components/OwnerNavigation';

export default function OwnerCampaignApprovals() {
  const navigate = useNavigate();
  const { user, needsApproval, validationStatus } = useAuthStore();
  const isDisabled = needsApproval && validationStatus === 'pending';

  const [loading, setLoading] = useState(true);
  const [campaigns, setCampaigns] = useState<PendingCampaign[]>([]);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>(
    'pending',
  );
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    if (!user) {
      navigate('/login');
      return;
    }

    loadCampaigns();
  }, [user, navigate]);

  const loadCampaigns = async () => {
    try {
      setLoading(true);
      const pendingCampaigns = await campaignOwnerApprovalService.getPendingCampaigns(user!.id);
      setCampaigns(pendingCampaigns);
    } catch (error) {
      console.error('Erreur lors du chargement des campagnes:', error);
      toast.error('Erreur lors du chargement des campagnes');
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (campaignId: string) => {
    try {
      setProcessingId(campaignId);
      await campaignOwnerApprovalService.approveCampaign(campaignId, user!.id);
      toast.success('Campagne approuvée avec succès');
      await loadCampaigns();
    } catch (error) {
      console.error("Erreur lors de l'approbation:", error);
      toast.error("Erreur lors de l'approbation de la campagne");
    } finally {
      setProcessingId(null);
    }
  };

  const handleReject = async (campaignId: string) => {
    const reason = prompt('Raison du rejet (optionnel):');
    try {
      setProcessingId(campaignId);
      await campaignOwnerApprovalService.rejectCampaign(campaignId, user!.id, reason || undefined);
      toast.success('Campagne rejetée');
      await loadCampaigns();
    } catch (error) {
      console.error('Erreur lors du rejet:', error);
      toast.error('Erreur lors du rejet de la campagne');
    } finally {
      setProcessingId(null);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  };

  const stats = useMemo(() => {
    const pending = campaigns.filter((c) => c.approval_status === 'pending').length;
    const approved = campaigns.filter((c) => c.approval_status === 'approved').length;
    const rejected = campaigns.filter((c) => c.approval_status === 'rejected').length;
    return {
      total: campaigns.length,
      pending,
      approved,
      rejected,
    };
  }, [campaigns]);

  const filteredCampaigns = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    return campaigns.filter((campaign) => {
      const campaignName = String(campaign.campaign_name || '').toLowerCase();
      const screenNames = Array.isArray(campaign.screen_names) ? campaign.screen_names : [];
      const statusOk = statusFilter === 'all' ? true : campaign.approval_status === statusFilter;
      const searchOk =
        normalizedSearch.length === 0 ||
        campaignName.includes(normalizedSearch) ||
        screenNames.some((name) =>
          String(name || '')
            .toLowerCase()
            .includes(normalizedSearch),
        );
      return statusOk && searchOk;
    });
  }, [campaigns, searchTerm, statusFilter]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50/80 flex items-center justify-center">
        <div className="text-center rounded-2xl bg-white border border-gray-200 px-8 py-7 shadow-sm">
          <RefreshCw className="h-8 w-8 animate-spin text-[#00B3A6] mx-auto mb-3" />
          <p className="text-sm font-medium text-gray-700">Chargement des campagnes...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50/80">
      <div className="flex h-screen">
        <OwnerNavigation isDisabled={isDisabled} />

        <div className="flex-1 flex flex-col overflow-hidden">
          <header className="bg-white border-b border-gray-200 sticky top-0 z-40 shadow-sm">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="h-10 w-10 rounded-full border border-gray-200 bg-white flex items-center justify-center">
                    <ShieldCheck className="h-5 w-5 text-gray-700" />
                  </div>
                  <div className="min-w-0">
                    <h1 className="text-xl font-semibold text-[#171717] truncate">
                      Validation des campagnes
                    </h1>
                    <p className="text-sm text-gray-500 truncate">
                      Approuvez ou rejetez les campagnes liées à vos dispositifs.
                    </p>
                  </div>
                </div>
                <button
                  onClick={loadCampaigns}
                  className="h-10 w-10 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 inline-flex items-center justify-center text-gray-600"
                  title="Actualiser"
                >
                  <RefreshCw className="h-5 w-5" />
                </button>
              </div>
            </div>
          </header>

          <div className="flex-1 overflow-y-auto">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
                <div className="rounded-xl border border-gray-200 bg-white p-4">
                  <p className="text-xs text-gray-500">Total</p>
                  <p className="text-xl font-semibold text-[#171717] mt-1">{stats.total}</p>
                </div>
                <div className="rounded-xl border border-[#E8D9A8] bg-[#FFFBEF] p-4">
                  <p className="text-xs text-[#8A6B11]">En attente</p>
                  <p className="text-xl font-semibold text-[#8A6B11] mt-1">{stats.pending}</p>
                </div>
                <div className="rounded-xl border border-[#BEE8CF] bg-[#F3FFF8] p-4">
                  <p className="text-xs text-[#1D7A46]">Approuvées</p>
                  <p className="text-xl font-semibold text-[#1D7A46] mt-1">{stats.approved}</p>
                </div>
                <div className="rounded-xl border border-[#F3C4C4] bg-[#FFF7F7] p-4">
                  <p className="text-xs text-[#B84242]">Rejetées</p>
                  <p className="text-xl font-semibold text-[#B84242] mt-1">{stats.rejected}</p>
                </div>
              </div>

              <div className="rounded-2xl border border-gray-200 bg-white p-4 mb-6">
                <div className="flex flex-col lg:flex-row gap-3 lg:items-center lg:justify-between">
                  <div className="flex flex-wrap items-center gap-2">
                    {[
                      { id: 'pending', label: 'En attente' },
                      { id: 'approved', label: 'Approuvées' },
                      { id: 'rejected', label: 'Rejetées' },
                      { id: 'all', label: 'Toutes' },
                    ].map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() =>
                          setStatusFilter(tab.id as 'all' | 'pending' | 'approved' | 'rejected')
                        }
                        className={`h-9 px-4 rounded-xl text-sm font-medium transition-colors ${
                          statusFilter === tab.id
                            ? 'bg-[#E4F9EB] text-[#132B1B]'
                            : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
                        }`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>
                  <div className="relative w-full lg:w-[340px]">
                    <Search className="h-4 w-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      placeholder="Rechercher une campagne ou un écran"
                      className="w-full h-10 rounded-xl border border-gray-200 pl-9 pr-3 text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#97d8a5] focus:border-[#97d8a5]"
                    />
                  </div>
                </div>
              </div>

              {filteredCampaigns.length === 0 ? (
                <div className="rounded-2xl border border-gray-200 bg-white text-center py-12 px-6">
                  <CheckCircle className="h-14 w-14 text-green-500 mx-auto mb-3" />
                  <h3 className="text-base font-semibold text-gray-900 mb-1">
                    Aucune campagne en attente
                  </h3>
                  <p className="text-sm text-gray-600">
                    Aucune campagne ne correspond à vos filtres actuels.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {filteredCampaigns.map((campaign) => (
                    <div
                      key={campaign.campaign_id}
                      className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden"
                    >
                      <div className="p-5 sm:p-6">
                        <div className="flex items-start justify-between mb-4">
                          <div className="flex-1">
                            <h3 className="text-lg font-semibold text-gray-900 mb-2">
                              {campaign.campaign_name || 'Campagne'}
                            </h3>
                            <div className="flex flex-wrap gap-4 text-sm text-gray-600">
                              <div className="flex items-center">
                                <Calendar className="h-4 w-4 mr-2 text-[#00B3A6]" />
                                <span>
                                  Du {formatDate(campaign.campaign_start_date)} au{' '}
                                  {formatDate(campaign.campaign_end_date)}
                                </span>
                              </div>
                            </div>
                          </div>
                          <div className="ml-4">
                            {campaign.approval_status === 'pending' ? (
                              <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium bg-yellow-100 text-yellow-800">
                                <Clock className="h-4 w-4 mr-1" />
                                En attente
                              </span>
                            ) : campaign.approval_status === 'approved' ? (
                              <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium bg-green-100 text-green-800">
                                <CheckCircle className="h-4 w-4 mr-1" />
                                Approuvée
                              </span>
                            ) : (
                              <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium bg-red-100 text-red-800">
                                <XCircle className="h-4 w-4 mr-1" />
                                Rejetée
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Liste des écrans du propriétaire concernés */}
                        <div className="mb-4">
                          <h4 className="text-sm font-medium text-gray-700 mb-2">
                            Vos écrans concernés (
                            {Array.isArray(campaign.screen_ids) ? campaign.screen_ids.length : 0}) :
                          </h4>
                          <div className="flex flex-wrap gap-2">
                            {(Array.isArray(campaign.screen_names)
                              ? campaign.screen_names
                              : []
                            ).map((name, index) => (
                              <span
                                key={index}
                                className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium bg-[#00B3A6]/10 text-[#00B3A6] border border-[#00B3A6]/20"
                              >
                                <Monitor className="h-3 w-3 mr-1" />
                                {name || 'Écran'}
                              </span>
                            ))}
                          </div>
                        </div>

                        {/* Actions */}
                        {campaign.approval_status === 'pending' && (
                          <div className="flex items-center justify-end gap-2 pt-4 border-t border-gray-200">
                            <button
                              onClick={() => handleReject(campaign.campaign_id)}
                              disabled={processingId === campaign.campaign_id}
                              className="inline-flex items-center h-10 px-4 border border-red-200 rounded-xl text-sm font-medium text-red-700 bg-white hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              <XCircle className="h-4 w-4 mr-2" />
                              Rejeter
                            </button>
                            <button
                              onClick={() => handleApprove(campaign.campaign_id)}
                              disabled={processingId === campaign.campaign_id}
                              className="inline-flex items-center h-10 px-4 rounded-xl text-sm font-medium text-[#171717] bg-[#76E6AB] hover:bg-[#63d89a] disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {processingId === campaign.campaign_id ? (
                                <>
                                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                                  Traitement...
                                </>
                              ) : (
                                <>
                                  <CheckCircle className="h-4 w-4 mr-2" />
                                  Approuver
                                </>
                              )}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
