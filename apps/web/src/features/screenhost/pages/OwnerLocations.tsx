import {
  MapPin,
  Monitor,
  Search,
  Plus,
  Bell,
  Map,
  Navigation,
  DollarSign,
  ChevronDown,
  Star,
  AlertTriangle,
  CheckCircle,
  XCircle,
} from 'lucide-react';
import { useState, useEffect } from 'react';
import { toast } from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';

import { useAuthStore } from '@/features/auth/stores/auth.store';
import LocationsMap from '@/features/screenhost/components/LocationsMap';
import OwnerNavigation from '@/features/screenhost/components/OwnerNavigation';
import { useScreens } from '@/features/screens/hooks/useScreens';
import type { Screen } from '@/features/screens/services/screens.service';

interface LocationStats {
  totalLocations: number;
  activeScreens: number;
  totalRevenue: number;
  averageRating: number;
  totalVisitors: number;
}

export default function OwnerLocations() {
  const navigate = useNavigate();
  const { user, needsApproval, validationStatus } = useAuthStore();
  const isDisabled = needsApproval && validationStatus === 'pending';
  const { screens, loading, isError } = useScreens();
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [viewMode, setViewMode] = useState<'map' | 'list'>('map');
  const [selectedLocation, setSelectedLocation] = useState<string | null>(null);

  useEffect(() => {
    if (!user) {
      navigate('/login');
    }
  }, [user, navigate]);

  useEffect(() => {
    if (isError) toast.error('Erreur lors du chargement des emplacements');
  }, [isError]);

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
        return <AlertTriangle className="h-4 w-4" />;
      case 'inactive':
        return <XCircle className="h-4 w-4" />;
      case 'unavailable':
        return <AlertTriangle className="h-4 w-4" />;
      default:
        return <Monitor className="h-4 w-4" />;
    }
  };

  // Grouper les écrans par emplacement
  const locations = screens.reduce(
    (acc, screen) => {
      const location = screen.location;
      if (!acc[location]) {
        acc[location] = [];
      }
      acc[location].push(screen);
      return acc;
    },
    {} as Record<string, Screen[]>,
  );

  const filteredLocations = Object.entries(locations).filter(([location, screens]) => {
    const matchesSearch =
      location.toLowerCase().includes(searchTerm.toLowerCase()) ||
      screens.some((screen) => screen.name.toLowerCase().includes(searchTerm.toLowerCase()));
    const matchesStatus =
      statusFilter === 'all' || screens.some((screen) => screen.status === statusFilter);
    return matchesSearch && matchesStatus;
  });

  // Calculer les statistiques
  const stats: LocationStats = {
    totalLocations: Object.keys(locations).length,
    activeScreens: screens.filter((s) => s.status === 'active').length,
    totalRevenue: screens.reduce((sum, s) => sum + s.monthly_revenue, 0),
    averageRating: 4.5, // À connecter avec un système de notation
    totalVisitors: screens.reduce((sum, s) => sum + s.monthly_revenue * 100, 0), // Estimation
  };

  const handleScreenClick = (screen: Screen) => {
    toast.success(`Écran sélectionné: ${screen.name}`);
    // Ici vous pouvez ajouter la logique pour afficher les détails de l'écran
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-[#00B3A6] mx-auto mb-4"></div>
          <p className="text-gray-600">Chargement des emplacements...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#00263A] via-[#00263A]/95 to-[#00263A]">
      <div className="flex h-screen">
        <OwnerNavigation isDisabled={isDisabled} />

        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Header */}
          <header className="bg-white/10 backdrop-blur-md border-b border-white/20 sticky top-0 z-40">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="flex justify-between items-center h-16">
                <div className="flex items-center space-x-4">
                  <h1 className="text-2xl font-bold text-white">Mes Emplacements</h1>
                  <span className="px-3 py-1 text-sm font-medium bg-[#00B3A6]/20 backdrop-blur-sm text-[#00B3A6] border border-[#00B3A6]/30 rounded-full">
                    {stats.totalLocations} emplacement{stats.totalLocations > 1 ? 's' : ''}
                  </span>
                </div>

                {/* Notifications et boutons */}
                <div className="flex items-center space-x-4">
                  <button className="p-2 rounded-lg hover:bg-white/10 transition-colors relative text-white">
                    <Bell className="h-6 w-6" />
                    <span className="absolute -top-1 -right-1 h-5 w-5 bg-red-500 text-white text-xs rounded-full flex items-center justify-center">
                      3
                    </span>
                  </button>
                </div>
              </div>
            </div>
          </header>

          <div className="flex-1 overflow-y-auto">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
              {/* Statistiques */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                <div className="bg-white/10 backdrop-blur-sm rounded-xl p-6 shadow-2xl border border-white/20">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-white/60 text-sm">Emplacements</p>
                      <p className="text-2xl font-bold text-white">{stats.totalLocations}</p>
                    </div>
                    <div className="p-3 bg-[#00B3A6]/20 rounded-lg">
                      <MapPin className="h-6 w-6 text-[#00B3A6]" />
                    </div>
                  </div>
                </div>

                <div className="bg-white/10 backdrop-blur-sm rounded-xl p-6 shadow-2xl border border-white/20">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-white/60 text-sm">Écrans Actifs</p>
                      <p className="text-2xl font-bold text-white">{stats.activeScreens}</p>
                    </div>
                    <div className="p-3 bg-green-500/20 rounded-lg">
                      <Monitor className="h-6 w-6 text-green-400" />
                    </div>
                  </div>
                </div>

                <div className="bg-white/10 backdrop-blur-sm rounded-xl p-6 shadow-2xl border border-white/20">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-white/60 text-sm">Revenus Mensuels</p>
                      <p className="text-2xl font-bold text-white">
                        {stats.totalRevenue.toLocaleString('fr-TN', {
                          style: 'currency',
                          currency: 'TND',
                        })}
                      </p>
                    </div>
                    <div className="p-3 bg-yellow-500/20 rounded-lg">
                      <DollarSign className="h-6 w-6 text-yellow-400" />
                    </div>
                  </div>
                </div>

                <div className="bg-white/10 backdrop-blur-sm rounded-xl p-6 shadow-2xl border border-white/20">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-white/60 text-sm">Note Moyenne</p>
                      <p className="text-2xl font-bold text-white">{stats.averageRating}/5</p>
                    </div>
                    <div className="p-3 bg-purple-500/20 rounded-lg">
                      <Star className="h-6 w-6 text-purple-400" />
                    </div>
                  </div>
                </div>
              </div>

              {/* Contrôles */}
              <div className="flex justify-between items-center mb-6">
                <div className="flex space-x-2">
                  <button
                    onClick={() => setViewMode('map')}
                    className={`px-4 py-2 rounded-lg transition-colors flex items-center space-x-2 ${
                      viewMode === 'map'
                        ? 'bg-[#00B3A6] text-white'
                        : 'bg-white/10 text-white hover:bg-white/20'
                    }`}
                  >
                    <Map className="h-4 w-4" />
                    <span>Vue Carte</span>
                  </button>

                  <button
                    onClick={() => setViewMode('list')}
                    className={`px-4 py-2 rounded-lg transition-colors flex items-center space-x-2 ${
                      viewMode === 'list'
                        ? 'bg-[#00B3A6] text-white'
                        : 'bg-white/10 text-white hover:bg-white/20'
                    }`}
                  >
                    <Navigation className="h-4 w-4" />
                    <span>Vue Liste</span>
                  </button>
                </div>

                <button
                  onClick={() => navigate('/owner-screens')}
                  className="px-4 py-2 bg-[#00B3A6] text-white rounded-lg hover:bg-[#00B3A6]/80 transition-colors flex items-center space-x-2"
                >
                  <Plus className="h-4 w-4" />
                  <span>Gérer les Écrans</span>
                </button>
              </div>

              {/* Filtres et recherche */}
              <div className="bg-white/10 backdrop-blur-sm rounded-xl p-6 shadow-2xl border border-white/20 mb-8">
                <div className="flex flex-col md:flex-row gap-4">
                  <div className="flex-1">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-white/60" />
                      <input
                        type="text"
                        placeholder="Rechercher un emplacement..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-white/60 focus:outline-none focus:ring-2 focus:ring-[#00B3A6] focus:border-transparent"
                      />
                    </div>
                  </div>

                  <div className="flex gap-4">
                    <select
                      value={statusFilter}
                      onChange={(e) => setStatusFilter(e.target.value)}
                      className="px-4 py-2 bg-[#00263A] border border-white/20 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-[#00B3A6] focus:border-transparent"
                    >
                      <option value="all" className="bg-[#00263A] text-white">
                        Tous les statuts
                      </option>
                      <option value="active" className="bg-[#00263A] text-white">
                        Actif
                      </option>
                      <option value="maintenance" className="bg-[#00263A] text-white">
                        Maintenance
                      </option>
                      <option value="inactive" className="bg-[#00263A] text-white">
                        Inactif
                      </option>
                      <option value="unavailable" className="bg-[#00263A] text-white">
                        Indisponible
                      </option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Contenu principal */}
              {viewMode === 'map' ? (
                /* Vue Carte */
                <div className="bg-white/10 backdrop-blur-sm rounded-xl shadow-2xl border border-white/20 overflow-hidden">
                  <div className="h-[600px] relative">
                    <LocationsMap
                      screens={screens.filter((screen) => {
                        const matchesSearch =
                          screen.location.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          screen.name.toLowerCase().includes(searchTerm.toLowerCase());
                        const matchesStatus =
                          statusFilter === 'all' || screen.status === statusFilter;
                        return matchesSearch && matchesStatus;
                      })}
                      onScreenClick={handleScreenClick}
                    />
                  </div>
                </div>
              ) : (
                /* Vue Liste */
                <div className="space-y-6">
                  {filteredLocations.map(([location, locationScreens]) => (
                    <div
                      key={location}
                      className="bg-white/10 backdrop-blur-sm rounded-xl shadow-2xl border border-white/20 p-6 hover:shadow-[#00B3A6]/25 transition-all duration-300"
                    >
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center space-x-3">
                          <div className="p-2 bg-[#00B3A6]/20 rounded-lg">
                            <MapPin className="h-5 w-5 text-[#00B3A6]" />
                          </div>
                          <div>
                            <h3 className="text-xl font-bold text-white">{location}</h3>
                            <p className="text-white/60">
                              {locationScreens.length} écran{locationScreens.length > 1 ? 's' : ''}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center space-x-4">
                          <div className="text-right">
                            <p className="text-white/60 text-sm">Revenus totaux</p>
                            <p className="text-lg font-bold text-white">
                              {locationScreens
                                .reduce((sum, s) => sum + s.monthly_revenue, 0)
                                .toLocaleString('fr-TN', { style: 'currency', currency: 'TND' })}
                            </p>
                          </div>
                          <button
                            onClick={() =>
                              setSelectedLocation(selectedLocation === location ? null : location)
                            }
                            className="p-2 rounded-lg hover:bg-white/10 transition-colors text-white"
                          >
                            <ChevronDown
                              className={`h-5 w-5 transform transition-transform ${selectedLocation === location ? 'rotate-180' : ''}`}
                            />
                          </button>
                        </div>
                      </div>

                      {selectedLocation === location && (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-4 pt-4 border-t border-white/20">
                          {locationScreens.map((screen) => (
                            <div
                              key={screen.id}
                              className="bg-white/5 rounded-lg p-4 border border-white/10"
                            >
                              <div className="flex items-center justify-between mb-2">
                                <h4 className="font-medium text-white">{screen.name}</h4>
                                <span
                                  className={`inline-flex items-center px-2 py-1 text-xs font-medium rounded-full ${getStatusColor(screen.status)}`}
                                >
                                  {getStatusIcon(screen.status)}
                                  <span className="ml-1">{getStatusText(screen.status)}</span>
                                </span>
                              </div>
                              <div className="space-y-1 text-sm">
                                <p className="text-white/80">
                                  Revenus:{' '}
                                  {screen.monthly_revenue.toLocaleString('fr-TN', {
                                    style: 'currency',
                                    currency: 'TND',
                                  })}
                                </p>
                                <p className="text-white/60">
                                  Dernière sync:{' '}
                                  {new Date(screen.updated_at).toLocaleString('fr-FR')}
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}

                  {filteredLocations.length === 0 && (
                    <div className="text-center py-12">
                      <MapPin className="h-12 w-12 text-white/40 mx-auto mb-4" />
                      <h3 className="text-lg font-medium text-white/60 mb-2">
                        Aucun emplacement trouvé
                      </h3>
                      <p className="text-white/40">
                        Aucun emplacement ne correspond à vos critères de recherche.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
