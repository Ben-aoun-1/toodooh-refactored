import { supabase } from '../lib/supabase';

export interface Campaign {
  id: string;
  name: string;
  client_id: string;
  category: 'commercial' | 'cultural' | 'promotional' | 'institutional';
  start_date: string;
  end_date: string;
  status: 'draft' | 'pending' | 'active' | 'paused' | 'completed' | 'rejected';
  budget: number;
  views: number;
  created_at: string;
  user_id: string;
}

export interface CreateCampaignDTO {
  name: string;
  client_id: string;
  category: Campaign['category'];
  start_date: string;
  end_date: string;
  budget: number;
}

export interface CampaignLocation {
  latitude: number;
  longitude: number;
  radius: number;
}

export interface CampaignMedia {
  url: string;
  filename: string;
}

export const campaignsService = {
  async getAll() {
    const { data, error } = await supabase
      .from('campaigns')
      .select(`
        *,
        client:clients(id, name),
        locations:campaign_locations(*),
        media:campaign_media(*)
      `)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data;
  },

  async getById(id: string) {
    const { data, error } = await supabase
      .from('campaigns')
      .select(`
        *,
        client:clients(id, name),
        locations:campaign_locations(*),
        media:campaign_media(*)
      `)
      .eq('id', id)
      .single();

    if (error) throw error;
    return data;
  },

  async create(campaign: CreateCampaignDTO, location: CampaignLocation, media: CampaignMedia) {
    // Start a transaction by using multiple operations
    const { data: campaignData, error: campaignError } = await supabase
      .from('campaigns')
      .insert([campaign])
      .select()
      .single();

    if (campaignError) throw campaignError;

    // Add location
    const { error: locationError } = await supabase
      .from('campaign_locations')
      .insert([{
        campaign_id: campaignData.id,
        ...location
      }]);

    if (locationError) throw locationError;

    // Add media
    const { error: mediaError } = await supabase
      .from('campaign_media')
      .insert([{
        campaign_id: campaignData.id,
        ...media
      }]);

    if (mediaError) throw mediaError;

    return this.getById(campaignData.id);
  },

  async update(id: string, campaign: Partial<CreateCampaignDTO>) {
    const { data, error } = await supabase
      .from('campaigns')
      .update(campaign)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async updateLocation(campaignId: string, location: CampaignLocation) {
    const { error } = await supabase
      .from('campaign_locations')
      .update(location)
      .eq('campaign_id', campaignId);

    if (error) throw error;
  },

  async updateMedia(campaignId: string, media: CampaignMedia) {
    const { error } = await supabase
      .from('campaign_media')
      .update(media)
      .eq('campaign_id', campaignId);

    if (error) throw error;
  },

  async delete(id: string) {
    const { error } = await supabase
      .from('campaigns')
      .delete()
      .eq('id', id);

    if (error) throw error;
  },

  async updateStatus(id: string, status: Campaign['status']) {
    const { data, error } = await supabase
      .from('campaigns')
      .update({ status })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data;
  },
};