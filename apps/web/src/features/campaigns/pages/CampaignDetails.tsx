import {
  ArrowLeft,
  Calendar,
  MapPin,
  DollarSign,
  Eye,
  BarChart3,
  Clock,
  CheckCircle,
  XCircle,
  AlertCircle,
  Film,
  Building,
} from 'lucide-react';
import { useState, useEffect } from 'react';
import { toast } from 'react-hot-toast';
import { useParams, useNavigate } from 'react-router-dom';

import { supabase } from '../../../lib/supabase';

interface Campaign {
  id: string;
  name: string;
  client?: string;
  category: string;
  start_date: string;
  end_date: string;
  status: string;
  budget: number;
  views: number;
  location_lat?: number;
  location_lng?: number;
  location_radius?: number;
  video_id?: string;
  content_validation_status?: string;
  created_at: string;
  user_id: string;
  selected_categories?: string[];
  selected_zones?: string[];
  validated_impressions?: number;
}

// TODO(phase-1): typed source [supabase] — see #15
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const isMissingCampaignCategoriesTable = (error: any) =>
  error?.code === 'PGRST205' && String(error?.message || '').includes('campaign_categories');

interface Video {
  id: string;
  filename: string;
  url: string;
  duration: number;
  validation_status: string;
}

// TODO(phase-1): typed source [supabase] — see #15
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const statusConfig: Record<string, { label: string; color: string; icon: any }> = {
  draft: { label: 'Brouillon', color: 'bg-gray-100 text-gray-800', icon: AlertCircle },
  pending: { label: 'En attente', color: 'bg-yellow-100 text-yellow-800', icon: Clock },
  active: { label: 'Active', color: 'bg-green-100 text-green-800', icon: CheckCircle },
  completed: { label: 'Terminée', color: 'bg-blue-100 text-blue-800', icon: CheckCircle },
  rejected: { label: 'Rejetée', color: 'bg-red-100 text-red-800', icon: XCircle },
};

export default function CampaignDetails() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [video, setVideo] = useState<Video | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadCampaign();
  }, [id]);

  const loadCampaign = async () => {
    try {
      setLoading(true);

      // Charger la campagne
      const { data: campaignData, error: campaignError } = await supabase
        .from('campaigns')
        .select('*')
        .eq('id', id)
        .single();

      if (campaignError) throw campaignError;

      const [{ data: categoryRows, error: categoryError }] =
        await Promise.all([
          supabase
            .from('campaign_categories')
            .select('category')
            .eq('campaign_id', campaignData.id),
          supabase
            .from('campaign_locations')
            .select('location_id')
            .eq('campaign_id', campaignData.id),
        ]);

      if (categoryError && !isMissingCampaignCategoriesTable(categoryError)) {
        throw categoryError;
      }

      const selectedCategories = (categoryRows || [])
        // TODO(phase-1): typed source [supabase] — see #15
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((row: any) => row.category)
        .filter(Boolean);

      let selectedZones: string[] = [];

      const { data: predefinedZonesRows } = await supabase
        .from('predefined_zones')
        .select('name, latitude, longitude, radius')
        .eq('is_active', true);
      const lat = Number(campaignData?.location_lat);
      const lng = Number(campaignData?.location_lng);
      const radius = Number(campaignData?.location_radius);
      if (Number.isFinite(lat) && Number.isFinite(lng) && Number.isFinite(radius)) {
        const matched = (predefinedZonesRows || []).find(
          // TODO(phase-1): typed source [supabase] — see #15
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (z: any) =>
            Math.abs(Number(z.latitude) - lat) <= 0.0005 &&
            Math.abs(Number(z.longitude) - lng) <= 0.0005 &&
            Math.abs(Number(z.radius) - radius) <= 50,
        );
        if (matched?.name) {
          selectedZones = [matched.name];
        } else {
          selectedZones = ['Grand Tunis'];
        }
      }

      setCampaign({
        ...campaignData,
        selected_categories:
          selectedCategories.length > 0
            ? selectedCategories
            : campaignData.category
              ? [campaignData.category]
              : [],
        selected_zones: Array.from(new Set(selectedZones)),
        validated_impressions: Math.max(0, Number(campaignData.views) || 0),
      });

      // Charger la vidéo si elle existe
      if (campaignData.video_id) {
        const { data: videoData, error: videoError } = await supabase
          .from('videos')
          .select('*')
          .eq('id', campaignData.video_id)
          .single();

        if (!videoError) {
          setVideo(videoData);
        }
      }
    } catch (_error) {
      toast.error('Erreur lors du chargement de la campagne');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-[#00B3A6] mx-auto mb-4"></div>
          <p className="text-gray-600">Chargement de la campagne...</p>
        </div>
      </div>
    );
  }

  if (!campaign) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <AlertCircle className="h-16 w-16 text-gray-300 mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-gray-900 mb-2">Campagne introuvable</h3>
          <p className="text-gray-600 mb-4">Cette campagne n'existe pas ou a été supprimée</p>
          <button
            onClick={() => navigate('/my-campaigns')}
            className="px-4 py-2 bg-[#00B3A6] text-white rounded-lg hover:bg-[#008C82] transition-colors"
          >
            Retour à mes campagnes
          </button>
        </div>
      </div>
    );
  }

  const status = statusConfig[campaign.status] || statusConfig.pending;
  const StatusIcon = status.icon;

  return (
    <div className="min-h-screen bg-white py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-6">
          <button
            onClick={() => navigate('/my-campaigns')}
            className="flex items-center text-gray-600 hover:text-[#00B3A6] transition-colors mb-4"
          >
            <ArrowLeft className="h-5 w-5 mr-2" />
            Retour à mes campagnes
          </button>

          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 mb-2">{campaign.name}</h1>
              <div className="flex items-center space-x-3">
                <span
                  className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${status.color}`}
                >
                  <StatusIcon className="h-4 w-4 mr-1" />
                  {status.label}
                </span>
                <span className="text-sm text-gray-500">
                  Créée le {new Date(campaign.created_at).toLocaleDateString('fr-FR')}
                </span>
              </div>
            </div>

            {campaign.status !== 'active' && (
              <button
                onClick={() => navigate(`/edit-campaign/${campaign.id}`, { state: { campaign } })}
                className="px-4 py-2 bg-[#00B3A6] text-white rounded-lg hover:bg-[#008C82] transition-colors"
              >
                Modifier la campagne
              </button>
            )}
          </div>
        </div>

        {/* Main Content */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column - Main Info */}
          <div className="lg:col-span-2 space-y-6">
            {/* Informations générales */}
            <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-100">
              <h2 className="text-xl font-bold text-gray-900 mb-4">Informations générales</h2>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {campaign.client && (
                  <div className="flex items-start space-x-3">
                    <Building className="h-5 w-5 text-[#00B3A6] mt-1" />
                    <div>
                      <p className="text-sm text-gray-500">Client</p>
                      <p className="font-medium text-gray-900">{campaign.client}</p>
                    </div>
                  </div>
                )}

                <div className="flex items-start space-x-3">
                  <BarChart3 className="h-5 w-5 text-[#00B3A6] mt-1" />
                  <div>
                    <p className="text-sm text-gray-500">Catégories</p>
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {(campaign.selected_categories || []).length > 0 ? (
                        (campaign.selected_categories || []).map((cat) => (
                          <span
                            key={cat}
                            className="inline-flex px-2 py-0.5 rounded bg-gray-100 text-gray-700 text-xs"
                          >
                            {cat}
                          </span>
                        ))
                      ) : (
                        <p className="font-medium text-gray-900">—</p>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-start space-x-3">
                  <Calendar className="h-5 w-5 text-[#00B3A6] mt-1" />
                  <div>
                    <p className="text-sm text-gray-500">Date de début</p>
                    <p className="font-medium text-gray-900">
                      {new Date(campaign.start_date).toLocaleDateString('fr-FR')}
                    </p>
                  </div>
                </div>

                <div className="flex items-start space-x-3">
                  <Calendar className="h-5 w-5 text-[#00B3A6] mt-1" />
                  <div>
                    <p className="text-sm text-gray-500">Date de fin</p>
                    <p className="font-medium text-gray-900">
                      {new Date(campaign.end_date).toLocaleDateString('fr-FR')}
                    </p>
                  </div>
                </div>

                <div className="flex items-start space-x-3">
                  <Clock className="h-5 w-5 text-[#00B3A6] mt-1" />
                  <div>
                    <p className="text-sm text-gray-500">Durée</p>
                    <p className="font-medium text-gray-900">
                      {Math.ceil(
                        (new Date(campaign.end_date).getTime() -
                          new Date(campaign.start_date).getTime()) /
                          (1000 * 60 * 60 * 24),
                      )}{' '}
                      jours
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Localisation */}
            {(campaign.location_lat && campaign.location_lng) ||
            (campaign.selected_zones && campaign.selected_zones.length > 0) ? (
              <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-100">
                <h2 className="text-xl font-bold text-gray-900 mb-4">Zone géographique</h2>

                <div className="flex items-start space-x-3">
                  <MapPin className="h-5 w-5 text-[#00B3A6] mt-1" />
                  <div>
                    <p className="text-sm text-gray-500">Zones sélectionnées</p>
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {(campaign.selected_zones || []).length > 0 ? (
                        (campaign.selected_zones || []).map((zone) => (
                          <span
                            key={zone}
                            className="inline-flex px-2 py-0.5 rounded bg-gray-100 text-gray-700 text-xs"
                          >
                            {zone}
                          </span>
                        ))
                      ) : (
                        <p className="font-medium text-gray-900">—</p>
                      )}
                    </div>
                    {campaign.location_lat && campaign.location_lng && (
                      <p className="text-xs text-gray-500 mt-2">
                        Coordonnées centre: {campaign.location_lat.toFixed(6)},{' '}
                        {campaign.location_lng.toFixed(6)}
                      </p>
                    )}
                    {campaign.location_radius && (
                      <p className="text-sm text-gray-600 mt-1">
                        Rayon: {(campaign.location_radius / 1000).toFixed(1)} km
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ) : null}

            {/* Vidéo */}
            {video && (
              <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-100">
                <h2 className="text-xl font-bold text-gray-900 mb-4">Contenu média</h2>

                <div className="space-y-3">
                  <div className="flex items-start space-x-3">
                    <Film className="h-5 w-5 text-[#00B3A6] mt-1" />
                    <div>
                      <p className="text-sm text-gray-500">Fichier vidéo</p>
                      <p className="font-medium text-gray-900">{video.filename}</p>
                      <p className="text-sm text-gray-600 mt-1">Durée: {video.duration}s</p>
                    </div>
                  </div>

                  {video.url && (
                    <video src={video.url} controls className="w-full rounded-lg">
                      Votre navigateur ne supporte pas la lecture de vidéos.
                    </video>
                  )}

                  <div className="flex items-center space-x-2">
                    <span className="text-sm text-gray-600">Statut de validation:</span>
                    <span
                      className={`px-2 py-1 rounded-full text-xs font-medium ${
                        video.validation_status === 'approved'
                          ? 'bg-green-100 text-green-800'
                          : video.validation_status === 'rejected'
                            ? 'bg-red-100 text-red-800'
                            : 'bg-yellow-100 text-yellow-800'
                      }`}
                    >
                      {video.validation_status === 'approved'
                        ? 'Approuvée'
                        : video.validation_status === 'rejected'
                          ? 'Rejetée'
                          : 'En attente'}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Right Column - Stats */}
          <div className="space-y-6">
            {/* Budget */}
            <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-100">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-gray-600">Budget total</span>
                <DollarSign className="h-5 w-5 text-[#00B3A6]" />
              </div>
              <p className="text-3xl font-bold text-[#00B3A6]">
                {campaign.budget.toLocaleString()} TND
              </p>
            </div>

            {/* Impressions validées */}
            <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-100">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-gray-600">Impressions validées</span>
                <Eye className="h-5 w-5 text-[#00B3A6]" />
              </div>
              <p className="text-3xl font-bold text-gray-900">
                {(campaign.validated_impressions || 0).toLocaleString('fr-FR')}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
