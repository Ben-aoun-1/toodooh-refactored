import { logger } from '../../../lib/logger';
import { supabase } from '../../../lib/supabase';
import { SpecialEvent, CreateEventDTO, EventStats } from '../../events/types/event';

const log = logger.child({ module: 'admin-events.service' });

export const adminEventsService = {
  // Récupérer tous les événements
  async getEvents(): Promise<SpecialEvent[]> {
    try {
      const { data, error } = await supabase
        .from('admin_events_view')
        .select('*')
        .order('start_date', { ascending: false });

      if (error) {
        throw new Error(`Erreur Supabase: ${error.message}`);
      }

      return data || [];
    } catch (error) {
      throw error;
    }
  },

  // Créer un nouvel événement
  async createEvent(eventData: CreateEventDTO, adminId: string): Promise<SpecialEvent | null> {
    try {
      const { data, error } = await supabase
        .from('special_events')
        .insert([
          {
            ...eventData,
            created_by: adminId,
          },
        ])
        .select()
        .single();

      if (error) {
        throw new Error(`Erreur lors de la création: ${error.message}`);
      }

      return data;
    } catch (error) {
      throw error;
    }
  },

  // Mettre à jour un événement
  async updateEvent(eventId: string, eventData: Partial<CreateEventDTO>): Promise<boolean> {
    try {
      const { error } = await supabase.from('special_events').update(eventData).eq('id', eventId);

      if (error) {
        log.error({ error }, '❌ Error updating event');
        return false;
      }

      return true;
    } catch (error) {
      log.error({ error }, '❌ Exception in updateEvent');
      return false;
    }
  },

  // Supprimer un événement
  async deleteEvent(eventId: string): Promise<boolean> {
    try {
      const { error } = await supabase.from('special_events').delete().eq('id', eventId);

      if (error) {
        log.error({ error }, '❌ Error deleting event');
        return false;
      }

      return true;
    } catch (error) {
      log.error({ error }, '❌ Exception in deleteEvent');
      return false;
    }
  },

  // Activer/Désactiver un événement
  async toggleEventStatus(eventId: string, isActive: boolean): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('special_events')
        .update({ is_active: isActive })
        .eq('id', eventId);

      if (error) {
        log.error({ error }, '❌ Error toggling status');
        return false;
      }

      return true;
    } catch (error) {
      log.error({ error }, '❌ Exception in toggleEventStatus');
      return false;
    }
  },

  // Mettre en avant un événement
  async toggleFeatured(eventId: string, isFeatured: boolean): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('special_events')
        .update({ is_featured: isFeatured })
        .eq('id', eventId);

      if (error) {
        log.error({ error }, '❌ Error toggling featured');
        return false;
      }

      return true;
    } catch (error) {
      log.error({ error }, '❌ Exception in toggleFeatured');
      return false;
    }
  },

  // Récupérer les événements mis en avant (pour le dashboard annonceur)
  async getFeaturedEvents(limit = 3): Promise<SpecialEvent[]> {
    try {
      const { data, error } = await supabase
        .from('special_events')
        .select('*')
        .eq('is_featured', true)
        .eq('is_active', true)
        .gte('end_date', new Date().toISOString())
        .order('start_date', { ascending: true })
        .limit(limit);

      if (error) {
        log.error({ error }, '❌ Error fetching featured events');
        return [];
      }
      return data || [];
    } catch (error) {
      log.error({ error }, '❌ Exception in getFeaturedEvents');
      return [];
    }
  },

  // Récupérer les statistiques
  async getStats(): Promise<EventStats> {
    try {
      const { data, error } = await supabase.rpc('get_events_stats');

      if (error) {
        log.error({ error }, '❌ Error fetching stats');
        return {
          total_events: 0,
          active_events: 0,
          upcoming_events: 0,
          past_events: 0,
          featured_events: 0,
        };
      }

      return (
        data[0] || {
          total_events: 0,
          active_events: 0,
          upcoming_events: 0,
          past_events: 0,
          featured_events: 0,
        }
      );
    } catch (error) {
      log.error({ error }, '❌ Exception in getStats');
      return {
        total_events: 0,
        active_events: 0,
        upcoming_events: 0,
        past_events: 0,
        featured_events: 0,
      };
    }
  },

  // Lier un événement à une campagne
  async linkEventToCampaign(
    eventId: string,
    campaignId: string,
    adminId: string,
  ): Promise<boolean> {
    try {
      const { error } = await supabase.from('event_campaigns').insert([
        {
          event_id: eventId,
          campaign_id: campaignId,
          linked_by: adminId,
        },
      ]);

      if (error) {
        log.error({ error }, '❌ Error linking event to campaign');
        return false;
      }

      return true;
    } catch (error) {
      log.error({ error }, '❌ Exception in linkEventToCampaign');
      return false;
    }
  },

  // Délier un événement d'une campagne
  async unlinkEventFromCampaign(eventId: string, campaignId: string): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('event_campaigns')
        .delete()
        .eq('event_id', eventId)
        .eq('campaign_id', campaignId);

      if (error) {
        log.error({ error }, '❌ Error unlinking event from campaign');
        return false;
      }

      return true;
    } catch (error) {
      log.error({ error }, '❌ Exception in unlinkEventFromCampaign');
      return false;
    }
  },
};
