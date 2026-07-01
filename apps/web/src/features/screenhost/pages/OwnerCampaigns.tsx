import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  DollarSign,
  Grid3X3,
  List,
  Loader2,
  MapPin,
  Monitor,
  MoreVertical,
  PartyPopper,
  Search,
  TrendingUp,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'react-hot-toast';
import { useLocation, useNavigate } from 'react-router-dom';

import { useAuthStore } from '@/features/auth/stores/auth.store';
import CampaignDrawer from '@/features/campaigns/components/CampaignDrawer';
import { useOwnerCampaignApprovalMutations } from '@/features/campaigns/hooks/useOwnerCampaignApprovalMutations';
import { useVideoById } from '@/features/campaigns/hooks/useVideoById';
import OwnerNavigation from '@/features/screenhost/components/OwnerNavigation';
import OwnerNotificationsBell from '@/features/screenhost/components/OwnerNotificationsBell';
import {
  useOwnerCampaignsOverview,
  type OwnerCampaignCard,
} from '@/features/screenhost/hooks/useOwnerCampaignsOverview';

type OwnerCampaignStatusFilter =
  | 'all'
  | 'to_approve'
  | 'active'
  | 'upcoming'
  | 'pending'
  | 'completed'
  | 'rejected';
type ViewMode = 'grid' | 'list';

const formatDateRange = (start: Date | null, end: Date | null) => {
  if (!start || !end) return '—';
  return `${start.toLocaleDateString('fr-FR')} -> ${end.toLocaleDateString('fr-FR')}`;
};

const getStatusUi = (status: string, isUpcoming: boolean) => {
  if (isUpcoming)
    return {
      label: 'A venir',
      badge: 'bg-blue-50 text-blue-700 border border-blue-200',
      dot: 'bg-blue-500',
    };
  const key = (status || '').toLowerCase();
  if (key === 'active')
    return {
      label: 'Active',
      badge: 'bg-green-50 text-green-700 border border-green-200',
      dot: 'bg-green-500',
    };
  if (key === 'pending')
    return {
      label: 'En attente',
      badge: 'bg-orange-50 text-orange-700 border border-orange-200',
      dot: 'bg-orange-500',
    };
  if (key === 'completed')
    return {
      label: 'Terminée',
      badge: 'bg-gray-100 text-gray-700 border border-gray-200',
      dot: 'bg-gray-500',
    };
  if (key === 'rejected')
    return {
      label: 'Refusée',
      badge: 'bg-red-50 text-red-700 border border-red-200',
      dot: 'bg-red-500',
    };
  if (key === 'paused')
    return {
      label: 'En pause',
      badge: 'bg-gray-100 text-gray-700 border border-gray-200',
      dot: 'bg-gray-500',
    };
  if (key === 'draft')
    return {
      label: 'Brouillon',
      badge: 'bg-amber-50 text-amber-700 border border-amber-200',
      dot: 'bg-amber-500',
    };
  return {
    label: 'En attente',
    badge: 'bg-orange-50 text-orange-700 border border-orange-200',
    dot: 'bg-orange-500',
  };
};

/**
 * A campaign still awaiting THIS owner's accept/reject decision. Module-level
 * (pure) so the `filteredCampaigns` / `statusCounts` memos and the drawer
 * footer gating all share one definition — the "À approuver" tab predicate is
 * exactly this (B3).
 */
const isPendingForOwner = (campaign: OwnerCampaignCard | null) =>
  Boolean(
    campaign &&
    campaign.approvalStatus !== 'approved' &&
    campaign.approvalStatus !== 'rejected' &&
    campaign.status !== 'completed',
  );

export default function OwnerCampaigns() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, needsApproval, validationStatus } = useAuthStore();
  const isDisabled = needsApproval && validationStatus === 'pending';

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<OwnerCampaignStatusFilter>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [currentPage, setCurrentPage] = useState(1);
  const [brokenLogoCampaignIds, setBrokenLogoCampaignIds] = useState<Set<string>>(new Set());
  const [openActionMenuId, setOpenActionMenuId] = useState<string | null>(null);
  const [selectedCampaign, setSelectedCampaign] = useState<OwnerCampaignCard | null>(null);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [processingDecision, setProcessingDecision] = useState<'accept' | 'reject' | null>(null);
  const [showApprovalSuccessModal, setShowApprovalSuccessModal] = useState(false);
  const [showRejectConfirmModal, setShowRejectConfirmModal] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const itemsPerPage = 6;

  const {
    data: overviewCampaigns,
    loading,
    isError: overviewError,
  } = useOwnerCampaignsOverview(user?.id);
  const { approveCampaign, rejectCampaign } = useOwnerCampaignApprovalMutations(user?.id);

  // Commit 7b — the approve / reject handlers now invalidate-and-refetch (the
  // optimistic `setCampaigns` patches are dropped), so the former local-state
  // mirror's only justification is gone: the page reads straight from the
  // query. The `?? []` is memoised so dependent hooks keep a stable reference
  // (CF-16).
  const campaigns = useMemo(() => overviewCampaigns ?? [], [overviewCampaigns]);

  // Detail-modal video — the shared `useVideoById` consolidation (Commit 7b).
  const { video: campaignVideo } = useVideoById(selectedCampaign?.videoId);

  // Reset broken-logo tracking whenever the campaign set refreshes.
  useEffect(() => {
    if (overviewCampaigns) {
      setBrokenLogoCampaignIds(new Set());
    }
  }, [overviewCampaigns]);

  useEffect(() => {
    if (overviewError) {
      toast.error('Impossible de charger les campagnes');
    }
  }, [overviewError]);

  const filteredCampaigns = useMemo(() => {
    const now = new Date();
    return campaigns.filter((campaign) => {
      const matchesSearch =
        !search.trim() ||
        campaign.name.toLowerCase().includes(search.toLowerCase()) ||
        campaign.clientName.toLowerCase().includes(search.toLowerCase());

      const isUpcoming = Boolean(campaign.startDate && campaign.startDate > now);
      // "À approuver" is on the approvalStatus axis — it OVERRIDES the status
      // filter (shows every owner-pending campaign regardless of status), and
      // reuses isPendingForOwner so the tab matches the drawer footer gating.
      const matchesStatus =
        statusFilter === 'all'
          ? true
          : statusFilter === 'to_approve'
            ? isPendingForOwner(campaign)
            : statusFilter === 'upcoming'
              ? isUpcoming
              : (campaign.status || '').toLowerCase() === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [campaigns, search, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredCampaigns.length / itemsPerPage));
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedCampaigns = filteredCampaigns.slice(startIndex, startIndex + itemsPerPage);

  useEffect(() => {
    setCurrentPage(1);
  }, [search, statusFilter]);

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const openCampaignId = params.get('openCampaignId');
    if (!openCampaignId || campaigns.length === 0) return;

    const target = campaigns.find((c) => c.id === openCampaignId);
    if (!target) return;

    void handleViewCampaign(target);

    const nextParams = new URLSearchParams(location.search);
    nextParams.delete('openCampaignId');
    const nextSearch = nextParams.toString();
    navigate(
      { pathname: location.pathname, search: nextSearch ? `?${nextSearch}` : '' },
      { replace: true },
    );
  }, [location.pathname, location.search, campaigns, navigate]);

  const closeDetailsDrawer = () => {
    // Slide-out is owned by <Drawer> (B2): flip `open` now, clear data after exit.
    setShowDetailsModal(false);
    setTimeout(() => {
      setSelectedCampaign(null);
      setProcessingDecision(null);
      setShowRejectConfirmModal(false);
      setRejectReason('');
    }, 300);
  };

  // The detail-modal video is loaded by `useVideoById` (reactive on
  // `selectedCampaign?.videoId`), so opening the drawer is now synchronous.
  const handleViewCampaign = (campaign: OwnerCampaignCard) => {
    setSelectedCampaign(campaign);
    setOpenActionMenuId(null);
    setShowDetailsModal(true);
  };

  const handleApproveSelectedCampaign = async () => {
    if (!selectedCampaign || !user?.id) return;
    try {
      setProcessingDecision('accept');
      await approveCampaign.mutateAsync({ campaignId: selectedCampaign.id });
      // Reflect the decision in the open drawer (modal client state — the
      // campaign list itself refreshes via invalidate-and-refetch).
      setSelectedCampaign((prev) => (prev ? { ...prev, approvalStatus: 'approved' } : prev));
      setShowApprovalSuccessModal(true);
    } catch (_error) {
      toast.error('Impossible d’accepter la campagne');
    } finally {
      setProcessingDecision(null);
    }
  };

  const handleRejectSelectedCampaign = async () => {
    if (!selectedCampaign || !user?.id) return;
    try {
      setProcessingDecision('reject');
      await rejectCampaign.mutateAsync({
        campaignId: selectedCampaign.id,
        reason: rejectReason.trim() || undefined,
      });
      setSelectedCampaign((prev) => (prev ? { ...prev, approvalStatus: 'rejected' } : prev));
      toast.success('Campagne refusée');
      setShowRejectConfirmModal(false);
      setRejectReason('');
      closeDetailsDrawer();
    } catch (_error) {
      toast.error('Impossible de refuser la campagne');
    } finally {
      setProcessingDecision(null);
    }
  };

  const statusCounts = useMemo(() => {
    const now = new Date();
    return {
      all: campaigns.length,
      toApprove: campaigns.filter((c) => isPendingForOwner(c)).length,
      active: campaigns.filter((c) => c.status === 'active').length,
      upcoming: campaigns.filter((c) => Boolean(c.startDate && c.startDate > now)).length,
      pending: campaigns.filter((c) => c.status === 'pending').length,
      completed: campaigns.filter((c) => c.status === 'completed').length,
      rejected: campaigns.filter((c) => c.status === 'rejected').length,
    };
  }, [campaigns]);

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-brand-primary mx-auto mb-4"></div>
          <p className="text-gray-600">Chargement...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      <div className="flex h-screen">
        <OwnerNavigation isDisabled={isDisabled} />

        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          <header className="bg-white border-b border-[#EBEBEB]">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h1 className="text-xl font-semibold text-[#171717]">Mes campagnes</h1>
                  <p className="text-sm text-[#5C5C5C]">Campagnes diffusees sur vos localites</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => navigate('/owner-calendar-devices')}
                    className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-2xl bg-brand-primary hover:bg-brand-primary/90 text-[#101010] text-sm font-semibold transition-colors"
                  >
                    <Calendar className="h-4 w-4" />
                    Piloter mon calendrier de diffusion
                  </button>
                  <OwnerNotificationsBell userId={user?.id} />
                </div>
              </div>
            </div>
          </header>

          <div className="flex-1 overflow-y-auto">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
              <div className="mb-5 rounded-xl border border-[#EBEBEB] bg-white px-2 py-2">
                <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
                  {[
                    { label: 'Total campagnes', value: statusCounts.all, color: 'text-[#171717]' },
                    { label: 'Actives', value: statusCounts.active, color: 'text-[#1FC16B]' },
                    { label: 'A venir', value: statusCounts.upcoming, color: 'text-[#335CFF]' },
                    { label: 'En attente', value: statusCounts.pending, color: 'text-[#F6B51E]' },
                    { label: 'Terminées', value: statusCounts.completed, color: 'text-[#5C5C5C]' },
                    { label: 'Refusées', value: statusCounts.rejected, color: 'text-[#FB3748]' },
                  ].map((stat, index, arr) => (
                    <div
                      key={stat.label}
                      className={`px-3 py-2 ${index < arr.length - 1 ? 'xl:border-r xl:border-[#EBEBEB]' : ''}`}
                    >
                      <p className="text-sm font-medium text-[#7A7A7A]">{stat.label}</p>
                      <p
                        className={`text-[34px] leading-9 font-medium mt-1 tabular-nums ${stat.color}`}
                      >
                        {stat.value}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex flex-col lg:flex-row lg:items-center gap-3 mb-5">
                <div className="flex flex-wrap items-center gap-2">
                  {[
                    { key: 'all' as const, label: 'Tous', count: statusCounts.all },
                    {
                      key: 'to_approve' as const,
                      label: 'À approuver',
                      count: statusCounts.toApprove,
                    },
                    { key: 'active' as const, label: 'Actives', count: statusCounts.active },
                    { key: 'upcoming' as const, label: 'A venir', count: statusCounts.upcoming },
                    { key: 'pending' as const, label: 'En attente', count: statusCounts.pending },
                    {
                      key: 'completed' as const,
                      label: 'Terminées',
                      count: statusCounts.completed,
                    },
                    { key: 'rejected' as const, label: 'Refusées', count: statusCounts.rejected },
                  ].map((item) => (
                    <button
                      key={item.key}
                      onClick={() => setStatusFilter(item.key)}
                      className={`px-3 py-1.5 rounded-md text-sm border transition-colors ${
                        statusFilter === item.key
                          ? 'bg-white text-[#171717] border-[#DADADA]'
                          : 'bg-[#F7F7F7] text-[#7A7A7A] border-transparent hover:border-[#E5E5E5]'
                      }`}
                    >
                      {item.label} <span className="text-xs opacity-70">({item.count})</span>
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-2 lg:ml-auto">
                  <div className="relative w-full sm:w-72">
                    <Search className="h-4 w-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Rechercher.."
                      className="w-full h-10 pl-9 pr-3 rounded-md border border-[#EBEBEB] text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/30"
                    />
                  </div>
                  <button
                    className={`h-10 w-10 rounded-md border ${viewMode === 'grid' ? 'bg-white border-[#DADADA]' : 'bg-[#F7F7F7] border-transparent'}`}
                    onClick={() => setViewMode('grid')}
                    title="Vue grille"
                  >
                    <Grid3X3 className="h-4 w-4 mx-auto text-[#5C5C5C]" />
                  </button>
                  <button
                    className={`h-10 w-10 rounded-md border ${viewMode === 'list' ? 'bg-white border-[#DADADA]' : 'bg-[#F7F7F7] border-transparent'}`}
                    onClick={() => setViewMode('list')}
                    title="Vue liste"
                  >
                    <List className="h-4 w-4 mx-auto text-[#5C5C5C]" />
                  </button>
                </div>
              </div>

              {filteredCampaigns.length === 0 ? (
                <div className="bg-white border border-[#EBEBEB] rounded-xl p-10 text-center text-[#5C5C5C]">
                  Aucune campagne diffusee sur vos localites.
                </div>
              ) : (
                <>
                  {viewMode === 'grid' ? (
                    <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
                      {paginatedCampaigns.map((campaign) => {
                        const now = new Date();
                        const isUpcoming = Boolean(campaign.startDate && campaign.startDate > now);
                        const statusUi = getStatusUi(campaign.status, isUpcoming);

                        return (
                          <div
                            key={campaign.id}
                            role="button"
                            tabIndex={0}
                            onClick={() => handleViewCampaign(campaign)}
                            onKeyDown={(e) => {
                              if (e.target !== e.currentTarget) return;
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                handleViewCampaign(campaign);
                              }
                            }}
                            className="rounded-xl border border-[#EBEBEB] bg-white p-4 flex flex-col min-h-[245px] cursor-pointer"
                          >
                            <div className="flex items-start justify-between gap-3 mb-2 min-h-[28px]">
                              <h3 className="text-base font-semibold text-[#171717] truncate pr-2">
                                {campaign.name}
                              </h3>
                              <span
                                className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusUi.badge}`}
                              >
                                <span
                                  className={`w-1.5 h-1.5 rounded-full mr-1.5 ${statusUi.dot}`}
                                />
                                {statusUi.label}
                              </span>
                            </div>

                            <div className="text-sm text-[#5C5C5C] mb-1 flex items-center gap-1.5 min-h-[20px] w-full">
                              <Calendar className="h-4 w-4" />
                              {formatDateRange(campaign.startDate, campaign.endDate)}
                            </div>

                            <div className="flex items-center justify-between text-sm text-[#5C5C5C] mb-3 min-h-[20px] w-full">
                              <span className="inline-flex items-center gap-1">
                                <Monitor className="h-4 w-4" />
                                {campaign.ownerScreensCount} ecrans
                              </span>
                              <span className="inline-flex items-center gap-1">
                                <MapPin className="h-4 w-4" />
                                {campaign.ownerLocationsCount} etablissements
                              </span>
                            </div>

                            <div className="grid grid-cols-2 gap-6 mb-4 w-full">
                              <div>
                                <div className="inline-flex items-center gap-1 text-[11px] uppercase tracking-wide text-[#7A7A7A]">
                                  <DollarSign className="h-3.5 w-3.5 text-brand-primary" />
                                  Revenu
                                </div>
                                <p className="text-base font-semibold text-[#171717]">
                                  {campaign.estimatedRevenue.toLocaleString('fr-FR', {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2,
                                  })}{' '}
                                  TND
                                </p>
                              </div>
                              <div className="text-right">
                                <div className="inline-flex items-center gap-1 text-[11px] uppercase tracking-wide text-[#7A7A7A]">
                                  <TrendingUp className="h-3.5 w-3.5 text-[#7e51f5]" />
                                  Impressions
                                </div>
                                <p className="text-base font-semibold text-[#171717]">
                                  {campaign.impressions.toLocaleString('fr-FR')}
                                </p>
                              </div>
                            </div>

                            <div className="h-[60px] flex items-center justify-center mt-auto">
                              {campaign.clientLogoUrl && !brokenLogoCampaignIds.has(campaign.id) ? (
                                <img
                                  src={campaign.clientLogoUrl}
                                  alt={campaign.clientName}
                                  className="h-[60px] w-[150px] object-contain"
                                  onError={() => {
                                    setBrokenLogoCampaignIds((prev) => {
                                      const next = new Set(prev);
                                      next.add(campaign.id);
                                      return next;
                                    });
                                  }}
                                />
                              ) : (
                                <div
                                  className="h-[60px] w-[150px] rounded-md border border-[#EBEBEB] bg-[#F7F7F7]"
                                  aria-label="Espace logo"
                                ></div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="rounded-xl border border-[#EBEBEB] bg-white overflow-hidden">
                      <div className="grid grid-cols-[1.4fr_1fr_1fr_1fr_1fr_1fr_44px] items-center bg-[#F8F8F8] px-4 py-3 text-[13px] text-[#5C5C5C]">
                        <div className="font-medium">Nom de la campagne</div>
                        <div className="font-medium">Status</div>
                        <div className="inline-flex items-center gap-1 font-medium">
                          <Calendar className="h-3.5 w-3.5" />
                          Date de debut
                        </div>
                        <div className="inline-flex items-center gap-1 font-medium">
                          <Calendar className="h-3.5 w-3.5" />
                          Date de fin
                        </div>
                        <div className="inline-flex items-center gap-1 font-medium">
                          <DollarSign className="h-3.5 w-3.5" />
                          Revenu
                        </div>
                        <div className="inline-flex items-center gap-1 font-medium">
                          <TrendingUp className="h-3.5 w-3.5" />
                          Impressions
                        </div>
                        <div />
                      </div>

                      {paginatedCampaigns.map((campaign) => {
                        const now = new Date();
                        const isUpcoming = Boolean(campaign.startDate && campaign.startDate > now);
                        const statusUi = getStatusUi(campaign.status, isUpcoming);
                        return (
                          <div
                            key={campaign.id}
                            className="grid grid-cols-[1.4fr_1fr_1fr_1fr_1fr_1fr_44px] items-center px-4 py-4 border-t border-[#F0F0F0] text-sm text-[#1F1F1F]"
                          >
                            <div className="font-semibold truncate pr-2">{campaign.name}</div>
                            <div>
                              <span
                                className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusUi.badge}`}
                              >
                                <span
                                  className={`w-1.5 h-1.5 rounded-full mr-1.5 ${statusUi.dot}`}
                                />
                                {statusUi.label}
                              </span>
                            </div>
                            <div>
                              {campaign.startDate
                                ? campaign.startDate.toLocaleDateString('fr-FR')
                                : '—'}
                            </div>
                            <div>
                              {campaign.endDate
                                ? campaign.endDate.toLocaleDateString('fr-FR')
                                : '—'}
                            </div>
                            <div>
                              {campaign.estimatedRevenue.toLocaleString('fr-FR', {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}{' '}
                              TND
                            </div>
                            <div>{campaign.impressions.toLocaleString('fr-FR')}</div>
                            <div className="relative">
                              <button
                                type="button"
                                onClick={() =>
                                  setOpenActionMenuId((prev) =>
                                    prev === campaign.id ? null : campaign.id,
                                  )
                                }
                                className="h-8 w-8 rounded-md hover:bg-[#F5F5F5] inline-flex items-center justify-center text-[#7A7A7A]"
                                aria-label="Actions campagne"
                              >
                                <MoreVertical className="h-4 w-4" />
                              </button>
                              {openActionMenuId === campaign.id && (
                                <div className="absolute right-0 top-9 z-20 rounded-lg border border-[#E9E9E9] bg-white shadow-md py-1 min-w-[170px]">
                                  <button
                                    type="button"
                                    onClick={() => handleViewCampaign(campaign)}
                                    className="w-full text-left px-3 py-2 text-sm text-[#1F1F1F] hover:bg-[#F8F8F8]"
                                  >
                                    Consulter la campagne
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-100 mt-6">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center">
                        <p className="text-sm text-gray-700">
                          Affichage de{' '}
                          <span className="font-medium text-[#00263A]">
                            {filteredCampaigns.length === 0 ? 0 : startIndex + 1}
                          </span>{' '}
                          a{' '}
                          <span className="font-medium text-[#00263A]">
                            {Math.min(startIndex + itemsPerPage, filteredCampaigns.length)}
                          </span>{' '}
                          sur{' '}
                          <span className="font-medium text-[#00263A]">
                            {filteredCampaigns.length}
                          </span>{' '}
                          resultats
                        </p>
                      </div>
                      <div className="flex items-center space-x-2">
                        <button
                          onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                          disabled={currentPage === 1}
                          className="p-2 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 hover:border-brand-primary disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
                        >
                          <ChevronLeft className="h-5 w-5" />
                        </button>
                        <span className="px-4 py-2 text-sm font-medium text-[#00263A]">
                          Page {currentPage} sur {totalPages}
                        </span>
                        <button
                          onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                          disabled={currentPage === totalPages}
                          className="p-2 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 hover:border-brand-primary disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
                        >
                          <ChevronRight className="h-5 w-5" />
                        </button>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {selectedCampaign &&
        (() => {
          const statusUi = getStatusUi(
            selectedCampaign.status,
            Boolean(selectedCampaign.startDate && selectedCampaign.startDate > new Date()),
          );
          return (
            <CampaignDrawer
              open={showDetailsModal}
              onClose={closeDetailsDrawer}
              campaign={selectedCampaign}
              video={campaignVideo}
              variant="owner"
              statusBadge={
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium w-fit ${statusUi.badge}`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${statusUi.dot}`} />
                  {statusUi.label}
                </span>
              }
              footerSlot={
                isPendingForOwner(selectedCampaign) ? (
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setShowRejectConfirmModal(true)}
                      disabled={processingDecision !== null}
                      className="h-10 rounded-lg border border-[#FFC5C7] bg-[#FFF6F6] text-[#FB3748] font-medium hover:opacity-90 disabled:opacity-60"
                    >
                      {processingDecision === 'reject' ? 'Traitement...' : 'Refuser'}
                    </button>
                    <button
                      type="button"
                      onClick={handleApproveSelectedCampaign}
                      disabled={processingDecision !== null}
                      className="h-10 rounded-lg border border-brand-primary bg-[#E8F8EE] text-[#1FC16B] font-medium hover:opacity-90 disabled:opacity-60 inline-flex items-center justify-center gap-2"
                    >
                      {processingDecision === 'accept' && (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      )}
                      <span>{processingDecision === 'accept' ? 'Traitement...' : 'Accepter'}</span>
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={closeDetailsDrawer}
                    className="w-full h-10 rounded-lg border border-[#EBEBEB] bg-white text-[#5C5C5C] font-medium hover:bg-gray-50"
                  >
                    Fermer
                  </button>
                )
              }
            />
          );
        })()}

      {showApprovalSuccessModal && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40"
          role="button"
          tabIndex={0}
          onClick={() => setShowApprovalSuccessModal(false)}
          onKeyDown={(e) => {
            if (e.target !== e.currentTarget) return;
            if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') {
              e.preventDefault();
              setShowApprovalSuccessModal(false);
            }
          }}
        >
          <div
            className="bg-white rounded-2xl shadow-xl w-full max-w-[760px] p-8 text-center relative"
            role="button"
            tabIndex={0}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <div className="flex justify-center mb-5">
              <div className="w-20 h-20 rounded-full bg-[#E8F8EE] flex items-center justify-center">
                <div className="w-14 h-14 rounded-full border border-[#9ADFB4] bg-white flex items-center justify-center">
                  <PartyPopper className="h-7 w-7 text-[#171717]" />
                </div>
              </div>
            </div>
            <h3 className="text-[42px] leading-none font-semibold text-[#171717] mb-5">
              Félicitations !
            </h3>
            <div className="border border-[#EBEBEB] rounded-2xl p-4 text-left text-[#1F1F1F] mb-6">
              <p className="text-[16px] leading-7 font-medium">
                La campagne est désormais programmée pour diffusion dans vos établissements.
              </p>
              <p className="text-[16px] leading-7 font-medium mt-3">
                Veillez à maintenir vos écrans actifs durant toute la période afin de garantir une
                diffusion optimale et un revenu maximal.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setShowApprovalSuccessModal(false);
                closeDetailsDrawer();
                navigate('/owner-dashboard');
              }}
              className="w-full h-12 rounded-xl font-medium text-[#171717] hover:opacity-90"
              style={{ background: '#9ADFB4' }}
            >
              Dashboard
            </button>
          </div>
        </div>
      )}

      {showRejectConfirmModal && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/40"
          role="button"
          tabIndex={0}
          onClick={() => setShowRejectConfirmModal(false)}
          onKeyDown={(e) => {
            if (e.target !== e.currentTarget) return;
            if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') {
              e.preventDefault();
              setShowRejectConfirmModal(false);
              setRejectReason('');
            }
          }}
        >
          <div
            className="w-full max-w-[760px] rounded-[24px] bg-white shadow-xl overflow-hidden"
            role="button"
            tabIndex={0}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <div className="px-8 py-5 border-b border-[#F1F1F1]">
              <h3 className="text-[20px] leading-tight font-semibold text-[#171717]">
                Etes-vous sur de vouloir refuser cette campagne ?
              </h3>
            </div>
            <div className="px-8 pt-5">
              <label
                htmlFor="reject-reason"
                className="block text-sm font-medium text-[#171717] mb-2"
              >
                Motif du refus
              </label>
              <textarea
                id="reject-reason"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                rows={3}
                placeholder="Expliquez la raison du refus (communiquée à l'annonceur)…"
                className="w-full rounded-xl border border-[#EBEBEB] px-4 py-3 text-sm text-[#171717] placeholder:text-[#A3A3A3] focus:outline-none focus:border-brand-primary resize-none"
              />
            </div>
            <div className="px-8 py-5 flex items-center justify-center gap-4">
              <button
                type="button"
                onClick={() => {
                  setShowRejectConfirmModal(false);
                  setRejectReason('');
                }}
                className="h-14 min-w-[210px] px-8 rounded-2xl border border-[#EBEBEB] bg-white text-[#5C5C5C] text-[16px] leading-none font-medium hover:bg-[#FAFAFA]"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={handleRejectSelectedCampaign}
                disabled={processingDecision === 'reject'}
                className="h-14 min-w-[250px] px-8 rounded-2xl bg-[#E84E4E] text-white text-[16px] leading-none font-medium hover:opacity-90 disabled:opacity-70"
              >
                {processingDecision === 'reject' ? 'Traitement...' : 'Refuser définitivement'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
