import { supabase } from '../lib/supabase';
import type { SpecialEvent } from '../types/event';

/**
 * Service pour les annonceurs : récupérer les événements mis en avant (dashboard).
 */
export const eventsService = {
  async getFeaturedEvents(limit = 3): Promise<SpecialEvent[]> {
    try {
      const { data, error } = await supabase.rpc('get_featured_events', {
        p_limit: limit
      });

      if (error) {
        console.error('Error fetching featured events:', error);
        return [];
      }
      return (data || []) as SpecialEvent[];
    } catch (err) {
      console.error('Exception getFeaturedEvents:', err);
      return [];
    }
  },

  async getAllEvents(page = 1, pageSize = 9): Promise<{ events: SpecialEvent[]; total: number }> {
    try {
      const offset = (page - 1) * pageSize;
      const [eventsRes, countRes] = await Promise.all([
        supabase.rpc('get_all_events', { p_limit: pageSize, p_offset: offset }),
        supabase.rpc('get_all_events_count')
      ]);
      if (eventsRes.error) {
        console.error('Error fetching all events:', eventsRes.error);
        return { events: [], total: 0 };
      }
      const total = Number(countRes.data ?? 0);
      return { events: (eventsRes.data || []) as SpecialEvent[], total };
    } catch (err) {
      console.error('Exception getAllEvents:', err);
      return { events: [], total: 0 };
    }
  },

  /** Événements sur lesquels l'annonceur a lancé une campagne (type événement). */
  async getMyEventCampaignsEvents(): Promise<SpecialEvent[]> {
    try {
      const { data, error } = await supabase.rpc('get_my_event_campaigns_events');
      if (error) {
        console.error('[Mes événements] RPC get_my_event_campaigns_events a échoué:', error.message, error);
        return [];
      }
      const list = (data || []) as SpecialEvent[];
      return list;
    } catch (err) {
      console.error('[Mes événements] Exception getMyEventCampaignsEvents:', err);
      return [];
    }
  },

  /** Pour chaque événement "mes événements", retourne l’event_id et le campaign_id lié. */
  async getMyEventCampaignLinks(): Promise<{ event_id: string; campaign_id: string }[]> {
    try {
      const { data, error } = await supabase.rpc('get_my_event_campaign_links');
      if (error) {
        console.error('[Mes événements] RPC get_my_event_campaign_links a échoué:', error.message, error);
        return [];
      }
      return (data || []).map((r: { event_id: string; campaign_id: string }) => ({
        event_id: r.event_id,
        campaign_id: r.campaign_id
      }));
    } catch (err) {
      console.error('[Mes événements] Exception getMyEventCampaignLinks:', err);
      return [];
    }
  }
};
