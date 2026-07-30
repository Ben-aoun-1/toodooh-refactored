import {
  Search,
  Filter,
  ChevronLeft,
  ChevronRight,
  Calendar,
  TrendingUp,
  Banknote,
  MoreVertical,
  Plus,
  MapPin,
  Repeat,
  Rocket,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { useState, useEffect } from 'react';
import DatePicker from 'react-datepicker';
import { toast } from 'react-hot-toast';
import { useNavigate, useLocation } from 'react-router-dom';

import 'react-datepicker/dist/react-datepicker.css';
import campagneIcon from '@/assets/sidebar/campagnes.png';
import PageHeader from '@/components/PageHeader';
import { useAuthStore } from '@/features/auth/stores/auth.store';
import BoostCampaignModal from '@/features/campaigns/components/BoostCampaignModal';
import CampaignDrawer from '@/features/campaigns/components/CampaignDrawer';
import { useDeleteCampaign, useReplayCampaign } from '@/features/campaigns/hooks/useCampaignApi';
import { useCreativePreviewUrl, useMyCreatives } from '@/features/campaigns/hooks/useCreativeApi';
import { useMyCampaigns } from '@/features/campaigns/hooks/useMyCampaigns';
import { usePricingConfig } from '@/features/campaigns/hooks/usePricingConfig';
import { canBoostCampaign } from '@/features/campaigns/lib/boost-rules';
import {
  canDeleteDraftCampaign,
  canResumeCampaign,
  rejectReasonToShow,
} from '@/features/campaigns/lib/campaign-actions';
import {
  STATUS_FILTER_OPTIONS,
  campaignMatchesCategory,
  categoryFilterOptions,
  statusFilterFromSearch,
} from '@/features/campaigns/lib/campaign-filters';
import {
  formatImpressions,
  impressionsDisplay,
} from '@/features/campaigns/lib/campaign-impressions';
import {
  REPLAY_ERROR_TOAST,
  REPLAY_SUCCESS_TOAST,
  canReplayCampaign,
  performReplay,
} from '@/features/campaigns/lib/campaign-replay';
import { campaignStatusUi } from '@/features/campaigns/lib/campaign-status';
import type { CampaignView } from '@/features/campaigns/services/campaigns.api';
import { useWizardResumeStore } from '@/features/campaigns/stores/wizard-resume.store';
import BoostPositioningModal from '@/features/events/components/BoostPositioningModal';
import EventPlacementSummary from '@/features/events/components/EventPlacementSummary';
import { logger } from '@/lib/logger';
import { htTtcOrDash } from '@/lib/money';

const log = logger.child({ module: 'MyCampaigns' });

// Test data

type _CampaignStatus = 'active' | 'en attente' | 'terminée' | 'planifiée';

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
  const user = useAuthStore((state) => state.user);
  const [currentPage, setCurrentPage] = useState(1);
  const [filters, setFilters] = useState<Filters>({
    client: '',
    category: '',
    status: '',
    campaignType: '',
    startDate: null,
    endDate: null,
  });

  // Appliquer le filtre statut depuis l'URL (?status=<the six enum ids>). CF-U3 (Mejri item 7):
  // keyed on location.key, not location.search — a SAME-URL navigate (the bell's « Consulter »
  // while already on /my-campaigns?status=draft after tab changes) pushes a new history entry
  // with a new key, so the filter re-applies instead of the click being silently swallowed.
  useEffect(() => {
    const statusParam = statusFilterFromSearch(location.search);
    if (statusParam !== null) {
      setFilters((prev) => ({ ...prev, status: statusParam }));
      setCurrentPage(1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- location.key covers every navigate (incl. same-URL)
  }, [location.key]);
  const [showFilters, setShowFilters] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  // Server state via React Query (Commit 7b). `useMyCampaigns` consumes
  // `campaignsKeys.list(userId)` — the key 7a's campaign-write mutations
  // already invalidate. The page reads straight from the query: with the
  // optimistic `setCampaigns` patches dropped (mutations now
  // invalidate-and-refetch), no local mirror is needed.
  const { campaigns, loading, isError } = useMyCampaigns(user?.id);
  // EV6 — the POSITIONING booster's target (its own modal: zones-only, frozen axes).
  const [boostPositioningTarget, setBoostPositioningTarget] = useState<CampaignView | null>(null);
  // CF-B1 — the Booster modal's target (the untrimmed wire row).
  const [boostTarget, setBoostTarget] = useState<CampaignView | null>(null);
  const deleteCampaign = useDeleteCampaign(user?.id);
  const replayCampaign = useReplayCampaign(user?.id);

  useEffect(() => {
    if (isError) {
      toast.error('Erreur lors du chargement des campagnes');
    }
  }, [isError]);

  const itemsPerPage = 6;

  // Filter campaigns (status '' = all, 'upcoming' = startDate > now)
  const filteredCampaigns = campaigns.filter((campaign) => {
    try {
      // CF-S1 — 'upcoming' is a STORED status now: plain equality, no date derivation.
      const statusMatch = !filters.status ? true : campaign.status === filters.status;
      const typeMatch = !filters.campaignType
        ? true
        : filters.campaignType === 'event'
          ? Boolean(campaign.event_id)
          : !campaign.event_id;
      return (
        (!filters.client || campaign.name.toLowerCase().includes(filters.client.toLowerCase())) &&
        // CF-U3 (Mejri item 5) — match the TARGETING categories (the chips the card shows);
        // whole-network campaigns match every category (see campaignMatchesCategory).
        campaignMatchesCategory(campaign.selected_categories, filters.category) &&
        statusMatch &&
        typeMatch &&
        (!filters.startDate ||
          (campaign.startDate != null && campaign.startDate >= filters.startDate)) &&
        (!filters.endDate || (campaign.endDate != null && campaign.endDate <= filters.endDate))
      );
    } catch (error) {
      log.error({ error, campaign }, 'Error filtering campaign');
      return true;
    }
  });

  // Calculate pagination
  const totalPages = Math.max(1, Math.ceil(filteredCampaigns.length / itemsPerPage));
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedCampaigns = filteredCampaigns.slice(startIndex, startIndex + itemsPerPage);

  // CF-U3 (item 5) — options from the campaigns' real targeting chips (whole-network excluded:
  // those campaigns match every category, so the chip is not an option).
  const uniqueCategories = categoryFilterOptions(campaigns);

  // État pour le modal de consultation
  // TODO(phase-1): typed source [supabase] — see #15
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [selectedCampaign, setSelectedCampaign] = useState<any>(null);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [openActionRowId, setOpenActionRowId] = useState<string | null>(null);

  // The slide animation now lives in the shared <Drawer> primitive (B2): close
  // flips `open` (showDetailsModal) immediately; the campaign data is cleared
  // after the 300ms exit so the body stays rendered through the slide-out.
  const closeDetailsDrawer = () => {
    setShowDetailsModal(false);
    setTimeout(() => setSelectedCampaign(null), 300);
  };

  // CF-HF3 (Mejri items 2–3) — the Consulter drawer's live data: the pricing CPM feeds the
  // budget-derived « prévues » fallback; the linked creative previews via the wizard's presign
  // (image AND video — the dead undefined-video legacy prop is retired for this variant).
  const pricing = usePricingConfig();
  const { data: myCreatives = [] } = useMyCreatives(user?.id);
  const selectedCreativeId: string | null = selectedCampaign?.creative_id ?? null;
  const previewUrl = useCreativePreviewUrl(selectedCreativeId);
  const selectedCreative = selectedCreativeId
    ? (myCreatives.find((c) => c.id === selectedCreativeId) ?? null)
    : null;

  // Fonction pour consulter une campagne.
  // TODO(phase-1): typed source [supabase] — see #15
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleViewCampaign = (campaign: any) => {
    setSelectedCampaign(campaign);
    setShowDetailsModal(true);
  };

  // Fonction pour modifier une campagne
  // TODO(phase-1): typed source [supabase] — see #15
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleEditCampaign = (campaign: any) => {
    // Vérifier si la campagne peut être modifiée
    if (campaign.status === 'active') {
      toast.error('Impossible de modifier une campagne active', {
        duration: 4000,
        icon: '🔒',
      });
      return;
    }

    // EV3 — a positioning (event-BOUND row) resumes in ITS parcours, never the classic wizard.
    if (campaign.event_id) {
      navigate(`/evenements/positionnement/${campaign.id}`, { state: { resumed: true } });
      return;
    }

    // Rediriger vers la page de nouvelle campagne avec les données de la campagne
    navigate('/new-campaign', { state: { editMode: true, campaign } });
  };

  // CF-RJ1 (spec §3.3) — « Rejouer » a Passée campaign: clone server-side, land the wizard on
  // Période (resume-store key on the NEW draft id), everything else prefilled from the clone.
  const handleReplayCampaign = async (campaign: { id: string; status: string }) => {
    if (!canReplayCampaign(campaign.status)) return;
    const result = await performReplay({
      sourceId: campaign.id,
      deps: {
        replay: (id) => replayCampaign.mutateAsync(id),
        setResumeStep: (draftId, step) => useWizardResumeStore.getState().setStep(draftId, step),
        navigate,
      },
    });
    if (result.kind === 'success') {
      toast.success(REPLAY_SUCCESS_TOAST);
    } else {
      log.error({ err: result.error }, 'campaign replay failed');
      toast.error(REPLAY_ERROR_TOAST);
    }
  };

  // TODO(phase-1): typed source [supabase] — see #15
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleDeleteDraftCampaign = async (campaign: any) => {
    if (!canDeleteDraftCampaign(campaign.status)) return;
    if (!user?.id) return;
    const confirmed = window.confirm(
      `Supprimer définitivement le brouillon "${campaign.name || 'Sans nom'}" ?`,
    );
    if (!confirmed) return;

    try {
      await deleteCampaign.mutateAsync(campaign.id);
      useWizardResumeStore.getState().clear(campaign.id); // CF-Q2 resume-key hygiene
      setOpenActionRowId((prev) => (prev === campaign.id ? null : prev));
      if (selectedCampaign?.id === campaign.id) {
        closeDetailsDrawer();
      }
      toast.success('Brouillon supprimé');
    } catch (_e) {
      toast.error('Erreur lors de la suppression du brouillon');
    }
  };

  // Compteurs par statut pour le bloc 7 widgets (Tout, Active, À venir, Brouillons, En attente, Non validé, Passées)
  const countTout = campaigns.length;
  const countActive = campaigns.filter((c) => c.status === 'active').length;
  // CF-S1 — counted from the STORED status, like every other widget.
  const countAVenir = campaigns.filter((c) => c.status === 'upcoming').length;
  const countBrouillons = campaigns.filter((c) => c.status === 'draft').length;
  const countEnAttente = campaigns.filter((c) => c.status === 'pending').length;
  const countNonValide = campaigns.filter((c) => c.status === 'rejected').length;
  const countPassees = campaigns.filter((c) => c.status === 'completed').length;

  const statusWidgets = [
    {
      label: 'Tout',
      value: '' as const,
      count: countTout,
      bg: 'bg-white',
      border: 'border border-[#EBEBEB]',
      titleColor: 'text-[#5C5C5C]',
      rounded: 'rounded-xl',
    },
    {
      label: 'Active',
      value: 'active' as const,
      count: countActive,
      bg: 'bg-[#E3F7EC]',
      border: '',
      titleColor: 'text-[#1FC16B]',
      rounded: 'rounded-md',
    },
    {
      label: 'À venir',
      value: 'upcoming' as const,
      count: countAVenir,
      bg: 'bg-[#EBF1FF]',
      border: '',
      titleColor: 'text-[#335CFF]',
      rounded: 'rounded-md',
    },
    {
      label: 'Brouillons',
      value: 'draft' as const,
      count: countBrouillons,
      bg: 'bg-[#FFFAEB]',
      border: '',
      titleColor: 'text-[#F6B51E]',
      rounded: 'rounded-md',
    },
    {
      label: 'En attente',
      value: 'pending' as const,
      count: countEnAttente,
      bg: 'bg-[#FFF3EB]',
      border: '',
      titleColor: 'text-[#FA7319]',
      rounded: 'rounded-md',
    },
    {
      label: 'Non validé',
      value: 'rejected' as const,
      count: countNonValide,
      bg: 'bg-[#FFEBEC]',
      border: '',
      titleColor: 'text-[#FB3748]',
      rounded: 'rounded-md',
    },
    {
      label: 'Passées',
      value: 'completed' as const,
      count: countPassees,
      bg: 'bg-[#F5F5F5]',
      border: '',
      titleColor: 'text-[#5C5C5C]',
      rounded: 'rounded-md',
    },
  ];

  return (
    <div className="w-full space-y-8">
      {/* Bloc statistiques par statut (7 widgets) – cliquables = filtres sur la liste */}
      <div className="flex flex-row flex-wrap items-stretch gap-4">
        {statusWidgets.map((w, i) => {
          const isSelected = filters.status === w.value;
          return (
            <button
              key={w.label}
              type="button"
              onClick={() => setFilters((f) => ({ ...f, status: w.value }))}
              className={`box-border flex min-h-[92px] flex-1 min-w-[100px] flex-shrink-0 flex-col items-start justify-start p-4 gap-2 text-left transition-all ${w.bg} ${w.border} ${w.rounded} ${isSelected ? 'ring-2 ring-brand-primary ring-offset-2' : 'hover:opacity-95'}`}
              style={i === 0 ? { boxShadow: '0px 1px 2px rgba(10, 13, 20, 0.0313726)' } : {}}
            >
              <span
                className={`text-sm font-medium leading-5 ${w.titleColor}`}
                style={{ letterSpacing: '-0.006em' }}
              >
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
          <PageHeader title="Mes campagnes" subtitle="Gérez vos campagnes actives" />
          <button
            onClick={() => navigate('/new-campaign')}
            className="bg-brand-primary text-[#171717] rounded-lg px-5 py-2.5 font-medium hover:opacity-90 transition-opacity flex items-center gap-2"
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
                className="w-full h-full pl-9 pr-3 py-2.5 text-sm border border-[#EBEBEB] rounded-md bg-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-primary/30 focus:border-brand-primary"
                onChange={(e) => setFilters({ ...filters, client: e.target.value })}
              />
            </div>
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`h-10 px-3 rounded-md font-medium transition-colors flex items-center gap-1.5 text-sm shrink-0 ${
                showFilters
                  ? 'bg-white border border-[#EBEBEB] text-[#171717]'
                  : 'bg-[#F5F5F5] text-[#5C5C5C] hover:bg-[#EBEBEB]'
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
                <label
                  className="block text-sm font-medium text-[#5C5C5C] mb-1.5"
                  htmlFor="campaign-type"
                >
                  Type
                </label>
                <select
                  className="w-full h-10 px-3 text-sm border border-[#EBEBEB] rounded-md bg-white text-[#171717] focus:outline-none focus:ring-2 focus:ring-brand-primary/30 focus:border-brand-primary transition-colors"
                  value={filters.campaignType}
                  onChange={(e) =>
                    setFilters({
                      ...filters,
                      campaignType: e.target.value as '' | 'campaign' | 'event',
                    })
                  }
                  id="campaign-type"
                >
                  <option value="">Tous les types</option>
                  <option value="campaign">Campagne</option>
                  <option value="event">Événement</option>
                </select>
              </div>
              <div>
                <label
                  className="block text-sm font-medium text-[#5C5C5C] mb-1.5"
                  htmlFor="category"
                >
                  Catégorie
                </label>
                <select
                  className="w-full h-10 px-3 text-sm border border-[#EBEBEB] rounded-md bg-white text-[#171717] focus:outline-none focus:ring-2 focus:ring-brand-primary/30 focus:border-brand-primary transition-colors"
                  value={filters.category}
                  onChange={(e) => setFilters({ ...filters, category: e.target.value })}
                  id="category"
                >
                  <option value="">Toutes les catégories</option>
                  {uniqueCategories.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-[#5C5C5C] mb-1.5" htmlFor="status">
                  Statut
                </label>
                <select
                  className="w-full h-10 px-3 text-sm border border-[#EBEBEB] rounded-md bg-white text-[#171717] focus:outline-none focus:ring-2 focus:ring-brand-primary/30 focus:border-brand-primary transition-colors"
                  value={filters.status}
                  onChange={(e) => setFilters({ ...filters, status: e.target.value })}
                  id="status"
                >
                  <option value="">Tous les statuts</option>
                  {/* CF-U3 (item 6) — the six real statuses, French labels from the CF-S1 single
                      map (no second list; values wired to the enum ids). */}
                  {STATUS_FILTER_OPTIONS.map(({ value, label }) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label
                  className="block text-sm font-medium text-[#5C5C5C] mb-1.5"
                  htmlFor="start-date"
                >
                  Date de début
                </label>
                <DatePicker
                  selected={filters.startDate}
                  onChange={(date: Date | null) => setFilters({ ...filters, startDate: date })}
                  className="w-full h-10 px-3 text-sm border border-[#EBEBEB] rounded-md bg-white text-[#171717] focus:outline-none focus:ring-2 focus:ring-brand-primary/30 focus:border-brand-primary"
                  dateFormat="dd/MM/yyyy"
                  placeholderText="Sélectionner"
                  id="start-date"
                />
              </div>
              <div>
                <label
                  className="block text-sm font-medium text-[#5C5C5C] mb-1.5"
                  htmlFor="end-date"
                >
                  Date de fin
                </label>
                <DatePicker
                  selected={filters.endDate}
                  onChange={(date: Date | null) => setFilters({ ...filters, endDate: date })}
                  className="w-full h-10 px-3 text-sm border border-[#EBEBEB] rounded-md bg-white text-[#171717] focus:outline-none focus:ring-2 focus:ring-brand-primary/30 focus:border-brand-primary"
                  dateFormat="dd/MM/yyyy"
                  placeholderText="Sélectionner"
                  id="end-date"
                />
              </div>
            </div>
            <div className="mt-4 flex justify-end">
              <button
                onClick={() =>
                  setFilters({
                    client: '',
                    category: '',
                    status: '',
                    campaignType: '',
                    startDate: null,
                    endDate: null,
                  })
                }
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
            <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-brand-primary mx-auto mb-4"></div>
            <p className="text-gray-600">Chargement des campagnes...</p>
          </div>
        </div>
      ) : paginatedCampaigns.length === 0 ? (
        <div className="bg-white rounded-xl p-12 shadow-sm border border-gray-200 text-center">
          <img
            src={campagneIcon}
            alt=""
            className="h-16 w-16 mx-auto mb-4 object-contain opacity-40"
          />
          <h3 className="text-xl font-semibold text-gray-900 mb-2">Aucune campagne trouvée</h3>
          <p className="text-gray-600 mb-6">
            Commencez par créer votre première campagne publicitaire
          </p>
          <button
            onClick={() => navigate('/new-campaign')}
            className="px-6 py-3 bg-brand-primary text-brand-deep rounded-lg hover:bg-brand-primary/90 transition-colors inline-flex items-center"
          >
            <Plus className="h-5 w-5 mr-2" />
            Créer une campagne
          </button>
        </div>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {paginatedCampaigns.map((campaign) => {
            // CF-S1 — ONE status map for every surface (kills the grid's draft=« Non validé »
            // mislabel and the « Terminée »/« Passée » split).
            const statusConf = campaignStatusUi(campaign.status);
            const start = campaign.startDate;
            const end = campaign.endDate;
            const dateStr =
              start && end
                ? `${start.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })} - ${end.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })}`
                : '—';
            return (
              <div
                key={campaign.id}
                className="rounded-xl bg-white border border-gray-200 p-5 shadow-sm flex flex-col"
              >
                <div className="flex items-start justify-between gap-2 mb-3">
                  <h3 className="text-base font-semibold text-gray-900 truncate flex-1">
                    {campaign.name}
                  </h3>
                  <span
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium flex-shrink-0 ${statusConf.bg} ${statusConf.text}`}
                  >
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
                    {campaign.selected_zones && campaign.selected_zones.length > 0
                      ? campaign.selected_zones.join(', ')
                      : '—'}
                  </span>
                </div>
                {rejectReasonToShow(campaign.status, campaign.reject_reason) && (
                  <p className="mb-2 rounded-lg border border-red-100 bg-red-50 px-2.5 py-1.5 text-xs text-red-700">
                    <span className="font-semibold">Motif du refus :</span> {campaign.reject_reason}
                  </p>
                )}
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {campaign.event_id && (
                    <span className="inline-flex px-2 py-0.5 rounded bg-purple-100 text-purple-700 text-xs font-medium">
                      Event
                    </span>
                  )}
                  {(campaign.selected_categories || []).map((cat: string) => (
                    <span
                      key={cat}
                      className="inline-flex px-2 py-0.5 rounded bg-gray-200 text-gray-700 text-xs"
                    >
                      {cat}
                    </span>
                  ))}
                </div>
                <div className="flex items-center justify-between gap-4 mb-4 mt-auto">
                  <div>
                    <div className="flex items-center gap-1 text-xs text-gray-500">
                      <Banknote className="h-3.5 w-3.5 text-[#60ba76]" />
                      <span>BUDGET</span>
                    </div>
                    {/* CF-U1 (Mejri item 6) — null renders « — » (no phantom 5 000); a set
                        budget carries its TTC. */}
                    <p className="text-base font-bold text-gray-900 tabular-nums">
                      {htTtcOrDash(campaign.budget)}
                    </p>
                  </div>
                  {/* CF-HF3 (Mejri item 3) — the display rule: prévues (plan facturable, else the
                      budget estimate), + validées once Active/Passée. Never a fake 0. */}
                  {(() => {
                    const imp = impressionsDisplay(campaign, pricing.data);
                    return (
                      <div className="flex items-start gap-1.5 justify-end">
                        <div className="flex flex-col items-end">
                          <div className="flex items-center gap-1 text-xs text-gray-500">
                            <TrendingUp className="h-3.5 w-3.5 text-[#7e51f5] flex-shrink-0" />
                            <span>PRÉVUES</span>
                          </div>
                          <p className="text-base font-bold text-gray-900 tabular-nums mt-0.5">
                            {formatImpressions(imp.prevues)}
                          </p>
                        </div>
                      </div>
                    );
                  })()}
                </div>
                <div className="flex gap-2 pt-4 mt-4 border-t border-gray-200 -mx-5 px-5">
                  <button
                    type="button"
                    onClick={() => handleViewCampaign(campaign)}
                    className="flex-1 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors"
                  >
                    Consulter
                  </button>
                  {/* CF-S1 — Reprendre on draft AND rejected (recovery works end-to-end now);
                      Supprimer stays draft-only; active keeps the parked disabled Booster;
                      pending/upcoming are Consulter-only. CF-RJ1 — completed gains Rejouer. */}
                  {canResumeCampaign(campaign.status) && (
                    <button
                      type="button"
                      onClick={() => handleEditCampaign(campaign)}
                      className="flex-1 py-2 rounded-lg text-sm font-medium inline-flex items-center justify-center gap-1.5 transition-colors bg-[#e3f7ec] text-[#66bc74] hover:bg-[#cceee0]"
                    >
                      <RotateCcw className="h-4 w-4" /> Reprendre
                    </button>
                  )}
                  {!campaign.event_id && canReplayCampaign(campaign.status) && (
                    <button
                      type="button"
                      onClick={() => void handleReplayCampaign(campaign)}
                      className="flex-1 py-2 rounded-lg text-sm font-medium inline-flex items-center justify-center gap-1.5 transition-colors bg-[#e3f7ec] text-[#66bc74] hover:bg-[#cceee0]"
                    >
                      <Repeat className="h-4 w-4" /> Rejouer
                    </button>
                  )}
                  {canDeleteDraftCampaign(campaign.status) && (
                    <button
                      type="button"
                      onClick={() => handleDeleteDraftCampaign(campaign)}
                      className="flex-1 py-2 rounded-lg text-sm font-medium inline-flex items-center justify-center gap-1.5 transition-colors bg-red-50 text-red-700 hover:bg-red-100"
                    >
                      <Trash2 className="h-4 w-4" /> Supprimer
                    </button>
                  )}
                  {canBoostCampaign(campaign.status) && (
                    <button
                      type="button"
                      onClick={() =>
                        campaign.event_id
                          ? setBoostPositioningTarget(campaign.raw)
                          : setBoostTarget(campaign.raw)
                      }
                      className="flex-1 py-2 rounded-lg text-sm font-medium inline-flex items-center justify-center gap-1.5 transition-colors bg-[#e3f7ec] text-[#66bc74] hover:bg-[#cceee0]"
                    >
                      <Rocket className="h-4 w-4" /> Booster
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
                      <Banknote className="h-3.5 w-3.5" />
                      Budget
                    </span>
                  </th>
                  <th className="px-5 py-3.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    <span className="inline-flex items-center gap-1.5">
                      <TrendingUp className="h-3.5 w-3.5" />
                      Impressions
                    </span>
                  </th>
                  <th className="px-5 py-3.5 text-right text-xs font-medium text-gray-500 uppercase tracking-wider w-12"></th>
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
                ) : (
                  paginatedCampaigns.map((campaign) => {
                    // CF-S1 — the stored status IS the truth: no date-derived « A venir ».
                    const statusConf = campaignStatusUi(campaign.status);
                    const startStr = campaign.startDate
                      ? new Date(campaign.startDate).toLocaleDateString('fr-FR', {
                          day: '2-digit',
                          month: '2-digit',
                          year: 'numeric',
                        })
                      : '—';
                    const endStr = campaign.endDate
                      ? new Date(campaign.endDate).toLocaleDateString('fr-FR', {
                          day: '2-digit',
                          month: '2-digit',
                          year: 'numeric',
                        })
                      : '—';
                    // CF-U1 (Mejri item 6) — « — » for a null budget; HT (TTC) otherwise.
                    const budgetStr = htTtcOrDash(campaign.budget);
                    // CF-HF3 (Mejri item 3) — the display rule, never a fake 0.
                    const imp = impressionsDisplay(campaign, pricing.data);
                    const isMenuOpen = openActionRowId === campaign.id;
                    return (
                      <tr key={campaign.id} className="hover:bg-gray-50/50 transition-colors">
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium text-gray-900">
                              {campaign.name || 'Sans nom'}
                            </span>
                            {campaign.event_id && (
                              <span className="inline-flex px-2 py-0.5 rounded bg-purple-100 text-purple-700 text-xs font-medium">
                                Event
                              </span>
                            )}
                            <span
                              className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium flex-shrink-0 ${statusConf.bg} ${statusConf.text}`}
                            >
                              <span className={`w-1.5 h-1.5 rounded-full ${statusConf.dot}`} />
                              {statusConf.label}
                            </span>
                          </div>
                          {rejectReasonToShow(campaign.status, campaign.reject_reason) && (
                            <p className="mt-1 text-xs text-red-700">
                              <span className="font-semibold">Motif du refus :</span>{' '}
                              {campaign.reject_reason}
                            </p>
                          )}
                        </td>
                        <td className="px-5 py-3.5 text-sm text-gray-900">{startStr}</td>
                        <td className="px-5 py-3.5 text-sm text-gray-900">{endStr}</td>
                        <td className="px-5 py-3.5 text-sm text-gray-900">
                          {/* CF-HF3 — an empty selection IS a targeting: whole network. */}
                          {campaign.selected_zones && campaign.selected_zones.length > 0
                            ? campaign.selected_zones.join(', ')
                            : 'Tout le réseau'}
                        </td>
                        <td className="px-5 py-3.5">
                          <div className="flex flex-wrap gap-1">
                            {(campaign.selected_categories || []).map((cat: string) => (
                              <span
                                key={cat}
                                className="inline-flex px-2 py-0.5 rounded bg-gray-100 text-gray-700 text-xs"
                              >
                                {cat}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="px-5 py-3.5 text-sm text-gray-900 tabular-nums">
                          {budgetStr}
                        </td>
                        <td className="px-5 py-3.5 text-sm text-gray-900 tabular-nums">
                          <div>Prévues : {formatImpressions(imp.prevues)}</div>
                        </td>
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
                                <div
                                  className="fixed inset-0 z-10"
                                  aria-hidden
                                  onClick={() => setOpenActionRowId(null)}
                                />
                                <div className="absolute right-0 top-full mt-1 z-20 py-1 w-48 rounded-lg bg-white border border-gray-200 shadow-lg">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setOpenActionRowId(null);
                                      handleViewCampaign(campaign);
                                    }}
                                    className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                                  >
                                    Consulter la campagne
                                  </button>
                                  {/* CF-S1: Reprendre on draft AND rejected (recovery works
                                      end-to-end); active keeps its parked, disabled Booster. */}
                                  {campaign.status === 'rejected' && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setOpenActionRowId(null);
                                        handleEditCampaign(campaign);
                                      }}
                                      className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                                    >
                                      Reprendre
                                    </button>
                                  )}
                                  {/* CF-RJ1 — Rejouer on a Passée campaign (clone → Période). */}
                                  {!campaign.event_id && canReplayCampaign(campaign.status) && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setOpenActionRowId(null);
                                        void handleReplayCampaign(campaign);
                                      }}
                                      className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                                    >
                                      Rejouer
                                    </button>
                                  )}
                                  {canBoostCampaign(campaign.status) && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setOpenActionRowId(null);
                                        if (campaign.event_id) {
                                          setBoostPositioningTarget(campaign.raw);
                                        } else {
                                          setBoostTarget(campaign.raw);
                                        }
                                      }}
                                      className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                                    >
                                      Booster
                                    </button>
                                  )}
                                  {canDeleteDraftCampaign(campaign.status) && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setOpenActionRowId(null);
                                        handleEditCampaign(campaign);
                                      }}
                                      className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                                    >
                                      Reprendre le brouillon
                                    </button>
                                  )}
                                  {canDeleteDraftCampaign(campaign.status) && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setOpenActionRowId(null);
                                        handleDeleteDraftCampaign(campaign);
                                      }}
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
                  })
                )}
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
              Affichage de <span className="font-medium text-[#00263A]">{startIndex + 1}</span> à{' '}
              <span className="font-medium text-[#00263A]">
                {Math.min(startIndex + itemsPerPage, filteredCampaigns.length)}
              </span>{' '}
              sur <span className="font-medium text-[#00263A]">{filteredCampaigns.length}</span>{' '}
              résultats
            </p>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
              disabled={currentPage === 1}
              className="p-2 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 hover:border-brand-primary disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <span className="px-4 py-2 text-sm font-medium text-[#00263A]">
              Page {currentPage} sur {totalPages}
            </span>
            <button
              onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
              disabled={currentPage === totalPages}
              className="p-2 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 hover:border-brand-primary disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>
        </div>
      </div>

      {/* Panneau droit (drawer) Détails de Campagne — 480px, design maquette.
          Guard on selectedCampaign (not showDetailsModal) so the drawer stays
          mounted through the <Drawer> exit animation; `open` drives the slide. */}
      {selectedCampaign &&
        (() => {
          // CF-S1 — the drawer badge reads the SAME map as the cards/rows.
          const statusUi = campaignStatusUi(selectedCampaign.status);
          const st = { label: statusUi.label, ...statusUi.drawer };
          return (
            <CampaignDrawer
              open={showDetailsModal}
              onClose={closeDetailsDrawer}
              campaign={selectedCampaign}
              creative={
                selectedCreativeId
                  ? {
                      creativeType: selectedCreative?.creative_type,
                      title: selectedCreative?.title ?? null,
                      durationSeconds: selectedCreative?.duration_seconds ?? null,
                      url: previewUrl.data?.url,
                      isLoading: previewUrl.isLoading,
                    }
                  : null
              }
              impressions={impressionsDisplay(selectedCampaign, pricing.data)}
              eventPlacementSlot={
                selectedCampaign?.event_id ? (
                  <EventPlacementSummary campaignId={selectedCampaign.id} />
                ) : undefined
              }
              variant="advertiser"
              statusBadge={
                <span
                  className="inline-flex items-center gap-1.5 w-fit px-2 py-0.5 rounded-md"
                  style={{ background: st.bg, border: `1px solid ${st.border}` }}
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ background: st.dot }}
                  />
                  <span
                    className="text-xs font-medium"
                    style={{ color: st.text, letterSpacing: '-0.006em', lineHeight: '16px' }}
                  >
                    {st.label}
                  </span>
                </span>
              }
              footerSlot={
                <div className="flex flex-row items-center gap-4">
                  <button
                    type="button"
                    onClick={closeDetailsDrawer}
                    className="flex-1 flex items-center justify-center py-2 px-3 rounded-[10px] bg-white border border-[#EBEBEB] text-sm font-medium text-[#5C5C5C] hover:bg-gray-50 transition-colors"
                    style={{ boxShadow: '0px 1px 2px rgba(10, 13, 20, 0.0313726)' }}
                  >
                    Fermer
                  </button>
                  {
                    canDeleteDraftCampaign(selectedCampaign.status) ? (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            const c = selectedCampaign;
                            closeDetailsDrawer();
                            setTimeout(() => handleEditCampaign(c), 320);
                          }}
                          className="flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-[10px] border border-[#1FC16B] text-sm font-medium text-[#1FC16B] bg-[#E3F7EC] hover:opacity-90 transition-opacity"
                          style={{ boxShadow: '0px 1px 2px rgba(10, 13, 20, 0.0313726)' }}
                        >
                          <RotateCcw className="h-5 w-5" />
                          Reprendre le brouillon
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
                    ) : selectedCampaign.status === 'rejected' ? (
                      <button
                        type="button"
                        onClick={() => {
                          const c = selectedCampaign;
                          closeDetailsDrawer();
                          setTimeout(() => handleEditCampaign(c), 320);
                        }}
                        className="flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-[10px] border border-[#1FC16B] text-sm font-medium text-[#1FC16B] bg-[#E3F7EC] hover:opacity-90 transition-opacity"
                        style={{ boxShadow: '0px 1px 2px rgba(10, 13, 20, 0.0313726)' }}
                      >
                        <RotateCcw className="h-5 w-5" />
                        Reprendre
                      </button>
                    ) : canBoostCampaign(selectedCampaign.status) ? (
                      <button
                        type="button"
                        onClick={() => {
                          const c = selectedCampaign;
                          closeDetailsDrawer();
                          setTimeout(
                            () =>
                              c.event_id ? setBoostPositioningTarget(c.raw) : setBoostTarget(c.raw),
                            320,
                          );
                        }}
                        className="flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-[10px] border border-[#1FC16B] text-sm font-medium text-[#1FC16B] bg-[#E3F7EC] hover:opacity-90 transition-opacity"
                        style={{ boxShadow: '0px 1px 2px rgba(10, 13, 20, 0.0313726)' }}
                      >
                        <Rocket className="h-5 w-5" />
                        Booster
                      </button>
                    ) : !selectedCampaign.event_id && canReplayCampaign(selectedCampaign.status) ? (
                      /* CF-RJ1 — a Passée campaign is replayable from the drawer too. */
                      <button
                        type="button"
                        onClick={() => {
                          const c = selectedCampaign;
                          closeDetailsDrawer();
                          setTimeout(() => void handleReplayCampaign(c), 320);
                        }}
                        className="flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-[10px] border border-[#1FC16B] text-sm font-medium text-[#1FC16B] bg-[#E3F7EC] hover:opacity-90 transition-opacity"
                        style={{ boxShadow: '0px 1px 2px rgba(10, 13, 20, 0.0313726)' }}
                      >
                        <Repeat className="h-5 w-5" />
                        Rejouer
                      </button>
                    ) : null /* CF-S1: pending/upcoming are Consulter-only in the drawer */
                  }
                </div>
              }
            />
          );
        })()}
      {boostTarget && (
        <BoostCampaignModal
          campaign={boostTarget}
          userId={user?.id}
          onClose={() => setBoostTarget(null)}
        />
      )}

      {/* EV6 — the POSITIONING booster: its own surface, the campaign one untouched beside it. */}
      {boostPositioningTarget && (
        <BoostPositioningModal
          campaign={boostPositioningTarget}
          onClose={() => setBoostPositioningTarget(null)}
        />
      )}
    </div>
  );
}
