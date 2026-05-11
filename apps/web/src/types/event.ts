// Types pour le système de gestion des événements spéciaux

export interface SpecialEvent {
  id: string;
  
  // Informations de base
  name: string;
  description?: string;
  event_type: 'concert' | 'sport' | 'festival' | 'conference' | 'exposition' | 'salon' | 'ramadan' | 'culture' | 'autre';
  
  // Dates
  start_date: string;
  end_date: string;
  
  // Localisation
  location: string;
  city: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  
  // Catégorie et visibilité
  category?: 'commercial' | 'cultural' | 'promotional' | 'institutional';
  is_active: boolean;
  is_featured: boolean;
  
  // Audiences
  expected_attendance?: number;
  target_audience?: string;
  
  // Images
  image_url?: string;
  banner_url?: string;
  
  // Tarification
  pricing_multiplier: number;
  priority_level: number;
  
  // Metadata
  created_by?: string;
  created_by_admin?: string;
  created_at: string;
  updated_at: string;
  
  // Stats
  campaigns_count?: number;
  campaign_names?: string;
}

export interface CreateEventDTO {
  name: string;
  description?: string;
  event_type: 'concert' | 'sport' | 'festival' | 'conference' | 'exposition' | 'salon' | 'ramadan' | 'culture' | 'autre';
  start_date: string;
  end_date: string;
  location: string;
  city: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  category?: 'commercial' | 'cultural' | 'promotional' | 'institutional';
  is_active?: boolean;
  is_featured?: boolean;
  expected_attendance?: number;
  target_audience?: string;
  image_url?: string;
  banner_url?: string;
  pricing_multiplier?: number;
  priority_level?: number;
}

export interface EventStats {
  total_events: number;
  active_events: number;
  upcoming_events: number;
  past_events: number;
  featured_events: number;
}

export interface EventCampaign {
  id: string;
  event_id: string;
  campaign_id: string;
  linked_at: string;
  linked_by?: string;
}












































