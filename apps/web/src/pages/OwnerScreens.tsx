import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Monitor, 
  MapPin, 
  BarChart3, 
  Settings, 
  LogOut,
  Menu,
  X,
  Home,
  DollarSign,
  Activity,
  Calendar,
  Users,
  User,
  ChevronDown,
  HelpCircle,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Clock,
  Eye,
  Wrench,
  Power,
  TrendingUp,
  FileText,
  Plus,
  Search,
  Filter,
  MoreVertical,
  Play,
  Pause,
  Trash2,
  Edit,
  Info,
  Bell
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useAuthStore } from '../stores/auth.store';
import OwnerNavigation from '../components/OwnerNavigation';
import ScreenCalendar from '../components/ScreenCalendar';
import { screensService, Screen, UnavailabilityPeriod, ScreenAlert } from '../services/screens.service';
import { supabase } from '../lib/supabase';
import AddScreen from '../components/AddScreen';

interface RevenueStats {
  totalRevenue: number;
  monthlyRevenue: number;
  activeScreens: number;
  totalScreens: number;
  loyaltyPoints: number;
}

export default function OwnerScreens() {
  const navigate = useNavigate();
  const { user, profileType, needsApproval, validationStatus } = useAuthStore();
  const isDisabled = needsApproval && validationStatus === 'pending';
  const [loading, setLoading] = useState(true);
  const [screens, setScreens] = useState<Screen[]>([]);
  const [selectedScreen, setSelectedScreen] = useState<Screen | null>(null);
  const [showAddScreenModal, setShowAddScreenModal] = useState(false);
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<string>('name');
  const [unavailabilityPeriods, setUnavailabilityPeriods] = useState<UnavailabilityPeriod[]>([]);
  const [screenAutoAccept, setScreenAutoAccept] = useState<Map<string, boolean>>(new Map());
  const [updatingScreen, setUpdatingScreen] = useState<string | null>(null);
  
  // ✅ OPTIMISATION : Éviter les rechargements multiples
  const hasLoadedData = useRef(false);

  // ✅ OPTIMISATION : Mémoriser loadScreensData avec useCallback
  const loadScreensData = useCallback(async () => {
    try {
      console.log('=== CHARGEMENT DES ÉCRANS ===');
      console.log('Utilisateur connecté:', user);
      console.log('Type de profil:', profileType);
      
      const [screensData, unavailabilityData] = await Promise.all([
        screensService.getScreens(),
        screensService.getUnavailabilityPeriods()
      ]);

      console.log('Écrans chargés:', screensData);
      console.log('Nombre d\'écrans:', screensData?.length || 0);
      console.log('Périodes d\'indisponibilité chargées:', unavailabilityData);
      console.log('Nombre de périodes:', unavailabilityData?.length || 0);

      if (screensData && screensData.length > 0) {
        console.log('Détails des écrans:');
        screensData.forEach((screen, index) => {
          console.log(`Écran ${index + 1}:`, {
            id: screen.id,
            name: screen.name,
            owner_id: screen.owner_id,
            status: screen.status,
            location: screen.location
          });
        });
      } else {
        console.log('⚠️ AUCUN ÉCRAN TROUVÉ - Vérifiez:');
        console.log('1. La base de données contient-elle des écrans ?');
        console.log('2. Les politiques RLS permettent-elles l\'accès ?');
        console.log('3. L\'utilisateur est-il bien authentifié ?');
      }

      setScreens(screensData);
      setUnavailabilityPeriods(unavailabilityData);
      
      // Charger les configurations auto_accept pour chaque écran
      const autoAcceptMap = new Map<string, boolean>();
      for (const screen of screensData) {
        const { data: configs, error } = await supabase
          .from('screen_configurations')
          .select('auto_accept_campaigns')
          .eq('screen_id', screen.id);
        
        // Si erreur ou pas de config, utiliser false par défaut
        if (error || !configs || configs.length === 0) {
          autoAcceptMap.set(screen.id, false);
        } else {
          autoAcceptMap.set(screen.id, configs[0]?.auto_accept_campaigns || false);
        }
      }
      setScreenAutoAccept(autoAcceptMap);
      
      setLoading(false);
      hasLoadedData.current = true; // ✅ Marquer comme chargé
    } catch (error) {
      console.error('Erreur lors du chargement des écrans:', error);
      toast.error('Erreur lors du chargement des écrans');
      setLoading(false);
    }
  }, []); // ✅ Pas de dépendances

  // ✅ OPTIMISATION : useEffect séparé pour l'authentification
  useEffect(() => {
    if (!user) {
      navigate('/login');
    }
  }, [user, navigate]);

  // ✅ OPTIMISATION : useEffect séparé pour le chargement initial
  useEffect(() => {
    if (user && !hasLoadedData.current) {
      console.log('BYPASS: Accès autorisé pour tous les types de profil');
      console.log('Type de profil actuel:', profileType);
      loadScreensData();
    }
  }, [user, profileType, loadScreensData]);

  // ✅ OPTIMISATION : useEffect pour le popup calendrier (inchangé)
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const openCalendar = urlParams.get('openCalendar');
    
    if (openCalendar === 'true') {
      setTimeout(() => {
        setShowCalendar(true);
        const newUrl = window.location.pathname;
        window.history.replaceState({}, '', newUrl);
      }, 500);
    }
  }, []);

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

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'active':
        return <CheckCircle className="h-4 w-4" />;
      case 'maintenance':
        return <Wrench className="h-4 w-4" />;
      case 'inactive':
        return <XCircle className="h-4 w-4" />;
      case 'unavailable':
        return <AlertTriangle className="h-4 w-4" />;
      default:
        return <Info className="h-4 w-4" />;
    }
  };

  const handleToggleAutoAccept = async (screenId: string, currentValue: boolean) => {
    try {
      setUpdatingScreen(screenId);
      const newValue = !currentValue;

      // Vérifier si la configuration existe (sans .single() pour éviter l'erreur 406)
      const { data: existingConfigs, error: checkError } = await supabase
        .from('screen_configurations')
        .select('id')
        .eq('screen_id', screenId)
        .limit(1);

      if (checkError) {
        console.error('Erreur lors de la vérification:', checkError);
        throw checkError;
      }

      const exists = existingConfigs && existingConfigs.length > 0;

      if (exists) {
        // Mettre à jour la configuration existante
        const { error: updateError } = await supabase
          .from('screen_configurations')
          .update({ auto_accept_campaigns: newValue })
          .eq('screen_id', screenId);

        if (updateError) {
          console.error('Erreur lors de la mise à jour:', updateError);
          throw updateError;
        }
      } else {
        // Créer une nouvelle configuration avec seulement les champs nécessaires
        const { error: insertError } = await supabase
          .from('screen_configurations')
          .insert({
            screen_id: screenId,
            auto_accept_campaigns: newValue,
            brightness_level: 100,
            volume_level: 50,
            auto_brightness: true,
            auto_volume: true,
            timezone: 'Africa/Tunis',
            language: 'fr',
            refresh_rate: 60,
            maintenance_mode: false
          });

        if (insertError) {
          console.error('Erreur lors de l\'insertion:', insertError);
          throw insertError;
        }
      }

      // Mettre à jour l'état local
      setScreenAutoAccept(prev => {
        const newMap = new Map(prev);
        newMap.set(screenId, newValue);
        return newMap;
      });

      toast.success(newValue ? 'Acceptation automatique activée' : 'Acceptation automatique désactivée');
    } catch (error) {
      console.error('Erreur lors de la mise à jour de la configuration:', error);
      toast.error('Erreur lors de la mise à jour de la configuration');
    } finally {
      setUpdatingScreen(null);
    }
  };

  const handleStatusChange = async (screenId: string, newStatus: string, reason?: string) => {
    try {
      console.log('🔄 Mise à jour du statut de l\'écran:', { screenId, newStatus, reason });
      
      // Appeler le service pour mettre à jour en base de données
      const updatedScreen = await screensService.updateScreen(screenId, {
        status: newStatus as any
      });
      
      console.log('✅ Écran mis à jour en base de données:', updatedScreen);
      
      // Mettre à jour l'état local
      setScreens(prev => prev.map(screen => {
        if (screen.id === screenId) {
          return {
            ...screen,
            status: newStatus as any
          };
        }
        return screen;
      }));
      
      toast.success(`Statut de l'écran mis à jour`);
      setShowStatusModal(false);
    } catch (error) {
      console.error('❌ Erreur lors de la mise à jour du statut:', error);
      toast.error('Erreur lors de la mise à jour du statut');
    }
  };

  const handleUnavailabilityAdded = async (period: UnavailabilityPeriod) => {
    try {
      console.log('📅 Période d\'indisponibilité ajoutée:', period);
      
      setUnavailabilityPeriods(prev => [...prev, period]);
      
      // Mettre à jour le statut de l'écran si la période est en cours
      const now = new Date();
      const periodStart = new Date(`${period.start_date}T${period.start_time}`);
      const periodEnd = new Date(`${period.end_date}T${period.end_time}`);
      
      if (now >= periodStart && now <= periodEnd) {
        console.log('🔄 Mise à jour du statut de l\'écran vers "unavailable"');
        
        // Mettre à jour en base de données
        const updatedScreen = await screensService.updateScreen(period.screen_id, {
          status: 'unavailable'
        });
        
        console.log('✅ Écran mis à jour en base de données:', updatedScreen);
        
        // Mettre à jour l'état local
        setScreens(prev => prev.map(screen => {
          if (screen.id === period.screen_id) {
            return {
              ...screen,
              status: 'unavailable' as any
            };
          }
          return screen;
        }));
      }
    } catch (error) {
      console.error('❌ Erreur lors de la mise à jour du statut:', error);
      toast.error('Erreur lors de la mise à jour du statut');
    }
  };

  const removeUnavailabilityPeriod = async (periodId: string) => {
    try {
      console.log('🗑️ Suppression de la période d\'indisponibilité:', periodId);
      
      // Supprimer en base de données
      await screensService.deleteUnavailabilityPeriod(periodId);
      
      console.log('✅ Période supprimée de la base de données');
      
      // Mettre à jour l'état local
      setUnavailabilityPeriods(prev => prev.filter(p => p.id !== periodId));
      
      toast.success('Période d\'indisponibilité supprimée');
    } catch (error) {
      console.error('❌ Erreur lors de la suppression de la période:', error);
      toast.error('Erreur lors de la suppression de la période');
    }
  };

  // Fonction pour mettre à jour le statut d'un écran en base de données
  const updateScreenStatusInDatabase = async (screenId: string, newStatus: string) => {
    try {
      console.log('🔄 Mise à jour du statut en base de données:', { screenId, newStatus });
      const updatedScreen = await screensService.updateScreen(screenId, {
        status: newStatus as any
      });
      console.log('✅ Statut mis à jour en base de données:', updatedScreen);
      return true;
    } catch (error) {
      console.error('❌ Erreur lors de la mise à jour du statut:', error);
      return false;
    }
  };

  // Vérifier automatiquement les périodes d'indisponibilité expirées
  useEffect(() => {
    const checkExpiredUnavailability = () => {
      const now = new Date();
      
      setUnavailabilityPeriods(prev => prev.map(period => {
        const periodStart = new Date(`${period.start_date}T${period.start_time}`);
        const periodEnd = new Date(`${period.end_date}T${period.end_time}`);
        
        // Si la période est expirée, la marquer comme terminée
        if (now > periodEnd && period.status !== 'completed') {
          // Remettre l'écran en statut actif si il était indisponible
          setScreens(prevScreens => prevScreens.map(screen => {
            if (screen.id === period.screen_id && screen.status === 'unavailable') {
              // Mettre à jour en base de données de manière asynchrone
              updateScreenStatusInDatabase(screen.id, 'active').then(success => {
                if (success) {
                  toast.success(`L'écran "${screen.name}" est maintenant disponible pour diffuser des annonces`);
                }
              });
              
              return {
                ...screen,
                status: 'active' as any
              };
            }
            return screen;
          }));
          
          return { ...period, status: 'completed' as const };
        }
        
        // Si la période est en cours, la marquer comme active
        if (now >= periodStart && now <= periodEnd && period.status === 'pending') {
          // Marquer l'écran comme indisponible
          setScreens(prevScreens => prevScreens.map(screen => {
            if (screen.id === period.screen_id) {
              // Mettre à jour en base de données de manière asynchrone
              updateScreenStatusInDatabase(screen.id, 'unavailable').then(success => {
                if (success) {
                  toast.success(`L'écran "${screen.name}" est maintenant indisponible (${period.reason})`);
                }
              });
              
              return {
                ...screen,
                status: 'unavailable' as any
              };
            }
            return screen;
          }));
          
          return { ...period, status: 'active' as const };
        }
        
        return period;
      }));
    };

    // Vérifier immédiatement
    checkExpiredUnavailability();

    // Vérifier toutes les minutes
    const interval = setInterval(checkExpiredUnavailability, 60000);

    return () => clearInterval(interval);
  }, []);

  const filteredScreens = screens.filter(screen => {
    const matchesSearch = screen.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         screen.location.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === 'all' || screen.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const sortedScreens = [...filteredScreens].sort((a, b) => {
    switch (sortBy) {
      case 'name':
        return a.name.localeCompare(b.name);
      case 'status':
        return a.status.localeCompare(b.status);
      case 'revenue':
        return b.monthly_revenue - a.monthly_revenue;
      case 'lastActivity':
        return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
      default:
        return 0;
    }
  });

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
        <OwnerNavigation isDisabled={isDisabled} />
        
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Header */}
          <header className="bg-white border-b border-gray-200 sticky top-0 z-40 shadow-sm">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="flex justify-between items-center h-16">
                <div className="flex items-center space-x-4">
                  <div>
                    <h1 className="text-2xl font-bold text-gray-900">
                      Mes Écrans
                    </h1>
                    <p className="text-sm text-gray-600 mt-1">
                      Gérez et suivez vos écrans
                    </p>
                  </div>
                  <span className="px-3 py-1 text-sm font-medium bg-[#00B3A6]/10 text-[#00B3A6] border border-[#00B3A6]/20 rounded-full">
                    {screens.length} écran{screens.length > 1 ? 's' : ''}
                  </span>
                </div>
                
                {/* Notifications */}
                <div className="flex items-center space-x-4">
                  <button className="p-2 rounded-lg hover:bg-gray-100 transition-colors relative text-gray-600">
                    <Bell className="h-6 w-6" />
                    <span className="absolute -top-1 -right-1 h-5 w-5 bg-red-500 text-gray-900 text-xs rounded-full flex items-center justify-center">
                      2
                    </span>
                  </button>
                </div>
              </div>
            </div>
          </header>

          <div className="flex-1 overflow-y-auto">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
              
              {/* Boutons d'action */}
              <div className="flex justify-between items-center mb-6">
                <button
                  onClick={() => setShowCalendar(true)}
                  className="px-4 py-2 bg-[#E94E77] text-gray-900 rounded-lg hover:bg-[#E94E77]/90 transition-colors flex items-center space-x-2"
                >
                  <Calendar className="h-4 w-4" />
                  <span>Calendrier des Indisponibilités</span>
                </button>
                
                <button
                  onClick={() => setShowAddScreenModal(true)}
                  className="px-4 py-2 bg-[#00B3A6] text-gray-900 rounded-lg hover:bg-[#00B3A6]/80 transition-colors flex items-center space-x-2"
                >
                  <Plus className="h-4 w-4" />
                  <span>Ajouter un écran</span>
                </button>
              </div>
              
              {/* Filtres et recherche */}
              <div className="bg-white rounded-xl p-6 shadow-lg border border-gray-200 mb-8">
                <div className="flex flex-col md:flex-row gap-4">
                  <div className="flex-1">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                      <input
                        type="text"
                        placeholder="Rechercher un écran..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#00B3A6] focus:border-[#00B3A6]"
                      />
                    </div>
                  </div>
                  
                  <div className="flex gap-2">
                    {/* Boutons de filtres pour les statuts */}
                    <div className="flex gap-2">
                      <button
                        onClick={() => setStatusFilter('all')}
                        className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                          statusFilter === 'all'
                            ? 'bg-[#00B3A6] text-gray-900'
                            : 'bg-white/10 text-gray-700 hover:bg-gray-100'
                        }`}
                      >
                        Tous
                      </button>
                      <button
                        onClick={() => setStatusFilter('active')}
                        className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center space-x-1 ${
                          statusFilter === 'active'
                            ? 'bg-green-500/30 text-green-400 border border-green-500/50'
                            : 'bg-white/10 text-gray-700 hover:bg-gray-100'
                        }`}
                      >
                        <CheckCircle className="h-4 w-4" />
                        <span>Actif</span>
                      </button>
                      <button
                        onClick={() => setStatusFilter('maintenance')}
                        className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center space-x-1 ${
                          statusFilter === 'maintenance'
                            ? 'bg-yellow-500/30 text-yellow-400 border border-yellow-500/50'
                            : 'bg-white/10 text-gray-700 hover:bg-gray-100'
                        }`}
                      >
                        <Wrench className="h-4 w-4" />
                        <span>Maintenance</span>
                      </button>
                      <button
                        onClick={() => setStatusFilter('inactive')}
                        className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center space-x-1 ${
                          statusFilter === 'inactive'
                            ? 'bg-red-500/30 text-red-400 border border-red-500/50'
                            : 'bg-white/10 text-gray-700 hover:bg-gray-100'
                        }`}
                      >
                        <XCircle className="h-4 w-4" />
                        <span>Inactif</span>
                      </button>
                      <button
                        onClick={() => setStatusFilter('unavailable')}
                        className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center space-x-1 ${
                          statusFilter === 'unavailable'
                            ? 'bg-gray-500/30 text-gray-400 border border-gray-500/50'
                            : 'bg-white/10 text-gray-700 hover:bg-gray-100'
                        }`}
                      >
                        <AlertTriangle className="h-4 w-4" />
                        <span>Indisponible</span>
                      </button>
                    </div>
                    
                    <select
                      value={sortBy}
                      onChange={(e) => setSortBy(e.target.value)}
                      className="px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#00B3A6] focus:border-[#00B3A6]"
                    >
                      <option value="name" className="bg-white text-gray-900">Trier par nom</option>
                      <option value="status" className="bg-white text-gray-900">Trier par statut</option>
                      <option value="revenue" className="bg-white text-gray-900">Trier par revenus</option>
                      <option value="lastActivity" className="bg-white text-gray-900">Trier par activité</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Périodes d'indisponibilité actives et programmées */}
              {statusFilter === 'unavailable' && unavailabilityPeriods.filter(p => p.status !== 'completed').length > 0 && (
                <div className="bg-white rounded-xl p-6 shadow-lg border border-gray-200 mb-8">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                    <AlertTriangle className="h-5 w-5 mr-2 text-yellow-400" />
                    Périodes d'Indisponibilité
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {unavailabilityPeriods
                      .filter(period => period.status !== 'completed')
                      .map(period => {
                        const now = new Date();
                        const periodStart = new Date(`${period.start_date}T${period.start_time}`);
                        const periodEnd = new Date(`${period.end_date}T${period.end_time}`);
                        const isActive = now >= periodStart && now <= periodEnd;
                        const isPending = now < periodStart;
                        const screen = screens.find(s => s.id === period.screen_id);
                        
                        return (
                          <div
                            key={period.id}
                            className={`p-4 rounded-lg border ${
                              isActive 
                                ? 'bg-red-500/10 border-red-500/30' 
                                : 'bg-yellow-500/10 border-yellow-500/30'
                            }`}
                          >
                            <div className="flex items-start justify-between mb-2">
                              <h4 className="font-medium text-gray-900">{screen?.name || 'Écran'}</h4>
                              <div className="flex items-center space-x-2">
                                <span className={`text-xs px-2 py-1 rounded-full ${
                                  isActive 
                                    ? 'bg-red-500/30 text-red-200' 
                                    : 'bg-yellow-500/30 text-yellow-200'
                                }`}>
                                  {isActive ? 'En cours' : 'Programmé'}
                                </span>
                                {isPending && (
                                  <button
                                    onClick={() => removeUnavailabilityPeriod(period.id)}
                                    className="text-red-400 hover:text-red-300 transition-colors"
                                    title="Supprimer cette période"
                                  >
                                    <X className="h-3 w-3" />
                                  </button>
                                )}
                              </div>
                            </div>
                            <p className="text-sm text-gray-600 mb-2">{period.reason}</p>
                            <div className="text-xs text-gray-500 space-y-1">
                              <div>Du: {new Date(period.start_date).toLocaleDateString('fr-FR')} à {period.start_time}</div>
                              <div>Au: {new Date(period.end_date).toLocaleDateString('fr-FR')} à {period.end_time}</div>
                            </div>
                          </div>
                        );
                      })}
                  </div>
                </div>
              )}

              {/* Liste des écrans */}
              <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
                {sortedScreens.map((screen) => (
                  <div
                    key={screen.id}
                    className="bg-white rounded-xl shadow-lg border border-gray-200 p-6 hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1"
                  >
                    {/* En-tête de l'écran */}
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex-1">
                        <h3 className="text-lg font-bold text-gray-900 mb-1">{screen.name}</h3>
                        <div className="flex items-center text-gray-600 text-sm mb-2">
                          <MapPin className="h-4 w-4 mr-1" />
                          {screen.location}
                        </div>
                        <div className="flex items-center space-x-2">
                          <span className={`inline-flex items-center px-2 py-1 text-xs font-medium rounded-full ${getStatusColor(screen.status)}`}>
                            {getStatusIcon(screen.status)}
                            <span className="ml-1">{getStatusText(screen.status)}</span>
                          </span>
                          <span className="text-xs text-gray-500">
                            Dernière sync: {new Date(screen.updated_at).toLocaleString('fr-FR')}
                          </span>
                        </div>
                      </div>
                      
                      <div className="relative">
                        <button className="p-2 rounded-lg hover:bg-white/10 transition-colors text-gray-900">
                          <MoreVertical className="h-4 w-4" />
                        </button>
                      </div>
                    </div>

                    {/* Statistiques */}
                    <div className="grid grid-cols-2 gap-4 mb-4">
                      <div className="text-center">
                        <p className="text-2xl font-bold text-gray-900">
                          {screen.monthly_revenue.toLocaleString('fr-TN', { style: 'currency', currency: 'TND' })}
                        </p>
                        <p className="text-xs text-gray-500">Revenus</p>
                      </div>
                      <div className="text-center">
                        <p className="text-2xl font-bold text-gray-900">
                          {unavailabilityPeriods.filter(p => p.screen_id === screen.id).length}
                        </p>
                        <p className="text-xs text-gray-500">Périodes d'indisponibilité</p>
                      </div>
                    </div>

                    {/* Configuration acceptation automatique */}
                    <div className="mb-4 p-3 bg-gray-50 rounded-lg border border-gray-200">
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <p className="text-sm font-medium text-gray-900">Acceptation des campagnes</p>
                          <p className="text-xs text-gray-500">
                            {screenAutoAccept.get(screen.id) ? 'Automatique' : 'Manuelle'}
                          </p>
                        </div>
                        <button
                          onClick={() => handleToggleAutoAccept(screen.id, screenAutoAccept.get(screen.id) || false)}
                          disabled={updatingScreen === screen.id}
                          className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-[#00B3A6] focus:ring-offset-2 ${
                            screenAutoAccept.get(screen.id) ? 'bg-[#00B3A6]' : 'bg-gray-200'
                          } ${updatingScreen === screen.id ? 'opacity-50 cursor-not-allowed' : ''}`}
                        >
                          <span
                            className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                              screenAutoAccept.get(screen.id) ? 'translate-x-5' : 'translate-x-0'
                            }`}
                          />
                        </button>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex space-x-2">
                      <button
                        onClick={() => setSelectedScreen(screen)}
                        className="flex-1 px-3 py-2 bg-[#00B3A6]/20 text-[#00B3A6] rounded-lg hover:bg-[#00B3A6]/30 transition-colors text-sm font-medium flex items-center justify-center"
                      >
                        <Eye className="h-4 w-4 mr-1" />
                        Détails
                      </button>
                      
                      {screen.status === 'active' && (
                        <button
                          onClick={() => {
                            setSelectedScreen(screen);
                            setShowStatusModal(true);
                          }}
                          className="px-3 py-2 bg-yellow-500/20 text-yellow-400 rounded-lg hover:bg-yellow-500/30 transition-colors text-sm font-medium"
                        >
                          <Wrench className="h-4 w-4" />
                        </button>
                      )}
                      
                      {screen.status === 'maintenance' && (
                        <button
                          onClick={() => handleStatusChange(screen.id, 'active')}
                          className="px-3 py-2 bg-green-500/20 text-green-400 rounded-lg hover:bg-green-500/30 transition-colors text-sm font-medium"
                        >
                          <Power className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {sortedScreens.length === 0 && (
                <div className="text-center py-12">
                  <Monitor className="h-12 w-12 text-gray-900/40 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-gray-500 mb-2">Aucun écran trouvé</h3>
                  <p className="text-gray-900/40">Aucun écran ne correspond à vos critères de recherche.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Modal de détails d'écran */}
      {selectedScreen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-2 sm:p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            {/* Header */}
            <div className="flex items-center justify-between p-6 border-b">
              <div className="flex items-center space-x-3">
                <Monitor className="h-6 w-6 text-[#00B3A6]" />
                <h2 className="text-xl font-bold text-gray-900">{selectedScreen.name}</h2>
              </div>
              <button
                onClick={() => setSelectedScreen(null)}
                className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <XCircle className="h-5 w-5 text-gray-600" />
              </button>
            </div>

            {/* Content */}
            <div className="p-6">

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Informations générales */}
              <div className="space-y-4">
                <div className="bg-gray-50 rounded-xl p-4">
                  <h3 className="text-lg font-semibold text-gray-900 mb-3">Informations générales</h3>
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-gray-600">Localisation:</span>
                      <span className="text-gray-900">{selectedScreen.location}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Statut:</span>
                      <span className={`inline-flex items-center px-2 py-1 text-xs font-medium rounded-full ${getStatusColor(selectedScreen.status)}`}>
                        {getStatusIcon(selectedScreen.status)}
                        <span className="ml-1">{getStatusText(selectedScreen.status)}</span>
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Dernière sync:</span>
                      <span className="text-gray-900">{new Date(selectedScreen.updated_at).toLocaleString('fr-FR')}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Revenus totaux:</span>
                      <span className="text-gray-900 font-semibold">
                        {selectedScreen.total_revenue.toLocaleString('fr-TN', { style: 'currency', currency: 'TND' })}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Périodes d'indisponibilité */}
                <div className="bg-gray-50 rounded-xl p-4">
                  <h3 className="text-lg font-semibold text-gray-900 mb-3">Périodes d'indisponibilité</h3>
                  {unavailabilityPeriods.filter(p => p.screen_id === selectedScreen.id).length > 0 ? (
                    <div className="space-y-2">
                      {unavailabilityPeriods
                        .filter(p => p.screen_id === selectedScreen.id)
                        .slice(0, 5)
                        .map((period) => (
                          <div key={period.id} className="bg-white rounded-lg p-3 border border-gray-200">
                            <div className="flex justify-between items-start mb-1">
                              <span className="text-sm font-medium text-gray-900">{period.reason}</span>
                              <span className={`inline-flex items-center px-2 py-1 text-xs font-medium rounded-full ${
                                period.status === 'active' ? 'text-green-400 bg-green-500/20 border border-green-500/30' :
                                period.status === 'pending' ? 'text-yellow-400 bg-yellow-500/20 border border-yellow-500/30' :
                                'text-gray-400 bg-gray-500/20 border border-gray-500/30'
                              }`}>
                                {period.status === 'active' ? 'Actif' : period.status === 'pending' ? 'En attente' : 'Terminé'}
                              </span>
                            </div>
                            <div className="text-xs text-gray-600">
                              {new Date(period.start_date).toLocaleDateString('fr-FR')} - {new Date(period.end_date).toLocaleDateString('fr-FR')}
                            </div>
                            <div className="text-xs text-gray-500">
                              {period.start_time} - {period.end_time}
                            </div>
                          </div>
                        ))}
                    </div>
                  ) : (
                    <p className="text-gray-500 text-center py-4">Aucune période d'indisponibilité</p>
                  )}
                </div>
              </div>

              {/* Actions rapides */}
              <div className="space-y-4">
                <div className="bg-gray-50 rounded-xl p-4">
                  <h3 className="text-lg font-semibold text-gray-900 mb-3">Actions rapides</h3>
                  <div className="space-y-3">
                    <button
                      onClick={() => {
                        setSelectedScreen(null);
                        setShowCalendar(true);
                      }}
                      className="w-full p-3 bg-[#E94E77]/10 text-[#E94E77] rounded-lg hover:bg-[#E94E77]/20 transition-colors text-left flex items-center"
                    >
                      <Calendar className="h-5 w-5 mr-3" />
                      <div>
                        <div className="font-medium">Déclarer indisponibilité</div>
                        <div className="text-sm text-[#E94E77]/80">Planifier une période d'indisponibilité</div>
                      </div>
                    </button>
                    
                    <button
                      onClick={() => {
                        setSelectedScreen(null);
                        setShowStatusModal(true);
                      }}
                      className="w-full p-3 bg-yellow-500/20 text-yellow-400 rounded-lg hover:bg-yellow-500/30 transition-colors text-left flex items-center"
                    >
                      <Wrench className="h-5 w-5 mr-3" />
                      <div>
                        <div className="font-medium">Changer le statut</div>
                        <div className="text-sm text-yellow-400/80">Modifier le statut de l'écran</div>
                      </div>
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex justify-end space-x-3 mt-6 pt-6 border-t border-white/20">
              <button
                onClick={() => setSelectedScreen(null)}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
              >
                Fermer
              </button>
            </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal de changement de statut */}
      {showStatusModal && selectedScreen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-2 sm:p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
            {/* Header */}
            <div className="flex items-center justify-between p-6 border-b">
              <div className="flex items-center space-x-3">
                <Wrench className="h-6 w-6 text-[#00B3A6]" />
                <h2 className="text-xl font-bold text-gray-900">Changer le statut de l'écran</h2>
              </div>
              <button
                onClick={() => setShowStatusModal(false)}
                className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <XCircle className="h-5 w-5 text-gray-600" />
              </button>
            </div>

            {/* Content */}
            <div className="p-6">
              <p className="text-gray-600 mb-6">Écran: {selectedScreen.name}</p>
              
              <div className="space-y-3 mb-6">
                <button
                  onClick={() => handleStatusChange(selectedScreen.id, 'active')}
                  className="w-full p-3 bg-white border-2 border-green-500 text-green-700 rounded-lg hover:bg-green-50 transition-colors text-left flex items-center"
                >
                  <CheckCircle className="h-5 w-5 mr-3" />
                  <div>
                    <div className="font-medium">Actif</div>
                    <div className="text-sm text-green-600">Écran opérationnel</div>
                  </div>
                </button>
                
                <button
                  onClick={() => handleStatusChange(selectedScreen.id, 'maintenance', 'Maintenance préventive')}
                  className="w-full p-3 bg-white border-2 border-orange-500 text-orange-700 rounded-lg hover:bg-orange-50 transition-colors text-left flex items-center"
                >
                  <Wrench className="h-5 w-5 mr-3" />
                  <div>
                    <div className="font-medium">Maintenance</div>
                    <div className="text-sm text-orange-600">Écran en maintenance</div>
                  </div>
                </button>
                
                <button
                  onClick={() => handleStatusChange(selectedScreen.id, 'inactive', 'Hors service')}
                  className="w-full p-3 bg-white border-2 border-red-500 text-red-700 rounded-lg hover:bg-red-50 transition-colors text-left flex items-center"
                >
                  <XCircle className="h-5 w-5 mr-3" />
                  <div>
                    <div className="font-medium">Inactif</div>
                    <div className="text-sm text-red-600">Écran hors service</div>
                  </div>
                </button>
              </div>
              
              <div className="flex justify-end space-x-3">
                <button
                  onClick={() => setShowStatusModal(false)}
                  className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
                >
                  Annuler
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal du calendrier */}
      {showCalendar && (
        <ScreenCalendar
          screens={screens}
          onUnavailabilityAdded={handleUnavailabilityAdded}
          onClose={() => setShowCalendar(false)}
        />
      )}

      {/* Modal d'ajout d'écran */}
      <AddScreen
        isOpen={showAddScreenModal}
        onClose={() => setShowAddScreenModal(false)}
        onScreenAdded={() => {
          loadScreensData(); // Recharger la liste des écrans
          setShowAddScreenModal(false);
        }}
      />
    </div>
  );
} 