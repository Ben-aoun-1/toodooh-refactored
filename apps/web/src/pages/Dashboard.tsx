import {
  Calendar,
  Megaphone,
  Wallet,
  FileText,
  Users,
  ChevronLeft,
  ChevronRight,
  X,
  PlusCircle,
  Edit,
  ArrowRight,
  TrendingUp,
  ShoppingBag,
  PanelLeft,
  LayoutGrid,
  MapPin,
  DollarSign,
  RotateCcw,
  Rocket,
  Monitor,
  Crosshair,
  Link2,
  Check,
  Trash2,
} from 'lucide-react';
import React, { useState, useEffect, useRef, useCallback, Component } from 'react';

/** Affiche l'erreur à l'écran pour déboguer la page blanche */
class ContentErrorBoundary extends Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  state = { hasError: false, error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    log.error({ error, componentStack: info.componentStack }, 'ContentErrorBoundary');
  }
  render() {
    if (this.state.hasError && this.state.error) {
      return (
        <div className="p-8 max-w-2xl mx-auto bg-red-50 border border-red-200 rounded-xl">
          <h2 className="text-lg font-bold text-red-800 mb-2">Erreur d&apos;affichage</h2>
          <pre className="text-sm text-red-700 whitespace-pre-wrap break-words overflow-auto max-h-96">
            {this.state.error.message}
          </pre>
          <p className="text-xs text-gray-600 mt-2">
            Vérifiez la console (F12) pour plus de détails.
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}
import { toast } from 'react-hot-toast';
import Joyride, { CallBackProps, STATUS, Step } from 'react-joyride';
import { useNavigate, useLocation } from 'react-router-dom';

import deconnexionIcon from '../assets/deconnexion.png';
import headerAgendaIcon from '../assets/header/agenda.png';
import headerCampagnesIcon from '../assets/header/campagnes.png';
import headerParcsIcon from '../assets/header/ecrans.png';
import headerFinanceIcon from '../assets/header/finance.png';
import headerParamsIcon from '../assets/header/params.png';
import headerPerformanceIcon from '../assets/header/performance.png';
import logoImage from '../assets/logo.png';
import matchImg from '../assets/match.png';
import paramIcon from '../assets/param.png';
import paramIconActive from '../assets/params.png';
import agendaIcon from '../assets/sidebar/agenda.png';
import campagneIcon from '../assets/sidebar/campagnes.png';
import dashboardIcon from '../assets/sidebar/dashboard.png';
import logoCompany from '../assets/sidebar/logo.png';
import { authService } from '../services/auth.service';
import { balanceService } from '../services/balance.service';
import { useAuthStore } from '../stores/auth.store';
import { campaignService } from '../services/campaign.service';

import CartPage from './CartPage';
import Events from './Events';
import MyCampaigns from './MyCampaigns';
import NewCampaign from './NewCampaign';
import Parcs from './Parcs';
import Perfor from './Perfor';
import UserProfile from './UserProfile';
import MyRecharges from './MyRecharges';

import dashboardIconActive from '../assets/sidebar/dashboards.png';
import campagneIconActive from '../assets/sidebar/campagness.png';
import agendaIconActive from '../assets/sidebar/agendas.png';
import performanceIcon from '../assets/sidebar/performance.png';
import performanceIconActive from '../assets/sidebar/performances.png';
import financeIcon from '../assets/sidebar/portefeuille.png';
import financeIconActive from '../assets/sidebar/portefeuilles.png';
import supportIcon from '../assets/support.png';
import supportIconActive from '../assets/supports.png';
import smart3Icon from '../assets/smart3.png';
import statIcon1 from '../assets/stats/1.png';
import statIcon2 from '../assets/stats/2.png';
import statIcon3 from '../assets/stats/3.png';
import statIcon4 from '../assets/stats/4.png';
import statIcon5 from '../assets/stats/5.png';

import OnboardingModal from './Onboarding';

import { supabase } from '../lib/supabase';

import MyInvoices from './MyInvoices';
import MyClients from './MyClients';

import { eventsService } from '../services/events.service';
import type { SpecialEvent } from '../types/event';
import AdvertiserNotificationsBell from '../components/AdvertiserNotificationsBell';
import { logger } from '../lib/logger';

const log = logger.child({ module: 'Dashboard' });


const APPOINTMENT_OBJECTIVES_FALLBACK = [
  'Renseignements',
  'Inscription',
  'Diffusion',
  'Ciblage',
  'Budget',
  'Accompagnement',
  'Support',
  'Facturation',
  'Autre',
];

const DISABLE_ONBOARDING_POPUPS = true;
const isMissingCampaignCategoriesTable = (error: any) =>
  error?.code === 'PGRST205' && String(error?.message || '').includes('campaign_categories');

function isAutreObjective(value: string): boolean {
  return value.trim().toLowerCase() === 'autre';
}

function getCalendarDays(year: number, month: number) {
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const startDay = first.getDay() === 0 ? 6 : first.getDay() - 1; // Lundi = 0
  const daysInMonth = last.getDate();
  const prevMonth = month === 0 ? 11 : month - 1;
  const prevYear = month === 0 ? year - 1 : year;
  const prevLast = new Date(prevYear, prevMonth + 1, 0).getDate();
  const rows: { day: number; currentMonth: boolean; date: Date }[] = [];
  for (let i = 0; i < startDay; i++) {
    const d = prevLast - startDay + 1 + i;
    rows.push({ day: d, currentMonth: false, date: new Date(prevYear, prevMonth, d) });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    rows.push({ day: d, currentMonth: true, date: new Date(year, month, d) });
  }
  const remaining = 42 - rows.length;
  for (let i = 0; i < remaining; i++) {
    rows.push({ day: i + 1, currentMonth: false, date: new Date(year, month + 1, i + 1) });
  }
  return rows;
}

function isDateUnavailable(date: Date) {
  const d = date.getDate();
  const unavailableDays = [6, 10, 17, 22];
  return unavailableDays.includes(d);
}

function isDatePast(date: Date) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d < today;
}

const MONTHS_FR = [
  'Janvier',
  'Février',
  'Mars',
  'Avril',
  'Mai',
  'Juin',
  'Juillet',
  'Août',
  'Septembre',
  'Octobre',
  'Novembre',
  'Décembre',
];
const WEEKDAYS_FR = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

type ActionCardProps = {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  actionLabel: string;
  onClick: () => void;
  disabled?: boolean;
};

function ActionCard({
  icon,
  title,
  subtitle,
  actionLabel,
  onClick,
  disabled = false,
}: ActionCardProps) {
  return (
    <div
      className={`bg-white rounded-xl shadow-lg border border-gray-200 p-6 flex flex-col justify-between min-h-[180px] transition ${
        disabled ? 'opacity-60 cursor-not-allowed' : 'hover:shadow-xl'
      }`}
    >
      <div className="flex items-center mb-4">
        <div
          className={`p-3 rounded-xl mr-4 shadow-lg flex items-center justify-center ${
            disabled ? 'bg-gray-400' : 'bg-[#00B3A6]'
          }`}
        >
          {icon}
        </div>
        <div>
          <h3 className={`text-lg font-bold mb-1 ${disabled ? 'text-gray-500' : 'text-gray-900'}`}>
            {title}
          </h3>
          <p className={`text-sm ${disabled ? 'text-gray-400' : 'text-gray-600'}`}>{subtitle}</p>
        </div>
      </div>
      <button
        onClick={onClick}
        disabled={disabled}
        className={`mt-auto font-semibold flex items-center gap-2 focus:outline-none ${
          disabled ? 'text-gray-400 cursor-not-allowed' : 'text-[#00B3A6] hover:underline'
        }`}
      >
        {actionLabel} <ArrowRight className="h-4 w-4" />
      </button>
    </div>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const location = useLocation();
  const logout = useAuthStore((state) => state.logout);
  const profileType = useAuthStore((state) => state.profileType);
  const user = useAuthStore((state) => state.user);
  const shouldOnboard = useAuthStore((state) => state.shouldOnboard);
  const needsApproval = useAuthStore((state) => state.needsApproval);
  const validationStatus = useAuthStore((state) => state.validationStatus);
  const [profile, setProfile] = useState<any>(null);
  const [onboardingCompleted, setOnboardingCompleted] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [sidebarExpanded, setSidebarExpanded] = useState(true);
  const [showContactModal, setShowContactModal] = useState(false);
  const [showSupportModal, setShowSupportModal] = useState(false);
  const [supportObjective, setSupportObjective] = useState('');
  const [appointmentObjectives, setAppointmentObjectives] = useState<string[]>(
    APPOINTMENT_OBJECTIVES_FALLBACK,
  );
  const [supportOtherDetail, setSupportOtherDetail] = useState('');
  const [supportMessage, setSupportMessage] = useState('');
  const [contactObjective, setContactObjective] = useState('');
  const [contactOtherDetail, setContactOtherDetail] = useState('');
  const [contactDate, setContactDate] = useState<Date | null>(null);
  const [contactMessage, setContactMessage] = useState('');
  const [contactCalendarMonth, setContactCalendarMonth] = useState(() => new Date());
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [currentPage, setCurrentPage] = useState('dashboard');
  const profileLoadedRef = useRef(false);
  const onboardingCheckRef = useRef(false);
  // Header maquette : panier / notifications
  const [cartItems, setCartItems] = useState<
    Array<{ id: string; name: string; amount: number; periodLabel?: string; zonesLabel?: string }>
  >([]);
  const [cartOpen, setCartOpen] = useState(false); // colonne panier à droite, fermé par défaut
  const [featuredEvents, setFeaturedEvents] = useState<SpecialEvent[]>([]);
  const cartCount = cartItems.length;
  const cartSubtotal = cartItems.reduce((sum, item) => sum + item.amount, 0);
  useEffect(() => {
    let active = true;
    const loadSupportObjectives = async () => {
      try {
        const rows = await authService.getAppointmentObjectives();
        if (!active) return;
        if (rows.length > 0) {
          setAppointmentObjectives(rows.map((r) => r.label));
        }
      } catch {
        // fallback local conservé
      }
    };
    loadSupportObjectives();
    return () => {
      active = false;
    };
  }, []);

  // Fonction pour déterminer si les fonctionnalités sont désactivées
  const isDisabled = needsApproval && validationStatus === 'pending';
  const hasRegistrationDocument = Boolean(
    profile?.registration_doc_path || profile?.registration_doc_url,
  );
  const canRechargeAccount =
    !isDisabled && validationStatus === 'approved' && profile?.is_active !== false;
  const canLaunchCampaign = !isDisabled && validationStatus === 'approved';

  // Charger le profil complet pour vérifier onboarding_completed (une seule fois)
  useEffect(() => {
    const loadProfile = async () => {
      if (!user?.id || profileLoadedRef.current) return;

      // Vérifier d'abord le localStorage pour éviter les requêtes inutiles
      const onboardingCompletedLocal = localStorage.getItem('onboardingCompleted') === 'true';
      if (onboardingCompletedLocal) {
        setOnboardingCompleted(true);
        profileLoadedRef.current = true;
        return;
      }

      try {
        profileLoadedRef.current = true;
        const { data, error } = await supabase
          .from('business_profiles')
          .select('onboarding_completed, registration_doc_url')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!error && data) {
          const isCompleted = data.onboarding_completed || false;
          setOnboardingCompleted(isCompleted);
          if (isCompleted) {
            localStorage.setItem('onboardingCompleted', 'true');
          }
        }
      } catch (error) {
        log.error({ error }, 'Erreur chargement profil');
        profileLoadedRef.current = false; // Réessayer en cas d'erreur
      }
    };

    loadProfile();
  }, [user?.id]); // Utiliser user?.id au lieu de user pour éviter les re-renders

  // Debug logs
  useEffect(() => {
  }, [needsApproval, validationStatus, isDisabled, onboardingCompleted, profileType, user]);

  const [runTour, setRunTour] = useState(false);
  const [tourStepIndex, setTourStepIndex] = useState(0);
  const [showOnboarding, setShowOnboarding] = useState(
    DISABLE_ONBOARDING_POPUPS ? false : shouldOnboard,
  );
  const onboardingModalInitializedRef = useRef(false);

  // Debug pour showOnboarding (désactivé pour réduire les logs)
  // useEffect(() => {
  //   ;
  // }, [showOnboarding]);

  // Fonction helper pour ouvrir le modal d'onboarding
  const openOnboardingModal = () => {
    if (DISABLE_ONBOARDING_POPUPS) return;

    // Nettoyer le localStorage pour éviter les conflits
    const oldValue = localStorage.getItem('onboardingCompleted');
    if (oldValue === 'true') {
      localStorage.removeItem('onboardingCompleted');
    }

    setShowOnboarding(true);
  };
  const [stats, setStats] = useState({
    activeCampaigns: 0,
    campaignsDiffused: 0,
    totalViews: 0,
    conversionRate: 0,
    balance: '0 TND',
    totalBudget: 0,
    totalDurationSeconds: 0,
    prevYearCampaigns: 0,
    prevYearViews: 0,
    prevYearDurationSeconds: 0,
    prevYearBudget: 0,
  });
  const [loadingStats, setLoadingStats] = useState(true);
  const [availableBalanceTnd, setAvailableBalanceTnd] = useState(0);
  const [totalCreatedCampaignsCount, setTotalCreatedCampaignsCount] = useState(0);
  const [lastCampaigns, setLastCampaigns] = useState<
    Array<{
      id: string;
      name: string;
      status: string;
      start_date: string;
      end_date: string;
      budget: number;
      views: number;
      category: string | null;
      selected_categories: string[];
      selected_zones: string[];
      validated_impressions: number;
    }>
  >([]);
  const hideGettingStartedBlock =
    hasRegistrationDocument && availableBalanceTnd > 0 && totalCreatedCampaignsCount > 0;
  const [loadingLastCampaigns, setLoadingLastCampaigns] = useState(false);

  // Vérifier le type de profil et rediriger si nécessaire
  useEffect(() => {
    if (user) {
      const userProfileType = localStorage.getItem('user_profile_type');
      if (userProfileType === 'individual_owner' || userProfileType === 'fleet_owner') {
        navigate('/owner-dashboard');
      }
    }
  }, [user, navigate]);

  const steps: Step[] = [
    {
      target: '.dashboard-stats',
      content: "Voici vos statistiques clés en un coup d'œil.",
      disableBeacon: true,
    },
    {
      target: '.dashboard-actions',
      content: 'Lancez ou gérez vos campagnes ici.',
    },
    {
      target: '.dashboard-quick-actions',
      content: 'Accédez rapidement à vos recharges et factures.',
    },
    {
      target: '.dashboard-profile',
      content: 'Gérez votre profil et vos informations.',
    },
  ];

  // Charger les statistiques réelles
  useEffect(() => {
    const loadDashboardStats = async () => {
      if (!user?.id) return;

      try {
        setLoadingStats(true);

        // Récupérer les campagnes de l'utilisateur (avec date pour comparaison année précédente)
        const { data: campaigns, error: campaignsError } = await supabase
          .from('campaigns')
          .select('status, views, budget, created_at')
          .eq('user_id', user.id);

        if (campaignsError) {
          log.error({ campaignsError }, 'Error fetching campaigns');
        }

        const now = new Date();
        const currentYearStart = new Date(now.getFullYear(), 0, 1);
        const prevYearStart = new Date(now.getFullYear() - 1, 0, 1);
        const prevYearEnd = new Date(now.getFullYear(), 0, 1);

        const isCurrentYear = (c: { created_at?: string }) => {
          if (!c.created_at) return true;
          const d = new Date(c.created_at);
          return d >= currentYearStart;
        };
        const isPrevYear = (c: { created_at?: string }) => {
          if (!c.created_at) return false;
          const d = new Date(c.created_at);
          return d >= prevYearStart && d < prevYearEnd;
        };

        const allCampaigns = campaigns || [];
        const currentCampaigns = allCampaigns.filter(isCurrentYear) || [];
        const prevYearCampaignsList = campaigns?.filter(isPrevYear) || [];
        setTotalCreatedCampaignsCount(allCampaigns.length);

        // Campagnes diffusées = campagnes créées / diffusées sur la période (année en cours vs année précédente)
        const campaignsDiffused = currentCampaigns.length;
        const activeCampaigns = currentCampaigns.filter((c) => c.status === 'active').length || 0;
        const totalViews = currentCampaigns.reduce((sum, c) => sum + (c.views || 0), 0) || 0;
        const totalBudget =
          currentCampaigns.reduce((sum, c) => sum + (parseFloat(String(c.budget)) || 0), 0) || 0;
        // Durée totale de diffusion : proxy = vues × 30 secondes (temps moyen par spot)
        const totalDurationSeconds = totalViews * 30;

        const prevYearCampaigns = prevYearCampaignsList.length;
        const prevYearViews =
          prevYearCampaignsList.reduce((sum, c) => sum + (c.views || 0), 0) || 0;
        const prevYearBudget =
          prevYearCampaignsList.reduce((sum, c) => sum + (parseFloat(String(c.budget)) || 0), 0) ||
          0;
        const prevYearDurationSeconds = prevYearViews * 30;

        // Récupérer le vrai solde depuis le service
        let balance = 0;
        try {
          // Récupérer les infos détaillées de balance
          const balanceInfo = await balanceService.getBalanceInfo(user.id);

          if (balanceInfo) {
            balance = balanceInfo.available_balance;
          } else {
            // Fallback
            balance = await balanceService.getUserBalance(user.id);
          }
        } catch (error) {
          log.error({ error }, '❌ Erreur récupération solde');
          balance = 0;
        }

        const conversionRate = totalViews > 0 ? (activeCampaigns / totalViews) * 100 : 0;

        const formatAmountFr = (amount: number) =>
          `${new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)} TND`;

        setStats({
          activeCampaigns,
          campaignsDiffused,
          totalViews,
          conversionRate: Math.round(conversionRate * 10) / 10,
          balance: formatAmountFr(balance),
          totalBudget,
          totalDurationSeconds,
          prevYearCampaigns,
          prevYearViews,
          prevYearDurationSeconds,
          prevYearBudget,
        });
        setAvailableBalanceTnd(balance);
      } catch (error) {
        log.error({ error }, 'Error loading dashboard stats');
        setAvailableBalanceTnd(0);
        setTotalCreatedCampaignsCount(0);
      } finally {
        setLoadingStats(false);
      }
    };

    loadDashboardStats();
  }, [user]);

  // Dernières 5 campagnes pour le bloc « Mes campagnes »
  useEffect(() => {
    const loadLastCampaigns = async () => {
      if (!user?.id) return;
      try {
        setLoadingLastCampaigns(true);
        const { data, error } = await supabase
          .from('campaigns')
          .select('id, name, status, start_date, end_date, budget, views, category')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(5);
        if (error) {
          log.error({ error }, 'Error fetching last campaigns');
          return;
        }
        const rows = data || [];
        const campaignIds = rows.map((c: any) => c.id).filter(Boolean);
        const categoriesByCampaign = new Map<string, string[]>();
        const zonesByCampaign = new Map<string, string[]>();

        if (campaignIds.length > 0) {
          const [{ data: categoryRows, error: categoryError }, { data: predefinedZonesRows }] =
            await Promise.all([
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
            log.error({ categoryError }, 'Error fetching campaign categories');
          }

          (categoryRows || []).forEach((row: any) => {
            if (!row?.campaign_id || !row?.category) return;
            const prev = categoriesByCampaign.get(row.campaign_id) || [];
            if (!prev.includes(row.category)) prev.push(row.category);
            categoriesByCampaign.set(row.campaign_id, prev);
          });

          rows.forEach((c: any) => {
            const lat = Number(c?.location_lat);
            const lng = Number(c?.location_lng);
            const radius = Number(c?.location_radius);
            if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(radius)) return;
            const matched = (predefinedZonesRows || []).find(
              (z: any) =>
                Math.abs(Number(z.latitude) - lat) <= 0.0005 &&
                Math.abs(Number(z.longitude) - lng) <= 0.0005 &&
                Math.abs(Number(z.radius) - radius) <= 50,
            );
            if (matched?.name) {
              zonesByCampaign.set(c.id, [matched.name]);
            } else {
              zonesByCampaign.set(c.id, ['Grand Tunis']);
            }
          });
        }

        setLastCampaigns(
          rows.map((c: any) => {
            const selectedCategories =
              categoriesByCampaign.get(c.id) || (c.category ? [c.category] : []);
            return {
              id: c.id,
              name: c.name || 'Sans nom',
              status: c.status || 'draft',
              start_date: c.start_date || '',
              end_date: c.end_date || '',
              budget: parseFloat(String(c.budget)) || 0,
              views: c.views || 0,
              category: c.category || null,
              selected_categories: selectedCategories,
              selected_zones: zonesByCampaign.get(c.id) || [],
              validated_impressions: Math.max(0, Number(c.views) || 0),
            };
          }),
        );
      } catch (e) {
        log.error({ e }, 'Exception loadLastCampaigns');
      } finally {
        setLoadingLastCampaigns(false);
      }
    };
    loadLastCampaigns();
  }, [user]);

  useEffect(() => {
    const fetchProfile = async () => {
      if (user) {
        try {
          const data = await authService.getBusinessProfile();
          setProfile(data);

          // Mettre à jour le localStorage avec le nom et prénom
          if (data?.contact_name) {
            localStorage.setItem('user_raison_social', data.contact_name);
          }
        } catch (error) {
          log.error({ error }, 'Error fetching profile');
          setProfile(null);
        }
      } else {
        setProfile(null);
      }
    };

    // Forcer le rechargement à chaque fois
    if (user) {
      fetchProfile();
    }
  }, [user, location.pathname]);

  useEffect(() => {
    if (DISABLE_ONBOARDING_POPUPS) {
      setShowOnboarding(false);
      onboardingModalInitializedRef.current = true;
      return;
    }
    // Vérifier le localStorage et l'état pour éviter les boucles infinies
    if (onboardingModalInitializedRef.current) return; // Ne s'exécuter qu'une fois

    const onboardingCompletedLocal = localStorage.getItem('onboardingCompleted') === 'true';
    if (onboardingCompletedLocal || onboardingCompleted) {
      setShowOnboarding(false);
      onboardingModalInitializedRef.current = true;
    } else if (shouldOnboard) {
      setShowOnboarding(true);
      onboardingModalInitializedRef.current = true;
    }
  }, [shouldOnboard, onboardingCompleted]);

  useEffect(() => {
    if (localStorage.getItem('justOnboarded') === 'true') {
      setRunTour(true);
      localStorage.removeItem('justOnboarded');
    }
  }, []);

  useEffect(() => {
    const syncCart = (openCart = false) => {
      try {
        const raw = localStorage.getItem('campaign_cart_items');
        const parsed = raw ? JSON.parse(raw) : [];
        setCartItems(Array.isArray(parsed) ? parsed : []);
        if (openCart) setCartOpen(true);
      } catch {
        setCartItems([]);
      }
    };

    const onCartUpdated = (event: Event) => {
      const customEvent = event as CustomEvent<{ open?: boolean }>;
      syncCart(Boolean(customEvent.detail?.open));
    };
    const onStorage = () => syncCart();

    syncCart();
    window.addEventListener('storage', onStorage);
    window.addEventListener('toodooh:cart-updated', onCartUpdated as EventListener);

    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('toodooh:cart-updated', onCartUpdated as EventListener);
    };
  }, []);

  const removeFromCart = useCallback((campaignId: string) => {
    try {
      const raw = localStorage.getItem('campaign_cart_items');
      const current = raw ? JSON.parse(raw) : [];
      const next = Array.isArray(current)
        ? current.filter((item: { id?: string }) => item?.id !== campaignId)
        : [];
      localStorage.setItem('campaign_cart_items', JSON.stringify(next));
      setCartItems(next);
      window.dispatchEvent(new CustomEvent('toodooh:cart-updated', { detail: {} }));
    } catch {
      setCartItems([]);
    }
  }, []);

  // Charger les événements mis en avant pour le bloc dashboard
  useEffect(() => {
    if (location.pathname !== '/dashboard') return;
    let cancelled = false;
    (async () => {
      const list = await eventsService.getFeaturedEvents(3);
      if (!cancelled) setFeaturedEvents(list);
    })();
    return () => {
      cancelled = true;
    };
  }, [location.pathname]);

  const balance = user ? '2,500 TND' : null;

  const handleLogout = async () => {
    try {

      // Nettoyer le localStorage
      localStorage.removeItem('onboardingCompleted');
      localStorage.removeItem('justOnboarded');
      localStorage.removeItem('user_profile_type');

      await logout();

      navigate('/login');
      toast.success('Déconnexion réussie');
    } catch (error: any) {
      toast.error(error?.message || "Une erreur inattendue s'est produite");
      // En cas d'erreur, forcer la redirection
      navigate('/login');
    }
  };

  const campaignActions = [
    {
      title: 'Lancer une nouvelle campagne',
      description: 'Créez et configurez une nouvelle campagne publicitaire',
      icon: PlusCircle,
      gradient: 'from-[#00B3A6] to-[#00B3A6]/80',
      action: () => navigate('/new-campaign'),
    },
    {
      title: 'Modifier une campagne active',
      description: 'Gérez et optimisez vos campagnes en cours',
      icon: Edit,
      gradient: 'from-[#00263A] to-[#00B3A6]',
      action: () => navigate('/my-campaigns'),
    },
  ];

  const quickActions = [
    {
      icon: Wallet,
      title: 'Recharger le compte',
      description: 'Ajoutez des fonds à votre portefeuille',
      gradient: 'from-[#00B3A6] to-[#00263A]',
    },
    {
      icon: FileText,
      title: 'Consulter les factures',
      description: "Accédez à l'historique de vos factures",
      gradient: 'from-[#00263A] to-[#00B3A6]',
    },
  ];

  // Format durée HH:MM:SS pour le widget "Durée totale de diffusion"
  const formatDuration = (totalSeconds: number) => {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = Math.floor(totalSeconds % 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  function renderProfileTypeLabel(type: string | null) {
    if (!type) return null;
    switch (type) {
      case 'advertiser':
        return 'Annonceur';
      case 'individual_owner':
        return 'Propriétaire individuel';
      case 'fleet_owner':
        return 'Propriétaire de parc';
      default:
        return type;
    }
  }

  const handleJoyrideCallback = (data: CallBackProps) => {
    const { status, index } = data;
    if (status === STATUS.FINISHED || status === STATUS.SKIPPED) {
      setRunTour(false);
      setTourStepIndex(0);
    } else {
      setTourStepIndex(index + 1);
    }
  };

  const handleOnboardingComplete = useCallback(async () => {
    if (onboardingCheckRef.current) return; // Éviter les appels multiples
    onboardingCheckRef.current = true;

    setShowOnboarding(false);

    // Marquer l'onboarding comme terminé dans localStorage d'abord
    localStorage.setItem('onboardingCompleted', 'true');

    // Marquer l'onboarding comme terminé dans la base de données
    if (user?.id) {
      try {
        const { error } = await supabase
          .from('business_profiles')
          .update({ onboarding_completed: true })
          .eq('user_id', user.id);

        if (error) {
          log.error({ error }, 'Erreur lors de la mise à jour onboarding_completed');
          onboardingCheckRef.current = false; // Réessayer en cas d'erreur
        } else {

          // Recharger l'état onboarding_completed
          setOnboardingCompleted(true);
        }
      } catch (error) {
        log.error({ error }, "Erreur lors de la completion de l'onboarding");
        onboardingCheckRef.current = false; // Réessayer en cas d'erreur
      }
    }
  }, [user?.id]);

  const handleOnboardingClose = async () => {
    setShowOnboarding(false);

    // Marquer l'onboarding comme terminé dans localStorage d'abord
    localStorage.setItem('onboardingCompleted', 'true');

    // Marquer l'onboarding comme terminé pour éviter qu'il se relance
    if (user) {
      try {
        const { error } = await supabase
          .from('business_profiles')
          .update({ onboarding_completed: true })
          .eq('user_id', user.id);

        if (error) {
          log.error({ error }, 'Erreur lors de la mise à jour onboarding_completed');
        } else {
        }
      } catch (error) {
        log.error({ error }, "Erreur lors de la fermeture de l'onboarding");
      }
    }
  };

  const renderContent = () => {
    // Détecter la route actuelle et afficher le bon composant
    switch (location.pathname) {
      case '/profile':
        return <UserProfile />;
      case '/new-campaign':
        return <NewCampaign />;
      case '/new-event-campaign':
        return <NewCampaign />;
      case '/my-campaigns':
        return <MyCampaigns />;
      case '/parcs':
        return <Parcs />;
      case '/evenements':
        return <Events />;
      case '/perfor':
        return <Perfor />;
      case '/my-recharges':
        return <MyRecharges />;
      case '/my-invoices':
        return <MyInvoices />;
      case '/my-clients':
        return <MyClients />;
      case '/my-cart':
        return <CartPage />;
      case '/dashboard':
      default:
        return (
          <div className="max-w-7xl mx-auto space-y-8">
            {/* Joyride */}
            <Joyride
              steps={steps}
              run={runTour}
              stepIndex={tourStepIndex}
              continuous
              showSkipButton
              showProgress
              locale={{
                back: 'Précédent',
                close: 'Fermer',
                last: 'Terminer',
                next: 'Suivant',
                skip: 'Passer',
              }}
              callback={handleJoyrideCallback}
              styles={{ options: { zIndex: 9999 } }}
            />

            {/* Première ligne sous la bannière : Solde disponible + Prêt à démarrer */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Carte Solde disponible */}
              <div className="rounded-xl bg-gradient-to-tr from-[#3db39a] via-[#1a6b5a] to-[#0a3d32] p-5 shadow-lg">
                <p className="text-base font-medium text-white/95 mb-2">Solde disponible</p>
                <p className="text-2xl sm:text-3xl font-bold text-white mb-5 tracking-tight tabular-nums font-sans">
                  {loadingStats ? '...' : stats.balance}
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      if (isDisabled) {
                        toast.error(
                          '⚠️ Veuillez compléter vos informations pour accéder à cette fonctionnalité',
                        );
                        openOnboardingModal();
                      } else {
                        navigate('/my-recharges');
                      }
                    }}
                    disabled={isDisabled}
                    className="px-5 py-3 rounded-lg bg-[#9ae2b0] hover:bg-[#85d99e] text-gray-900 font-semibold text-base transition-colors disabled:opacity-50"
                  >
                    Recharger
                  </button>
                  <button
                    type="button"
                    onClick={() => navigate('/my-recharges')}
                    className="text-white/95 hover:text-white hover:underline text-sm font-medium transition-colors"
                  >
                    Voir l&apos;historique
                  </button>
                </div>
              </div>
              {/* Carte Prêt à démarrer */}
              <div className="rounded-xl border border-[#76E6AB]/50 bg-[#f6faf8] p-5 shadow-lg flex flex-col items-center text-center">
                <div className="w-14 h-14 flex items-center justify-center mb-3">
                  <img src={smart3Icon} alt="" className="h-14 w-auto object-contain" />
                </div>
                <h3 className="text-base font-bold text-gray-900 mb-1 whitespace-nowrap">
                  Prêt à démarrer ?
                </h3>
                <p className="text-sm text-gray-600 mb-4">
                  Diffusez votre campagne publicitaire en quelques clics
                </p>
                <button
                  type="button"
                  onClick={() => {
                    if (isDisabled) {
                      toast.error(
                        '⚠️ Veuillez compléter vos informations pour accéder à cette fonctionnalité',
                      );
                      openOnboardingModal();
                    } else {
                      navigate('/new-campaign');
                    }
                  }}
                  disabled={isDisabled}
                  className="w-full px-4 py-3 rounded-lg bg-[#9ae2b0] hover:bg-[#85d99e] text-gray-900 font-medium text-sm transition-colors disabled:opacity-50"
                >
                  Lancer une nouvelle campagne
                </button>
              </div>
            </div>

            {/* Événements mis en avant (3 cartes) */}
            {featuredEvents.length > 0 && (
              <div className="mb-8">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {featuredEvents.map((event) => {
                    const typeConfig: Record<string, { bg: string; text: string; label: string }> =
                      {
                        sport: { bg: 'bg-blue-100', text: 'text-blue-800', label: 'Sport' },
                        ramadan: { bg: 'bg-amber-100', text: 'text-amber-900', label: 'Ramadan' },
                        culture: { bg: 'bg-purple-100', text: 'text-purple-800', label: 'Culture' },
                        concert: { bg: 'bg-purple-100', text: 'text-purple-800', label: 'Concert' },
                        festival: { bg: 'bg-pink-100', text: 'text-pink-800', label: 'Festival' },
                        conference: {
                          bg: 'bg-indigo-100',
                          text: 'text-indigo-800',
                          label: 'Conférence',
                        },
                        exposition: {
                          bg: 'bg-green-100',
                          text: 'text-green-800',
                          label: 'Exposition',
                        },
                        salon: { bg: 'bg-orange-100', text: 'text-orange-800', label: 'Salon' },
                        autre: { bg: 'bg-gray-100', text: 'text-gray-800', label: 'Autre' },
                      };
                    const typeStyle = typeConfig[event.event_type] || typeConfig.autre;
                    const start = new Date(event.start_date);
                    const end = new Date(event.end_date);
                    const dateStr = start.toLocaleDateString('fr-FR', {
                      day: 'numeric',
                      month: 'long',
                    });
                    const timeStr = `${start.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} - ${end.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
                    const impressions =
                      event.expected_attendance != null
                        ? `${event.expected_attendance.toLocaleString('fr-FR').replace(/\s/g, ' ')}`
                        : '184 500';
                    return (
                      <div
                        key={event.id}
                        className="bg-white rounded-t-xl shadow-lg border border-gray-200 overflow-hidden flex flex-col"
                      >
                        <div className="aspect-[16/10] bg-gray-200 overflow-hidden">
                          {event.image_url ? (
                            <img
                              src={event.image_url}
                              alt={event.name}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-gray-100 to-gray-200">
                              <Megaphone className="h-12 w-12 text-gray-400" />
                            </div>
                          )}
                        </div>
                        <div className="p-4 flex flex-col flex-1">
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <h3 className="text-base font-bold text-gray-900 flex-1">
                              {event.name}
                            </h3>
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium flex-shrink-0 ${typeStyle.bg} ${typeStyle.text}`}
                            >
                              {typeStyle.label}
                            </span>
                          </div>
                          <div className="flex flex-wrap gap-1.5 mb-2">
                            <span className="inline-flex px-2 py-0.5 rounded bg-gray-100 text-gray-700 text-xs">
                              Restaurants
                            </span>
                            <span className="inline-flex px-2 py-0.5 rounded bg-gray-100 text-gray-700 text-xs">
                              Salles de sport
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 text-sm text-gray-600 mb-1">
                            <Calendar className="h-4 w-4 flex-shrink-0" />
                            <span>
                              {dateStr} | {timeStr}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 text-sm text-gray-600 mb-2">
                            <TrendingUp className="h-4 w-4 flex-shrink-0" />
                            <span>~ {impressions} impressions</span>
                          </div>
                          <p className="text-xs text-gray-500 mb-4">
                            (En incluant automatiquement toutes les catégories de commerces
                            susceptibles de diffuser l&apos;événement)
                          </p>
                          <button
                            type="button"
                            onClick={() => navigate('/new-event-campaign', { state: { event } })}
                            className="mt-auto w-full py-2.5 rounded-lg bg-gray-700 hover:bg-gray-800 text-white text-sm font-medium transition-colors"
                          >
                            Je me positionne
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Widgets statistiques (Campagnes diffusées, Impressions, Durée, Budget) */}
            <div className="dashboard-stats grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-8">
              {/* Campagnes diffusées */}
              <div className="rounded-xl p-5 min-h-[120px] flex flex-col bg-[#e8f6ed] border border-[#85cc95]/30">
                <div className="flex items-center justify-between gap-2 mb-3 min-h-[1.25rem]">
                  <span className="text-xs font-semibold text-[#85cc95] whitespace-nowrap truncate min-w-0">
                    Campagnes diffusées
                  </span>
                  <img src={statIcon1} alt="" className="h-5 w-5 object-contain flex-shrink-0" />
                </div>
                <p className="text-3xl font-bold text-[#1a1a1a] tabular-nums font-sans mt-auto">
                  {loadingStats ? '...' : stats.campaignsDiffused}
                </p>
              </div>
              {/* Impressions générées */}
              <div className="rounded-xl p-5 min-h-[120px] flex flex-col bg-[#edf1fe] border border-[#6e82f6]/30">
                <div className="flex items-center justify-between gap-2 mb-3 min-h-[1.25rem]">
                  <span className="text-xs font-semibold text-[#6e82f6] whitespace-nowrap truncate min-w-0">
                    Impressions générées
                  </span>
                  <img src={statIcon4} alt="" className="h-5 w-5 object-contain flex-shrink-0" />
                </div>
                <p className="text-3xl font-bold text-[#1a1a1a] tabular-nums font-sans mt-auto">
                  {loadingStats
                    ? '...'
                    : stats.totalViews.toLocaleString('fr-FR').replace(/\s/g, ' ')}
                </p>
              </div>
              {/* Durée totale de diffusion */}
              <div className="rounded-xl p-5 min-h-[120px] flex flex-col bg-[#eeecfd] border border-[#a08cf0]/30">
                <div className="flex items-center justify-between gap-2 mb-3 min-h-[1.25rem]">
                  <span className="text-xs font-semibold text-[#a08cf0] whitespace-nowrap truncate min-w-0">
                    Durée totale de diffusion
                  </span>
                  <img src={statIcon2} alt="" className="h-5 w-5 object-contain flex-shrink-0" />
                </div>
                <p className="text-3xl font-bold text-[#1a1a1a] tabular-nums font-sans mt-auto font-mono">
                  {loadingStats ? '...' : formatDuration(stats.totalDurationSeconds)}
                </p>
              </div>
              {/* Budget total alloué */}
              <div className="rounded-xl p-5 min-h-[120px] flex flex-col bg-[#fdfaed] border border-[#edcc7a]/30">
                <div className="flex items-center justify-between gap-2 mb-3 min-h-[1.25rem]">
                  <span className="text-xs font-semibold text-[#edcc7a] whitespace-nowrap truncate min-w-0">
                    Budget total alloué
                  </span>
                  <img src={statIcon3} alt="" className="h-5 w-5 object-contain flex-shrink-0" />
                </div>
                <p className="text-3xl font-bold text-[#1a1a1a] tabular-nums font-sans mt-auto">
                  {loadingStats
                    ? '...'
                    : `${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(stats.totalBudget)} TND`}
                </p>
              </div>
            </div>

            {/* Mes campagnes — 5 dernières + bloc Gagnez du temps */}
            <div className="mb-10 rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
              <div className="flex flex-row items-center p-0 gap-6 px-5 py-4 border-b border-gray-200 bg-gray-50/50 min-h-[24px]">
                <h2 className="text-lg font-normal leading-6 text-gray-900 flex-1 order-0">
                  Mes campagnes
                </h2>
                <button
                  type="button"
                  onClick={() => navigate('/my-campaigns')}
                  className="inline-flex items-center justify-center px-5 py-2.5 rounded-xl border border-gray-200 bg-white text-gray-800 text-sm font-medium hover:bg-gray-50 hover:border-gray-300 transition-colors flex-none shadow-sm"
                >
                  Voir mes campagnes
                </button>
              </div>
              <div className="p-5">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                  {loadingLastCampaigns
                    ? [...Array(5)].map((_, i) => (
                        <div
                          key={i}
                          className="rounded-xl bg-gray-100 border border-gray-200 p-5 min-h-[220px] animate-pulse"
                        />
                      ))
                    : lastCampaigns.map((campaign) => {
                        const statusMap: Record<
                          string,
                          { label: string; bg: string; text: string; dot: string }
                        > = {
                          draft: {
                            label: 'Non validé',
                            bg: 'bg-red-50',
                            text: 'text-red-700',
                            dot: 'bg-red-500',
                          },
                          rejected: {
                            label: 'Non validé',
                            bg: 'bg-red-50',
                            text: 'text-red-700',
                            dot: 'bg-red-500',
                          },
                          pending: {
                            label: 'En attente',
                            bg: 'bg-amber-50',
                            text: 'text-amber-700',
                            dot: 'bg-amber-500',
                          },
                          active: {
                            label: 'Active',
                            bg: 'bg-green-50',
                            text: 'text-green-700',
                            dot: 'bg-green-500',
                          },
                          completed: {
                            label: 'Terminée',
                            bg: 'bg-gray-100',
                            text: 'text-gray-700',
                            dot: 'bg-gray-500',
                          },
                          paused: {
                            label: 'En pause',
                            bg: 'bg-gray-100',
                            text: 'text-gray-700',
                            dot: 'bg-gray-500',
                          },
                        };
                        const statusConf = statusMap[campaign.status] || statusMap.draft;
                        const start = campaign.start_date ? new Date(campaign.start_date) : null;
                        const end = campaign.end_date ? new Date(campaign.end_date) : null;
                        const dateStr =
                          start && end
                            ? `${start.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })} - ${end.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })}`
                            : '—';
                        const isActive = campaign.status === 'active';
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
                            <div className="flex flex-wrap gap-1.5 mb-3">
                              {(campaign.selected_categories || []).map((cat) => (
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
                                  <DollarSign className="h-3.5 w-3.5 text-[#60ba76]" />
                                  <span>BUDGET</span>
                                </div>
                                <p className="text-base font-bold text-gray-900 tabular-nums">
                                  {new Intl.NumberFormat('en-US', {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2,
                                  }).format(campaign.budget)}{' '}
                                  TND
                                </p>
                              </div>
                              <div className="flex items-start gap-1.5 justify-end">
                                <div className="flex flex-col items-start">
                                  <TrendingUp className="h-3.5 w-3.5 text-[#7e51f5] flex-shrink-0" />
                                  <p className="text-base font-bold text-gray-900 tabular-nums mt-0.5">
                                    {(campaign.validated_impressions || 0)
                                      .toLocaleString('fr-FR')
                                      .replace(/\s/g, ' ')}
                                  </p>
                                </div>
                                <div className="text-right text-xs text-gray-500 pt-0.5">
                                  IMPRESSIONS
                                </div>
                              </div>
                            </div>
                            <div className="flex gap-2 pt-4 mt-4 border-t border-gray-200 -mx-5 px-5">
                              <button
                                type="button"
                                onClick={() => navigate('/my-campaigns')}
                                className="flex-1 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors"
                              >
                                Consulter
                              </button>
                              <button
                                type="button"
                                onClick={() => navigate('/my-campaigns')}
                                className="flex-1 py-2 rounded-lg bg-[#e3f7ec] text-[#66bc74] text-sm font-medium hover:bg-[#cceee0] transition-colors inline-flex items-center justify-center gap-1.5"
                              >
                                {isActive ? (
                                  <>
                                    <Rocket className="h-4 w-4" /> Booster
                                  </>
                                ) : (
                                  <>
                                    <RotateCcw className="h-4 w-4" /> Reprendre
                                  </>
                                )}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                  {/* Bloc Gagnez du temps */}
                  <div className="rounded-xl bg-[#f5f5f5] border border-gray-200 p-5 shadow-sm flex flex-col items-center justify-center text-center">
                    <img src={statIcon5} alt="" className="h-12 w-12 object-contain mb-3" />
                    <h3 className="text-sm font-bold text-gray-900 mb-1 whitespace-nowrap">
                      Gagnez du temps
                    </h3>
                    <p className="text-sm text-gray-600 mb-4">
                      Capitalisez sur des campagnes enregistrées ou déjà jouées
                    </p>
                    <div className="flex flex-col gap-2 w-full">
                      <button
                        type="button"
                        onClick={() => navigate('/my-campaigns?status=completed')}
                        className="w-full py-2.5 rounded-lg border border-gray-300 bg-white text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors"
                      >
                        Rejouer les campagnes passées
                      </button>
                      <button
                        type="button"
                        onClick={() => navigate('/my-campaigns?status=draft')}
                        className="w-full py-2.5 rounded-lg border border-gray-300 bg-white text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors"
                      >
                        Reprendre les brouillons
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Parcs / Enseignes — masqué à la demande */}
            {false && (
              <div className="mb-10 rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
                <div className="flex flex-row items-center p-0 gap-6 px-5 py-4 border-b border-gray-200 bg-gray-50/50 min-h-[24px]">
                  <h2 className="text-lg font-normal leading-6 text-gray-900 flex-1 order-0">
                    Diffusez votre spot publicitaire sur une même enseigne
                  </h2>
                  <button
                    type="button"
                    onClick={() => navigate('/my-campaigns')}
                    className="inline-flex items-center justify-center px-5 py-2.5 rounded-xl border border-gray-200 bg-white text-gray-800 text-sm font-medium hover:bg-gray-50 hover:border-gray-300 transition-colors flex-none shadow-sm"
                  >
                    Voir tous les parcs
                  </button>
                </div>
                <div className="p-5">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                    {[1, 2, 3].map((i) => (
                      <div
                        key={i}
                        className="rounded-xl bg-white border border-gray-200 p-5 shadow-sm flex flex-col"
                      >
                        <div className="flex items-center gap-3 mb-3">
                          <img
                            src="https://back.carrefour.tn/media/logos/logo_car_25.png"
                            alt="Carrefour"
                            className="w-10 h-10 rounded-lg object-contain flex-shrink-0 bg-white"
                          />
                          <span className="font-semibold text-gray-900">Carrefour</span>
                        </div>
                        <div className="flex items-center flex-wrap gap-x-3 gap-y-1 text-xs text-gray-600 mb-2">
                          <span className="flex items-center gap-1.5">
                            <Monitor className="h-3.5 w-3.5 flex-shrink-0 text-gray-500" />
                            32 écrans
                          </span>
                          <span className="flex items-center gap-1.5">
                            <MapPin className="h-3.5 w-3.5 flex-shrink-0 text-gray-500" />
                            12 établissements
                          </span>
                        </div>
                        <div className="mb-3">
                          <span className="inline-flex px-2.5 py-1 rounded-full bg-gray-200 text-gray-700 text-xs font-medium">
                            Sport
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-3 mb-4">
                          <div>
                            <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-gray-500">
                              <Crosshair className="h-3 w-3 flex-shrink-0 text-gray-500" />
                              <span>CIBLE DOMINANTE</span>
                            </div>
                            <p className="text-xs font-medium text-gray-900 mt-0.5">18 - 35 ans</p>
                          </div>
                          <div className="flex flex-col items-end">
                            <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-gray-500">
                              <TrendingUp className="h-3 w-3 text-[#7e51f5] flex-shrink-0" />
                              <span>IMPRESSIONS</span>
                            </div>
                            <p className="text-xs font-semibold text-gray-900 tabular-nums mt-0.5">
                              145 000
                            </p>
                          </div>
                        </div>
                        <div className="flex pt-4 mt-auto border-t border-gray-200 -mx-5 px-5">
                          <button
                            type="button"
                            className="w-full py-2.5 rounded-lg bg-gray-700 text-white text-sm font-medium hover:bg-gray-800 transition-colors"
                          >
                            Diffuser sur ce parc
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Mes événements — 2 cartes événement + Suggérez un événement */}
            <div className="mb-10 rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
              <div className="flex flex-row items-center p-0 gap-6 px-5 py-4 border-b border-gray-200 bg-gray-50/50 min-h-[24px]">
                <h2 className="text-lg font-normal leading-6 text-gray-900 flex-1 order-0">
                  Mes événements
                </h2>
                <button
                  type="button"
                  onClick={() => navigate('/evenements')}
                  className="inline-flex items-center justify-center px-5 py-2.5 rounded-xl border border-gray-200 bg-white text-gray-800 text-sm font-medium hover:bg-gray-50 hover:border-gray-300 transition-colors flex-none shadow-sm"
                >
                  Découvrir tous les événements
                </button>
              </div>
              <div className="p-5">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                  {/* Deux cartes événement (contenu statique inspiré du bloc Mis en avant) */}
                  {[
                    {
                      title: 'Derby Tunis VS Sfax',
                      type: 'sport',
                      date: '12 Mars',
                      time: '20h00 - 22h30',
                      impressions: '184 500',
                    },
                    {
                      title: 'Derby Tunis VS Sfax',
                      type: 'sport',
                      date: '12 Mars',
                      time: '20h00 - 22h30',
                      impressions: '184 500',
                    },
                  ].map((evt, idx) => (
                    <div
                      key={idx}
                      className="bg-white rounded-xl shadow-sm border border-[#76E6AB]/60 overflow-hidden flex flex-col"
                    >
                      <div className="aspect-[16/10] bg-gray-200 overflow-hidden">
                        <img src={matchImg} alt="" className="w-full h-full object-cover" />
                      </div>
                      <div className="p-4 flex flex-col flex-1">
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <h3 className="text-sm font-normal text-gray-900 flex-1 truncate">
                            {evt.title}
                          </h3>
                          <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium flex-shrink-0 bg-blue-100 text-blue-800">
                            Sport
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-1.5 mb-2">
                          <span className="inline-flex px-2 py-0.5 rounded bg-gray-100 text-gray-700 text-xs">
                            Restaurants
                          </span>
                          <span className="inline-flex px-2 py-0.5 rounded bg-gray-100 text-gray-700 text-xs">
                            Salles de sport
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 text-sm text-gray-600 mb-1">
                          <Calendar className="h-4 w-4 flex-shrink-0 text-gray-500" />
                          <span>
                            {evt.date} | {evt.time}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 text-sm text-gray-600 mb-2">
                          <TrendingUp className="h-4 w-4 flex-shrink-0 text-gray-500" />
                          <span>~ {evt.impressions} impressions</span>
                        </div>
                        <p className="text-xs text-gray-500 mb-4">
                          (En incluant automatiquement toutes les catégories de commerces qui
                          diffusent pendant le match)
                        </p>
                        <button
                          type="button"
                          onClick={() => navigate('/new-campaign')}
                          className="mt-auto w-full py-2.5 rounded-lg bg-[#e3f7ec] hover:bg-[#cceee0] text-[#66bc74] text-sm font-medium transition-colors inline-flex items-center justify-center gap-2"
                        >
                          <Rocket className="h-4 w-4" />
                          Booster
                        </button>
                      </div>
                    </div>
                  ))}
                  {/* Carte Suggérez un événement */}
                  <div className="bg-[#f5f5f5] rounded-xl border border-[#76E6AB]/60 p-4 shadow-sm flex flex-col items-center text-center">
                    <div className="w-12 h-12 rounded-full bg-[#76E6AB]/30 flex items-center justify-center mb-2">
                      <Megaphone className="h-6 w-6 text-[#2d9f6e]" />
                    </div>
                    <h3 className="text-sm font-bold text-gray-900 mb-2 whitespace-nowrap">
                      Suggérez un événement
                    </h3>
                    <p className="text-sm text-gray-600 mb-3 leading-snug">
                      <span className="block">Vous souhaitez diffuser votre spot</span>
                      <span className="block">lors d&apos;un événement</span>
                      <span className="block">particulier ?</span>
                    </p>
                    <button
                      type="button"
                      onClick={() => navigate('/new-campaign')}
                      className="w-full py-2.5 rounded-lg bg-[#e3f7ec] hover:bg-[#cceee0] text-[#66bc74] text-sm font-medium transition-colors"
                    >
                      Lancer une campagne sur un événement absent de la liste
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Pour bien commencer */}
            {!hideGettingStartedBlock && (
              <div className="mb-10 rounded-2xl border border-gray-200 bg-[#F8FAFC] p-5 shadow-sm">
                <h2 className="text-lg font-bold text-gray-900">Pour bien commencer</h2>
                <p className="text-sm text-gray-600 mt-1 mb-4">
                  Suivez ces étapes pour configurer votre compte
                </p>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                  <div className="rounded-2xl border border-[#E4E7EC] bg-white p-5 flex items-start gap-4">
                    {hasRegistrationDocument ? (
                      <div className="w-10 h-10 rounded-full bg-[#60BA76] flex items-center justify-center flex-shrink-0">
                        <Check className="h-5 w-5 text-white" strokeWidth={3} />
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
                      <p className="text-sm text-gray-600 mt-1">
                        Uploadez votre registre de commerce
                      </p>
                      <button
                        type="button"
                        onClick={() => navigate('/profile?tab=entreprise&sub=documents')}
                        disabled={hasRegistrationDocument}
                        className={`mt-4 inline-flex items-center justify-center px-5 py-2 rounded-xl text-sm font-medium transition-colors ${
                          hasRegistrationDocument
                            ? 'bg-[#F2F4F7] text-[#98A2B3] cursor-not-allowed'
                            : 'bg-white border border-[#D0D5DD] text-[#344054] hover:bg-gray-50'
                        }`}
                      >
                        {hasRegistrationDocument ? 'OK' : 'Upload'}
                      </button>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-[#E4E7EC] bg-white p-5 flex items-start gap-4">
                    <div className="w-8 h-8 rounded-full bg-[#EFF5F2] text-[#171717] flex items-center justify-center text-sm font-semibold">
                      2
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-xl font-semibold text-gray-900">Rechargez votre solde</h3>
                      <p className="text-sm text-gray-600 mt-1">
                        Ajoutez vos fonds pour vos campagnes
                      </p>
                      <button
                        type="button"
                        onClick={() => navigate('/my-recharges')}
                        disabled={!canRechargeAccount}
                        className={`mt-4 inline-flex items-center justify-center px-5 py-2 rounded-xl text-sm font-medium transition-colors ${
                          canRechargeAccount
                            ? 'bg-white border border-[#D0D5DD] text-[#344054] hover:bg-gray-50'
                            : 'bg-[#F2F4F7] text-[#98A2B3] cursor-not-allowed'
                        }`}
                      >
                        Recharger
                      </button>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-[#E4E7EC] bg-white p-5 flex items-start gap-4">
                    <div className="w-8 h-8 rounded-full bg-[#EFF5F2] text-[#171717] flex items-center justify-center text-sm font-semibold">
                      3
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-xl font-semibold text-gray-900">Lancez une campagne</h3>
                      <p className="text-sm text-gray-600 mt-1">Creez votre premiere campagne</p>
                      <button
                        type="button"
                        onClick={() => navigate('/new-campaign')}
                        disabled={!canLaunchCampaign}
                        className={`mt-4 inline-flex items-center justify-center px-5 py-2 rounded-xl text-sm font-medium transition-colors ${
                          canLaunchCampaign
                            ? 'bg-white border border-[#D0D5DD] text-[#344054] hover:bg-gray-50'
                            : 'bg-[#F2F4F7] text-[#98A2B3] cursor-not-allowed'
                        }`}
                      >
                        Commencer
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Insights clés — conforme au CSS fourni */}
            <div
              className="mb-10 flex flex-col items-start rounded-2xl border border-[#96E3B0] bg-[#F5FAF8] p-4 shadow-sm"
              style={{ boxShadow: '0px 1px 2px rgba(10, 13, 20, 0.0313726)' }}
            >
              <div className="flex w-full flex-col items-start gap-1">
                <h2 className="text-lg font-bold leading-6 text-gray-900">Insights clés</h2>
                <p className="text-sm font-normal text-gray-600">
                  Recommandations basées sur l&apos;analyse de vos données
                </p>
              </div>
              <div className="mt-4 flex w-full flex-row flex-wrap items-start gap-6">
                <div
                  className="flex min-w-0 flex-1 flex-row items-start gap-3 rounded-xl border border-[#76E6AB] bg-white p-4"
                  style={{ boxShadow: '0px 1px 2px rgba(10, 13, 20, 0.0313726)' }}
                >
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-[#DCF0E9]">
                    <TrendingUp className="h-6 w-6 text-[#142522]" />
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <h3 className="text-xs font-semibold text-gray-900 whitespace-nowrap truncate">
                      Performances optimales
                    </h3>
                    <p className="text-xs font-normal text-gray-600 leading-4">
                      Vos campagnes Sport génèrent le meilleur ROI à 53.6 impressions/TND
                    </p>
                  </div>
                </div>
                <div
                  className="flex min-w-0 flex-1 flex-row items-start gap-3 rounded-xl border border-[#76E6AB] bg-white p-4"
                  style={{ boxShadow: '0px 1px 2px rgba(10, 13, 20, 0.0313726)' }}
                >
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-[#DCF0E9]">
                    <MapPin className="h-6 w-6 text-[#142522]" />
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <h3 className="text-xs font-semibold text-gray-900 whitespace-nowrap truncate">
                      Zones performantes
                    </h3>
                    <p className="text-xs font-normal text-gray-600 leading-4">
                      Sidi Bou Said représente 44% de vos impressions avec 32 écrans actifs
                    </p>
                  </div>
                </div>
                <div
                  className="flex min-w-0 flex-1 flex-row items-start gap-3 rounded-xl border border-[#76E6AB] bg-white p-4"
                  style={{ boxShadow: '0px 1px 2px rgba(10, 13, 20, 0.0313726)' }}
                >
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-[#DCF0E9]">
                    <Link2 className="h-6 w-6 text-[#142522]" />
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <h3 className="text-xs font-semibold text-gray-900 whitespace-nowrap truncate">
                      Opportunités d&apos;optimisation
                    </h3>
                    <p className="text-xs font-normal text-gray-600 leading-4">
                      Réduisez votre CPM de 15% en ciblant les heures de forte affluence
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
    }
  };

  return (
    <div className="min-h-screen bg-white flex flex-col lg:flex-row">
      {/* Sidebar : à gauche, fixe au scroll (sticky), pleine hauteur */}
      <aside
        className={`
        ${isMenuOpen ? 'flex' : 'hidden'} lg:flex
        fixed left-0 z-30 flex flex-col bg-white border-r border-[#E1E4EA] isolate transition-[width] duration-200 ease-in-out overflow-hidden
        top-0 bottom-0 h-full lg:h-screen lg:sticky lg:top-0
        w-[272px] ${sidebarExpanded ? 'lg:w-[272px]' : 'lg:w-[80px]'} lg:flex-shrink-0
      `}
      >
        {/* Header logo + toggle */}
        <div className="flex flex-col justify-center items-start p-3 gap-2.5 h-[88px] border-b border-[#E1E4EA] flex-none">
          <div className="flex flex-row items-center w-full gap-2">
            <div
              className={`flex items-center justify-center overflow-hidden transition-all ${sidebarExpanded ? 'flex-1 min-w-0' : 'w-10 h-10 flex-shrink-0'}`}
            >
              {sidebarExpanded ? (
                <img
                  src={logoImage}
                  alt="Logo"
                  className="h-10 w-auto max-w-[178px] object-contain"
                />
              ) : (
                <img src={logoCompany} alt="Logo" className="w-10 h-10 object-contain" />
              )}
            </div>
            <button
              type="button"
              onClick={() => setSidebarExpanded((v) => !v)}
              className="flex-shrink-0 p-2 rounded-lg text-[#5C5C5C] hover:bg-gray-100 transition-colors hidden lg:flex"
              title={sidebarExpanded ? 'Réduire le menu' : 'Ouvrir le menu'}
            >
              {sidebarExpanded ? (
                <ChevronLeft className="h-5 w-5" />
              ) : (
                <ChevronRight className="h-5 w-5" />
              )}
            </button>
            <button
              type="button"
              onClick={() => setIsMenuOpen(false)}
              className="lg:hidden p-2 rounded-lg text-[#5C5C5C] hover:bg-gray-100"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
        <nav className="flex flex-col flex-1 py-5 gap-2 px-3">
          {/* Dashboard */}
          <button
            onClick={() => {
              navigate('/dashboard');
              setIsMenuOpen(false);
            }}
            title={!sidebarExpanded ? 'Dashboard' : undefined}
            className={`h-9 flex items-center rounded-lg text-sm font-medium transition-colors tracking-[-0.006em] ${
              sidebarExpanded
                ? 'w-full max-w-[232px] px-3 py-2 gap-3'
                : 'w-10 justify-center px-0 mx-auto'
            } ${location.pathname === '/dashboard' ? 'bg-[#E4F9EB] text-[#132B1B]' : 'text-[#5C5C5C] hover:bg-gray-100/80'}`}
          >
            <img
              src={location.pathname === '/dashboard' ? dashboardIconActive : dashboardIcon}
              alt=""
              className="h-5 w-5 flex-shrink-0 object-contain"
            />
            {sidebarExpanded && <span className="leading-5 truncate">Dashboard</span>}
          </button>
          {/* Mes campagnes */}
          <button
            onClick={() => {
              if (isDisabled) {
                toast.error(
                  '⚠️ Veuillez compléter vos informations pour accéder à cette fonctionnalité',
                );
                openOnboardingModal();
              } else {
                navigate('/my-campaigns');
                setIsMenuOpen(false);
              }
            }}
            disabled={isDisabled}
            title={!sidebarExpanded ? 'Mes campagnes' : undefined}
            className={`h-9 flex items-center rounded-lg text-sm font-medium transition-colors ${
              sidebarExpanded
                ? 'w-full max-w-[232px] px-3 py-2 gap-3'
                : 'w-10 justify-center mx-auto'
            } ${isDisabled ? 'text-[#5C5C5C] opacity-50 cursor-not-allowed' : location.pathname === '/my-campaigns' ? 'bg-[#E4F9EB] text-[#132B1B]' : 'text-[#5C5C5C] hover:bg-gray-100/80'}`}
          >
            <img
              src={location.pathname === '/my-campaigns' ? campagneIconActive : campagneIcon}
              alt=""
              className="h-5 w-5 flex-shrink-0 object-contain"
            />
            {sidebarExpanded && <span className="leading-5 truncate">Mes campagnes</span>}
          </button>
          {/* Événements */}
          <button
            onClick={() => {
              if (isDisabled) {
                toast.error(
                  '⚠️ Veuillez compléter vos informations pour accéder à cette fonctionnalité',
                );
                openOnboardingModal();
              } else {
                navigate('/evenements');
                setIsMenuOpen(false);
              }
            }}
            disabled={isDisabled}
            title={!sidebarExpanded ? 'Événements' : undefined}
            className={`h-9 flex items-center rounded-lg text-sm font-medium transition-colors ${
              sidebarExpanded
                ? 'w-full max-w-[232px] px-3 py-2 gap-3'
                : 'w-10 justify-center mx-auto'
            } ${isDisabled ? 'text-[#5C5C5C] opacity-50 cursor-not-allowed' : location.pathname === '/evenements' ? 'bg-[#E4F9EB] text-[#132B1B]' : 'text-[#5C5C5C] hover:bg-gray-100/80'}`}
          >
            <img
              src={location.pathname === '/evenements' ? agendaIconActive : agendaIcon}
              alt=""
              className="h-5 w-5 flex-shrink-0 object-contain"
            />
            {sidebarExpanded && <span className="leading-5 truncate">Événements</span>}
          </button>
          {/* Mes performances */}
          <button
            onClick={() => {
              if (isDisabled) {
                toast.error(
                  '⚠️ Veuillez compléter vos informations pour accéder à cette fonctionnalité',
                );
                openOnboardingModal();
              } else {
                navigate('/perfor');
                setIsMenuOpen(false);
              }
            }}
            disabled={isDisabled}
            title={!sidebarExpanded ? 'Mes performances' : undefined}
            className={`h-9 flex items-center rounded-lg text-sm font-medium transition-colors ${
              sidebarExpanded
                ? 'w-full max-w-[232px] px-3 py-2 gap-3'
                : 'w-10 justify-center mx-auto'
            } ${isDisabled ? 'text-[#5C5C5C] opacity-50 cursor-not-allowed' : location.pathname === '/perfor' ? 'bg-[#E4F9EB] text-[#132B1B]' : 'text-[#5C5C5C] hover:bg-gray-100/80'}`}
          >
            <img
              src={location.pathname === '/perfor' ? performanceIconActive : performanceIcon}
              alt=""
              className="h-5 w-5 flex-shrink-0 object-contain"
            />
            {sidebarExpanded && <span className="leading-5 truncate">Mes performances</span>}
          </button>
          {/* Mes finances */}
          <button
            onClick={() => {
              if (isDisabled) {
                toast.error(
                  '⚠️ Veuillez compléter vos informations pour accéder à cette fonctionnalité',
                );
                openOnboardingModal();
              } else {
                navigate('/my-recharges');
                setIsMenuOpen(false);
              }
            }}
            disabled={isDisabled}
            title={!sidebarExpanded ? 'Mes finances' : undefined}
            className={`h-9 flex items-center rounded-lg text-sm font-medium transition-colors ${
              sidebarExpanded
                ? 'w-full max-w-[232px] px-3 py-2 gap-3'
                : 'w-10 justify-center mx-auto'
            } ${isDisabled ? 'text-[#5C5C5C] opacity-50 cursor-not-allowed' : location.pathname === '/my-recharges' ? 'bg-[#E4F9EB] text-[#132B1B]' : 'text-[#5C5C5C] hover:bg-gray-100/80'}`}
          >
            <img
              src={location.pathname === '/my-recharges' ? financeIconActive : financeIcon}
              alt=""
              className="h-5 w-5 flex-shrink-0 object-contain"
            />
            {sidebarExpanded && <span className="leading-5 truncate">Mes finances</span>}
          </button>
          {(profileType === 'advertising_agency' || profileType === 'event_organizer') && (
            <button
              onClick={() => {
                if (isDisabled) {
                  toast.error(
                    '⚠️ Veuillez compléter vos informations pour accéder à cette fonctionnalité',
                  );
                  openOnboardingModal();
                } else {
                  navigate('/my-clients');
                  setIsMenuOpen(false);
                }
              }}
              disabled={isDisabled}
              title={!sidebarExpanded ? 'Mes clients' : undefined}
              className={`h-9 flex items-center rounded-lg text-sm font-medium transition-colors ${
                sidebarExpanded
                  ? 'w-full max-w-[232px] px-3 py-2 gap-3'
                  : 'w-10 justify-center mx-auto'
              } ${isDisabled ? 'text-[#5C5C5C] opacity-50 cursor-not-allowed' : location.pathname === '/my-clients' ? 'bg-[#E4F9EB] text-[#132B1B]' : 'text-[#5C5C5C] hover:bg-gray-100/80'}`}
            >
              <Users className="h-5 w-5 flex-shrink-0" strokeWidth={1.5} />
              {sidebarExpanded && <span className="leading-5 truncate">Mes clients</span>}
            </button>
          )}
        </nav>
        {/* Paramètres + Support juste au-dessus de déconnexion */}
        <div
          className={`flex flex-col flex-none pt-2 pb-2 gap-2 px-3 ${sidebarExpanded ? '' : 'items-center'}`}
        >
          <button
            onClick={() => {
              navigate('/profile');
              setIsMenuOpen(false);
            }}
            title={!sidebarExpanded ? 'Mes informations' : undefined}
            className={`h-9 flex items-center rounded-lg text-sm font-medium transition-colors ${
              sidebarExpanded
                ? 'w-full max-w-[232px] px-3 py-2 gap-3'
                : 'w-10 justify-center mx-auto'
            } ${location.pathname === '/profile' ? 'bg-[#E6F7ED] text-[#132B1B]' : 'text-[#5C5C5C] hover:bg-gray-100/80'}`}
          >
            <img
              src={location.pathname === '/profile' ? paramIconActive : paramIcon}
              alt=""
              className="h-5 w-5 flex-shrink-0 object-contain"
            />
            {sidebarExpanded && <span className="leading-5 truncate">Paramètres</span>}
          </button>
          <button
            onClick={() => {
              setShowSupportModal(true);
              setIsMenuOpen(false);
            }}
            title={!sidebarExpanded ? 'Support' : undefined}
            className={`h-9 flex items-center rounded-lg text-sm font-medium transition-colors ${
              sidebarExpanded
                ? 'w-full max-w-[232px] px-3 py-2 gap-3'
                : 'w-10 justify-center mx-auto'
            } ${showSupportModal ? 'bg-[#E6F7ED] text-[#132B1B]' : 'text-[#5C5C5C] hover:bg-gray-100/80'}`}
          >
            <img
              src={showSupportModal ? supportIconActive : supportIcon}
              alt=""
              className="h-5 w-5 flex-shrink-0 object-contain"
            />
            {sidebarExpanded && <span className="leading-5 truncate">Support</span>}
          </button>
        </div>
        {/* Bloc utilisateur déconnexion (icône + nom, clic = confirmation) */}
        <div
          className={`flex flex-col flex-none border-t border-[#E1E4EA] ${sidebarExpanded ? '' : 'items-center'}`}
        >
          <button
            type="button"
            onClick={() => setShowLogoutConfirm(true)}
            title={sidebarExpanded ? 'Déconnexion' : undefined}
            className={`w-full h-12 flex flex-row items-center gap-3 rounded-none text-left ${
              sidebarExpanded ? 'px-3 py-3' : 'justify-center p-2'
            }`}
          >
            <img src={deconnexionIcon} alt="" className="h-9 w-9 flex-shrink-0 object-contain" />
            {sidebarExpanded && (
              <>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[#5C5C5C] leading-5 tracking-[-0.006em] truncate">
                    {profile?.contact_name || user?.email?.split('@')[0] || 'Utilisateur'}
                  </p>
                </div>
                <ChevronRight className="h-5 w-5 flex-shrink-0 text-[#5C5C5C]" strokeWidth={1.5} />
              </>
            )}
          </button>
        </div>
      </aside>

      {/* Zone centrale : header + contenu (entre sidebar gauche et colonne panier droite) */}
      <div className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden">
        {/* Header : contenu adapté selon la page (Mes campagnes vs défaut) */}
        <header className="flex-none h-16 bg-white border-b border-gray-200 sticky top-0 z-40 shadow-sm">
          <div className="h-full w-full px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-4 flex-nowrap">
            {/* Gauche : selon la page */}
            <div className="flex items-center gap-3 min-w-0 flex-shrink-0">
              <button
                className="md:hidden p-2 rounded-full bg-gray-100 hover:bg-gray-200 transition-colors text-gray-500 flex-shrink-0"
                onClick={() => setIsMenuOpen(!isMenuOpen)}
                aria-label="Menu"
              >
                <PanelLeft className="h-5 w-5" />
              </button>
              {location.pathname === '/my-campaigns' ? (
                <>
                  <img
                    src={headerCampagnesIcon}
                    alt=""
                    className="h-12 w-12 flex-shrink-0 object-contain"
                  />
                  <div className="min-w-0">
                    <h1 className="text-base sm:text-lg font-bold text-gray-900 truncate">
                      Mes campagnes
                    </h1>
                    <p className="text-xs text-gray-500 truncate hidden sm:block">
                      Gérez vos campagnes actives
                    </p>
                  </div>
                </>
              ) : location.pathname === '/parcs' ? (
                <>
                  <img
                    src={headerParcsIcon}
                    alt=""
                    className="h-12 w-12 flex-shrink-0 object-contain"
                  />
                  <div className="min-w-0">
                    <h1 className="text-base sm:text-lg font-bold text-gray-900 truncate">
                      Parcs TV
                    </h1>
                    <p className="text-xs text-gray-500 truncate hidden sm:block">
                      Wording Youssef
                    </p>
                  </div>
                </>
              ) : location.pathname === '/evenements' ? (
                <>
                  <img
                    src={headerAgendaIcon}
                    alt=""
                    className="h-12 w-12 flex-shrink-0 object-contain"
                  />
                  <div className="min-w-0">
                    <h1 className="text-base sm:text-lg font-bold text-gray-900 truncate">
                      Événements
                    </h1>
                    <p className="text-xs text-gray-500 truncate hidden sm:block">
                      Profitez des pics d'audience des événements pour amplifier votre impact
                    </p>
                  </div>
                </>
              ) : location.pathname === '/perfor' ? (
                <>
                  <img
                    src={headerPerformanceIcon}
                    alt=""
                    className="h-12 w-12 flex-shrink-0 object-contain"
                  />
                  <div className="min-w-0">
                    <h1 className="text-base sm:text-lg font-bold text-gray-900 truncate">
                      Mes performances
                    </h1>
                    <p className="text-xs text-gray-500 truncate hidden sm:block">
                      Analysez la performance de vos campagnes en un coup d&apos;oeil
                    </p>
                  </div>
                </>
              ) : location.pathname === '/my-recharges' ? (
                <>
                  <img
                    src={headerFinanceIcon}
                    alt=""
                    className="h-12 w-12 flex-shrink-0 object-contain"
                  />
                  <div className="min-w-0">
                    <h1 className="text-base sm:text-lg font-bold text-gray-900 truncate">
                      Mes Finances
                    </h1>
                    <p className="text-xs text-gray-500 truncate hidden sm:block">
                      Gérez votre solde et consultez l&apos;historique de vos transactions
                    </p>
                  </div>
                </>
              ) : location.pathname === '/my-invoices' ? (
                <>
                  <img
                    src={headerFinanceIcon}
                    alt=""
                    className="h-12 w-12 flex-shrink-0 object-contain"
                  />
                  <div className="min-w-0 flex items-center gap-1.5">
                    <span className="text-base sm:text-lg font-bold text-gray-400 truncate">
                      Mes Finances
                    </span>
                    <ChevronRight className="h-4 w-4 text-gray-400 flex-shrink-0" />
                    <h1 className="text-base sm:text-lg font-bold text-gray-900 truncate">
                      Mes factures
                    </h1>
                  </div>
                </>
              ) : location.pathname === '/profile' ? (
                <>
                  <img
                    src={headerParamsIcon}
                    alt=""
                    className="h-12 w-12 flex-shrink-0 object-contain"
                  />
                  <div className="min-w-0">
                    <h1 className="text-base sm:text-lg font-bold text-gray-900 truncate">
                      Paramètres
                    </h1>
                    <p className="text-xs text-gray-500 truncate hidden sm:block">
                      Gérez vos préférences et configurez différentes options.
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <div className="hidden md:flex items-center gap-1 flex-shrink-0">
                    <button
                      type="button"
                      className="p-2 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500"
                      aria-label="Vue grille"
                    >
                      <LayoutGrid className="h-5 w-5" />
                    </button>
                  </div>
                  <div className="min-w-0">
                    <h1 className="text-base sm:text-lg font-bold text-gray-900 truncate">
                      Bonjour,{' '}
                      {profile?.contact_name || user?.email?.split('@')[0] || 'Utilisateur'}
                    </h1>
                    <p className="text-xs text-gray-500 truncate hidden sm:block">
                      Gérez vos campagnes et suivez vos performances en temps réel
                    </p>
                  </div>
                </>
              )}
            </div>

            {/* Droite : Prendre rendez-vous + cloche + Mon panier (style adapté sur Mes campagnes) */}
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                type="button"
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg font-medium text-sm whitespace-nowrap ${
                  location.pathname === '/my-campaigns' ||
                  location.pathname === '/parcs' ||
                  location.pathname === '/evenements' ||
                  location.pathname === '/perfor'
                    ? 'bg-[#76E6AB] hover:opacity-90 text-gray-900'
                    : 'bg-[#9ae2b0] hover:bg-[#85d99e] text-gray-900'
                }`}
                onClick={() => setShowContactModal(true)}
              >
                <Users className="h-4 w-4 flex-shrink-0" />
                <span className="hidden md:inline">Prendre rendez-vous</span>
              </button>
              <AdvertiserNotificationsBell
                userId={user?.id}
                emphasized={
                  location.pathname === '/my-campaigns' ||
                  location.pathname === '/parcs' ||
                  location.pathname === '/evenements' ||
                  location.pathname === '/perfor'
                }
              />
              <button
                type="button"
                onClick={() => setCartOpen((v) => !v)}
                className={`flex items-center gap-1.5 px-2.5 py-2.5 rounded-lg text-sm font-medium whitespace-nowrap ${
                  location.pathname === '/my-campaigns' ||
                  location.pathname === '/parcs' ||
                  location.pathname === '/evenements' ||
                  location.pathname === '/perfor'
                    ? 'bg-white border border-gray-200 hover:bg-gray-50 text-gray-700'
                    : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                }`}
              >
                <ShoppingBag className="h-5 w-5 flex-shrink-0" />
                <span className="hidden md:inline">Mon panier</span>
                <span className="text-red-500 font-semibold">{cartCount}</span>
              </button>
            </div>
          </div>
        </header>
        <main className="flex-1 min-h-0 overflow-auto p-8">
          <ContentErrorBoundary>{renderContent()}</ContentErrorBoundary>
        </main>
      </div>

      {/* Colonne droite : Panier (emplacement maquette — Sous-total + montant + Mon panier en haut) */}
      <aside
        className={`hidden lg:flex flex-col flex-shrink-0 bg-gray-50/80 border-l border-[#E1E4EA] transition-[width] duration-200 ease-in-out overflow-hidden ${
          cartOpen ? 'w-[136px]' : 'w-0 border-l-0'
        }`}
      >
        {cartOpen && (
          <>
            <div className="flex-none p-4 flex flex-col gap-2 border-b border-[#E1E4EA]">
              <p className="text-xs text-gray-500">Sous-total</p>
              <p className="text-base font-bold text-gray-900">
                {cartSubtotal.toLocaleString('fr-FR', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}{' '}
                TND
              </p>
              <button
                type="button"
                onClick={() => navigate('/my-cart')}
                className="w-full py-2 rounded-lg bg-gray-200 hover:bg-gray-300 text-gray-700 text-sm font-medium"
              >
                Mon panier
              </button>
            </div>
            <div className="flex-1 overflow-auto p-2 space-y-3">
              {cartCount === 0 ? (
                <p className="text-xs text-gray-500 text-center py-4">Panier vide</p>
              ) : (
                cartItems.map((item) => (
                  <div
                    key={item.id}
                    className="bg-white rounded-lg border border-gray-200 p-2 shadow-sm flex flex-col"
                  >
                    <div className="flex items-start justify-between gap-1 mb-2">
                      <p className="text-[11px] font-semibold text-gray-900 break-words leading-tight flex-1 min-w-0">
                        {item.name || 'Nom de la campagne'}
                      </p>
                      <button
                        type="button"
                        onClick={() => removeFromCart(item.id)}
                        className="p-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 flex-shrink-0"
                        title="Retirer du panier"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div className="w-full h-24 rounded-md bg-gray-200 mb-2" />
                    {(item.periodLabel || item.zonesLabel) && (
                      <p
                        className="text-[10px] text-gray-500 mb-1.5 leading-tight line-clamp-1"
                        title={[item.periodLabel, item.zonesLabel].filter(Boolean).join(' · ')}
                      >
                        {[item.periodLabel, item.zonesLabel].filter(Boolean).join(' · ')}
                      </p>
                    )}
                    <p className="text-sm font-bold text-gray-900">
                      {item.amount.toLocaleString('fr-FR', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}{' '}
                      TND
                    </p>
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </aside>

      {/* Onboarding Modal - Toujours disponible peu importe la route */}
      {!DISABLE_ONBOARDING_POPUPS && showOnboarding && (
        <OnboardingModal onComplete={handleOnboardingComplete} onClose={handleOnboardingClose} />
      )}

      {/* Modal confirmation déconnexion */}
      {showLogoutConfirm && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => setShowLogoutConfirm(false)}
        >
          <div
            className="bg-white rounded-xl p-6 max-w-sm w-full shadow-xl border border-gray-200"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-gray-800 text-center mb-6">Vous allez être déconnecté.</p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setShowLogoutConfirm(false)}
                className="flex-1 py-2.5 px-4 rounded-xl border border-gray-300 text-gray-700 font-medium hover:bg-gray-50 transition-colors"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={async () => {
                  setShowLogoutConfirm(false);
                  await handleLogout();
                }}
                className="flex-1 py-2.5 px-4 rounded-xl font-medium text-white transition-colors hover:opacity-90"
                style={{ background: '#76E6AB' }}
              >
                Se déconnecter
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Support Modal */}
      {showSupportModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl border border-gray-200 max-w-md w-full overflow-hidden">
            <div className="p-4 pb-3 border-b border-dashed border-sky-200">
              <div className="flex justify-between items-start gap-4">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="flex-shrink-0 w-10 h-10 rounded-full bg-gray-100 border border-gray-300 flex items-center justify-center p-1.5">
                    <img src={supportIcon} alt="" className="w-full h-full object-contain" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-lg font-bold text-gray-900">Support</h3>
                    <p className="text-sm text-gray-500 mt-0.5">
                      Prendre rendez-vous avec un agent toodooh
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowSupportModal(false)}
                  className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 flex-shrink-0"
                  aria-label="Fermer"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>
            <form
              className="p-4 space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (isAutreObjective(supportObjective) && !supportOtherDetail.trim()) {
                  toast.error('Veuillez préciser dans la description');
                  return;
                }
                toast.success('Message envoyé');
                setShowSupportModal(false);
                setSupportObjective('');
                setSupportOtherDetail('');
                setSupportMessage('');
              }}
            >
              <div>
                <label className="block text-sm font-bold text-gray-900 mb-1.5">
                  Choisissez vos objectifs *
                </label>
                <select
                  value={supportObjective}
                  onChange={(e) => setSupportObjective(e.target.value)}
                  className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-gray-900 focus:ring-2 focus:ring-[#97d8a5] focus:border-[#97d8a5] appearance-none cursor-pointer"
                  style={{
                    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%236b7280'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E")`,
                    backgroundRepeat: 'no-repeat',
                    backgroundPosition: 'right 0.75rem center',
                    backgroundSize: '1.25rem',
                    paddingRight: '2.5rem',
                  }}
                >
                  <option value="">Choisissez vos objectifs</option>
                  {appointmentObjectives.map((obj) => (
                    <option key={obj} value={obj}>
                      {obj}
                    </option>
                  ))}
                </select>
              </div>
              {isAutreObjective(supportObjective) && (
                <div>
                  <label className="block text-sm font-bold text-gray-900 mb-1.5">
                    Précision *
                  </label>
                  <input
                    type="text"
                    value={supportOtherDetail}
                    onChange={(e) => setSupportOtherDetail(e.target.value)}
                    className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:ring-2 focus:ring-[#97d8a5] focus:border-[#97d8a5]"
                    placeholder="Veuillez préciser dans la description"
                  />
                </div>
              )}
              <div>
                <label className="block text-sm font-bold text-gray-900 mb-1.5">
                  Commentaire additionnels
                </label>
                <textarea
                  rows={3}
                  value={supportMessage}
                  onChange={(e) => setSupportMessage(e.target.value)}
                  className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:ring-2 focus:ring-[#97d8a5] focus:border-[#97d8a5] resize-none"
                  placeholder="Votre Message ici.."
                />
              </div>
              <div className="pt-1 border-t border-dashed border-sky-200 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setShowSupportModal(false)}
                  className="px-5 py-2.5 rounded-xl font-medium text-gray-900 border border-gray-300 bg-white hover:bg-gray-50"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2.5 rounded-xl font-medium text-black transition-opacity hover:opacity-90"
                  style={{ background: '#97d8a5' }}
                >
                  Envoyer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Contact Modal - Prendre rendez-vous */}
      {showContactModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl border border-gray-200 max-w-md w-full overflow-hidden flex flex-col max-h-[90vh]">
            <div className="p-4 pb-2 flex-shrink-0">
              <div className="flex justify-between items-start gap-4">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center">
                    <Users className="h-4 w-4 text-gray-600" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-base font-bold text-gray-900 uppercase tracking-tight">
                      Prendre rendez-vous
                    </h3>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Rencontrez un agent Toodooh pour répondre à vos besoins
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowContactModal(false)}
                  className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 flex-shrink-0"
                  aria-label="Fermer"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>
            <form
              className="px-4 pb-4 space-y-3 flex-1 min-h-0 flex flex-col"
              onSubmit={(e) => {
                e.preventDefault();
                if (isAutreObjective(contactObjective) && !contactOtherDetail.trim()) {
                  toast.error('Veuillez préciser dans la description');
                  return;
                }
                toast.success('Rendez-vous demandé');
                setShowContactModal(false);
                setContactObjective('');
                setContactOtherDetail('');
                setContactDate(null);
                setContactMessage('');
              }}
            >
              <div className="flex-shrink-0">
                <label className="block text-sm font-bold text-gray-900 mb-1">
                  Choisissez vos objectifs *
                </label>
                <select
                  value={contactObjective}
                  onChange={(e) => setContactObjective(e.target.value)}
                  className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-gray-900 focus:ring-2 focus:ring-[#97d8a5] focus:border-[#97d8a5] appearance-none cursor-pointer"
                  style={{
                    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%236b7280'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E")`,
                    backgroundRepeat: 'no-repeat',
                    backgroundPosition: 'right 0.75rem center',
                    backgroundSize: '1.25rem',
                    paddingRight: '2.5rem',
                  }}
                >
                  <option value="">Choisissez vos objectifs</option>
                  {appointmentObjectives.map((obj) => (
                    <option key={obj} value={obj}>
                      {obj}
                    </option>
                  ))}
                </select>
              </div>
              {isAutreObjective(contactObjective) && (
                <div className="flex-shrink-0">
                  <label className="block text-sm font-bold text-gray-900 mb-1">Précision *</label>
                  <input
                    type="text"
                    value={contactOtherDetail}
                    onChange={(e) => setContactOtherDetail(e.target.value)}
                    className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:ring-2 focus:ring-[#97d8a5] focus:border-[#97d8a5] text-sm"
                    placeholder="Veuillez préciser dans la description"
                  />
                </div>
              )}
              <div className="flex-shrink-0">
                <label className="block text-sm font-bold text-gray-900 mb-1">
                  Choisissez un créneau *
                </label>
                <div className="border border-gray-200 rounded-xl p-2 bg-gray-50/50">
                  <div className="flex items-center justify-between mb-2">
                    <button
                      type="button"
                      onClick={() =>
                        setContactCalendarMonth((d) => new Date(d.getFullYear(), d.getMonth() - 1))
                      }
                      className="p-1 rounded-lg hover:bg-gray-200 text-gray-600"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <span className="text-xs font-semibold text-gray-900">
                      {MONTHS_FR[contactCalendarMonth.getMonth()]}{' '}
                      {contactCalendarMonth.getFullYear()}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setContactCalendarMonth((d) => new Date(d.getFullYear(), d.getMonth() + 1))
                      }
                      className="p-1 rounded-lg hover:bg-gray-200 text-gray-600"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="grid grid-cols-7 gap-0.5 text-center">
                    {WEEKDAYS_FR.map((wd) => (
                      <div key={wd} className="text-[10px] font-medium text-gray-500 py-0.5">
                        {wd}
                      </div>
                    ))}
                    {getCalendarDays(
                      contactCalendarMonth.getFullYear(),
                      contactCalendarMonth.getMonth(),
                    ).map((cell, idx) => {
                      const unavailable =
                        !cell.currentMonth || isDatePast(cell.date) || isDateUnavailable(cell.date);
                      const selected =
                        contactDate &&
                        cell.currentMonth &&
                        contactDate.getDate() === cell.day &&
                        contactDate.getMonth() === contactCalendarMonth.getMonth() &&
                        contactDate.getFullYear() === contactCalendarMonth.getFullYear();
                      return (
                        <button
                          key={idx}
                          type="button"
                          disabled={!cell.currentMonth || isDatePast(cell.date)}
                          onClick={() => {
                            if (
                              cell.currentMonth &&
                              !isDatePast(cell.date) &&
                              !isDateUnavailable(cell.date)
                            ) {
                              setContactDate(cell.date);
                            }
                          }}
                          className={`py-1 rounded-md text-xs font-medium transition-colors ${
                            !cell.currentMonth
                              ? 'text-gray-300'
                              : isDatePast(cell.date)
                                ? 'text-gray-400 cursor-not-allowed'
                                : isDateUnavailable(cell.date)
                                  ? 'bg-red-100 text-red-700 cursor-not-allowed'
                                  : selected
                                    ? 'bg-[#97d8a5] text-black'
                                    : 'bg-[#E6F7ED] text-gray-900 hover:bg-[#97d8a5]/80'
                          }`}
                        >
                          {cell.day}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
              <div className="flex-shrink-0">
                <label className="block text-sm font-bold text-gray-900 mb-1">
                  Aidez-nous à préparer au mieux l&apos;entretien
                </label>
                <textarea
                  rows={2}
                  value={contactMessage}
                  onChange={(e) => setContactMessage(e.target.value)}
                  className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:ring-2 focus:ring-[#97d8a5] focus:border-[#97d8a5] resize-none text-sm"
                  placeholder="Votre Message ici.."
                />
              </div>
              <div className="flex items-center gap-3 pt-2 flex-shrink-0">
                <button
                  type="button"
                  onClick={() => setShowContactModal(false)}
                  className="px-5 py-2.5 rounded-xl font-medium text-gray-900 border border-gray-300 bg-white hover:bg-gray-50"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2.5 rounded-xl font-medium text-black transition-opacity hover:opacity-90"
                  style={{ background: '#97d8a5' }}
                >
                  Prendre rendez-vous
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
