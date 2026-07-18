import { Calendar, MapPin, Monitor, Search, Wifi, WifiOff } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';

import { useAuthStore } from '@/features/auth/stores/auth.store';
import OwnerNavigation from '@/features/screenhost/components/OwnerNavigation';
import { useOwnerDevices } from '@/features/screenhost/hooks/useOwnerDevices';
import {
  DEVICE_STATUS_LABELS,
  type DeviceStatus,
  deviceCounts,
  deviceStatusOf,
  groupByVenue,
  lastSeenLabel,
} from '@/features/screenhost/lib/device-liveness';

/**
 * CF-D1 — « Mes Écrans » on the LIVE api (GET /api/screenhosts/screens): the owner's devices per
 * venue with REAL connectivity (server-computed against the E6 heartbeat tolerance — one liveness
 * truth), replacing the dead Supabase screens surface. The old status enum
 * (active/inactive/maintenance/unavailable), the unavailability modal, the auto-accept toggle and
 * « Ajouter un écran » had no live backing: screens are GENERATED at owner approval and pair from
 * the TV app; the indisponibilités calendar lives on its own page (E2's /owner-calendar-devices).
 */
const STATUS_BADGE: Record<DeviceStatus, string> = {
  connected: 'bg-green-50 text-green-700 border border-green-200',
  offline: 'bg-red-50 text-red-700 border border-red-200',
  never: 'bg-gray-100 text-gray-600 border border-gray-200',
};

const STATUS_DOT: Record<DeviceStatus, string> = {
  connected: 'bg-green-500',
  offline: 'bg-red-500',
  never: 'bg-gray-400',
};

type StatusFilter = 'all' | DeviceStatus;

export default function OwnerScreens() {
  const navigate = useNavigate();
  const { user, needsApproval, validationStatus } = useAuthStore();
  const isDisabled = needsApproval && validationStatus === 'pending';
  const { devices, loading, isError } = useOwnerDevices(user?.id);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const now = new Date();

  useEffect(() => {
    if (!user) navigate('/login');
  }, [user, navigate]);

  useEffect(() => {
    if (isError) toast.error('Erreur lors du chargement des écrans');
  }, [isError]);

  const counts = useMemo(() => deviceCounts(devices), [devices]);

  const filtered = useMemo(() => {
    const term = searchTerm.toLowerCase();
    return devices.filter((d) => {
      const matchesTerm =
        !term || d.name.toLowerCase().includes(term) || d.venue_name.toLowerCase().includes(term);
      const matchesStatus = statusFilter === 'all' || deviceStatusOf(d) === statusFilter;
      return matchesTerm && matchesStatus;
    });
  }, [devices, searchTerm, statusFilter]);

  const venues = useMemo(() => groupByVenue(filtered), [filtered]);

  const filterChip = (key: StatusFilter, label: string, count: number) => (
    <button
      key={key}
      onClick={() => setStatusFilter(key)}
      className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
        statusFilter === key
          ? 'bg-gray-900 text-white'
          : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
      }`}
    >
      {label} ({count})
    </button>
  );

  return (
    <div className="min-h-screen bg-white">
      <div className="flex h-screen">
        <OwnerNavigation isDisabled={isDisabled} />

        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          {/* Header */}
          <header className="bg-white border-b border-gray-200 sticky top-0 z-40 shadow-sm">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="flex justify-between items-center h-16">
                <div className="flex items-center space-x-4">
                  <div>
                    <h1 className="text-2xl font-bold text-gray-900">Mes Écrans</h1>
                    <p className="text-sm text-gray-600 mt-1">
                      Suivez la connexion de vos écrans en temps réel
                    </p>
                  </div>
                  <span className="px-3 py-1 text-sm font-medium bg-brand-primary/10 text-brand-primary border border-brand-primary/20 rounded-full">
                    {devices.length} écran{devices.length > 1 ? 's' : ''}
                  </span>
                </div>
                <button
                  onClick={() => navigate('/owner-calendar-devices')}
                  className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors flex items-center space-x-2 text-sm font-medium"
                >
                  <Calendar className="h-4 w-4" />
                  <span>Calendrier des indisponibilités</span>
                </button>
              </div>
            </div>
          </header>

          <div className="flex-1 overflow-y-auto">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
              {/* Recherche + filtres de connexion */}
              <div className="bg-white rounded-xl p-6 shadow-lg border border-gray-200 mb-8">
                <div className="flex flex-col md:flex-row gap-4">
                  <div className="flex-1">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                      <input
                        type="text"
                        placeholder="Rechercher un écran ou un établissement..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-primary focus:border-brand-primary"
                      />
                    </div>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    {filterChip('all', 'Tous', devices.length)}
                    {filterChip('connected', DEVICE_STATUS_LABELS.connected, counts.connected)}
                    {filterChip('offline', DEVICE_STATUS_LABELS.offline, counts.offline)}
                    {filterChip('never', DEVICE_STATUS_LABELS.never, counts.never)}
                  </div>
                </div>
              </div>

              {/* Écrans par établissement */}
              {loading ? (
                <div className="p-16 flex items-center justify-center">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-primary"></div>
                </div>
              ) : venues.length === 0 ? (
                <div className="p-16 text-center">
                  <Monitor className="h-12 w-12 text-gray-300 mx-auto mb-3" />
                  <p className="text-sm text-gray-500">
                    {devices.length === 0
                      ? 'Aucun écran pour le moment — vos écrans apparaissent ici dès la validation de votre compte.'
                      : 'Aucun écran ne correspond à votre recherche.'}
                  </p>
                </div>
              ) : (
                <div className="space-y-8">
                  {venues.map((venue) => (
                    <section key={venue.venueId}>
                      <div className="flex items-center gap-2 mb-3">
                        <MapPin className="h-4 w-4 text-gray-400" />
                        <h2 className="text-base font-bold text-gray-900">{venue.venueName}</h2>
                        <span className="text-xs text-gray-400">
                          {venue.devices.length} écran{venue.devices.length > 1 ? 's' : ''}
                        </span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        {venue.devices.map((device) => {
                          const status = deviceStatusOf(device);
                          return (
                            <div
                              key={device.id}
                              className="bg-white rounded-xl border border-gray-200 shadow-sm p-5"
                            >
                              <div className="flex items-start justify-between gap-3 mb-3">
                                <div className="flex items-center gap-3 min-w-0">
                                  <div
                                    className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                                      status === 'connected' ? 'bg-green-50' : 'bg-gray-100'
                                    }`}
                                  >
                                    {status === 'connected' ? (
                                      <Wifi className="h-5 w-5 text-green-600" />
                                    ) : (
                                      <WifiOff className="h-5 w-5 text-gray-400" />
                                    )}
                                  </div>
                                  <div className="min-w-0">
                                    <h3 className="text-sm font-bold text-gray-900 truncate">
                                      {device.name}
                                    </h3>
                                    <p className="text-xs text-gray-500 truncate">
                                      {device.venue_name}
                                    </p>
                                  </div>
                                </div>
                                <span
                                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium flex-shrink-0 ${STATUS_BADGE[status]}`}
                                >
                                  <span
                                    className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[status]}`}
                                  />
                                  {DEVICE_STATUS_LABELS[status]}
                                </span>
                              </div>
                              <div className="text-xs text-gray-500 space-y-1">
                                {status === 'offline' && device.last_seen_at && (
                                  <p className="text-red-600 font-medium">
                                    {lastSeenLabel(device.last_seen_at, now)}
                                  </p>
                                )}
                                {status === 'never' && (
                                  <p>En attente du premier appairage de l’écran.</p>
                                )}
                                {device.paired_at && (
                                  <p>
                                    Appairé le{' '}
                                    {new Date(device.paired_at).toLocaleDateString('fr-FR')}
                                  </p>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
