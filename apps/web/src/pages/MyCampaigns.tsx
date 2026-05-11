import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { 
  Eye, 
  Edit2, 
  Search, 
  Filter, 
  ChevronLeft, 
  ChevronRight, 
  Calendar,
  TrendingUp,
  DollarSign,
  Users,
  MoreVertical,
  Plus,
  BarChart3,
  Megaphone,
  Film,
  X,
  MapPin,
  Rocket,
  RotateCcw,
  Crosshair,
  Monitor,
  Trash2
} from 'lucide-react';
import DatePicker from 'react-datepicker';
import "react-datepicker/dist/react-datepicker.css";
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../stores/auth.store';
import { toast } from 'react-hot-toast';
import { balanceService } from '../services/balance.service';
import { campaignService } from '../services/campaign.service';
import campagneIcon from '../assets/sidebar/campagnes.png';

const isMissingCampaignCategoriesTable = (error: any) =>
  error?.code === 'PGRST205' &&
  String(error?.message || '').includes('campaign_categories');

// Test data
const testCampaigns = [
  {
    id: 1,
    name: "Promotion d'été 2024",
    client: "Carrefour Tunisie",
    category: "Publicité commerciale",
    startDate: new Date(2024, 5, 1),
    endDate: new Date(2024, 8, 30),
    status: "active",
    views: 15420,
    budget: 5000
  },
  {
    id: 2,
    name: "Festival de Carthage",
    client: "Ministère de la Culture",
    category: "Événement culturel",
    startDate: new Date(2024, 6, 15),
    endDate: new Date(2024, 7, 15),
    status: "en attente",
    views: 0,
    budget: 8000
  },
  {
    id: 3,
    name: "Ramadan 2024",
    client: "Monoprix",
    category: "Promotion spéciale",
    startDate: new Date(2024, 2, 1),
    endDate: new Date(2024, 3, 15),
    status: "terminée",
    views: 45200,
    budget: 12000
  },
  {
    id: 4,
    name: "Rentrée Scolaire",
    client: "Librairie Al-Kitab",
    category: "Publicité commerciale",
    startDate: new Date(2024, 8, 1),
    endDate: new Date(2024, 9, 30),
    status: "en attente",
    views: 0,
    budget: 3500
  },
  {
    id: 5,
    name: "Black Friday",
    client: "Jumia Tunisie",
    category: "Promotion spéciale",
    startDate: new Date(2024, 10, 20),
    endDate: new Date(2024, 10, 27),
    status: "planifiée",
    views: 0,
    budget: 15000
  },
  {
    id: 6,
    name: "Fête de l'Aid",
    client: "Géant",
    category: "Promotion spéciale",
    startDate: new Date(2024, 5, 15),
    endDate: new Date(2024, 6, 15),
    status: "active",
    views: 8750,
    budget: 7500
  },
  {
    id: 7,
    name: "Exposition d'Art",
    client: "Galerie Kalysté",
    category: "Événement culturel",
    startDate: new Date(2024, 3, 1),
    endDate: new Date(2024, 3, 30),
    status: "terminée",
    views: 12300,
    budget: 4000
  }
];

type CampaignStatus = 'active' | 'en attente' | 'terminée' | 'planifiée';

const statusConfig = {
  active: {
    color: "bg-green-100 text-green-800",
    gradient: "from-green-500 to-emerald-500",
    icon: TrendingUp
  },
  "en attente": {
    color: "bg-yellow-100 text-yellow-800",
    gradient: "from-yellow-500 to-orange-500",
    icon: Calendar
  },
  terminée: {
    color: "bg-gray-100 text-gray-800",
    gradient: "from-gray-500 to-slate-500",
    icon: BarChart3
  },
  planifiée: {
    color: "bg-blue-100 text-blue-800",
    gradient: "from-blue-500 to-cyan-500",
    icon: Calendar
  }
};

interface Filters {
  client: string;
  category: string;
  status: string;
  campaignType: '' | 'campaign' | 'event';
  startDate: Date | null;
  endDate: Date | null;
}

export default function MyCampaigns() {
  const navigate = useNavigate();
  const location = useLocation();
  const user = useAuthStore(state => state.user);
  const [currentPage, setCurrentPage] = useState(1);
  const [filters, setFilters] = useState<Filters>({
    client: "",
    category: "",
    status: "",
    campaignType: "",
    startDate: null,
    endDate: null
  });

  // Appliquer le filtre statut depuis l'URL (?status=completed ou ?status=draft)
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const statusParam = params.get('status');
    if (statusParam === 'completed' || statusParam === 'draft') {
      setFilters(prev => ({ ...prev, status: statusParam }));
      setCurrentPage(1);
    }
  }, [location.search]);
  const [showFilters, setShowFilters] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    totalCampaigns: 0,
    activeCampaigns: 0,
    totalViews: 0,
    totalBudget: 0
  });

  const itemsPerPage = 6;

  // Charger les campagnes réelles
  useEffect(() => {
    const loadCampaigns = async () => {
      if (!user?.id) return;

      try {
        setLoading(true);
        
        // Récupérer les campagnes de l'utilisateur avec les clients
        const { data: campaignsData, error } = await supabase
          .from('campaigns')
          .select(`
            *,
            client:clients(id, name)
          `)
          .eq('user_id', user.id)
          .order('created_at', { ascending: false });

        if (error) {
          console.error('Error fetching campaigns:', error);
          toast.error('Erreur lors du chargement des campagnes');
          return;
        }

        const campaignIds = (campaignsData || []).map((c) => c.id).filter(Boolean);
        const categoriesByCampaign = new Map<string, string[]>();
        const zonesByCampaign = new Map<string, string[]>();

        if (campaignIds.length > 0) {
          const [{ data: categoryRows, error: categoryError }, { data: predefinedZonesRows }] = await Promise.all([
            supabase
              .from('campaign_categories')
              .select('campaign_id, category')
              .in('campaign_id', campaignIds),
            supabase
              .from('predefined_zones')
              .select('name, latitude, longitude, radius')
              .eq('is_active', true),
          ]);

          if (categoryError && !isMissingCampaignCategoriesTable(categoryError)) {
            console.error('Error fetching campaign categories:', categoryError);
          }

          (categoryRows || []).forEach((row: any) => {
            if (!row?.campaign_id || !row?.category) return;
            const prev = categoriesByCampaign.get(row.campaign_id) || [];
            if (!prev.includes(row.category)) prev.push(row.category);
            categoriesByCampaign.set(row.campaign_id, prev);
          });

          (campaignsData || []).forEach((c: any) => {
            const lat = Number(c?.location_lat);
            const lng = Number(c?.location_lng);
            const radius = Number(c?.location_radius);
            if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(radius)) return;
            const matched = (predefinedZonesRows || []).find((z: any) =>
              Math.abs(Number(z.latitude) - lat) <= 0.0005 &&
              Math.abs(Number(z.longitude) - lng) <= 0.0005 &&
              Math.abs(Number(z.radius) - radius) <= 50
            );
            if (matched?.name) {
              zonesByCampaign.set(c.id, [matched.name]);
            } else {
              zonesByCampaign.set(c.id, ['Grand Tunis']);
            }
          });

        }

        // Transformer les données pour correspondre au format attendu
        const transformedCampaigns = campaignsData?.map(c => ({
          selected_categories: categoriesByCampaign.get(c.id) || (c.category ? [c.category] : []),
          selected_zones: zonesByCampaign.get(c.id) || [],
          validated_impressions: Math.max(0, Number(c.views) || 0),
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
          user_id: c.user_id
        })) || [];

        console.log('✅ Campaigns loaded:', transformedCampaigns.length);
        console.log('Campaigns data:', transformedCampaigns);
        
        setCampaigns(transformedCampaigns);

        // Calculer les statistiques
        const totalCampaigns = transformedCampaigns.length;
        const activeCampaigns = transformedCampaigns.filter(c => c.status === 'active').length;
        const totalViews = transformedCampaigns.reduce((sum, c) => sum + c.views, 0);
        const totalBudget = transformedCampaigns.reduce((sum, c) => sum + c.budget, 0);

        console.log('Stats calculated:', { totalCampaigns, activeCampaigns, totalViews, totalBudget });

        setStats({
          totalCampaigns,
          activeCampaigns,
          totalViews,
          totalBudget
        });

      } catch (error) {
        console.error('Error loading campaigns:', error);
        toast.error('Erreur lors du chargement');
      } finally {
        setLoading(false);
      }
    };

    loadCampaigns();
  }, [user]);

  // Filter campaigns (status '' = all, 'upcoming' = startDate > now)
  const nowForFilter = new Date();
  const filteredCampaigns = campaigns.filter(campaign => {
    try {
      const statusMatch =
        !filters.status
          ? true
          : filters.status === 'upcoming'
            ? campaign.startDate > nowForFilter
            : campaign.status === filters.status;
      const typeMatch =
        !filters.campaignType
          ? true
          : filters.campaignType === 'event'
            ? Boolean(campaign.event_id)
            : !campaign.event_id;
      return (
        (!filters.client || campaign.client?.toLowerCase().includes(filters.client.toLowerCase())) &&
        (!filters.category || campaign.category === filters.category) &&
        statusMatch &&
        typeMatch &&
        (!filters.startDate || (campaign.startDate >= filters.startDate)) &&
        (!filters.endDate || (campaign.endDate <= filters.endDate))
      );
    } catch (error) {
      console.error('Error filtering campaign:', error, campaign);
      return true;
    }
  });

  // Calculate pagination
  const totalPages = Math.max(1, Math.ceil(filteredCampaigns.length / itemsPerPage));
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedCampaigns = filteredCampaigns.slice(startIndex, startIndex + itemsPerPage);

  const uniqueCategories = campaigns.length > 0
    ? [...new Set(campaigns.flatMap(c => (c.selected_categories?.length ? c.selected_categories : [c.category])).filter(Boolean))]
    : [];
  const uniqueStatuses = campaigns.length > 0 ? [...new Set(campaigns.map(c => c.status).filter(Boolean))] : [];

  // État pour le modal de consultation
  const [selectedCampaign, setSelectedCampaign] = useState<any>(null);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [campaignVideo, setCampaignVideo] = useState<any>(null);
  const [openActionRowId, setOpenActionRowId] = useState<string | null>(null);
  const [drawerVisible, setDrawerVisible] = useState(false);

  // Animation du panneau droit : ouvrir après le montage, fermer avant le démontage
  useEffect(() => {
    if (showDetailsModal) {
      const t = requestAnimationFrame(() => setDrawerVisible(true));
      return () => cancelAnimationFrame(t);
    }
    setDrawerVisible(false);
  }, [showDetailsModal]);

  const closeDetailsDrawer = () => {
    setDrawerVisible(false);
    setTimeout(() => {
      setShowDetailsModal(false);
      setSelectedCampaign(null);
      setCampaignVideo(null);
    }, 300);
  };

  // Fonction pour consulter une campagne
  const handleViewCampaign = async (campaign: any) => {
    console.log('📋 Consultation de la campagne:', campaign);
    setSelectedCampaign(campaign);
    
    // Charger la vidéo si elle existe
    if (campaign.video_id) {
      try {
        const { data: videoData } = await supabase
          .from('videos')
          .select('*')
          .eq('id', campaign.video_id)
          .single();
        
        setCampaignVideo(videoData);
      } catch (error) {
        console.error('Erreur chargement vidéo:', error);
      }
    } else {
      setCampaignVideo(null);
    }
    
    setShowDetailsModal(true);
  };

  // Fonction pour modifier une campagne
  const handleEditCampaign = (campaign: any) => {
    console.log('✏️ Modification de la campagne:', campaign);
    
    // Vérifier si la campagne peut être modifiée
    if (campaign.status === 'active') {
      toast.error('Impossible de modifier une campagne active', {
        duration: 4000,
        icon: '🔒',
      });
      return;
    }
    
    // Rediriger vers la page de nouvelle campagne avec les données de la campagne
    navigate('/new-campaign', { state: { editMode: true, campaign } });
  };

  const canDeleteDraftCampaign = (status: string) => status === 'draft';

  const handleDeleteDraftCampaign = async (campaign: any) => {
    if (!canDeleteDraftCampaign(campaign.status)) return;
    const confirmed = window.confirm(`Supprimer définitivement le brouillon "${campaign.name || 'Sans nom'}" ?`);
    if (!confirmed) return;

    try {
      const { error } = await supabase
        .from('campaigns')
        .delete()
        .eq('id', campaign.id)
        .eq('user_id', user?.id)
        .eq('status', 'draft');

      if (error) {
        console.error('Erreur suppression brouillon:', error);
        toast.error('Impossible de supprimer ce brouillon');
        return;
      }

      setCampaigns((prev) => prev.filter((c) => c.id !== campaign.id));
      setOpenActionRowId((prev) => (prev === campaign.id ? null : prev));
      if (selectedCampaign?.id === campaign.id) {
        closeDetailsDrawer();
      }
      toast.success('Brouillon supprimé');
    } catch (e) {
      console.error('Erreur suppression brouillon:', e);
      toast.error('Erreur lors de la suppression du brouillon');
    }
  };

  const handleActivateDraftCampaign = async (campaign: any) => {
    if (campaign.status !== 'draft') return;
    if (!user?.id) {
      toast.error('Utilisateur non connecté');
      return;
    }

    try {
      const balanceCheck = await balanceService.checkCampaignBalance(campaign.id);
      const hasSufficientBalance = Boolean(balanceCheck?.has_sufficient_balance);
      const insufficientMessage =
        balanceCheck?.message || 'Solde insuffisant pour activer la campagne.';

      let videoIsValidated = campaign.content_validation_status === 'approved';
      if (!videoIsValidated && campaign.video_id) {
        const { data: video } = await supabase
          .from('videos')
          .select('validation_status')
          .eq('id', campaign.video_id)
          .single();
        videoIsValidated = video?.validation_status === 'approved';
      }

      const isMissingValidationNotesColumn = (error: any) =>
        error?.code === 'PGRST204' && String(error?.message || '').includes('validation_notes');

      if (!hasSufficientBalance) {
        let { error: updateDraftError } = await supabase
          .from('campaigns')
          .update({
            status: 'draft',
            content_validation_status: 'pending',
            validation_notes: insufficientMessage
          })
          .eq('id', campaign.id)
          .eq('user_id', user.id);

        if (isMissingValidationNotesColumn(updateDraftError)) {
          const { error: fallbackError } = await supabase
            .from('campaigns')
            .update({
              status: 'draft',
              content_validation_status: 'pending'
            })
            .eq('id', campaign.id)
            .eq('user_id', user.id);
          updateDraftError = fallbackError;
        }

        if (updateDraftError) {
          toast.error('Impossible de mettre à jour la campagne');
          return;
        }

        setCampaigns((prev) =>
          prev.map((c) =>
            c.id === campaign.id
              ? {
                  ...c,
                  status: 'draft',
                  content_validation_status: 'pending'
                }
              : c
          )
        );
        toast.error('Solde insuffisant pour activer la campagne');
        setTimeout(() => navigate('/my-recharges'), 1200);
        return;
      }

      const nextStatus = videoIsValidated ? 'active' : 'pending';
      let { error: updateError } = await supabase
        .from('campaigns')
        .update({
          status: nextStatus,
          content_validation_status: videoIsValidated ? 'approved' : 'pending',
          validation_notes: null
        })
        .eq('id', campaign.id)
        .eq('user_id', user.id);

      if (isMissingValidationNotesColumn(updateError)) {
        const { error: fallbackError } = await supabase
          .from('campaigns')
          .update({
            status: nextStatus,
            content_validation_status: videoIsValidated ? 'approved' : 'pending'
          })
          .eq('id', campaign.id)
          .eq('user_id', user.id);
        updateError = fallbackError;
      }

      if (updateError) {
        toast.error('Impossible d\'activer ce brouillon');
        return;
      }

      if (nextStatus === 'active') {
        await campaignService.injectCampaignPublicationSchedule(campaign.id);
      }

      setCampaigns((prev) =>
        prev.map((c) =>
          c.id === campaign.id
            ? {
                ...c,
                status: nextStatus,
                content_validation_status: videoIsValidated ? 'approved' : 'pending'
              }
            : c
        )
      );
      if (selectedCampaign?.id === campaign.id) {
        setSelectedCampaign((prev: any) =>
          prev
            ? {
                ...prev,
                status: nextStatus,
                content_validation_status: videoIsValidated ? 'approved' : 'pending'
              }
            : prev
        );
      }

      if (nextStatus === 'active') toast.success('Campagne activée avec succès');
      else toast('Campagne en attente de validation vidéo admin', { icon: '⏳' });
    } catch (error) {
      console.error('Erreur activation brouillon:', error);
      toast.error('Erreur lors de l\'activation du brouillon');
    }
  };

  // Vérifier si une campagne peut être modifiée
  const canEditCampaign = (status: string) => {
    return status !== 'active';
  };

  // Compteurs par statut pour le bloc 7 widgets (Tout, Active, A venir, Brouillons, En attente, Non validé, Passées)
  const now = new Date();
  const countTout = campaigns.length;
  const countActive = campaigns.filter(c => c.status === 'active').length;
  const countAVenir = campaigns.filter(c => c.startDate > now).length;
  const countBrouillons = campaigns.filter(c => c.status === 'draft').length;
  const countEnAttente = campaigns.filter(c => c.status === 'pending').length;
  const countNonValide = campaigns.filter(c => c.status === 'rejected').length;
  const countPassees = campaigns.filter(c => c.status === 'completed').length;

  const statusWidgets = [
    { label: 'Tout', value: '' as const, count: countTout, bg: 'bg-white', border: 'border border-[#EBEBEB]', titleColor: 'text-[#5C5C5C]', rounded: 'rounded-xl' },
    { label: 'Active', value: 'active' as const, count: countActive, bg: 'bg-[#E3F7EC]', border: '', titleColor: 'text-[#1FC16B]', rounded: 'rounded-md' },
    { label: 'A venir', value: 'upcoming' as const, count: countAVenir, bg: 'bg-[#EBF1FF]', border: '', titleColor: 'text-[#335CFF]', rounded: 'rounded-md' },
    { label: 'Brouillons', value: 'draft' as const, count: countBrouillons, bg: 'bg-[#FFFAEB]', border: '', titleColor: 'text-[#F6B51E]', rounded: 'rounded-md' },
    { label: 'En attente', value: 'pending' as const, count: countEnAttente, bg: 'bg-[#FFF3EB]', border: '', titleColor: 'text-[#FA7319]', rounded: 'rounded-md' },
    { label: 'Non validé', value: 'rejected' as const, count: countNonValide, bg: 'bg-[#FFEBEC]', border: '', titleColor: 'text-[#FB3748]', rounded: 'rounded-md' },
    { label: 'Passées', value: 'completed' as const, count: countPassees, bg: 'bg-[#F5F5F5]', border: '', titleColor: 'text-[#5C5C5C]', rounded: 'rounded-md' },
  ];

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      {/* Bloc statistiques par statut (7 widgets) – cliquables = filtres sur la liste */}
      <div className="flex flex-row flex-wrap items-stretch gap-4">
        {statusWidgets.map((w, i) => {
          const isSelected = filters.status === w.value;
          return (
            <button
              key={w.label}
              type="button"
              onClick={() => setFilters((f) => ({ ...f, status: w.value }))}
              className={`box-border flex min-h-[92px] flex-1 min-w-[100px] flex-shrink-0 flex-col items-start justify-start p-4 gap-2 text-left transition-all ${w.bg} ${w.border} ${w.rounded} ${isSelected ? 'ring-2 ring-[#76E6AB] ring-offset-2' : 'hover:opacity-95'}`}
              style={i === 0 ? { boxShadow: '0px 1px 2px rgba(10, 13, 20, 0.0313726)' } : {}}
            >
              <span className={`text-sm font-medium leading-5 ${w.titleColor}`} style={{ letterSpacing: '-0.006em' }}>
                {w.label}
              </span>
              <span className="text-2xl font-medium leading-8 text-[#171717] tabular-nums">
                {loading ? '...' : w.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Header Section */}
      <div className="bg-white rounded-xl p-6 border border-gray-200">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold mb-1 text-[#171717]">Mes campagnes</h1>
            <p className="text-sm font-normal text-[#5C5C5C]">Gérez vos campagnes actives</p>
          </div>
          <button 
            onClick={() => navigate('/new-campaign')}
            className="bg-[#76E6AB] text-[#171717] rounded-lg px-5 py-2.5 font-medium hover:opacity-90 transition-opacity flex items-center gap-2"
          >
            <Plus className="h-5 w-5" />
            <span>Lancer une nouvelle campagne</span>
          </button>
        </div>

        {/* Barre filtres : onglets statut alignés avec recherche + vues */}
        <div className="flex flex-col lg:flex-row lg:items-stretch gap-3 lg:gap-4">
          {/* Onglets statut (même hauteur que la recherche, une seule ligne) */}
          <div className="flex flex-nowrap items-center gap-0.5 p-0.5 rounded-lg bg-[#F5F5F5] min-h-[40px] box-border shrink-0 overflow-x-auto">
            {[
              { label: 'Tous', value: '' },
              { label: 'Actives', value: 'active' },
              { label: 'Programmées', value: 'pending' },
              { label: 'Brouillons', value: 'draft' },
              { label: 'Passées', value: 'completed' },
            ].map(({ label, value }) => (
              <button
                key={value || 'all'}
                type="button"
                onClick={() => setFilters((f) => ({ ...f, status: value }))}
                className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors h-7 flex items-center whitespace-nowrap ${
                  filters.status === value
                    ? 'bg-white text-[#171717]'
                    : 'bg-transparent text-[#5C5C5C] hover:text-[#171717]'
                }`}
                style={{ lineHeight: '16px' }}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 flex-1 lg:flex-initial lg:min-w-0 lg:min-h-[40px]">
            <div className="relative flex-1 min-w-0 max-w-sm h-10">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#5C5C5C]" />
              <input
                type="text"
                placeholder="Rechercher.."
                className="w-full h-full pl-9 pr-3 py-2.5 text-sm border border-[#EBEBEB] rounded-md bg-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#76E6AB]/30 focus:border-[#76E6AB]"
                onChange={(e) => setFilters({ ...filters, client: e.target.value })}
              />
            </div>
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`h-10 px-3 rounded-md font-medium transition-colors flex items-center gap-1.5 text-sm shrink-0 ${
                showFilters ? 'bg-white border border-[#EBEBEB] text-[#171717]' : 'bg-[#F5F5F5] text-[#5C5C5C] hover:bg-[#EBEBEB]'
              }`}
              title="Filtres avancés"
            >
              <Filter className="h-4 w-4" />
              <span className="hidden sm:inline">Filtres</span>
            </button>
          </div>

          {/* Boutons vue grille / liste : alignés à droite de la ligne, espacés du bouton Filtres */}
          <div className="flex items-center gap-1 shrink-0 self-center lg:self-stretch lg:items-center lg:ml-auto lg:pl-4">
            <button
              type="button"
              onClick={() => setViewMode('grid')}
              className={`h-10 w-10 flex items-center justify-center rounded-md transition-colors ${
                viewMode === 'grid'
                  ? 'bg-white border border-[#EBEBEB] text-[#5C5C5C]'
                  : 'bg-[#F5F5F5] text-[#5C5C5C] hover:bg-[#EBEBEB]'
              }`}
              title="Vue grille"
            >
              <div className="grid grid-cols-2 gap-0.5 w-4 h-4">
                <div className="bg-current rounded-sm opacity-80" />
                <div className="bg-current rounded-sm opacity-80" />
                <div className="bg-current rounded-sm opacity-80" />
                <div className="bg-current rounded-sm opacity-80" />
              </div>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('list')}
              className={`h-10 w-10 flex items-center justify-center rounded-md transition-colors ${
                viewMode === 'list'
                  ? 'bg-white border border-[#EBEBEB] text-[#5C5C5C]'
                  : 'bg-[#F5F5F5] text-[#5C5C5C] hover:bg-[#EBEBEB]'
              }`}
              title="Vue liste"
            >
              <div className="space-y-1 w-4 h-4 flex flex-col justify-center">
                <div className="bg-current rounded-sm h-0.5 w-full opacity-80" />
                <div className="bg-current rounded-sm h-0.5 w-full opacity-80" />
                <div className="bg-current rounded-sm h-0.5 w-full opacity-80" />
              </div>
            </button>
          </div>
        </div>

        {/* Filtres avancés (harmonisé avec la barre) */}
        {showFilters && (
          <div className="mt-5 pt-5 border-t border-[#EBEBEB]">
            <p className="text-sm font-medium text-[#5C5C5C] mb-4">Filtres avancés</p>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium text-[#5C5C5C] mb-1.5">Type</label>
                <select
                  className="w-full h-10 px-3 text-sm border border-[#EBEBEB] rounded-md bg-white text-[#171717] focus:outline-none focus:ring-2 focus:ring-[#76E6AB]/30 focus:border-[#76E6AB] transition-colors"
                  value={filters.campaignType}
                  onChange={(e) => setFilters({ ...filters, campaignType: e.target.value as '' | 'campaign' | 'event' })}
                >
                  <option value="">Tous les types</option>
                  <option value="campaign">Campagne</option>
                  <option value="event">Événement</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-[#5C5C5C] mb-1.5">Catégorie</label>
                <select
                  className="w-full h-10 px-3 text-sm border border-[#EBEBEB] rounded-md bg-white text-[#171717] focus:outline-none focus:ring-2 focus:ring-[#76E6AB]/30 focus:border-[#76E6AB] transition-colors"
                  value={filters.category}
                  onChange={(e) => setFilters({ ...filters, category: e.target.value })}
                >
                  <option value="">Toutes les catégories</option>
                  {uniqueCategories.map(category => (
                    <option key={category} value={category}>{category}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-[#5C5C5C] mb-1.5">Statut</label>
                <select
                  className="w-full h-10 px-3 text-sm border border-[#EBEBEB] rounded-md bg-white text-[#171717] focus:outline-none focus:ring-2 focus:ring-[#76E6AB]/30 focus:border-[#76E6AB] transition-colors"
                  value={filters.status}
                  onChange={(e) => setFilters({ ...filters, status: e.target.value })}
                >
                  <option value="">Tous les statuts</option>
                  {uniqueStatuses.map(status => (
                    <option key={status} value={status}>{status}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-[#5C5C5C] mb-1.5">Date de début</label>
                <DatePicker
                  selected={filters.startDate}
                  onChange={(date: Date | null) => setFilters({ ...filters, startDate: date })}
                  className="w-full h-10 px-3 text-sm border border-[#EBEBEB] rounded-md bg-white text-[#171717] focus:outline-none focus:ring-2 focus:ring-[#76E6AB]/30 focus:border-[#76E6AB]"
                  dateFormat="dd/MM/yyyy"
                  placeholderText="Sélectionner"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[#5C5C5C] mb-1.5">Date de fin</label>
                <DatePicker
                  selected={filters.endDate}
                  onChange={(date: Date | null) => setFilters({ ...filters, endDate: date })}
                  className="w-full h-10 px-3 text-sm border border-[#EBEBEB] rounded-md bg-white text-[#171717] focus:outline-none focus:ring-2 focus:ring-[#76E6AB]/30 focus:border-[#76E6AB]"
                  dateFormat="dd/MM/yyyy"
                  placeholderText="Sélectionner"
                />
              </div>
            </div>
            <div className="mt-4 flex justify-end">
              <button
                onClick={() => setFilters({
                  client: "",
                  category: "",
                  status: "",
                  campaignType: "",
                  startDate: null,
                  endDate: null
                })}
                className="h-9 px-4 rounded-md text-sm font-medium text-[#5C5C5C] bg-[#F5F5F5] hover:bg-[#EBEBEB] border border-[#EBEBEB] transition-colors"
              >
                Réinitialiser les filtres
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Campaigns Display */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="text-center">
            <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-[#00B3A6] mx-auto mb-4"></div>
            <p className="text-gray-600">Chargement des campagnes...</p>
          </div>
        </div>
      ) : paginatedCampaigns.length === 0 ? (
        <div className="bg-white rounded-xl p-12 shadow-sm border border-gray-200 text-center">
          <img src={campagneIcon} alt="" className="h-16 w-16 mx-auto mb-4 object-contain opacity-40" />
          <h3 className="text-xl font-semibold text-gray-900 mb-2">Aucune campagne trouvée</h3>
          <p className="text-gray-600 mb-6">Commencez par créer votre première campagne publicitaire</p>
          <button
            onClick={() => navigate('/new-campaign')}
            className="px-6 py-3 bg-[#00B3A6] text-white rounded-lg hover:bg-[#008C82] transition-colors inline-flex items-center"
          >
            <Plus className="h-5 w-5 mr-2" />
            Créer une campagne
          </button>
        </div>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {paginatedCampaigns.map((campaign) => {
            const statusMap: Record<string, { label: string; bg: string; text: string; dot: string }> = {
              draft: { label: 'Non validé', bg: 'bg-red-50', text: 'text-red-700', dot: 'bg-red-500' },
              rejected: { label: 'Non validé', bg: 'bg-red-50', text: 'text-red-700', dot: 'bg-red-500' },
              pending: { label: 'En attente', bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-500' },
              active: { label: 'Active', bg: 'bg-green-50', text: 'text-green-700', dot: 'bg-green-500' },
              completed: { label: 'Terminée', bg: 'bg-gray-100', text: 'text-gray-700', dot: 'bg-gray-500' },
              paused: { label: 'En pause', bg: 'bg-gray-100', text: 'text-gray-700', dot: 'bg-gray-500' }
            };
            const statusConf = statusMap[campaign.status] || statusMap.draft;
            const start = campaign.startDate;
            const end = campaign.endDate;
            const dateStr = start && end
              ? `${start.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })} - ${end.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })}`
              : '—';
            const isActive = campaign.status === 'active';
            return (
              <div key={campaign.id} className="rounded-xl bg-white border border-gray-200 p-5 shadow-sm flex flex-col">
                <div className="flex items-start justify-between gap-2 mb-3">
                  <h3 className="text-base font-semibold text-gray-900 truncate flex-1">{campaign.name}</h3>
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium flex-shrink-0 ${statusConf.bg} ${statusConf.text}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${statusConf.dot}`} />
                    {statusConf.label}
                  </span>
                </div>
                <div className="flex items-center flex-wrap gap-x-3 gap-y-1 text-xs text-gray-600 mb-2">
                  <span className="flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5 flex-shrink-0 text-gray-500" />
                    {dateStr}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5 flex-shrink-0 text-gray-500" />
                    {(campaign.selected_zones && campaign.selected_zones.length > 0)
                      ? campaign.selected_zones.join(', ')
                      : '—'}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {campaign.event_id && (
                    <span className="inline-flex px-2 py-0.5 rounded bg-purple-100 text-purple-700 text-xs font-medium">Event</span>
                  )}
                  {(campaign.selected_categories || []).map((cat: string) => (
                    <span key={cat} className="inline-flex px-2 py-0.5 rounded bg-gray-200 text-gray-700 text-xs">{cat}</span>
                  ))}
                </div>
                <div className="flex items-center justify-between gap-4 mb-4 mt-auto">
                  <div>
                    <div className="flex items-center gap-1 text-xs text-gray-500">
                      <DollarSign className="h-3.5 w-3.5 text-[#60ba76]" />
                      <span>BUDGET</span>
                    </div>
                    <p className="text-base font-bold text-gray-900 tabular-nums">
                      {new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(campaign.budget)} TND
                    </p>
                  </div>
                  <div className="flex items-start gap-1.5 justify-end">
                    <div className="flex flex-col items-start">
                      <TrendingUp className="h-3.5 w-3.5 text-[#7e51f5] flex-shrink-0" />
                      <p className="text-base font-bold text-gray-900 tabular-nums mt-0.5">{(campaign.validated_impressions || 0).toLocaleString('fr-FR').replace(/\s/g, ' ')}</p>
                    </div>
                    <div className="text-right text-xs text-gray-500 pt-0.5">IMPRESSIONS</div>
                  </div>
                </div>
                <div className="flex gap-2 pt-4 mt-4 border-t border-gray-200 -mx-5 px-5">
                  <button
                    type="button"
                    onClick={() => handleViewCampaign(campaign)}
                    className="flex-1 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors"
                  >
                    Consulter
                  </button>
                  {canDeleteDraftCampaign(campaign.status) ? (
                    <>
                      <button
                        type="button"
                        onClick={() => handleActivateDraftCampaign(campaign)}
                        className="flex-1 py-2 rounded-lg text-sm font-medium inline-flex items-center justify-center gap-1.5 transition-colors bg-[#e3f7ec] text-[#66bc74] hover:bg-[#cceee0]"
                      >
                        <Rocket className="h-4 w-4" /> Activer
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteDraftCampaign(campaign)}
                        className="flex-1 py-2 rounded-lg text-sm font-medium inline-flex items-center justify-center gap-1.5 transition-colors bg-red-50 text-red-700 hover:bg-red-100"
                      >
                        <Trash2 className="h-4 w-4" /> Supprimer
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => canEditCampaign(campaign.status) ? handleEditCampaign(campaign) : undefined}
                      disabled={!canEditCampaign(campaign.status)}
                      className={`flex-1 py-2 rounded-lg text-sm font-medium inline-flex items-center justify-center gap-1.5 transition-colors ${
                        canEditCampaign(campaign.status)
                          ? 'bg-[#e3f7ec] text-[#66bc74] hover:bg-[#cceee0]'
                          : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                      }`}
                    >
                      {isActive ? <><Rocket className="h-4 w-4" /> Booster</> : <><RotateCcw className="h-4 w-4" /> Reprendre</>}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden border border-gray-200">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-white border-b border-gray-200">
                <tr>
                  <th className="px-5 py-3.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Nom de la campagne Statuts
                  </th>
                  <th className="px-5 py-3.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    <span className="inline-flex items-center gap-1.5">
                      <Calendar className="h-3.5 w-3.5" />
                      Date de début
                    </span>
                  </th>
                  <th className="px-5 py-3.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    <span className="inline-flex items-center gap-1.5">
                      <Calendar className="h-3.5 w-3.5" />
                      Date de fin
                    </span>
                  </th>
                  <th className="px-5 py-3.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    <span className="inline-flex items-center gap-1.5">
                      <MapPin className="h-3.5 w-3.5" />
                      Zone
                    </span>
                  </th>
                  <th className="px-5 py-3.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Catégories
                  </th>
                  <th className="px-5 py-3.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    <span className="inline-flex items-center gap-1.5">
                      <DollarSign className="h-3.5 w-3.5" />
                      Budget
                    </span>
                  </th>
                  <th className="px-5 py-3.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    <span className="inline-flex items-center gap-1.5">
                      <TrendingUp className="h-3.5 w-3.5" />
                      Impressions
                    </span>
                  </th>
                  <th className="px-5 py-3.5 text-right text-xs font-medium text-gray-500 uppercase tracking-wider w-12">
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {paginatedCampaigns.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-6 py-12 text-center">
                      <div className="flex flex-col items-center justify-center space-y-3">
                        <Calendar className="h-12 w-12 text-gray-400" />
                        <p className="text-gray-500 text-sm">Aucune campagne à afficher</p>
                      </div>
                    </td>
                  </tr>
                ) : paginatedCampaigns.map((campaign) => {
                  const statusMap: Record<string, { label: string; bg: string; text: string; dot: string }> = {
                    draft: { label: 'Brouillon', bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-500' },
                    rejected: { label: 'Non validé', bg: 'bg-red-50', text: 'text-red-700', dot: 'bg-red-500' },
                    pending: { label: 'En attente', bg: 'bg-orange-50', text: 'text-orange-700', dot: 'bg-orange-500' },
                    active: { label: 'Active', bg: 'bg-green-50', text: 'text-green-700', dot: 'bg-green-500' },
                    completed: { label: 'Passée', bg: 'bg-gray-100', text: 'text-gray-700', dot: 'bg-gray-500' },
                    paused: { label: 'Passée', bg: 'bg-gray-100', text: 'text-gray-700', dot: 'bg-gray-500' }
                  };
                  const isUpcoming = campaign.startDate && new Date(campaign.startDate) > new Date();
                  const statusConf = campaign.status === 'active' ? statusMap.active
                    : isUpcoming ? { label: 'A venir', bg: 'bg-blue-50', text: 'text-blue-700', dot: 'bg-blue-500' }
                    : statusMap[campaign.status] || statusMap.draft;
                  const startStr = campaign.startDate ? new Date(campaign.startDate).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
                  const endStr = campaign.endDate ? new Date(campaign.endDate).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
                  const budgetStr = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(campaign.budget || 0) + ' TND';
                  const impressionsStr = (campaign.validated_impressions || 0).toLocaleString('fr-FR').replace(/\s/g, ' ');
                  const isMenuOpen = openActionRowId === campaign.id;
                  return (
                    <tr key={campaign.id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium text-gray-900">{campaign.name || 'Sans nom'}</span>
                          {campaign.event_id && (
                            <span className="inline-flex px-2 py-0.5 rounded bg-purple-100 text-purple-700 text-xs font-medium">Event</span>
                          )}
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium flex-shrink-0 ${statusConf.bg} ${statusConf.text}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${statusConf.dot}`} />
                            {statusConf.label}
                          </span>
                        </div>
                      </td>
                      <td className="px-5 py-3.5 text-sm text-gray-900">{startStr}</td>
                      <td className="px-5 py-3.5 text-sm text-gray-900">{endStr}</td>
                      <td className="px-5 py-3.5 text-sm text-gray-900">
                        {(campaign.selected_zones && campaign.selected_zones.length > 0)
                          ? campaign.selected_zones.join(', ')
                          : '—'}
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex flex-wrap gap-1">
                          {(campaign.selected_categories || []).map((cat: string) => (
                            <span key={cat} className="inline-flex px-2 py-0.5 rounded bg-gray-100 text-gray-700 text-xs">{cat}</span>
                          ))}
                        </div>
                      </td>
                      <td className="px-5 py-3.5 text-sm text-gray-900 tabular-nums">{budgetStr}</td>
                      <td className="px-5 py-3.5 text-sm text-gray-900 tabular-nums">{impressionsStr}</td>
                      <td className="px-5 py-3.5 text-right">
                        <div className="relative flex justify-end">
                          <button
                            type="button"
                            onClick={() => setOpenActionRowId(isMenuOpen ? null : campaign.id)}
                            className="p-2 rounded-lg hover:bg-gray-100 text-gray-500"
                            aria-label="Actions"
                          >
                            <MoreVertical className="h-4 w-4" />
                          </button>
                          {isMenuOpen && (
                            <>
                              <div className="fixed inset-0 z-10" aria-hidden onClick={() => setOpenActionRowId(null)} />
                              <div className="absolute right-0 top-full mt-1 z-20 py-1 w-48 rounded-lg bg-white border border-gray-200 shadow-lg">
                                <button
                                  type="button"
                                  onClick={() => { setOpenActionRowId(null); handleViewCampaign(campaign); }}
                                  className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                                >
                                  Consulter la campagne
                                </button>
                                {!canDeleteDraftCampaign(campaign.status) && (
                                  <button
                                    type="button"
                                    onClick={() => { setOpenActionRowId(null); canEditCampaign(campaign.status) && handleEditCampaign(campaign); }}
                                    disabled={!canEditCampaign(campaign.status)}
                                    className={`w-full px-3 py-2 text-left text-sm hover:bg-gray-50 ${canEditCampaign(campaign.status) ? 'text-gray-700' : 'text-gray-400 cursor-not-allowed'}`}
                                  >
                                    {campaign.status === 'active' ? 'Booster' : 'Reprendre'}
                                  </button>
                                )}
                                {canDeleteDraftCampaign(campaign.status) && (
                                  <button
                                    type="button"
                                    onClick={() => { setOpenActionRowId(null); handleActivateDraftCampaign(campaign); }}
                                    className="w-full px-3 py-2 text-left text-sm text-[#1FC16B] hover:bg-green-50"
                                  >
                                    Activer le brouillon
                                  </button>
                                )}
                                {canDeleteDraftCampaign(campaign.status) && (
                                  <button
                                    type="button"
                                    onClick={() => { setOpenActionRowId(null); handleDeleteDraftCampaign(campaign); }}
                                    className="w-full px-3 py-2 text-left text-sm text-red-700 hover:bg-red-50"
                                  >
                                    Supprimer le brouillon
                                  </button>
                                )}
                              </div>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Pagination */}
      <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-100">
        <div className="flex items-center justify-between">
          <div className="flex items-center">
            <p className="text-sm text-gray-700">
              Affichage de <span className="font-medium text-[#00263A]">{startIndex + 1}</span> à{" "}
              <span className="font-medium text-[#00263A]">
                {Math.min(startIndex + itemsPerPage, filteredCampaigns.length)}
              </span>{" "}
              sur <span className="font-medium text-[#00263A]">{filteredCampaigns.length}</span> résultats
            </p>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setCurrentPage(page => Math.max(1, page - 1))}
              disabled={currentPage === 1}
              className="p-2 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 hover:border-[#00B3A6] disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <span className="px-4 py-2 text-sm font-medium text-[#00263A]">
              Page {currentPage} sur {totalPages}
            </span>
            <button
              onClick={() => setCurrentPage(page => Math.min(totalPages, page + 1))}
              disabled={currentPage === totalPages}
              className="p-2 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 hover:border-[#00B3A6] disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>
        </div>
      </div>

      {/* Panneau droit (drawer) Détails de Campagne — 480px, design maquette */}
      {showDetailsModal && selectedCampaign && (() => {
        const drawerStatusStyle: Record<string, { label: string; bg: string; border: string; dot: string; text: string }> = {
          draft: { label: 'Brouillon', bg: '#FFFAEB', border: '#FFECC0', dot: '#F6B51E', text: '#F6B51E' },
          rejected: { label: 'Non validé', bg: '#FFEBEC', border: '#FFC5C7', dot: '#FB3748', text: '#FB3748' },
          pending: { label: 'En attente', bg: '#FFF3EB', border: '#FFD4BC', dot: '#FA7319', text: '#FA7319' },
          active: { label: 'Active', bg: '#E3F7EC', border: '#76E6AB', dot: '#1FC16B', text: '#1FC16B' },
          completed: { label: 'Passée', bg: '#F5F5F5', border: '#EBEBEB', dot: '#5C5C5C', text: '#5C5C5C' },
          paused: { label: 'Passée', bg: '#F5F5F5', border: '#EBEBEB', dot: '#5C5C5C', text: '#5C5C5C' }
        };
        const st = drawerStatusStyle[selectedCampaign.status] || drawerStatusStyle.draft;
        const startStr = selectedCampaign.startDate ? new Date(selectedCampaign.startDate).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
        const endStr = selectedCampaign.endDate ? new Date(selectedCampaign.endDate).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
        const durationDays = selectedCampaign.startDate && selectedCampaign.endDate
          ? Math.ceil((selectedCampaign.endDate.getTime() - selectedCampaign.startDate.getTime()) / (1000 * 60 * 60 * 24))
          : 0;
        const categories = selectedCampaign.selected_categories || (selectedCampaign.category ? [selectedCampaign.category] : []);
        const zones = selectedCampaign.selected_zones || [];
        return (
          <div className="fixed inset-0 z-50 overflow-hidden">
            <div
              className={`absolute inset-0 bg-gray-500/75 transition-opacity duration-300 ${drawerVisible ? 'opacity-100' : 'opacity-0'}`}
              onClick={closeDetailsDrawer}
              aria-hidden
            />
            <div
              className={`absolute top-0 bottom-0 w-[480px] right-2 bg-white flex flex-col isolate transform transition-transform duration-300 ease-out ${
                drawerVisible ? 'translate-x-0' : 'translate-x-full'
              }`}
              style={{
                boxShadow: '0px 16px 32px rgba(14, 18, 27, 0.101961)',
                border: '1px solid #EBEBEB',
                borderRadius: '12px'
              }}
            >
              {/* Header — Frame 413 */}
              <div className="flex-none flex flex-row items-start p-5 gap-4 border-b border-[#EBEBEB]">
                <div className="flex flex-col gap-1 min-w-0 flex-1">
                  <h3 className="text-lg font-medium text-[#171717] leading-6 truncate" style={{ letterSpacing: '-0.015em' }}>
                    {selectedCampaign.name}
                  </h3>
                  <span
                    className="inline-flex items-center gap-1.5 w-fit px-2 py-0.5 rounded-md"
                    style={{ background: st.bg, border: `1px solid ${st.border}` }}
                  >
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: st.dot }} />
                    <span className="text-xs font-medium" style={{ color: st.text, letterSpacing: '-0.006em', lineHeight: '16px' }}>{st.label}</span>
                  </span>
                </div>
                <button type="button" onClick={closeDetailsDrawer} className="p-2 text-[#5C5C5C] hover:bg-gray-100 rounded-lg transition-colors shrink-0" aria-label="Fermer">
                  <X className="h-6 w-6" strokeWidth={1.5} />
                </button>
              </div>

              {/* Content — Frame 414 */}
              <div className="flex-1 overflow-y-auto flex flex-col p-5 gap-4">
                {/* Type de la campagne */}
                <div className="flex flex-col gap-2">
                  <span className="text-xs font-medium uppercase text-[#A3A3A3] tracking-tight" style={{ letterSpacing: '-0.006em', lineHeight: '16px' }}>Type de la campagne</span>
                  <div className="flex gap-2">
                    <div className="flex-1 flex items-center gap-2 p-1.5 rounded-lg bg-white border border-[#76E6AB]" style={{ boxShadow: '0px 1px 2px rgba(10, 13, 20, 0.0313726)' }}>
                      <div className="w-8 h-8 rounded-lg bg-[#DCF0E9] flex items-center justify-center shrink-0">
                        <Crosshair className="h-5 w-5 text-[#142522]" />
                      </div>
                      <span className="text-xs text-[#171717]">Réseau Toodooh</span>
                    </div>
                    <div className="flex-1 flex items-center gap-2 p-1.5 rounded-lg bg-[#F7F7F7] border border-[#EBEBEB]" style={{ boxShadow: '0px 1px 2px rgba(10, 13, 20, 0.0313726)' }}>
                      <div className="w-8 h-8 rounded-lg border border-[#EBEBEB] flex items-center justify-center shrink-0">
                        <Monitor className="h-5 w-5 text-[#D1D1D1]" />
                      </div>
                      <span className="text-xs text-[#D1D1D1]">Parc TV</span>
                    </div>
                  </div>
                </div>

                {/* Catégorie(s) */}
                <div className="flex flex-col gap-2">
                  <span className="text-xs font-medium uppercase text-[#A3A3A3] tracking-tight" style={{ letterSpacing: '-0.006em', lineHeight: '16px' }}>Catégorie(s)</span>
                  <div className="flex flex-wrap gap-2">
                    {categories.map((cat: string, i: number) => (
                      <span
                        key={i}
                        className="inline-flex items-center px-2 py-1 rounded bg-white border border-[#76E6AB] text-xs text-[#171717]"
                        style={{ boxShadow: '0px 1px 2px rgba(10, 13, 20, 0.0313726)' }}
                      >
                        {cat}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Période */}
                <div className="flex flex-col gap-2">
                  <span className="text-xs font-medium uppercase text-[#A3A3A3] tracking-tight" style={{ letterSpacing: '-0.006em', lineHeight: '16px' }}>Période</span>
                  <div className="flex flex-wrap gap-4 text-xs font-medium text-[#171717]" style={{ letterSpacing: '-0.006em', lineHeight: '16px' }}>
                    <span>Début: {startStr}</span>
                    <span>Fin: {endStr}</span>
                    <span>Durée: {durationDays} jours</span>
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <span className="text-xs font-medium uppercase text-[#A3A3A3] tracking-tight" style={{ letterSpacing: '-0.006em', lineHeight: '16px' }}>Impressions validées</span>
                  <div className="text-sm font-semibold text-[#171717]">
                    {(selectedCampaign.validated_impressions || 0).toLocaleString('fr-FR')}
                  </div>
                </div>

                {/* Zones géographiques */}
                <div className="flex flex-col gap-2">
                  <span className="text-xs font-medium uppercase text-[#A3A3A3] tracking-tight" style={{ letterSpacing: '-0.006em', lineHeight: '16px' }}>Zones géographiques</span>
                  <div className="flex flex-wrap gap-2 text-xs font-medium text-[#171717]" style={{ letterSpacing: '-0.006em', lineHeight: '16px' }}>
                    {zones.length > 0 ? zones.map((zone: string) => (
                      <span key={zone} className="inline-flex items-center px-2 py-1 rounded bg-white border border-[#76E6AB]">
                        {zone}
                      </span>
                    )) : <span>—</span>}
                  </div>
                </div>

                {/* Spot */}
                <div className="flex flex-col gap-2">
                  <span className="text-xs font-medium uppercase text-[#A3A3A3] tracking-tight" style={{ letterSpacing: '-0.006em', lineHeight: '16px' }}>Spot</span>
                  <div className="rounded-xl border border-[#EBEBEB] overflow-hidden bg-black/5 relative">
                    {campaignVideo?.url ? (
                      <div className="relative">
                        <video
                          src={campaignVideo.url}
                          controls
                          className="w-full aspect-video object-contain rounded-xl"
                          muted
                          playsInline
                        />
                        <div
                          className="absolute inset-x-0 bottom-0 h-24 pointer-events-none"
                          style={{ background: 'linear-gradient(180deg, rgba(13, 15, 20, 0) 0%, rgba(13, 15, 20, 0.9) 80.37%)', backdropFilter: 'blur(1px)' }}
                        />
                      </div>
                    ) : (
                      <div className="aspect-video flex items-center justify-center text-[#A3A3A3] text-sm">
                        Aucun spot
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Footer — Frame 415 */}
              <div className="flex-none flex flex-row items-center p-5 gap-4 border-t border-[#EBEBEB]">
                <button
                  type="button"
                  onClick={closeDetailsDrawer}
                  className="flex-1 flex items-center justify-center py-2 px-3 rounded-[10px] bg-white border border-[#EBEBEB] text-sm font-medium text-[#5C5C5C] hover:bg-gray-50 transition-colors"
                  style={{ boxShadow: '0px 1px 2px rgba(10, 13, 20, 0.0313726)' }}
                >
                  Fermer
                </button>
                {canDeleteDraftCampaign(selectedCampaign.status) ? (
                  <>
                    <button
                      type="button"
                      onClick={() => handleActivateDraftCampaign(selectedCampaign)}
                      className="flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-[10px] border border-[#1FC16B] text-sm font-medium text-[#1FC16B] bg-[#E3F7EC] hover:opacity-90 transition-opacity"
                      style={{ boxShadow: '0px 1px 2px rgba(10, 13, 20, 0.0313726)' }}
                    >
                      <Rocket className="h-5 w-5" />
                      Activer le brouillon
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteDraftCampaign(selectedCampaign)}
                      className="flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-[10px] border border-red-200 text-sm font-medium text-red-700 bg-red-50 hover:bg-red-100 transition-colors"
                      style={{ boxShadow: '0px 1px 2px rgba(10, 13, 20, 0.0313726)' }}
                    >
                      <Trash2 className="h-5 w-5" />
                      Supprimer le brouillon
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => { const c = selectedCampaign; closeDetailsDrawer(); setTimeout(() => handleEditCampaign(c), 320); }}
                    disabled={!canEditCampaign(selectedCampaign.status)}
                    className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-[10px] border text-sm font-medium transition-opacity ${
                      canEditCampaign(selectedCampaign.status)
                        ? 'bg-[#E3F7EC] border-[#1FC16B] text-[#1FC16B] hover:opacity-90'
                        : 'bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed'
                    }`}
                    style={{ boxShadow: '0px 1px 2px rgba(10, 13, 20, 0.0313726)' }}
                  >
                    <Rocket className="h-5 w-5" />
                    Booster
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}