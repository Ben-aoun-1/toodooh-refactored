import React, { useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import { Screen } from '../services/screens.service';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Configuration pour la langue française - Utilisation d'OpenStreetMap avec style français
const FRENCH_TILE_LAYER = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';

// Fix pour les icônes Leaflet
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

// Créer des icônes personnalisées pour différents statuts
const createStatusIcon = (status: string) => {
  const colors = {
    active: '#10B981',
    inactive: '#EF4444',
    maintenance: '#F59E0B',
    unavailable: '#6B7280',
  };

  return L.divIcon({
    className: 'custom-marker',
    html: `
      <div style="
        width: 20px;
        height: 20px;
        background-color: ${colors[status as keyof typeof colors] || colors.inactive};
        border: 2px solid white;
        border-radius: 50%;
        box-shadow: 0 2px 4px rgba(0,0,0,0.3);
        display: flex;
        align-items: center;
        justify-content: center;
      ">
        <div style="
          width: 8px;
          height: 8px;
          background-color: white;
          border-radius: 50%;
        "></div>
      </div>
    `,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });
};

interface LocationsMapProps {
  screens: Screen[];
  onScreenClick?: (screen: Screen) => void;
}

export default function LocationsMap({ screens, onScreenClick }: LocationsMapProps) {
  const mapRef = useRef<L.Map | null>(null);

  // Coordonnées par défaut pour Tunis
  const defaultCenter: [number, number] = [36.8065, 10.1815];

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

  // Générer des coordonnées pour chaque emplacement
  const getLocationCoordinates = (location: string, index: number): [number, number] => {
    // En production, ces coordonnées viendraient de la base de données
    const baseLat = 36.8065 + (Math.random() - 0.5) * 0.1;
    const baseLng = 10.1815 + (Math.random() - 0.5) * 0.1;
    return [baseLat + index * 0.001, baseLng + index * 0.001];
  };

  // Ajuster la vue de la carte pour inclure tous les marqueurs
  useEffect(() => {
    if (mapRef.current && screens.length > 0) {
      const bounds = L.latLngBounds(defaultCenter);

      Object.entries(locations).forEach(([location, locationScreens], locationIndex) => {
        locationScreens.forEach((screen, screenIndex) => {
          const coords = getLocationCoordinates(location, screenIndex);
          bounds.extend(coords);
        });
      });

      mapRef.current.fitBounds(bounds, { padding: [20, 20] });
    }
  }, [screens, locations]);

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
        return '🟢';
      case 'maintenance':
        return '🟡';
      case 'inactive':
        return '🔴';
      case 'unavailable':
        return '⚫';
      default:
        return '⚪';
    }
  };

  return (
    <div className="h-full w-full relative">
      <MapContainer
        center={defaultCenter}
        zoom={10}
        style={{ height: '100%', width: '100%' }}
        ref={mapRef}
        className="z-10"
        zoomControl={true}
        attributionControl={true}
      >
        <TileLayer
          url={FRENCH_TILE_LAYER}
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          maxZoom={19}
        />

        {Object.entries(locations).map(([location, locationScreens], locationIndex) => {
          return locationScreens.map((screen, screenIndex) => {
            const coords = getLocationCoordinates(location, screenIndex);

            return (
              <Marker
                key={screen.id}
                position={coords}
                icon={createStatusIcon(screen.status)}
                eventHandlers={{
                  click: () => onScreenClick?.(screen),
                  mouseover: (e: any) => {
                    e.target.openPopup();
                  },
                  mouseout: (e: any) => {
                    e.target.closePopup();
                  },
                }}
              >
                <Popup autoOpen={false}>
                  <div className="p-3 min-w-[250px]">
                    <div className="flex items-center space-x-3 mb-3">
                      <div className="p-2 bg-[#00B3A6]/20 rounded-lg">
                        <div className="w-6 h-6 bg-[#00B3A6] rounded flex items-center justify-center text-white text-xs font-bold">
                          📺
                        </div>
                      </div>
                      <div>
                        <h3 className="font-bold text-lg text-gray-900">{screen.name}</h3>
                        <p className="text-gray-600 text-sm">{location}</p>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-gray-600 text-sm">Statut:</span>
                        <span
                          className={`inline-flex items-center px-2 py-1 text-xs font-medium rounded-full ${getStatusColor(screen.status)}`}
                        >
                          <span className="mr-1">{getStatusIcon(screen.status)}</span>
                          {getStatusText(screen.status)}
                        </span>
                      </div>

                      <div className="flex items-center justify-between">
                        <span className="text-gray-600 text-sm">Revenus mensuels:</span>
                        <span className="font-semibold text-green-600">
                          {screen.monthly_revenue.toLocaleString('fr-TN', {
                            style: 'currency',
                            currency: 'TND',
                          })}
                        </span>
                      </div>

                      <div className="flex items-center justify-between">
                        <span className="text-gray-600 text-sm">Revenus totaux:</span>
                        <span className="font-semibold text-blue-600">
                          {screen.total_revenue.toLocaleString('fr-TN', {
                            style: 'currency',
                            currency: 'TND',
                          })}
                        </span>
                      </div>

                      <div className="flex items-center justify-between">
                        <span className="text-gray-600 text-sm">Points fidélité:</span>
                        <span className="font-semibold text-purple-600">
                          {screen.loyalty_points}
                        </span>
                      </div>

                      <div className="pt-2 border-t border-gray-200">
                        <p className="text-gray-500 text-xs">
                          Dernière mise à jour:{' '}
                          {new Date(screen.updated_at).toLocaleString('fr-FR')}
                        </p>
                      </div>
                    </div>
                  </div>
                </Popup>
              </Marker>
            );
          });
        })}
      </MapContainer>

      {/* Légende */}
      <div className="absolute bottom-4 left-4 bg-white/90 backdrop-blur-sm rounded-lg p-4 shadow-lg border border-white/20">
        <h4 className="font-semibold text-gray-900 mb-2">Légende</h4>
        <div className="space-y-1 text-sm">
          <div className="flex items-center space-x-2">
            <div className="w-3 h-3 bg-green-500 rounded-full"></div>
            <span className="text-gray-700">Actif</span>
          </div>
          <div className="flex items-center space-x-2">
            <div className="w-3 h-3 bg-yellow-500 rounded-full"></div>
            <span className="text-gray-700">Maintenance</span>
          </div>
          <div className="flex items-center space-x-2">
            <div className="w-3 h-3 bg-red-500 rounded-full"></div>
            <span className="text-gray-700">Inactif</span>
          </div>
          <div className="flex items-center space-x-2">
            <div className="w-3 h-3 bg-gray-500 rounded-full"></div>
            <span className="text-gray-700">Indisponible</span>
          </div>
        </div>
      </div>
    </div>
  );
}
