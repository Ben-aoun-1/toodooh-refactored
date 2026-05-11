import { supabase } from '../lib/supabase';
import { SpecialEvent, CreateEventDTO, EventStats } from '../types/event';

export const adminEventsService = {
  // Récupérer tous les événements
  async getEvents(): Promise<SpecialEvent[]> {
    try {
      console.log('🔍 Fetching special events...');

      const { data, error } = await supabase
        .from('admin_events_view')
        .select('*')
        .order('start_date', { ascending: false });

      if (error) {
        console.error('❌ Error fetching events:', error);
        throw new Error(`Erreur Supabase: ${error.message}`);
      }

      console.log('✅ Events fetched successfully:', data?.length || 0, 'events');

      return data || [];
    } catch (error) {
      console.error('❌ Exception in getEvents:', error);
      throw error;
    }
  },

  // Créer un nouvel événement
  async createEvent(eventData: CreateEventDTO, adminId: string): Promise<SpecialEvent | null> {
    try {
      console.log('🔄 Creating special event:', eventData.name);

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
        console.error('❌ Error creating event:', error);
        throw new Error(`Erreur lors de la création: ${error.message}`);
      }

      console.log('✅ Event created successfully:', data.id);
      return data;
    } catch (error) {
      console.error('❌ Exception in createEvent:', error);
      throw error;
    }
  },

  // Mettre à jour un événement
  async updateEvent(eventId: string, eventData: Partial<CreateEventDTO>): Promise<boolean> {
    try {
      console.log('🔄 Updating event:', eventId);

      const { error } = await supabase.from('special_events').update(eventData).eq('id', eventId);

      if (error) {
        console.error('❌ Error updating event:', error);
        return false;
      }

      console.log('✅ Event updated successfully');
      return true;
    } catch (error) {
      console.error('❌ Exception in updateEvent:', error);
      return false;
    }
  },

  // Supprimer un événement
  async deleteEvent(eventId: string): Promise<boolean> {
    try {
      console.log('🗑️ Deleting event:', eventId);

      const { error } = await supabase.from('special_events').delete().eq('id', eventId);

      if (error) {
        console.error('❌ Error deleting event:', error);
        return false;
      }

      console.log('✅ Event deleted successfully');
      return true;
    } catch (error) {
      console.error('❌ Exception in deleteEvent:', error);
      return false;
    }
  },

  // Activer/Désactiver un événement
  async toggleEventStatus(eventId: string, isActive: boolean): Promise<boolean> {
    try {
      console.log('🔄 Toggling event status:', eventId, isActive);

      const { error } = await supabase
        .from('special_events')
        .update({ is_active: isActive })
        .eq('id', eventId);

      if (error) {
        console.error('❌ Error toggling status:', error);
        return false;
      }

      console.log('✅ Status toggled successfully');
      return true;
    } catch (error) {
      console.error('❌ Exception in toggleEventStatus:', error);
      return false;
    }
  },

  // Mettre en avant un événement
  async toggleFeatured(eventId: string, isFeatured: boolean): Promise<boolean> {
    try {
      console.log('🔄 Toggling featured status:', eventId, isFeatured);

      const { error } = await supabase
        .from('special_events')
        .update({ is_featured: isFeatured })
        .eq('id', eventId);

      if (error) {
        console.error('❌ Error toggling featured:', error);
        return false;
      }

      console.log('✅ Featured status toggled successfully');
      return true;
    } catch (error) {
      console.error('❌ Exception in toggleFeatured:', error);
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
        console.error('❌ Error fetching featured events:', error);
        return [];
      }
      return data || [];
    } catch (error) {
      console.error('❌ Exception in getFeaturedEvents:', error);
      return [];
    }
  },

  // Récupérer les statistiques
  async getStats(): Promise<EventStats> {
    try {
      console.log('🔍 Fetching event stats...');

      const { data, error } = await supabase.rpc('get_events_stats');

      if (error) {
        console.error('❌ Error fetching stats:', error);
        return {
          total_events: 0,
          active_events: 0,
          upcoming_events: 0,
          past_events: 0,
          featured_events: 0,
        };
      }

      console.log('✅ Stats fetched successfully');
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
      console.error('❌ Exception in getStats:', error);
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
      console.log('🔄 Linking event to campaign:', { eventId, campaignId });

      const { error } = await supabase.from('event_campaigns').insert([
        {
          event_id: eventId,
          campaign_id: campaignId,
          linked_by: adminId,
        },
      ]);

      if (error) {
        console.error('❌ Error linking event to campaign:', error);
        return false;
      }

      console.log('✅ Event linked to campaign successfully');
      return true;
    } catch (error) {
      console.error('❌ Exception in linkEventToCampaign:', error);
      return false;
    }
  },

  // Délier un événement d'une campagne
  async unlinkEventFromCampaign(eventId: string, campaignId: string): Promise<boolean> {
    try {
      console.log('🔄 Unlinking event from campaign:', { eventId, campaignId });

      const { error } = await supabase
        .from('event_campaigns')
        .delete()
        .eq('event_id', eventId)
        .eq('campaign_id', campaignId);

      if (error) {
        console.error('❌ Error unlinking event from campaign:', error);
        return false;
      }

      console.log('✅ Event unlinked from campaign successfully');
      return true;
    } catch (error) {
      console.error('❌ Exception in unlinkEventFromCampaign:', error);
      return false;
    }
  },
};
