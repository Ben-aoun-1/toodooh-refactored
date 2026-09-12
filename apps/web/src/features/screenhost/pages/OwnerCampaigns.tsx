import {
  Banknote,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Grid3X3,
  List,
  MapPin,
  Megaphone,
  MoreVertical,
  Search,
  TrendingUp,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'react-hot-toast';
import { useLocation, useNavigate } from 'react-router-dom';

import PageHeader from '@/components/PageHeader';
import { useAuthStore } from '@/features/auth/stores/auth.store';
import OwnerCampaignDetailsDrawer from '@/features/screenhost/components/OwnerCampaignDetailsDrawer';
import OwnerNavigation from '@/features/screenhost/components/OwnerNavigation';
import OwnerNotificationsBell from '@/features/screenhost/components/OwnerNotificationsBell';
import { useOwnerCampaigns } from '@/features/screenhost/hooks/useOwnerCampaigns';
import {
  DECIDE_CTA_LABEL,
  DECIDE_ROUTE,
  EMPTY_STATE_DETAIL,
  EMPTY_STATE_TITLE,
  LOAD_ERROR_MESSAGE,
  type OwnerCampaignStatusFilter,
  STATUS_FILTERS,
  countByFilter,
  decisionUi,
  fmtDate,
  fmtDateRange,
  matchesSearch,
  matchesStatusFilter,
  needsDecision,
  statusUi,
  venuesLabel,
} from '@/features/screenhost/lib/owner-campaigns.lib';
import { revenueLabel } from '@/features/screenhost/services/screenhost-allocations.service';
import type { OwnerCampaign } from '@/features/screenhost/services/screenhost-campaigns.service';

type ViewMode = 'grid' | 'list';

/**
 * CAMP-E1 / SUPA-1 slice 1 — the owner's « Mes campagnes », on the api (GET
 * /api/screenhosts/campaigns). Oversight only: every campaign the dispatch placed on the owner's
 * venues, ANY decision state, grouped per campaign with the owner's totals and their decision.
 * The accept/reject surface stays /owner-allocations (« Décider » navigates there).
 *
 * The previous read was a Supabase composite that THREW in production (env unset), so every
 * owner — with or without campaigns — saw « Impossible de charger les campagnes » and an empty
 * page (Mejri, 2026-09-11). Now: an empty list is a calm empty state; only a real fetch error
 * toasts.
 */
const StatusBadge = ({ campaign }: { campaign: OwnerCampaign }) => {
  const ui = statusUi(campaign.status);
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${ui.badge}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${ui.dot}`} />
      {ui.label}
    </span>
  );
};

const DecisionChip = ({ campaign }: { campaign: OwnerCampaign }) => {
  const ui = decisionUi(campaign.owner_decision);
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${ui.className}`}
    >
      {ui.label}
    </span>
  );
};

export default function OwnerCampaigns() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, needsApproval, validationStatus } = useAuthStore();
  const isDisabled = needsApproval && validationStatus === 'pending';

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<OwnerCampaignStatusFilter>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [currentPage, setCurrentPage] = useState(1);
  const [openActionMenuId, setOpenActionMenuId] = useState<string | null>(null);
  const [selectedCampaign, setSelectedCampaign] = useState<OwnerCampaign | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const itemsPerPage = 6;

  const { data, loading, isError } = useOwnerCampaigns(user?.id);
  // Memoised `?? []` so dependent memos keep a stable reference (CF-16).
  const campaigns = useMemo(() => data ?? [], [data]);

  // A REAL fetch failure keeps a toast; an empty list never does (that is the empty state below).
  useEffect(() => {
    if (isError) toast.error(LOAD_ERROR_MESSAGE);
  }, [isError]);

  const counts = useMemo(() => countByFilter(campaigns), [campaigns]);

  const filteredCampaigns = useMemo(
    () => campaigns.filter((c) => matchesSearch(c, search) && matchesStatusFilter(c, statusFilter)),
    [campaigns, search, statusFilter],
  );

  const totalPages = Math.max(1, Math.ceil(filteredCampaigns.length / itemsPerPage));
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedCampaigns = filteredCampaigns.slice(startIndex, startIndex + itemsPerPage);

  useEffect(() => {
    setCurrentPage(1);
  }, [search, statusFilter]);

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  const openDetails = (campaign: OwnerCampaign) => {
    setSelectedCampaign(campaign);
    setOpenActionMenuId(null);
    setDrawerOpen(true);
  };

  const closeDetails = () => {
    // Slide-out is owned by <Drawer>: flip `open` now, clear data after the exit animation.
    setDrawerOpen(false);
    setTimeout(() => setSelectedCampaign(null), 300);
  };

  // ?openCampaignId=<id> (the notification bell's deep link) opens the drawer once, then clears.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const openCampaignId = params.get('openCampaignId');
    if (!openCampaignId || campaigns.length === 0) return;
    const target = campaigns.find((c) => c.id === openCampaignId);
    if (target) openDetails(target);
    params.delete('openCampaignId');
    const nextSearch = params.toString();
    navigate(
      { pathname: location.pathname, search: nextSearch ? `?${nextSearch}` : '' },
      { replace: true },
    );
  }, [location.pathname, location.search, campaigns, navigate]);

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

  const statTiles: { key: OwnerCampaignStatusFilter; label: string; color: string }[] = [
    { key: 'all', label: 'Total campagnes', color: 'text-[#171717]' },
    { key: 'to_decide', label: 'À valider', color: 'text-[#B47A00]' },
    { key: 'active', label: 'Actives', color: 'text-[#1FC16B]' },
    { key: 'upcoming', label: 'À venir', color: 'text-[#335CFF]' },
    { key: 'pending', label: 'En attente', color: 'text-[#F6B51E]' },
    { key: 'completed', label: 'Terminées', color: 'text-[#5C5C5C]' },
  ];

  return (
    <div className="min-h-screen bg-white">
      <div className="flex h-screen">
        <OwnerNavigation isDisabled={isDisabled} />

        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          <header className="bg-white border-b border-[#EBEBEB]">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <PageHeader
                    title="Mes campagnes"
                    subtitle="Campagnes diffusées sur vos établissements"
                  />
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => navigate('/owner-calendar-devices')}
                    aria-label="Piloter mon calendrier de diffusion"
                    title="Piloter mon calendrier de diffusion"
                    className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-2xl bg-brand-primary hover:bg-brand-primary/90 text-[#101010] text-sm font-semibold transition-colors flex-shrink-0 whitespace-nowrap"
                  >
                    <Calendar className="h-4 w-4 flex-shrink-0" />
                    <span className="hidden lg:inline">Piloter mon calendrier de diffusion</span>
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
                  {statTiles.map((stat, index, arr) => (
                    <div
                      key={stat.key}
                      className={`px-3 py-2 ${index < arr.length - 1 ? 'xl:border-r xl:border-[#EBEBEB]' : ''}`}
                    >
                      <p className="text-sm font-medium text-[#7A7A7A]">{stat.label}</p>
                      <p
                        className={`text-[34px] leading-9 font-medium mt-1 tabular-nums ${stat.color}`}
                      >
                        {counts[stat.key]}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex flex-col lg:flex-row lg:items-center gap-3 mb-5">
                <div className="flex flex-wrap items-center gap-2">
                  {STATUS_FILTERS.map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => setStatusFilter(item.key)}
                      className={`px-3 py-1.5 rounded-md text-sm border transition-colors ${
                        statusFilter === item.key
                          ? 'bg-white text-[#171717] border-[#DADADA]'
                          : 'bg-[#F7F7F7] text-[#7A7A7A] border-transparent hover:border-[#E5E5E5]'
                      }`}
                    >
                      {item.label} <span className="text-xs opacity-70">({counts[item.key]})</span>
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
                    type="button"
                    className={`h-10 w-10 rounded-md border ${viewMode === 'grid' ? 'bg-white border-[#DADADA]' : 'bg-[#F7F7F7] border-transparent'}`}
                    onClick={() => setViewMode('grid')}
                    title="Vue grille"
                  >
                    <Grid3X3 className="h-4 w-4 mx-auto text-[#5C5C5C]" />
                  </button>
                  <button
                    type="button"
                    className={`h-10 w-10 rounded-md border ${viewMode === 'list' ? 'bg-white border-[#DADADA]' : 'bg-[#F7F7F7] border-transparent'}`}
                    onClick={() => setViewMode('list')}
                    title="Vue liste"
                  >
                    <List className="h-4 w-4 mx-auto text-[#5C5C5C]" />
                  </button>
                </div>
              </div>

              {campaigns.length === 0 ? (
                // The actual ask (Mejri 2026-09-11): zero campaigns is a calm state, not an error.
                <div className="bg-white border border-[#EBEBEB] rounded-xl px-6 py-14 text-center">
                  <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-[#F7F7F7] flex items-center justify-center text-[#7A7A7A]">
                    <Megaphone className="h-5 w-5" />
                  </div>
                  <p className="text-base font-semibold text-[#171717]">{EMPTY_STATE_TITLE}</p>
                  <p className="mt-1 text-sm text-[#5C5C5C] max-w-md mx-auto">
                    {EMPTY_STATE_DETAIL}
                  </p>
                </div>
              ) : filteredCampaigns.length === 0 ? (
                <div className="bg-white border border-[#EBEBEB] rounded-xl p-10 text-center text-[#5C5C5C]">
                  Aucune campagne ne correspond à ce filtre.
                </div>
              ) : (
                <>
                  {viewMode === 'grid' ? (
                    <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
                      {paginatedCampaigns.map((campaign) => (
                        <div
                          key={campaign.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => openDetails(campaign)}
                          onKeyDown={(e) => {
                            if (e.target !== e.currentTarget) return;
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              openDetails(campaign);
                            }
                          }}
                          className="rounded-xl border border-[#EBEBEB] bg-white p-4 flex flex-col min-h-[215px] cursor-pointer"
                        >
                          <div className="flex items-start justify-between gap-3 mb-1 min-h-[28px]">
                            <h3 className="text-base font-semibold text-[#171717] truncate pr-2">
                              {campaign.name}
                            </h3>
                            <StatusBadge campaign={campaign} />
                          </div>
                          <p className="text-sm text-[#5C5C5C] truncate mb-2">
                            {campaign.advertiser_name}
                          </p>

                          <div className="text-sm text-[#5C5C5C] mb-1 flex items-center gap-1.5 min-h-[20px] w-full">
                            <Calendar className="h-4 w-4" />
                            {fmtDateRange(campaign.start_date, campaign.end_date)}
                          </div>

                          <div className="flex items-center justify-between text-sm text-[#5C5C5C] mb-3 min-h-[20px] w-full">
                            <span className="inline-flex items-center gap-1">
                              <MapPin className="h-4 w-4" />
                              {venuesLabel(campaign.allocations.length)}
                            </span>
                            <DecisionChip campaign={campaign} />
                          </div>

                          <div className="grid grid-cols-2 gap-6 w-full">
                            <div>
                              <div className="inline-flex items-center gap-1 text-[11px] uppercase tracking-wide text-[#7A7A7A]">
                                <Banknote className="h-3.5 w-3.5 text-brand-primary" />
                                Revenu estimé
                              </div>
                              <p className="text-base font-semibold text-[#171717]">
                                {revenueLabel(campaign.totals.revenu_previsionnel)}
                              </p>
                            </div>
                            <div className="text-right">
                              <div className="inline-flex items-center gap-1 text-[11px] uppercase tracking-wide text-[#7A7A7A]">
                                <TrendingUp className="h-3.5 w-3.5 text-[#7e51f5]" />
                                Impressions
                              </div>
                              <p className="text-base font-semibold text-[#171717]">
                                {campaign.totals.ii_potentiel.toLocaleString('fr-FR')}
                              </p>
                            </div>
                          </div>

                          {needsDecision(campaign.owner_decision) && (
                            <div className="mt-auto pt-3">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  navigate(DECIDE_ROUTE);
                                }}
                                className="w-full h-9 rounded-lg bg-brand-primary text-sm font-semibold text-[#101010] hover:bg-brand-primary/90"
                              >
                                {DECIDE_CTA_LABEL}
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-xl border border-[#EBEBEB] bg-white overflow-hidden">
                      <div className="grid grid-cols-[1.4fr_1fr_1fr_1fr_1fr_1fr_44px] items-center bg-[#F8F8F8] px-4 py-3 text-[13px] text-[#5C5C5C]">
                        <div className="font-medium">Nom de la campagne</div>
                        <div className="font-medium">Statut</div>
                        <div className="font-medium">Votre décision</div>
                        <div className="inline-flex items-center gap-1 font-medium">
                          <Calendar className="h-3.5 w-3.5" />
                          Période
                        </div>
                        <div className="inline-flex items-center gap-1 font-medium">
                          <Banknote className="h-3.5 w-3.5" />
                          Revenu estimé
                        </div>
                        <div className="inline-flex items-center gap-1 font-medium">
                          <TrendingUp className="h-3.5 w-3.5" />
                          Impressions
                        </div>
                        <div />
                      </div>

                      {paginatedCampaigns.map((campaign) => (
                        <div
                          key={campaign.id}
                          className="grid grid-cols-[1.4fr_1fr_1fr_1fr_1fr_1fr_44px] items-center px-4 py-4 border-t border-[#F0F0F0] text-sm text-[#1F1F1F]"
                        >
                          <div className="min-w-0 pr-2">
                            <p className="font-semibold truncate">{campaign.name}</p>
                            <p className="text-xs text-[#7A7A7A] truncate">
                              {campaign.advertiser_name}
                            </p>
                          </div>
                          <div>
                            <StatusBadge campaign={campaign} />
                          </div>
                          <div>
                            <DecisionChip campaign={campaign} />
                          </div>
                          <div className="text-xs">
                            {fmtDate(campaign.start_date)}
                            <br />
                            {fmtDate(campaign.end_date)}
                          </div>
                          <div>{revenueLabel(campaign.totals.revenu_previsionnel)}</div>
                          <div>{campaign.totals.ii_potentiel.toLocaleString('fr-FR')}</div>
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
                                  onClick={() => openDetails(campaign)}
                                  className="w-full text-left px-3 py-2 text-sm text-[#1F1F1F] hover:bg-[#F8F8F8]"
                                >
                                  Consulter la campagne
                                </button>
                                {needsDecision(campaign.owner_decision) && (
                                  <button
                                    type="button"
                                    onClick={() => navigate(DECIDE_ROUTE)}
                                    className="w-full text-left px-3 py-2 text-sm text-[#1F1F1F] hover:bg-[#F8F8F8]"
                                  >
                                    {DECIDE_CTA_LABEL}
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-100 mt-6">
                    <div className="flex items-center justify-between">
                      <p className="text-sm text-gray-700">
                        Affichage de{' '}
                        <span className="font-medium text-[#00263A]">{startIndex + 1}</span> à{' '}
                        <span className="font-medium text-[#00263A]">
                          {Math.min(startIndex + itemsPerPage, filteredCampaigns.length)}
                        </span>{' '}
                        sur{' '}
                        <span className="font-medium text-[#00263A]">
                          {filteredCampaigns.length}
                        </span>{' '}
                        résultats
                      </p>
                      <div className="flex items-center space-x-2">
                        <button
                          type="button"
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
                          type="button"
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

      {selectedCampaign && (
        <OwnerCampaignDetailsDrawer
          open={drawerOpen}
          onClose={closeDetails}
          campaign={selectedCampaign}
          footerSlot={
            needsDecision(selectedCampaign.owner_decision) ? (
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={closeDetails}
                  className="h-10 rounded-lg border border-[#EBEBEB] bg-white text-[#5C5C5C] font-medium hover:bg-gray-50"
                >
                  Fermer
                </button>
                <button
                  type="button"
                  onClick={() => navigate(DECIDE_ROUTE)}
                  className="h-10 rounded-lg bg-brand-primary text-[#101010] font-semibold hover:bg-brand-primary/90"
                >
                  {DECIDE_CTA_LABEL}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={closeDetails}
                className="w-full h-10 rounded-lg border border-[#EBEBEB] bg-white text-[#5C5C5C] font-medium hover:bg-gray-50"
              >
                Fermer
              </button>
            )
          }
        />
      )}
    </div>
  );
}
