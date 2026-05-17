import { useQuery } from '@tanstack/react-query';

import { eventsService } from '@/features/events/services/events.service';
import type { CampaignForEdit, SpecialEvent } from '@/features/events/types/event';
import { supabase } from '@/lib/supabase';

import { eventsKeys } from './queryKeys';

interface MyEventCampaignsData {
  events: SpecialEvent[];
  eventToCampaign: Map<string, CampaignForEdit>;
}

interface UseMyEventCampaignsResult {
  myEventCampaignsEvents: SpecialEvent[];
  eventToCampaign: Map<string, CampaignForEdit>;
  loadingMyEvents: boolean;
}

/**
 * Composite read: the user's event-campaigns events + their links, joined
 * against the `campaigns` table to build the event→campaign map the page
 * uses for "edit" navigation. Verbatim port of the former `[user?.id]`
 * effect — the service calls are session-scoped; `userId` is only needed
 * for the campaigns sub-query.
 */
async function fetchMyEventCampaigns(userId: string | undefined): Promise<MyEventCampaignsData> {
  const [events, links] = await Promise.all([
    eventsService.getMyEventCampaignsEvents(),
    eventsService.getMyEventCampaignLinks(),
  ]);

  const campaignIds = [...new Set(links.map((l) => l.campaign_id))];
  if (campaignIds.length === 0 || !userId) {
    return { events, eventToCampaign: new Map() };
  }

  const { data: campaignsData, error } = await supabase
    .from('campaigns')
    .select('*, client:clients(id, name)')
    .in('id', campaignIds)
    .eq('user_id', userId);
  if (error || !campaignsData?.length) {
    return { events, eventToCampaign: new Map() };
  }

  const byId = new Map<string, CampaignForEdit>();
  campaignsData.forEach((c) => {
    const camp: CampaignForEdit = {
      id: c.id,
      name: c.name,
      client: c.client?.name || 'N/A',
      client_id: c.client_id,
      category: c.category,
      startDate: new Date(c.start_date),
      endDate: new Date(c.end_date),
      start_date: c.start_date,
      end_date: c.end_date,
      status: c.status,
      views: c.views || 0,
      budget: parseFloat(c.budget) || 0,
      location_lat: c.location_lat,
      location_lng: c.location_lng,
      location_radius: c.location_radius,
      video_id: c.video_id,
      event_id: c.event_id ?? undefined,
      content_validation_status: c.content_validation_status,
      created_at: c.created_at,
      user_id: c.user_id,
    };
    byId.set(c.id, camp);
  });

  const eventToCampaign = new Map<string, CampaignForEdit>();
  links.forEach(({ event_id, campaign_id }) => {
    const camp = byId.get(campaign_id);
    if (camp) eventToCampaign.set(event_id, camp);
  });

  return { events, eventToCampaign };
}

export function useMyEventCampaigns(userId: string | undefined): UseMyEventCampaignsResult {
  const query = useQuery({
    queryKey: eventsKeys.myCampaigns(userId ?? ''),
    queryFn: () => fetchMyEventCampaigns(userId),
  });

  return {
    myEventCampaignsEvents: query.data?.events ?? [],
    eventToCampaign: query.data?.eventToCampaign ?? new Map(),
    loadingMyEvents: query.isLoading,
  };
}
