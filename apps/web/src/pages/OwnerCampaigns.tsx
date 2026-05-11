import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Crosshair,
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
  X,
} from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'react-hot-toast';
import { useLocation, useNavigate } from 'react-router-dom';

import OwnerNavigation from '../components/OwnerNavigation';
import OwnerNotificationsBell from '../components/OwnerNotificationsBell';
import { supabase } from '../lib/supabase';
import { campaignOwnerApprovalService } from '../services/campaign-owner-approval.service';
import { getDoohConfigNumbers } from '../services/global-configuration.service';
import { useAuthStore } from '../stores/auth.store';

type OwnerCampaignStatusFilter =
  | 'all'
  | 'active'
  | 'upcoming'
  | 'pending'
  | 'completed'
  | 'rejected';
type ViewMode = 'grid' | 'list';

type OwnerCampaignCard = {
  id: string;
  name: string;
  status: string;
  startDate: Date | null;
  endDate: Date | null;
  impressions: number;
  estimatedRevenue: number;
  ownerLocationsCount: number;
  ownerScreensCount: number;
  ownerScreenIds: string[];
  approvalStatus: 'pending' | 'approved' | 'rejected' | null;
  videoId: string | null;
  clientName: string;
  clientLogoUrl: string | null;
};

const toNumber = (value: number | string | null | undefined) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

const extractPlannedImpressions = (publicationSchedule: any): number => {
  if (!publicationSchedule) return 0;
  const raw = publicationSchedule?.total_impressions;
  return toNumber(raw);
};

const toDate = (value?: string | null) => {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

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

export default function OwnerCampaigns() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, needsApproval, validationStatus } = useAuthStore();
  const isDisabled = needsApproval && validationStatus === 'pending';

  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<OwnerCampaignStatusFilter>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [campaigns, setCampaigns] = useState<OwnerCampaignCard[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [brokenLogoCampaignIds, setBrokenLogoCampaignIds] = useState<Set<string>>(new Set());
  const [openActionMenuId, setOpenActionMenuId] = useState<string | null>(null);
  const [selectedCampaign, setSelectedCampaign] = useState<OwnerCampaignCard | null>(null);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [campaignVideo, setCampaignVideo] = useState<{ url?: string | null } | null>(null);
  const [processingDecision, setProcessingDecision] = useState<'accept' | 'reject' | null>(null);
  const [showApprovalSuccessModal, setShowApprovalSuccessModal] = useState(false);
  const [showRejectConfirmModal, setShowRejectConfirmModal] = useState(false);
  const itemsPerPage = 6;

  useEffect(() => {
    const loadOwnerCampaigns = async () => {
      if (!user?.id) return;
      setLoading(true);
      try {
        const doohConfig = await getDoohConfigNumbers();
        const [
          { data: ownerLocations, error: ownerLocationsError },
          { data: ownerScreens, error: ownerScreensError },
          { data: ownerApprovals, error: ownerApprovalsError },
        ] = await Promise.all([
          supabase.from('locations').select('id').eq('owner_id', user.id),
          supabase
            .from('screens')
            .select('id, location_id')
            .eq('owner_id', user.id)
            .eq('status', 'active'),
          supabase
            .from('campaign_owner_approvals')
            .select('campaign_id, status')
            .eq('owner_id', user.id),
        ]);

        if (ownerLocationsError) throw ownerLocationsError;
        if (ownerScreensError) throw ownerScreensError;
        if (ownerApprovalsError) throw ownerApprovalsError;

        const ownerLocationIds = (ownerLocations || []).map((l: { id: string }) => l.id);
        const ownerScreenIds = (ownerScreens || []).map((s: { id: string }) => s.id);
        const ownerScreenToLocation = new Map<string, string | null>(
          (ownerScreens || []).map((s: { id: string; location_id: string | null }) => [
            s.id,
            s.location_id || null,
          ]),
        );

        const queryTasks: Promise<any>[] = [
          ownerLocationIds.length > 0
            ? supabase
                .from('campaign_locations')
                .select('campaign_id, location_id')
                .in('location_id', ownerLocationIds)
            : Promise.resolve({ data: [], error: null }),
          ownerScreenIds.length > 0
            ? supabase
                .from('campaign_screens')
                .select('campaign_id, screen_id')
                .in('screen_id', ownerScreenIds)
            : Promise.resolve({ data: [], error: null }),
        ];

        const [ownerCampaignLocRes, ownerCampaignScreenRes] = await Promise.all(queryTasks);
        const { data: ownerCampaignLocRows, error: ownerCampaignLocError } = ownerCampaignLocRes;
        const { data: ownerCampaignScreenRows, error: ownerCampaignScreenError } =
          ownerCampaignScreenRes;

        if (ownerCampaignLocError) throw ownerCampaignLocError;
        if (ownerCampaignScreenError) throw ownerCampaignScreenError;

        const campaignIds = Array.from(
          new Set(
            [
              ...(ownerCampaignLocRows || []).map((r: { campaign_id: string }) => r.campaign_id),
              ...(ownerCampaignScreenRows || []).map((r: { campaign_id: string }) => r.campaign_id),
              ...(ownerApprovals || []).map((r: { campaign_id: string }) => r.campaign_id),
            ].filter(Boolean),
          ),
        );
        if (campaignIds.length === 0) {
          setCampaigns([]);
          return;
        }

        const [
          { data: allCampaignLocRows, error: allCampaignLocError },
          { data: allCampaignScreenRows, error: allCampaignScreenError },
        ] = await Promise.all([
          supabase
            .from('campaign_locations')
            .select('campaign_id, location_id')
            .in('campaign_id', campaignIds),
          supabase
            .from('campaign_screens')
            .select('campaign_id, screen_id')
            .in('campaign_id', campaignIds),
        ]);

        if (allCampaignLocError) throw allCampaignLocError;
        if (allCampaignScreenError) throw allCampaignScreenError;

        const { data: campaignsRows, error: campaignsError } = await supabase
          .from('campaigns')
          .select(
            `
            id,
            name,
            user_id,
            status,
            content_validation_status,
            start_date,
            end_date,
            budget,
            views,
            video_id,
            publication_schedule,
            client:clients(name, user_id)
          `,
          )
          .in('id', campaignIds)
          .order('created_at', { ascending: false });
        if (campaignsError) throw campaignsError;

        const videoIds = Array.from(
          new Set((campaignsRows || []).map((c: any) => c.video_id).filter(Boolean)),
        );
        const approvedVideoIdSet = new Set<string>();
        if (videoIds.length > 0) {
          const { data: approvedVideos, error: approvedVideosError } = await supabase
            .from('videos')
            .select('id')
            .in('id', videoIds)
            .eq('validation_status', 'approved');
          if (approvedVideosError) throw approvedVideosError;
          (approvedVideos || []).forEach((video: any) => approvedVideoIdSet.add(video.id));
        }

        const approvalByCampaignId = new Map<
          string,
          { status: 'pending' | 'approved' | 'rejected' }
        >();
        (ownerApprovals || []).forEach(
          (approval: { campaign_id: string; status?: 'pending' | 'approved' | 'rejected' }) => {
            approvalByCampaignId.set(approval.campaign_id, {
              status: approval.status || 'pending',
            });
          },
        );

        const advertiserUserIds = Array.from(
          new Set(
            (campaignsRows || [])
              .flatMap((c: any) => [c.user_id, c.client?.user_id])
              .filter(Boolean),
          ),
        );
        const advertiserClientNames = Array.from(
          new Set(
            (campaignsRows || [])
              .map((c: any) => (typeof c.client?.name === 'string' ? c.client.name.trim() : ''))
              .filter(Boolean),
          ),
        );
        const advertiserLogoByUserId = new Map<string, string>();
        const advertiserLogoByBusinessName = new Map<string, string>();
        if (advertiserUserIds.length > 0) {
          const { data: advertiserProfiles, error: advertiserProfilesError } = await supabase
            .from('business_profiles')
            .select('user_id, business_name, logo_url')
            .in('user_id', advertiserUserIds);
          if (advertiserProfilesError) {
            console.warn('OwnerCampaigns logo query by user_id failed:', advertiserProfilesError);
          }

          (advertiserProfiles || []).forEach(
            (profile: {
              user_id: string;
              business_name?: string | null;
              logo_url?: string | null;
            }) => {
              if (profile.logo_url) advertiserLogoByUserId.set(profile.user_id, profile.logo_url);
              if (profile.logo_url && profile.business_name) {
                advertiserLogoByBusinessName.set(
                  profile.business_name.trim().toLowerCase(),
                  profile.logo_url,
                );
              }
            },
          );
        }
        if (advertiserClientNames.length > 0) {
          const { data: advertiserProfilesByName, error: advertiserProfilesByNameError } =
            await supabase
              .from('business_profiles')
              .select('business_name, logo_url')
              .in('business_name', advertiserClientNames);
          if (advertiserProfilesByNameError) {
            console.warn(
              'OwnerCampaigns logo query by business_name failed:',
              advertiserProfilesByNameError,
            );
          }
          (advertiserProfilesByName || []).forEach(
            (profile: { business_name?: string | null; logo_url?: string | null }) => {
              if (profile.logo_url && profile.business_name) {
                advertiserLogoByBusinessName.set(
                  profile.business_name.trim().toLowerCase(),
                  profile.logo_url,
                );
              }
            },
          );
        }

        const ownerLocationIdsByCampaign = new Map<string, Set<string>>();
        for (const row of ownerCampaignLocRows || []) {
          const set = ownerLocationIdsByCampaign.get(row.campaign_id) || new Set<string>();
          set.add(row.location_id);
          ownerLocationIdsByCampaign.set(row.campaign_id, set);
        }
        const ownerScreenIdsByCampaign = new Map<string, Set<string>>();
        for (const row of ownerCampaignScreenRows || []) {
          const set = ownerScreenIdsByCampaign.get(row.campaign_id) || new Set<string>();
          set.add(row.screen_id);
          ownerScreenIdsByCampaign.set(row.campaign_id, set);
        }
        // Fallback: dériver localités propriétaires à partir des écrans propriétaire liés à la campagne.
        for (const [campaignId, screenSet] of ownerScreenIdsByCampaign.entries()) {
          const locSet = ownerLocationIdsByCampaign.get(campaignId) || new Set<string>();
          for (const screenId of screenSet) {
            const locId = ownerScreenToLocation.get(screenId);
            if (locId) locSet.add(locId);
          }
          ownerLocationIdsByCampaign.set(campaignId, locSet);
        }

        const totalLocationCountByCampaign = new Map<string, number>();
        for (const row of allCampaignLocRows || []) {
          totalLocationCountByCampaign.set(
            row.campaign_id,
            (totalLocationCountByCampaign.get(row.campaign_id) || 0) + 1,
          );
        }
        const totalScreenCountByCampaign = new Map<string, number>();
        for (const row of allCampaignScreenRows || []) {
          totalScreenCountByCampaign.set(
            row.campaign_id,
            (totalScreenCountByCampaign.get(row.campaign_id) || 0) + 1,
          );
        }

        const cards: OwnerCampaignCard[] = (campaignsRows || [])
          .filter((campaign: any) => {
            const advertiserValidated = campaign?.content_validation_status === 'approved';
            const videoValidated = Boolean(
              campaign?.video_id && approvedVideoIdSet.has(campaign.video_id),
            );
            return advertiserValidated && videoValidated;
          })
          .map((campaign: any) => {
            const ownerLocIds = ownerLocationIdsByCampaign.get(campaign.id) || new Set<string>();
            const ownerScreenIdsForCampaign =
              ownerScreenIdsByCampaign.get(campaign.id) || new Set<string>();

            const ownerLocationsCount = ownerLocIds.size;
            const ownerScreensCount = ownerScreenIdsForCampaign.size;

            const totalLocationCount = totalLocationCountByCampaign.get(campaign.id) || 0;
            const totalScreenCount = totalScreenCountByCampaign.get(campaign.id) || 0;

            const locationShare =
              totalLocationCount > 0 ? ownerLocationsCount / totalLocationCount : 0;
            const screenShare = totalScreenCount > 0 ? ownerScreensCount / totalScreenCount : 0;
            const ownerShare = Math.min(
              1,
              Math.max(0, totalLocationCount > 0 ? locationShare : screenShare || 1),
            );

            const campaignBudget = toNumber(campaign.budget);
            const campaignViews = toNumber(campaign.views);
            const plannedImpressions = extractPlannedImpressions(campaign.publication_schedule);
            const cpmTnd = campaign.event_id
              ? doohConfig.event_campaign_cpm_tnd
              : doohConfig.standard_campaign_cpm_tnd;
            const baselineImpressions =
              plannedImpressions > 0
                ? plannedImpressions
                : campaignViews > 0
                  ? campaignViews
                  : Math.round((campaignBudget / cpmTnd) * 1000);

            return {
              id: campaign.id,
              name: campaign.name || 'Campagne sans nom',
              status: campaign.status || '',
              startDate: toDate(campaign.start_date),
              endDate: toDate(campaign.end_date),
              impressions: Math.round(baselineImpressions * ownerShare),
              estimatedRevenue: Math.round(campaignBudget * ownerShare * 100) / 100,
              ownerLocationsCount,
              ownerScreensCount,
              ownerScreenIds: Array.from(ownerScreenIdsForCampaign),
              approvalStatus: approvalByCampaignId.get(campaign.id)?.status || null,
              videoId: campaign.video_id || null,
              clientName: campaign.client?.name || 'Annonceur',
              clientLogoUrl:
                advertiserLogoByUserId.get(campaign.user_id) ||
                advertiserLogoByUserId.get(campaign.client?.user_id) ||
                advertiserLogoByBusinessName.get(
                  String(campaign.client?.name || '')
                    .trim()
                    .toLowerCase(),
                ) ||
                null,
            };
          });

        setBrokenLogoCampaignIds(new Set());
        setCampaigns(cards.filter((c) => c.ownerLocationsCount > 0 || c.ownerScreensCount > 0));
      } catch (error) {
        console.error('Erreur chargement campagnes proprietaire:', error);
        toast.error('Impossible de charger les campagnes');
        setCampaigns([]);
      } finally {
        setLoading(false);
      }
    };

    loadOwnerCampaigns();
  }, [user?.id]);

  const filteredCampaigns = useMemo(() => {
    const now = new Date();
    return campaigns.filter((campaign) => {
      const matchesSearch =
        !search.trim() ||
        campaign.name.toLowerCase().includes(search.toLowerCase()) ||
        campaign.clientName.toLowerCase().includes(search.toLowerCase());

      const isUpcoming = Boolean(campaign.startDate && campaign.startDate > now);
      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'upcoming'
          ? isUpcoming
          : (campaign.status || '').toLowerCase() === statusFilter);

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
    if (showDetailsModal) {
      const t = requestAnimationFrame(() => setDrawerVisible(true));
      return () => cancelAnimationFrame(t);
    }
    setDrawerVisible(false);
  }, [showDetailsModal]);

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
    setDrawerVisible(false);
    setTimeout(() => {
      setShowDetailsModal(false);
      setSelectedCampaign(null);
      setCampaignVideo(null);
      setProcessingDecision(null);
      setShowRejectConfirmModal(false);
    }, 300);
  };

  const handleViewCampaign = async (campaign: OwnerCampaignCard) => {
    setSelectedCampaign(campaign);
    setOpenActionMenuId(null);
    if (campaign.videoId) {
      try {
        const { data: videoData } = await supabase
          .from('videos')
          .select('url')
          .eq('id', campaign.videoId)
          .single();
        setCampaignVideo(videoData || null);
      } catch {
        setCampaignVideo(null);
      }
    } else {
      setCampaignVideo(null);
    }
    setShowDetailsModal(true);
  };

  const isPendingForOwner = (campaign: OwnerCampaignCard | null) =>
    Boolean(
      campaign &&
      campaign.approvalStatus !== 'approved' &&
      campaign.approvalStatus !== 'rejected' &&
      campaign.status !== 'completed',
    );

  const handleApproveSelectedCampaign = async () => {
    if (!selectedCampaign || !user?.id) return;
    try {
      setProcessingDecision('accept');
      await campaignOwnerApprovalService.approveCampaign(selectedCampaign.id, user.id);
      setCampaigns((prev) =>
        prev.map((c) => (c.id === selectedCampaign.id ? { ...c, approvalStatus: 'approved' } : c)),
      );
      setSelectedCampaign((prev) => (prev ? { ...prev, approvalStatus: 'approved' } : prev));
      setShowApprovalSuccessModal(true);
    } catch (error) {
      console.error('Erreur approbation campagne propriétaire:', error);
      toast.error('Impossible d’accepter la campagne');
    } finally {
      setProcessingDecision(null);
    }
  };

  const handleRejectSelectedCampaign = async () => {
    if (!selectedCampaign || !user?.id) return;
    try {
      setProcessingDecision('reject');
      await campaignOwnerApprovalService.rejectCampaign(selectedCampaign.id, user.id, undefined);
      setCampaigns((prev) =>
        prev.map((c) => (c.id === selectedCampaign.id ? { ...c, approvalStatus: 'rejected' } : c)),
      );
      setSelectedCampaign((prev) => (prev ? { ...prev, approvalStatus: 'rejected' } : prev));
      toast.success('Campagne refusée');
      setShowRejectConfirmModal(false);
      closeDetailsDrawer();
    } catch (error) {
      console.error('Erreur rejet campagne propriétaire:', error);
      toast.error('Impossible de refuser la campagne');
    } finally {
      setProcessingDecision(null);
    }
  };

  const statusCounts = useMemo(() => {
    const now = new Date();
    return {
      all: campaigns.length,
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
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-[#00B3A6] mx-auto mb-4"></div>
          <p className="text-gray-600">Chargement...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      <div className="flex h-screen">
        <OwnerNavigation isDisabled={isDisabled} />

        <div className="flex-1 flex flex-col overflow-hidden">
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
                    className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-2xl bg-[#9AE2B0] hover:bg-[#85D99E] text-[#101010] text-sm font-semibold transition-colors"
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
                      className="w-full h-10 pl-9 pr-3 rounded-md border border-[#EBEBEB] text-sm focus:outline-none focus:ring-2 focus:ring-[#76E6AB]/30"
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
                          <article
                            key={campaign.id}
                            onClick={() => handleViewCampaign(campaign)}
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
                                  <DollarSign className="h-3.5 w-3.5 text-[#76E6AB]" />
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
                          </article>
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
                          className="p-2 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 hover:border-[#00B3A6] disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
                        >
                          <ChevronLeft className="h-5 w-5" />
                        </button>
                        <span className="px-4 py-2 text-sm font-medium text-[#00263A]">
                          Page {currentPage} sur {totalPages}
                        </span>
                        <button
                          onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                          disabled={currentPage === totalPages}
                          className="p-2 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 hover:border-[#00B3A6] disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
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

      {showDetailsModal &&
        selectedCampaign &&
        (() => {
          const statusUi = getStatusUi(
            selectedCampaign.status,
            Boolean(selectedCampaign.startDate && selectedCampaign.startDate > new Date()),
          );
          const startStr = selectedCampaign.startDate
            ? selectedCampaign.startDate.toLocaleDateString('fr-FR')
            : '—';
          const endStr = selectedCampaign.endDate
            ? selectedCampaign.endDate.toLocaleDateString('fr-FR')
            : '—';
          const durationDays =
            selectedCampaign.startDate && selectedCampaign.endDate
              ? Math.max(
                  0,
                  Math.ceil(
                    (selectedCampaign.endDate.getTime() - selectedCampaign.startDate.getTime()) /
                      (1000 * 60 * 60 * 24),
                  ),
                )
              : 0;
          return (
            <div className="fixed inset-0 z-50 overflow-hidden">
              <div
                className={`absolute inset-0 bg-gray-500/75 transition-opacity duration-300 ${drawerVisible ? 'opacity-100' : 'opacity-0'}`}
                onClick={closeDetailsDrawer}
                aria-hidden
              />
              <div
                className={`absolute top-0 bottom-0 right-2 w-[420px] bg-white flex flex-col isolate transform transition-transform duration-300 ease-out ${
                  drawerVisible ? 'translate-x-0' : 'translate-x-full'
                }`}
                style={{
                  boxShadow: '0px 16px 32px rgba(14,18,27,0.102)',
                  border: '1px solid #EBEBEB',
                  borderRadius: '12px',
                }}
              >
                <div className="flex-none flex flex-row items-start p-4 gap-3 border-b border-[#EBEBEB]">
                  <div className="flex flex-col gap-1 min-w-0 flex-1">
                    <h3 className="text-[20px] leading-6 font-semibold text-[#171717] truncate">
                      {selectedCampaign.name}
                    </h3>
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium w-fit ${statusUi.badge}`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${statusUi.dot}`} />
                      {statusUi.label}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={closeDetailsDrawer}
                    className="p-2 text-[#5C5C5C] hover:bg-gray-100 rounded-lg transition-colors shrink-0"
                    aria-label="Fermer"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                  <div className="border-b border-[#EFEFEF] pb-3">
                    <p className="text-xs uppercase text-[#A3A3A3] mb-2">Type de la campagne</p>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="flex items-center gap-2 rounded-lg p-2 border border-[#76E6AB] bg-white">
                        <div className="w-8 h-8 rounded-lg bg-[#E8F8EE] border border-[#76E6AB] flex items-center justify-center">
                          <Crosshair className="h-4 w-4 text-[#142522]" />
                        </div>
                        <span className="text-sm text-[#171717]">Réseau Toodooh</span>
                      </div>
                      <div className="flex items-center gap-2 rounded-lg p-2 border border-[#EBEBEB] bg-[#F7F7F7]">
                        <div className="w-8 h-8 rounded-lg bg-white border border-[#EBEBEB] flex items-center justify-center">
                          <Monitor className="h-4 w-4 text-[#D1D1D1]" />
                        </div>
                        <span className="text-sm text-[#9D9D9D]">Parc TV</span>
                      </div>
                    </div>
                  </div>

                  <div className="border-b border-[#EFEFEF] pb-3">
                    <p className="text-xs uppercase text-[#A3A3A3] mb-2">Etablissements</p>
                    <div className="inline-flex items-center justify-center h-7 min-w-7 px-2 rounded border border-[#76E6AB] bg-[#E8F8EE] text-[#1FC16B] text-sm font-semibold">
                      {selectedCampaign.ownerLocationsCount}
                    </div>
                  </div>

                  <div className="border-b border-[#EFEFEF] pb-3">
                    <p className="text-xs uppercase text-[#A3A3A3] mb-2">Période</p>
                    <div className="flex justify-between text-sm text-[#171717]">
                      <span>
                        <strong>Début:</strong> {startStr}
                      </span>
                      <span>
                        <strong>Fin:</strong> {endStr}
                      </span>
                      <span>
                        <strong>Durée:</strong> {durationDays} jours
                      </span>
                    </div>
                  </div>

                  <div className="border-b border-[#EFEFEF] pb-3">
                    <p className="text-xs uppercase text-[#A3A3A3] mb-2">Zones géographiques</p>
                    <div className="flex justify-between text-sm text-[#171717]">
                      <span>
                        <strong>Nombre de zones:</strong>{' '}
                        {Math.max(1, selectedCampaign.ownerLocationsCount)}
                      </span>
                      <span>
                        <strong>Zone couverte:</strong> —
                      </span>
                    </div>
                  </div>

                  <div>
                    <p className="text-xs uppercase text-[#A3A3A3] mb-2">Spot</p>
                    <div className="rounded-xl border border-[#EBEBEB] overflow-hidden bg-black/5">
                      {campaignVideo?.url ? (
                        <video
                          src={campaignVideo.url || undefined}
                          controls
                          className="w-full aspect-video object-contain bg-black"
                        />
                      ) : (
                        <div className="aspect-video flex items-center justify-center text-sm text-[#A3A3A3]">
                          Aucun spot
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex-none p-4 border-t border-[#EBEBEB]">
                  {isPendingForOwner(selectedCampaign) ? (
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
                        className="h-10 rounded-lg border border-[#76E6AB] bg-[#E8F8EE] text-[#1FC16B] font-medium hover:opacity-90 disabled:opacity-60 inline-flex items-center justify-center gap-2"
                      >
                        {processingDecision === 'accept' && (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        )}
                        <span>
                          {processingDecision === 'accept' ? 'Traitement...' : 'Accepter'}
                        </span>
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
                  )}
                </div>
              </div>
            </div>
          );
        })()}

      {showApprovalSuccessModal && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40"
          onClick={() => setShowApprovalSuccessModal(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl w-full max-w-[760px] p-8 text-center relative"
            onClick={(e) => e.stopPropagation()}
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
          onClick={() => setShowRejectConfirmModal(false)}
        >
          <div
            className="w-full max-w-[760px] rounded-[24px] bg-white shadow-xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-8 py-5 border-b border-[#F1F1F1]">
              <h3 className="text-[20px] leading-tight font-semibold text-[#171717]">
                Etes-vous sur de vouloir refuser cette campagne ?
              </h3>
            </div>
            <div className="px-8 py-5 flex items-center justify-center gap-4">
              <button
                type="button"
                onClick={() => setShowRejectConfirmModal(false)}
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
