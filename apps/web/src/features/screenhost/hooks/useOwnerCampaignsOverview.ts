import { useQuery } from '@tanstack/react-query';

import { DEFAULT_DOOH_CONFIG_NUMBERS } from '@/lib/dooh/config';
import { logger } from '@/lib/logger';
import { supabase } from '@/lib/supabase';

import { screenhostKeys } from './queryKeys';

const log = logger.child({ module: 'useOwnerCampaignsOverview' });

/** A campaign touching the owner's parc, shaped for the OwnerCampaigns view. */
export type OwnerCampaignCard = {
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

// TODO(phase-1): typed source [supabase] — see #15
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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

/**
 * Composite read for `OwnerCampaigns` — verbatim port of the former
 * `loadOwnerCampaigns` effect: resolves the owner's locations / screens /
 * approvals, the campaigns touching them, their advertiser logos and video
 * validation, and folds it all into per-campaign owner-share cards.
 */
async function fetchOwnerCampaignsOverview(userId: string): Promise<OwnerCampaignCard[]> {
  const doohConfig = DEFAULT_DOOH_CONFIG_NUMBERS; // ADM-CFG1 — seed CPM; live knob = dispatch_config (api)
  const [
    { data: ownerLocations, error: ownerLocationsError },
    { data: ownerScreens, error: ownerScreensError },
    { data: ownerApprovals, error: ownerApprovalsError },
  ] = await Promise.all([
    supabase.from('locations').select('id').eq('owner_id', userId),
    supabase
      .from('screens')
      .select('id, location_id')
      .eq('owner_id', userId)
      .eq('status', 'active'),
    supabase.from('campaign_owner_approvals').select('campaign_id, status').eq('owner_id', userId),
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

  // TODO(phase-1): typed source [supabase] — see #15
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  const { data: ownerCampaignScreenRows, error: ownerCampaignScreenError } = ownerCampaignScreenRes;

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
  if (campaignIds.length === 0) return [];

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
    // TODO(phase-1): typed source [supabase] — see #15
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    // TODO(phase-1): typed source [supabase] — see #15
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (approvedVideos || []).forEach((video: any) => approvedVideoIdSet.add(video.id));
  }

  const approvalByCampaignId = new Map<string, { status: 'pending' | 'approved' | 'rejected' }>();
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
        // TODO(phase-1): typed source [supabase] — see #15
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .flatMap((c: any) => [c.user_id, c.client?.user_id])
        .filter(Boolean),
    ),
  );
  const advertiserClientNames = Array.from(
    new Set(
      (campaignsRows || [])
        // TODO(phase-1): typed source [supabase] — see #15
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
      log.warn({ advertiserProfilesError }, 'OwnerCampaigns logo query by user_id failed');
    }

    (advertiserProfiles || []).forEach(
      (profile: { user_id: string; business_name?: string | null; logo_url?: string | null }) => {
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
    const { data: advertiserProfilesByName, error: advertiserProfilesByNameError } = await supabase
      .from('business_profiles')
      .select('business_name, logo_url')
      .in('business_name', advertiserClientNames);
    if (advertiserProfilesByNameError) {
      log.warn(
        { advertiserProfilesByNameError },
        'OwnerCampaigns logo query by business_name failed',
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
    // TODO(phase-1): typed source [supabase] — see #15
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((campaign: any) => {
      const advertiserValidated = campaign?.content_validation_status === 'approved';
      const videoValidated = Boolean(
        campaign?.video_id && approvedVideoIdSet.has(campaign.video_id),
      );
      return advertiserValidated && videoValidated;
    })
    // TODO(phase-1): typed source [supabase] — see #15
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((campaign: any) => {
      const ownerLocIds = ownerLocationIdsByCampaign.get(campaign.id) || new Set<string>();
      const ownerScreenIdsForCampaign =
        ownerScreenIdsByCampaign.get(campaign.id) || new Set<string>();

      const ownerLocationsCount = ownerLocIds.size;
      const ownerScreensCount = ownerScreenIdsForCampaign.size;

      const totalLocationCount = totalLocationCountByCampaign.get(campaign.id) || 0;
      const totalScreenCount = totalScreenCountByCampaign.get(campaign.id) || 0;

      const locationShare = totalLocationCount > 0 ? ownerLocationsCount / totalLocationCount : 0;
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

  return cards.filter((c) => c.ownerLocationsCount > 0 || c.ownerScreensCount > 0);
}

interface UseOwnerCampaignsOverviewResult {
  /** The raw query payload — a stable reference per fetch, `undefined` until loaded. */
  data: OwnerCampaignCard[] | undefined;
  loading: boolean;
  isError: boolean;
}

/**
 * The owner's campaign-oversight list. Read-only; `OwnerCampaigns` keeps a
 * local mirror of this data because its approve / reject handlers apply
 * optimistic `setCampaigns` patches (those writes stay inline pending
 * Commit 7 — `campaignOwnerApprovalService` migration). `data` is returned
 * raw (not `?? []`) so the page's mirror-seeding effect keys off a stable
 * reference and does not churn while the query loads.
 */
export function useOwnerCampaignsOverview(
  userId: string | undefined,
): UseOwnerCampaignsOverviewResult {
  const query = useQuery({
    queryKey: screenhostKeys.campaignsOverview(userId ?? ''),
    queryFn: () => fetchOwnerCampaignsOverview(userId as string),
    enabled: !!userId,
  });

  return {
    data: query.data,
    loading: query.isLoading,
    isError: query.isError,
  };
}
