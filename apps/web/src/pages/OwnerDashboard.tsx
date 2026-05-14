import {
  Plus,
  AlertTriangle,
  CheckCircle,
  XCircle,
  DollarSign,
  Monitor,
  Gift,
  Calendar,
  CalendarX,
  BarChart3,
  TrendingUp,
  Bell,
  Settings,
  Star,
  LayoutGrid,
  Megaphone,
  Eye,
  Building2,
} from 'lucide-react';
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { toast } from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';

import AddScreen from '../components/AddScreen';
import GiftCatalog from '../components/GiftCatalog';
import OwnerNavigation from '../components/OwnerNavigation';
import OwnerNotificationsBell from '../components/OwnerNotificationsBell';
import { logger } from '../lib/logger';
import { authService } from '../services/auth.service';
import { campaignOwnerApprovalService } from '../services/campaign-owner-approval.service';
import { revenueService, RevenueStats } from '../services/revenue.service';
import { screensService, Screen } from '../services/screens.service';
import { useAuthStore } from '../stores/auth.store';

const log = logger.child({ module: 'OwnerDashboard' });

interface Alert {
  id: string;
  type: 'warning' | 'info' | 'success' | 'error';
  title: string;
  message: string;
  timestamp: string;
}

interface OwnerDashboardNotification {
  id: string;
  title: string;
  createdAt: Date;
  actionLabel: string;
  actionPath: string;
}

/** Mettre à true pour réafficher Mes écrans, Mes revenus et Rewards sur le dashboard */
const SHOW_OWNER_DASHBOARD_LEGACY_SECTIONS = false;

export default function OwnerDashboard() {
  const navigate = useNavigate();
  const { user, profileType, needsApproval, validationStatus } = useAuthStore();

  // Fonction pour déterminer si les fonctionnalités sont désactivées
  const isDisabled = needsApproval && validationStatus === 'pending';
  const [loading, setLoading] = useState(true);
  const [screens, setScreens] = useState<Screen[]>([]);
  const [stats, setStats] = useState<RevenueStats>({
    totalRevenue: 0,
    monthlyRevenue: 0,
    quarterlyRevenue: 0,
    yearlyRevenue: 0,
    averagePerScreen: 0,
    topPerformingScreen: '',
    growthRate: 0,
    activeScreens: 0,
    totalScreens: 0,
    loyaltyPoints: 0,
  });
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [accountStatus, setAccountStatus] = useState<'active' | 'pending' | 'suspended'>('active');
  // TODO(phase-1): typed source [supabase] — see #15
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [profile, setProfile] = useState<any>(null);
  const [businessSectorName, setBusinessSectorName] = useState<string>('');
  const [showGiftCatalog, setShowGiftCatalog] = useState(false);
  const [showAddScreen, setShowAddScreen] = useState(false);
  const [selectedEstablishment, setSelectedEstablishment] = useState<string | null>(null);
  const [ownerNotifications, setOwnerNotifications] = useState<OwnerDashboardNotification[]>([]);

  // ✅ OPTIMISATION : useRef pour éviter les rechargements multiples
  const hasLoadedData = useRef(false);

  // ✅ OPTIMISATION : Mémoriser la fonction loadDashboardData avec useCallback
  const loadDashboardData = useCallback(async () => {
    try {
      setLoading(true);

      // Charger le profil utilisateur
      const profileData = await authService.getBusinessProfile();
      setProfile(profileData);

      try {
        const sectors = await authService.getBusinessSectors();
        const sid = profileData?.business_sector_id;
        const found = sectors.find((s) => s.id === sid);
        setBusinessSectorName(found?.name?.trim() || '');
      } catch {
        setBusinessSectorName('');
      }

      // Charger les écrans depuis la base de données
      const screensData = await screensService.getScreens();
      setScreens(screensData);

      // Charger les statistiques de revenus complètes
      const revenueStats = await revenueService.getRevenueStats();

      // Utiliser directement les statistiques du service
      setStats(revenueStats);

      // Générer les alertes basées sur les données réelles
      const generatedAlerts: Alert[] = [];

      // Alerte pour les écrans en maintenance
      const maintenanceScreens = screensData.filter((screen) => screen.status === 'maintenance');
      if (maintenanceScreens.length > 0) {
        generatedAlerts.push({
          id: 'maintenance',
          type: 'warning',
          title: 'Écrans en maintenance',
          message: `${maintenanceScreens.length} écran(s) sont actuellement en maintenance.`,
          timestamp: new Date().toISOString(),
        });
      }

      // Alerte pour les écrans inactifs
      const inactiveScreens = screensData.filter((screen) => screen.status === 'inactive');
      if (inactiveScreens.length > 0) {
        generatedAlerts.push({
          id: 'inactive',
          type: 'info',
          title: 'Écrans inactifs',
          message: `${inactiveScreens.length} écran(s) sont inactifs et ne génèrent pas de revenus.`,
          timestamp: new Date().toISOString(),
        });
      }

      // Alerte pour les écrans indisponibles
      const unavailableScreens = screensData.filter((screen) => screen.status === 'unavailable');
      if (unavailableScreens.length > 0) {
        generatedAlerts.push({
          id: 'unavailable',
          type: 'warning',
          title: 'Écrans indisponibles',
          message: `${unavailableScreens.length} écran(s) sont temporairement indisponibles.`,
          timestamp: new Date().toISOString(),
        });
      }

      // Alerte de succès pour les revenus
      if (revenueStats.monthlyRevenue > 0) {
        generatedAlerts.push({
          id: 'revenue',
          type: 'success',
          title: 'Revenus générés',
          message: `Vos écrans ont généré ${revenueStats.monthlyRevenue.toLocaleString('fr-TN', { style: 'currency', currency: 'TND' })} ce mois-ci.`,
          timestamp: new Date().toISOString(),
        });
      }

      // Alerte pour les points fidélité
      if (revenueStats.loyaltyPoints > 100) {
        generatedAlerts.push({
          id: 'loyalty',
          type: 'info',
          title: 'Points fidélité disponibles',
          message: `Vous avez ${revenueStats.loyaltyPoints} points fidélité à échanger dans le catalogue.`,
          timestamp: new Date().toISOString(),
        });
      }

      setAlerts(generatedAlerts.slice(0, 5)); // Limiter à 5 alertes

      const currentUser = await authService.getCurrentUser();
      if (currentUser?.id) {
        try {
          const pendingCampaigns = await campaignOwnerApprovalService.getPendingCampaigns(
            currentUser.id,
          );
          const mappedNotifications: OwnerDashboardNotification[] = (pendingCampaigns || [])
            .filter((c) => (c.approval_status || 'pending') === 'pending')
            .map((c) => ({
              id: `pending-${c.campaign_id}`,
              title: c.campaign_name
                ? `Nouvelle campagne à diffuser sur votre parc: ${c.campaign_name}`
                : 'Nouvelle campagne à diffuser sur votre parc',
              createdAt: new Date(c.campaign_start_date || Date.now()),
              actionLabel: 'Consulter',
              actionPath: '/owner-campaign-approvals',
            }));
          setOwnerNotifications(mappedNotifications);
        } catch (notificationError) {
          log.error(
            { notificationError },
            'Erreur chargement notifications dashboard propriétaire',
          );
          setOwnerNotifications([]);
        }
      } else {
        setOwnerNotifications([]);
      }

      hasLoadedData.current = true; // ✅ Marquer comme chargé
    } catch (error) {
      toast.error('Erreur lors du chargement des données');
    } finally {
      setLoading(false);
    }
  }, []); // ✅ Pas de dépendances - la fonction ne change jamais

  // ✅ OPTIMISATION : useEffect séparé pour l'authentification
  useEffect(() => {
    if (!user) {
      navigate('/login');
      return;
    }
  }, [user, navigate]);

  // ✅ OPTIMISATION : useEffect séparé pour le chargement initial des données
  useEffect(() => {
    if (user && !hasLoadedData.current) {
      loadDashboardData();
    }
  }, [user, profileType, loadDashboardData]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'text-green-400 bg-green-500/20 border border-green-500/30';
      case 'inactive':
        return 'text-red-400 bg-red-500/20 border border-red-500/30';
      case 'maintenance':
        return 'text-yellow-400 bg-yellow-500/20 border border-yellow-500/30';
      case 'unavailable':
        return 'text-gray-400 bg-gray-500/20 border border-gray-500/30';
      default:
        return 'text-gray-400 bg-gray-500/20 border border-gray-500/30';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'active':
        return 'Actif';
      case 'inactive':
        return 'Inactif';
      case 'maintenance':
        return 'Maintenance';
      case 'unavailable':
        return 'Indisponible';
      default:
        return 'Inconnu';
    }
  };

  const getAccountStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'text-green-400 bg-green-500/20 border border-green-500/30';
      case 'pending':
        return 'text-yellow-400 bg-yellow-500/20 border border-yellow-500/30';
      case 'suspended':
        return 'text-red-400 bg-red-500/20 border border-red-500/30';
      default:
        return 'text-gray-400 bg-gray-500/20 border border-gray-500/30';
    }
  };

  const getAccountStatusText = (status: string) => {
    switch (status) {
      case 'active':
        return 'Actif';
      case 'pending':
        return 'En attente';
      case 'suspended':
        return 'Suspendu';
      default:
        return 'Inconnu';
    }
  };

  const getAlertIcon = (type: string) => {
    switch (type) {
      case 'warning':
        return <AlertTriangle className="h-5 w-5 text-yellow-500" />;
      case 'info':
        return <Bell className="h-5 w-5 text-blue-500" />;
      case 'success':
        return <CheckCircle className="h-5 w-5 text-green-500" />;
      case 'error':
        return <XCircle className="h-5 w-5 text-red-500" />;
      default:
        return <Bell className="h-5 w-5 text-gray-500" />;
    }
  };

  // Fonctions de redirection pour les widgets
  const handleNavigateToScreens = () => {
    navigate('/owner-calendar-devices');
    toast.success('Redirection vers le calendrier des dispositifs');
  };

  const handleNavigateToRevenue = () => {
    navigate('/owner-revenue');
    toast.success('Redirection vers la page des revenus');
  };

  const handleNavigateToLocations = () => {
    navigate('/owner-locations');
    toast.success('Redirection vers la page des emplacements');
  };

  const handleNavigateToGiftCatalog = () => {
    setShowGiftCatalog(true);
  };

  const handleDeclareUnavailability = () => {
    navigate('/owner-calendar-devices');
  };

  const handleAddScreen = () => {
    setShowAddScreen(true);
  };

  const handleViewDetailedRevenue = () => {
    // Rediriger vers /owner-revenue en mode tableau
    navigate('/owner-revenue?viewMode=table');
  };

  const handleAccessGiftCatalog = () => {
    setShowGiftCatalog(true);
  };

  const formatDuration = (totalSeconds: number) => {
    const n = Number(totalSeconds) || 0;
    const h = Math.floor(n / 3600);
    const m = Math.floor((n % 3600) / 60);
    const s = Math.floor(n % 60);
    return [h, m, s].map((v) => String(v).padStart(2, '0')).join(':');
  };

  const formatRelativeTime = (date: Date) => {
    const diffMs = Math.max(0, Date.now() - date.getTime());
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return "À l'instant";
    if (mins < 60) return `il y a ${mins} min`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `il y a ${hours} h`;
    const days = Math.floor(hours / 24);
    return `il y a ${days} j`;
  };

  const ownerKpi = useMemo(
    () => ({
      campaignsDiffused: 0,
      impressions: 0,
      totalDurationSeconds: 0,
    }),
    [],
  );

  const establishmentsWithStatus = useMemo(() => {
    const list = Array.isArray(screens) ? screens : [];
    const byLocation = new Map<
      string,
      {
        name: string;
        screens: Screen[];
        status: 'active' | 'inactive' | 'maintenance' | 'unavailable';
      }
    >();
    list.forEach((s) => {
      const loc = s.location || s.name || 'Établissement';
      if (!byLocation.has(loc)) {
        const status: 'active' | 'inactive' | 'maintenance' | 'unavailable' =
          s.status === 'active'
            ? 'active'
            : s.status === 'maintenance'
              ? 'maintenance'
              : s.status === 'unavailable'
                ? 'unavailable'
                : 'inactive';
        byLocation.set(loc, { name: loc, screens: [s], status });
      } else {
        const entry = byLocation.get(loc)!;
        entry.screens.push(s);
        if (s.status === 'active') entry.status = 'active';
        else if (s.status === 'maintenance' && entry.status !== 'active')
          entry.status = 'maintenance';
        else if (
          s.status === 'unavailable' &&
          entry.status !== 'active' &&
          entry.status !== 'maintenance'
        )
          entry.status = 'unavailable';
        else if (entry.status !== 'active' && entry.status !== 'maintenance')
          entry.status = 'inactive';
      }
    });
    return Array.from(byLocation.values());
  }, [screens]);

  useEffect(() => {
    if (!selectedEstablishment) return;
    const exists = establishmentsWithStatus.some((e) => e.name === selectedEstablishment);
    if (!exists) setSelectedEstablishment(null);
  }, [establishmentsWithStatus, selectedEstablishment]);

  const establishmentScreenRows = useMemo(() => {
    const source = selectedEstablishment
      ? establishmentsWithStatus.filter((e) => e.name === selectedEstablishment)
      : establishmentsWithStatus;

    return source.flatMap((est) =>
      est.screens.map((screen) => ({
        id: screen.id,
        establishmentName: est.name,
        screenName: screen.name || 'Écran',
        status: screen.status,
      })),
    );
  }, [establishmentsWithStatus, selectedEstablishment]);

  const latestOwnerNotification = useMemo(() => {
    if (ownerNotifications.length === 0) return null;
    return [...ownerNotifications].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  }, [ownerNotifications]);
  const hasOwnerLegalDocument = Boolean(
    profile?.cin_doc_url || profile?.registration_doc_path || profile?.registration_doc_url,
  );
  const hasOwnerBankDetails = Boolean(
    profile?.bank_account_holder &&
    profile?.bank_rib &&
    profile?.bank_iban &&
    (profile?.bank_doc_path || profile?.bank_doc_url),
  );
  const isOwnerAccountActive = validationStatus === 'approved' && profile?.is_active !== false;
  const hideOwnerGettingStartedBlock =
    hasOwnerLegalDocument && hasOwnerBankDetails && isOwnerAccountActive;

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-[#00B3A6] mx-auto mb-4"></div>
          <p className="text-gray-600">Chargement...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      <div className="flex h-screen">
        {/* Navigation */}
        <OwnerNavigation isDisabled={isDisabled} />

        {/* Main content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Header (même design que annonceur) */}
          <header className="flex-none h-16 bg-white border-b border-gray-200 sticky top-0 z-40 shadow-sm">
            <div className="h-full w-full px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-4 flex-nowrap">
              <div className="flex items-center gap-3 min-w-0 flex-shrink-0">
                <div className="flex items-center justify-center flex-shrink-0 w-10 h-10 rounded-full border border-gray-200 bg-white">
                  <LayoutGrid className="h-5 w-5 text-gray-600" strokeWidth={1.5} />
                </div>
                <div className="min-w-0 flex-1">
                  <h1 className="text-base sm:text-lg font-bold text-gray-900 truncate">
                    Bonjour, {profile?.contact_name || user?.email?.split('@')[0] || 'Utilisateur'}
                  </h1>
                  <p className="text-xs text-gray-500 truncate hidden sm:block">
                    Consultez vos revenus et suivez les campagnes diffusées dans votre établissement
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                {/* Message de validation en attente ou badge actif */}
                {needsApproval && validationStatus === 'pending' ? (
                  // En attente de validation admin
                  <div className="flex items-center px-4 py-2 bg-blue-100 text-blue-800 rounded-lg border border-blue-300">
                    <svg
                      className="h-4 w-4 mr-2 animate-spin"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      ></circle>
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      ></path>
                    </svg>
                    <span className="text-sm font-medium">
                      Votre compte est en cours de validation par un administrateur
                    </span>
                  </div>
                ) : !needsApproval && validationStatus === 'approved' ? (
                  // Compte validé
                  <div className="flex items-center px-4 py-2 bg-green-100 text-green-800 rounded-lg border border-green-300">
                    <svg
                      className="h-4 w-4 mr-2"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                      />
                    </svg>
                    <span className="text-sm font-medium">Compte actif</span>
                  </div>
                ) : null}

                <OwnerNotificationsBell userId={user?.id} />

                <button
                  onClick={() => navigate('/my-account')}
                  className="hidden p-2 rounded-lg hover:bg-gray-100 transition-colors text-gray-600"
                  aria-hidden
                >
                  <Settings className="h-5 w-5" />
                </button>
              </div>
            </div>
          </header>

          <div className="flex-1 overflow-y-auto">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
              {/* Ligne 1 : Revenus + Bloc entreprise (harmonisé annonceur) */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="rounded-2xl bg-gradient-to-tr from-[#3db39a] via-[#1a6b5a] to-[#0a3d32] p-8 sm:p-10 shadow-lg min-h-[160px] sm:min-h-[180px] flex flex-col justify-center">
                  <p className="text-lg font-medium text-white/95 mb-3">Revenus</p>
                  <p className="text-3xl sm:text-4xl font-bold text-white tracking-tight tabular-nums font-sans">
                    {loading
                      ? '...'
                      : `${(stats.totalRevenue ?? 0).toLocaleString('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} TND`}
                  </p>
                </div>
                <div className="rounded-2xl border border-[#E1E4EA] bg-white p-6 sm:p-8 shadow-lg min-h-[160px] sm:min-h-[180px] flex flex-row items-center gap-5 sm:gap-6">
                  <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-xl bg-gray-100 border border-gray-200 flex-shrink-0 flex items-center justify-center overflow-hidden shadow-inner">
                    {profile?.logo_url ? (
                      <img src={profile.logo_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <Building2 className="h-14 w-14 sm:h-16 sm:w-16 text-gray-400" />
                    )}
                  </div>
                  <div className="flex-1 w-full min-w-0 flex flex-col justify-center gap-4">
                    <div className="w-full flex flex-col gap-1.5">
                      <span className="text-xs font-semibold text-gray-600 leading-tight">
                        Catégorie
                      </span>
                      <div className="w-full min-h-[44px] px-4 py-2.5 rounded-xl border border-gray-200 text-gray-900 text-sm bg-gray-50/80 flex items-center">
                        {loading ? (
                          <span className="text-gray-400">…</span>
                        ) : (
                          <span className="font-medium">{businessSectorName || '—'}</span>
                        )}
                      </div>
                    </div>
                    <div className="w-full flex flex-col gap-1.5">
                      <span className="text-xs font-semibold text-gray-600 leading-tight">
                        {profile?.profile_type === 'individual_owner'
                          ? 'Zone géographique'
                          : 'Taille du réseau'}
                      </span>
                      <div className="w-full min-h-[44px] px-4 py-2.5 rounded-xl border border-gray-200 text-gray-900 text-sm bg-gray-50/80 flex items-center">
                        {loading ? (
                          <span className="text-gray-400">…</span>
                        ) : (
                          <span className="font-medium">
                            {profile?.profile_type === 'individual_owner'
                              ? profile?.zone?.trim()
                                ? profile.zone
                                : '—'
                              : profile?.company_size?.trim()
                                ? profile.company_size
                                : '—'}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Statut des Établissements */}
              <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
                <div className="flex flex-row flex-wrap items-center justify-between gap-4 px-5 py-4 border-b border-gray-200 bg-gray-50/50">
                  <h2 className="text-lg font-semibold text-gray-900">Statut des Établissements</h2>
                  <button
                    type="button"
                    onClick={() => navigate('/owner-calendar-devices')}
                    className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#9ae2b0] hover:bg-[#85d99e] text-gray-900 text-sm font-medium transition-colors"
                  >
                    <Calendar className="h-4 w-4" />
                    Piloter mon calendrier de diffusion
                  </button>
                </div>
                <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 gap-4">
                  {establishmentsWithStatus.length === 0 ? (
                    <div className="col-span-full rounded-xl border border-dashed border-gray-200 p-6 text-center text-gray-500 text-sm">
                      Aucun établissement pour le moment. Enregistrez un écran pour commencer.
                    </div>
                  ) : (
                    establishmentsWithStatus.map((est, idx) => {
                      const statusConfig = {
                        active: {
                          label: 'Actif',
                          bg: 'bg-[#e8f6ed]',
                          text: 'text-[#16a34a]',
                          dot: 'bg-[#16a34a]',
                        },
                        inactive: {
                          label: 'Inactif',
                          bg: 'bg-red-50',
                          text: 'text-red-600',
                          dot: 'bg-red-500',
                        },
                        maintenance: {
                          label: 'En panne',
                          bg: 'bg-amber-50',
                          text: 'text-amber-600',
                          dot: 'bg-amber-500',
                        },
                        unavailable: {
                          label: 'En panne',
                          bg: 'bg-amber-50',
                          text: 'text-amber-600',
                          dot: 'bg-amber-500',
                        },
                      };
                      const sc = statusConfig[est.status];
                      const isSelected = selectedEstablishment === est.name;
                      return (
                        <button
                          key={idx}
                          type="button"
                          onClick={() =>
                            setSelectedEstablishment((prev) =>
                              prev === est.name ? null : est.name,
                            )
                          }
                          className={`rounded-xl border bg-white p-4 shadow-sm flex items-center justify-between gap-3 text-left transition-colors ${
                            isSelected
                              ? 'border-[#76E6AB] ring-1 ring-[#76E6AB]/60'
                              : 'border-gray-200 hover:border-gray-300'
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <p className="font-medium text-gray-900 truncate">{est.name}</p>
                          </div>
                          <span
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium flex-shrink-0 ${sc.bg} ${sc.text}`}
                          >
                            <span className={`w-1.5 h-1.5 rounded-full ${sc.dot}`} />
                            {sc.label}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
                {establishmentsWithStatus.length > 0 && (
                  <div className="px-4 pb-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {establishmentScreenRows.map((row) => {
                        const statusConfig = {
                          active: {
                            label: 'Active',
                            bg: 'bg-[#e8f6ed]',
                            text: 'text-[#16a34a]',
                            dot: 'bg-[#16a34a]',
                          },
                          inactive: {
                            label: 'Inactif',
                            bg: 'bg-red-50',
                            text: 'text-red-600',
                            dot: 'bg-red-500',
                          },
                          maintenance: {
                            label: 'En panne',
                            bg: 'bg-amber-50',
                            text: 'text-amber-600',
                            dot: 'bg-amber-500',
                          },
                          unavailable: {
                            label: 'En panne',
                            bg: 'bg-amber-50',
                            text: 'text-amber-600',
                            dot: 'bg-amber-500',
                          },
                        } as const;
                        const sc = statusConfig[row.status] || statusConfig.inactive;
                        return (
                          <div
                            key={row.id}
                            className="rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm flex items-center justify-between gap-3"
                          >
                            <p className="font-medium text-gray-900 truncate">
                              {row.establishmentName} {row.screenName}
                            </p>
                            <span
                              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium flex-shrink-0 ${sc.bg} ${sc.text}`}
                            >
                              <span className={`w-1.5 h-1.5 rounded-full ${sc.dot}`} />
                              {sc.label}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* KPIs (Revenus cumulés, Campagnes diffusées, Impressions, Durée) — style annonceur */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
                <div className="rounded-xl p-5 min-h-[120px] flex flex-col bg-[#fdfaed] border border-[#edcc7a]/30">
                  <div className="flex items-center justify-between gap-2 mb-3 min-h-[1.25rem]">
                    <span className="text-xs font-semibold text-[#c9a227] whitespace-nowrap truncate min-w-0">
                      Revenus cumulés
                    </span>
                    <DollarSign className="h-5 w-5 text-[#c9a227] flex-shrink-0" />
                  </div>
                  <p className="text-3xl font-bold text-[#1a1a1a] tabular-nums font-sans mt-auto">
                    {loading
                      ? '...'
                      : (stats.totalRevenue ?? 0).toLocaleString('fr-FR', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                  </p>
                  <p
                    className={`text-xs mt-1 ${(stats.growthRate ?? 0) >= 0 ? 'text-[#16a34a]' : 'text-red-500'}`}
                  >
                    {(stats.growthRate ?? 0) >= 0 ? '+' : ''}
                    {stats.growthRate ?? 0}% Année précédente
                  </p>
                </div>
                <div className="rounded-xl p-5 min-h-[120px] flex flex-col bg-[#e8f6ed] border border-[#85cc95]/30">
                  <div className="flex items-center justify-between gap-2 mb-3 min-h-[1.25rem]">
                    <span className="text-xs font-semibold text-[#85cc95] whitespace-nowrap truncate min-w-0">
                      Campagnes diffusées
                    </span>
                    <Megaphone className="h-5 w-5 text-[#85cc95] flex-shrink-0" />
                  </div>
                  <p className="text-3xl font-bold text-[#1a1a1a] tabular-nums font-sans mt-auto">
                    {loading ? '...' : ownerKpi.campaignsDiffused}
                  </p>
                  <p className="text-xs mt-1 text-[#16a34a]">+12% Année précédente</p>
                </div>
                <div className="rounded-xl p-5 min-h-[120px] flex flex-col bg-[#edf1fe] border border-[#6e82f6]/30">
                  <div className="flex items-center justify-between gap-2 mb-3 min-h-[1.25rem]">
                    <span className="text-xs font-semibold text-[#6e82f6] whitespace-nowrap truncate min-w-0">
                      Impressions générées
                    </span>
                    <Eye className="h-5 w-5 text-[#6e82f6] flex-shrink-0" />
                  </div>
                  <p className="text-3xl font-bold text-[#1a1a1a] tabular-nums font-sans mt-auto">
                    {loading
                      ? '...'
                      : ownerKpi.impressions.toLocaleString('fr-FR').replace(/\s/g, ' ')}
                  </p>
                  <p className="text-xs mt-1 text-red-500">-22% Année précédente</p>
                </div>
                <div className="rounded-xl p-5 min-h-[120px] flex flex-col bg-[#eeecfd] border border-[#a08cf0]/30">
                  <div className="flex items-center justify-between gap-2 mb-3 min-h-[1.25rem]">
                    <span className="text-xs font-semibold text-[#a08cf0] whitespace-nowrap truncate min-w-0">
                      Durée totale de diffusion
                    </span>
                    <Monitor className="h-5 w-5 text-[#a08cf0] flex-shrink-0" />
                  </div>
                  <p className="text-3xl font-bold text-[#1a1a1a] tabular-nums font-sans mt-auto font-mono">
                    {loading ? '...' : formatDuration(ownerKpi.totalDurationSeconds)}
                  </p>
                  <p className="text-xs mt-1 text-red-500">-22% Année précédente</p>
                </div>
              </div>

              {/* Pour bien commencer (propriétaire) */}
              {!hideOwnerGettingStartedBlock && (
                <div className="rounded-2xl border border-gray-200 bg-[#F8FAFC] p-5 shadow-sm">
                  <h2 className="text-lg font-bold text-gray-900">Pour bien commencer</h2>
                  <p className="text-sm text-gray-600 mt-1 mb-4">
                    Suivez ces étapes pour configurer votre compte
                  </p>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                    <div className="rounded-2xl border border-[#E4E7EC] bg-white p-5 flex items-start gap-4">
                      {hasOwnerLegalDocument ? (
                        <div className="w-10 h-10 rounded-full bg-[#60BA76] flex items-center justify-center flex-shrink-0">
                          <CheckCircle className="h-5 w-5 text-white" />
                        </div>
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-[#EFF5F2] text-[#171717] flex items-center justify-center text-sm font-semibold flex-shrink-0">
                          1
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <h3 className="text-xl font-semibold text-gray-900">
                          Complétez votre profil
                        </h3>
                        <p className="text-sm text-gray-600 mt-1">Uploadez votre document légal</p>
                        <button
                          type="button"
                          onClick={() => navigate('/owner-settings?tab=entreprise&sub=documents')}
                          disabled={hasOwnerLegalDocument}
                          className={`mt-4 inline-flex items-center justify-center px-5 py-2 rounded-xl text-sm font-medium transition-colors ${
                            hasOwnerLegalDocument
                              ? 'bg-[#F2F4F7] text-[#98A2B3] cursor-not-allowed'
                              : 'bg-white border border-[#D0D5DD] text-[#344054] hover:bg-gray-50'
                          }`}
                        >
                          {hasOwnerLegalDocument ? 'OK' : 'Upload'}
                        </button>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-[#E4E7EC] bg-white p-5 flex items-start gap-4">
                      {hasOwnerBankDetails ? (
                        <div className="w-10 h-10 rounded-full bg-[#60BA76] flex items-center justify-center flex-shrink-0">
                          <CheckCircle className="h-5 w-5 text-white" />
                        </div>
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-[#EFF5F2] text-[#171717] flex items-center justify-center text-sm font-semibold">
                          2
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <h3 className="text-xl font-semibold text-gray-900">
                          Ajouter les coordonnées bancaires de votre établissement
                        </h3>
                        <p className="text-sm text-gray-600 mt-1">
                          Configurez votre moyen de versement
                        </p>
                        <button
                          type="button"
                          onClick={() =>
                            navigate('/owner-settings?tab=entreprise&sub=coordonnees-bancaires')
                          }
                          disabled={hasOwnerBankDetails}
                          className={`mt-4 inline-flex items-center justify-center px-5 py-2 rounded-xl text-sm font-medium transition-colors ${
                            hasOwnerBankDetails
                              ? 'bg-[#F2F4F7] text-[#98A2B3] cursor-not-allowed'
                              : 'bg-white border border-[#D0D5DD] text-[#344054] hover:bg-gray-50'
                          }`}
                        >
                          {hasOwnerBankDetails ? 'OK' : 'Ajouter'}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Bloc Notifications propriétaire (dernière notif ou message vide) */}
              <section
                className="rounded-2xl border border-[#b8e6c9] bg-[#f7fcf8] p-5 sm:p-6 shadow-sm"
                aria-labelledby="owner-notifications-heading"
              >
                <h2 id="owner-notifications-heading" className="text-lg font-bold text-gray-900">
                  Notifications
                </h2>

                {latestOwnerNotification ? (
                  <ul className="flex flex-col gap-6">
                    <li key={latestOwnerNotification.id} className="flex flex-row gap-4">
                      <div className="relative flex-shrink-0">
                        <div className="w-12 h-12 rounded-full border border-gray-200 bg-white flex items-center justify-center shadow-sm">
                          <Calendar className="h-5 w-5 text-gray-800" strokeWidth={1.5} />
                        </div>
                        <span
                          className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-red-500 ring-2 ring-[#f7fcf8]"
                          aria-hidden
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-gray-900 text-[15px] leading-snug">
                          {latestOwnerNotification.title}
                        </p>
                        <p className="text-xs text-gray-400 mt-1.5">
                          {formatRelativeTime(latestOwnerNotification.createdAt)}
                        </p>
                        <div className="flex flex-wrap items-center gap-2 sm:gap-3 mt-4">
                          <button
                            type="button"
                            onClick={() => navigate(latestOwnerNotification.actionPath)}
                            className="px-4 py-2 rounded-full text-sm font-medium text-gray-900 bg-white border border-gray-300 hover:bg-gray-50 transition-colors"
                          >
                            {latestOwnerNotification.actionLabel}
                          </button>
                        </div>
                      </div>
                    </li>
                  </ul>
                ) : (
                  <div className="rounded-xl border border-dashed border-gray-200 bg-white/70 p-4 text-sm text-gray-500">
                    Aucune notification
                  </div>
                )}
              </section>

              {SHOW_OWNER_DASHBOARD_LEGACY_SECTIONS && (
                <>
                  {/* Section Mes Écrans */}
                  <div className="mb-8">
                    <h3 className="text-2xl font-bold text-gray-900 mb-4 flex items-center">
                      <Monitor className="h-6 w-6 text-[#00B3A6] mr-2" />
                      Mes Écrans
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
                      {/* Ajouter un Écran */}
                      <button
                        onClick={() => setShowAddScreen(true)}
                        disabled={isDisabled}
                        className={`bg-white rounded-xl p-6 shadow-lg transition-all duration-300 border border-gray-200 text-left ${
                          isDisabled
                            ? 'opacity-50 cursor-not-allowed'
                            : 'hover:shadow-xl transform hover:-translate-y-1 cursor-pointer group'
                        }`}
                      >
                        <div className="flex items-center justify-center mb-4">
                          <div className="p-4 rounded-xl bg-gradient-to-br from-[#00B3A6] to-[#00B3A6]/80 shadow-lg group-hover:scale-110 transition-transform">
                            <Plus className="h-8 w-8 text-white" />
                          </div>
                        </div>
                        <p className="text-sm font-medium text-gray-600 text-center">
                          Enregistrer un nouvel écran
                        </p>
                      </button>

                      {/* Déclarer Indisponibilité */}
                      <button
                        onClick={handleDeclareUnavailability}
                        disabled={isDisabled}
                        className={`bg-white rounded-xl p-6 shadow-lg transition-all duration-300 border border-gray-200 text-left ${
                          isDisabled
                            ? 'opacity-50 cursor-not-allowed'
                            : 'hover:shadow-xl transform hover:-translate-y-1 cursor-pointer group'
                        }`}
                      >
                        <div className="flex items-center justify-center mb-4">
                          <div className="p-4 rounded-xl bg-gradient-to-br from-red-500/20 to-red-600/20 border border-red-500/30 shadow-lg group-hover:scale-110 transition-transform">
                            <CalendarX className="h-8 w-8 text-red-400" />
                          </div>
                        </div>
                        <p className="text-sm font-medium text-gray-600 text-center">
                          Marquer des écrans comme indisponibles
                        </p>
                      </button>

                      {/* Écrans Actifs */}
                      <button
                        onClick={handleNavigateToScreens}
                        disabled={isDisabled}
                        className={`bg-white rounded-xl p-6 shadow-lg transition-all duration-300 border border-gray-200 ${
                          isDisabled
                            ? 'opacity-50 cursor-not-allowed'
                            : 'hover:shadow-xl transform hover:-translate-y-1 cursor-pointer group'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-600 mb-1">Écrans Actifs</p>
                            <p className="text-3xl font-bold text-gray-900 group-hover:text-[#00B3A6] transition-colors">
                              {stats.activeScreens}/{stats.totalScreens}
                            </p>
                          </div>
                          <div className="p-3 rounded-xl bg-gradient-to-br from-[#00B3A6] to-[#00B3A6]/80 shadow-lg group-hover:scale-110 transition-transform flex-shrink-0 ml-3">
                            <Monitor className="h-6 w-6 text-white" />
                          </div>
                        </div>
                      </button>
                    </div>

                    {/* Widgets d'état des écrans */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      {/* Écrans en maintenance */}
                      <div className="bg-white rounded-xl p-4 shadow-lg border border-gray-200">
                        <div className="flex items-center space-x-3">
                          <div className="p-2 rounded-lg bg-gradient-to-br from-yellow-500/20 to-yellow-600/20 border border-yellow-500/30">
                            <AlertTriangle className="h-5 w-5 text-yellow-400" />
                          </div>
                          <div className="flex-1">
                            <p className="text-sm font-medium text-gray-700">
                              Écrans en maintenance
                            </p>
                            <p className="text-xs text-gray-500">
                              1 écran(s) sont actuellement en maintenance
                            </p>
                            <p className="text-xs text-gray-400 mt-1">15/08 14:05</p>
                          </div>
                        </div>
                      </div>

                      {/* Écrans inactifs */}
                      <div className="bg-white rounded-xl p-4 shadow-lg border border-gray-200">
                        <div className="flex items-center space-x-3">
                          <div className="p-2 rounded-lg bg-gradient-to-br from-blue-500/20 to-blue-600/20 border border-blue-500/30">
                            <Monitor className="h-5 w-5 text-blue-400" />
                          </div>
                          <div className="flex-1">
                            <p className="text-sm font-medium text-gray-700">Écrans inactifs</p>
                            <p className="text-xs text-gray-500">
                              1 écran(s) sont inactifs et ne génèrent pas de revenus
                            </p>
                            <p className="text-xs text-gray-400 mt-1">15/08 14:05</p>
                          </div>
                        </div>
                      </div>

                      {/* Écrans indisponibles */}
                      <div className="bg-white rounded-xl p-4 shadow-lg border border-gray-200">
                        <div className="flex items-center space-x-3">
                          <div className="p-2 rounded-lg bg-gradient-to-br from-yellow-500/20 to-yellow-600/20 border border-yellow-500/30">
                            <AlertTriangle className="h-5 w-5 text-yellow-400" />
                          </div>
                          <div className="flex-1">
                            <p className="text-sm font-medium text-gray-700">
                              Écrans indisponibles
                            </p>
                            <p className="text-xs text-gray-500">
                              1 écran(s) sont temporairement indisponibles
                            </p>
                            <p className="text-xs text-gray-400 mt-1">15/08 14:05</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Section Mes Revenus */}
                  <div className="mb-8">
                    <h3 className="text-2xl font-bold text-gray-900 mb-4 flex items-center">
                      <DollarSign className="h-6 w-6 text-[#00B3A6] mr-2" />
                      Mes Revenus
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      {/* Revenus du Mois */}
                      <button
                        onClick={handleNavigateToRevenue}
                        disabled={isDisabled}
                        className={`bg-white rounded-xl p-6 shadow-lg transition-all duration-300 border border-gray-200 ${
                          isDisabled
                            ? 'opacity-50 cursor-not-allowed'
                            : 'hover:shadow-xl transform hover:-translate-y-1 cursor-pointer group'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-600 mb-1">
                              Revenus du Mois
                            </p>
                            <p className="text-2xl font-bold text-gray-900 group-hover:text-[#00B3A6] transition-colors truncate">
                              {stats.monthlyRevenue.toLocaleString('fr-TN', {
                                style: 'currency',
                                currency: 'TND',
                              })}
                            </p>
                            <p className="text-xs text-gray-500 mt-2">
                              Cliquer pour voir les détails &gt;
                            </p>
                          </div>
                          <div className="p-3 rounded-xl bg-gradient-to-br from-[#00263A] to-[#00B3A6] shadow-lg group-hover:scale-110 transition-transform flex-shrink-0 ml-3">
                            <DollarSign className="h-6 w-6 text-white" />
                          </div>
                        </div>
                      </button>

                      {/* Revenus Totaux */}
                      <button
                        onClick={handleNavigateToRevenue}
                        disabled={isDisabled}
                        className={`bg-white rounded-xl p-6 shadow-lg transition-all duration-300 border border-gray-200 ${
                          isDisabled
                            ? 'opacity-50 cursor-not-allowed'
                            : 'hover:shadow-xl transform hover:-translate-y-1 cursor-pointer group'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-600 mb-1">Revenus Totaux</p>
                            <p className="text-2xl font-bold text-gray-900 group-hover:text-[#00B3A6] transition-colors truncate">
                              {stats.totalRevenue.toLocaleString('fr-TN', {
                                style: 'currency',
                                currency: 'TND',
                              })}
                            </p>
                            <p className="text-xs text-gray-500 mt-2">
                              Cliquer pour voir l'historique &gt;
                            </p>
                          </div>
                          <div className="p-3 rounded-xl bg-gradient-to-br from-[#00263A] to-[#00B3A6] shadow-lg group-hover:scale-110 transition-transform flex-shrink-0 ml-3">
                            <TrendingUp className="h-6 w-6 text-white" />
                          </div>
                        </div>
                      </button>

                      {/* Revenus Détaillés */}
                      <button
                        onClick={handleViewDetailedRevenue}
                        disabled={isDisabled}
                        className={`bg-white rounded-xl p-6 shadow-lg transition-all duration-300 border border-gray-200 text-left ${
                          isDisabled
                            ? 'opacity-50 cursor-not-allowed'
                            : 'hover:shadow-xl transform hover:-translate-y-1 cursor-pointer group'
                        }`}
                      >
                        <div className="flex items-center justify-center mb-4">
                          <div className="p-4 rounded-xl bg-gradient-to-br from-[#00B3A6] to-[#00B3A6]/80 shadow-lg group-hover:scale-110 transition-transform">
                            <BarChart3 className="h-8 w-8 text-white" />
                          </div>
                        </div>
                        <p className="text-sm font-medium text-gray-600 text-center">
                          Analyser les performances
                        </p>
                      </button>
                    </div>
                  </div>

                  {/* Section Rewards */}
                  <div className="mb-8">
                    <h3 className="text-2xl font-bold text-gray-900 mb-4 flex items-center">
                      <Gift className="h-6 w-6 text-[#00B3A6] mr-2" />
                      Rewards
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {/* Points Fidélité */}
                      <button
                        onClick={handleNavigateToGiftCatalog}
                        className="bg-white rounded-xl p-6 shadow-lg hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1 border border-gray-200 cursor-pointer group"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-600 mb-1">
                              Points Fidélité
                            </p>
                            <p className="text-3xl font-bold text-gray-900 group-hover:text-[#00B3A6] transition-colors">
                              {stats.loyaltyPoints}
                            </p>
                          </div>
                          <div className="p-3 rounded-xl bg-gradient-to-br from-[#00B3A6] to-[#00B3A6]/80 shadow-lg group-hover:scale-110 transition-transform flex-shrink-0 ml-3">
                            <Star className="h-6 w-6 text-white" />
                          </div>
                        </div>
                      </button>

                      {/* Catalogue Cadeaux */}
                      <button
                        onClick={handleNavigateToGiftCatalog}
                        className="bg-white rounded-xl p-6 shadow-lg hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1 border border-gray-200 cursor-pointer group text-left"
                      >
                        <div className="flex items-center justify-center mb-4">
                          <div className="p-4 rounded-xl bg-gradient-to-br from-[#00B3A6] to-[#00B3A6]/80 shadow-lg group-hover:scale-110 transition-transform">
                            <Gift className="h-8 w-8 text-white" />
                          </div>
                        </div>
                        <p className="text-sm font-medium text-gray-600 text-center">
                          Échanger vos points fidélité
                        </p>
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Gift Catalog Modal */}
      <GiftCatalog
        isOpen={showGiftCatalog}
        onClose={() => setShowGiftCatalog(false)}
        userPoints={stats.loyaltyPoints}
      />

      {/* Add Screen Modal */}
      <AddScreen
        isOpen={showAddScreen}
        onClose={() => setShowAddScreen(false)}
        onScreenAdded={loadDashboardData}
      />
    </div>
  );
}
