// Types pour le système de validation des vidéos
// Règle: 1 campagne = 1 vidéo, 1 vidéo peut être dans plusieurs campagnes

export interface Video {
  id: string;
  url: string;
  filename: string;
  file_size?: number;
  duration?: number;
  thumbnail_url?: string;
  
  // Validation
  validation_status: 'pending' | 'approved' | 'rejected';
  validated_by?: string;
  validated_at?: string;
  validation_notes?: string;
  
  // Metadata
  uploaded_by: string;
  uploaded_by_business?: string;
  uploaded_by_contact?: string;
  uploaded_by_email?: string;
  created_at: string;
  updated_at: string;
  
  // Stats
  campaigns_count?: number;
  campaign_names?: string;
  validated_by_admin?: string;
}

export interface VideoValidationStats {
  total_videos: number;
  pending_videos: number;
  approved_videos: number;
  rejected_videos: number;
}

export interface CampaignUsingVideo {
  campaign_id: string;
  campaign_name: string;
  campaign_status: string;
  advertiser_name: string;
}

export interface VideoWithCampaigns extends Video {
  campaigns: CampaignUsingVideo[];
}

export interface ValidateVideoData {
  video_id: string;
  validation_status: 'approved' | 'rejected';
  validation_notes?: string;
  validated_by: string;
}
