import L from 'leaflet';
import { ArrowRight, Check, CheckCircle, Flame, MapPin, Users, X } from 'lucide-react';
import 'leaflet/dist/leaflet.css';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'react-hot-toast';
import { Circle, MapContainer, Marker, Popup, TileLayer } from 'react-leaflet';

import type { GeographicZone } from '@/features/campaigns/hooks/new-campaign/wizard-types';
import {
  campaignScreensService,
  type CampaignLocation,
} from '@/features/campaigns/services/campaign-screens.service';
import type { PredefinedZone } from '@/features/screens/services/predefined-zones.service';

// Leaflet's default icon URLs are broken under bundlers (the bundler can't
// see asset paths embedded in the package). The fix is the same one used
// across the React-Leaflet ecosystem: replace _getIconUrl and point to a
// public CDN. Module-level so ESM init runs once across all importers.
// TODO(phase-1): typed source [leaflet] — see #15
// eslint-disable-next-line @typescript-eslint/no-explicit-any
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

interface Step4Props {
  geographicZones: GeographicZone[];
  setGeographicZones: (
    next: GeographicZone[] | ((prev: GeographicZone[]) => GeographicZone[]),
  ) => void;
  diffusionType: 'toodooh' | 'parc_tv';
  categories: string[];
  predefinedZones: PredefinedZone[];
  loadingPredefinedZones: boolean;
  onNext: () => boolean;
  onBack: () => void;
}

// Haversine distance in km between two lat/lng pairs.
function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function normalizeCategoryName(value?: string): string {
  if (!value) return '';
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/**
 * Step 4 of the wizard: geographic zones. Renders the predefined-zone
 * picker (left column) + Leaflet map (right column) + selected-zones
 * summary footer. Same component serves standard Step 4 AND event Step 1
 * — the parent's currentStep condition is the only difference.
 *
 * The custom-zone-creation modal that NewCampaign.tsx used to render is
 * gone (Commit 9): setShowZoneModal(true) was never called, so the
 * entire surface was unreachable UI. The live mutation path is
 * handleTogglePredefinedZone — toggle a card on the left, the zone
 * lands in geographicZones with id `predefined-${zone.id}`.
 *
 * Extracted from NewCampaign.tsx (formerly lines ~1845-2120 for the JSX
 * plus the companion utility functions and the loadAllMapLocations
 * effect).
 */
export default function Step4({
  geographicZones,
  setGeographicZones,
  diffusionType,
  categories,
  predefinedZones,
  loadingPredefinedZones,
  onNext,
  onBack,
}: Step4Props) {
  const [allMapLocations, setAllMapLocations] = useState<CampaignLocation[]>([]);
  const [loadingMapLocations, setLoadingMapLocations] = useState(false);
  const [zoneFilterCountry, setZoneFilterCountry] = useState<string>('');
  const [zoneFilterRegion, setZoneFilterRegion] = useState<string>('');

  useEffect(() => {
    setLoadingMapLocations(true);
    campaignScreensService
      .getAllLocationsForMap()
      .then(setAllMapLocations)
      .catch(() => setAllMapLocations([]))
      .finally(() => setLoadingMapLocations(false));
  }, []);

  // Owner-category filter: only show locations whose owner's category
  // overlaps the selected campaign categories. parc_tv mode bypasses
  // the filter entirely.
  const filteredMapLocations = useMemo(() => {
    if (diffusionType === 'parc_tv') return allMapLocations;
    if (!Array.isArray(allMapLocations) || allMapLocations.length === 0) return [];
    if (!categories || categories.length === 0) return allMapLocations;
    const selected = new Set(categories.map((c) => normalizeCategoryName(c)));
    return allMapLocations.filter((loc) =>
      selected.has(normalizeCategoryName(loc.owner_category || '')),
    );
  }, [allMapLocations, diffusionType, categories]);

  const getUsedLocationIds = useCallback(
    (excludeZoneId?: string): string[] =>
      geographicZones
        .filter((zone) => zone.id !== excludeZoneId)
        .flatMap((zone) => (zone.locations || []).map((loc) => loc.id)),
    [geographicZones],
  );

  const getLocationsForPredefinedZone = useCallback(
    (zone: PredefinedZone): CampaignLocation[] => {
      if (!filteredMapLocations.length) return [];
      const radiusKm = zone.radius / 1000;
      const usedIds = getUsedLocationIds();
      return filteredMapLocations.filter((loc) => {
        const c = loc?.coordinates;
        if (!c || typeof c.lat !== 'number' || typeof c.lng !== 'number') return false;
        const d = distanceKm(zone.latitude, zone.longitude, c.lat, c.lng);
        return d <= radiusKm && !usedIds.includes(loc.id);
      });
    },
    [filteredMapLocations, getUsedLocationIds],
  );

  const getEstimatedVisitorsForPredefinedZone = useCallback(
    (zone: PredefinedZone): number => {
      if (!filteredMapLocations.length) return 0;
      const radiusKm = zone.radius / 1000;
      const locs = filteredMapLocations.filter((loc) => {
        const c = loc?.coordinates;
        if (!c || typeof c.lat !== 'number' || typeof c.lng !== 'number') return false;
        return distanceKm(zone.latitude, zone.longitude, c.lat, c.lng) <= radiusKm;
      });
      return locs.reduce((sum, loc) => {
        const s = loc.affluence_schedule;
        if (!s?.length) return sum;
        return (
          sum + s.reduce((acc, x) => acc + Math.max(0, Number(x.estimated_impressions) || 0), 0)
        );
      }, 0);
    },
    [filteredMapLocations],
  );

  const isPredefinedZoneSelected = (zone: PredefinedZone): boolean =>
    geographicZones.some((z) => z.predefinedZoneId === zone.id);

  const handleTogglePredefinedZone = (zone: PredefinedZone) => {
    if (isPredefinedZoneSelected(zone)) {
      setGeographicZones((prev) => prev.filter((z) => z.predefinedZoneId !== zone.id));
      toast.success(`Zone "${zone.name}" retirée`);
      return;
    }
    const locs = getLocationsForPredefinedZone(zone);
    const newZone: GeographicZone = {
      id: `predefined-${zone.id}`,
      name: zone.name,
      location: { lat: zone.latitude, lng: zone.longitude },
      radius: zone.radius,
      locations: locs,
      predefinedZoneId: zone.id,
    };
    setGeographicZones((prev) => [...prev, newZone]);
    toast.success(`Zone "${zone.name}" ajoutée`);
  };

  const handleDeleteZone = (zoneId: string) => {
    setGeographicZones((prev) => prev.filter((zone) => zone.id !== zoneId));
    toast.success('Zone supprimée');
  };

  const handleNext = () => {
    const hasZones =
      geographicZones.length > 0 && geographicZones.some((z) => (z.locations || []).length > 0);
    if (!hasZones) {
      toast.error('Sélectionnez au moins une zone géographique');
      return;
    }
    onNext();
  };

  const filteredPredefinedZones = useMemo(
    () =>
      predefinedZones.filter((z) => {
        if (zoneFilterCountry && (z.country || '') !== zoneFilterCountry) return false;
        if (zoneFilterRegion && (z.region || '') !== zoneFilterRegion) return false;
        return true;
      }),
    [predefinedZones, zoneFilterCountry, zoneFilterRegion],
  );

  const totalAreaKm2 = useMemo(
    () => geographicZones.reduce((sum, z) => sum + Math.PI * Math.pow(z.radius / 1000, 2), 0),
    [geographicZones],
  );

  const nextDisabled = geographicZones.length === 0;

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl shadow-lg overflow-hidden border border-gray-100">
        <div className="p-6 border-b border-gray-200">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <h2 className="text-xl font-bold text-[#00263A]">Zones géographiques</h2>
            <div className="flex items-center gap-3 flex-wrap">
              <select
                value={zoneFilterCountry}
                onChange={(e) => setZoneFilterCountry(e.target.value)}
                className="min-w-[240px] px-3 py-2 text-sm border border-gray-300 rounded-xl focus:ring-2 focus:ring-brand-primary focus:border-transparent bg-white"
                aria-label="Filtrer par pays"
              >
                <option value="">Pays</option>
                <option value="Tunisie">Tunisie</option>
              </select>
              <select
                value={zoneFilterRegion}
                onChange={(e) => setZoneFilterRegion(e.target.value)}
                className="min-w-[240px] px-3 py-2 text-sm border border-gray-300 rounded-xl focus:ring-2 focus:ring-brand-primary focus:border-transparent bg-white"
                aria-label="Filtrer par région"
              >
                <option value="">Région</option>
                {[...new Set(predefinedZones.map((z) => z.region).filter(Boolean))].map((r) => (
                  <option key={r!} value={r!}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p className="text-gray-600 mt-2">Ajoutez une ou plusieurs zones de diffusion</p>
        </div>

        <div className="flex flex-col lg:flex-row">
          {/* Left column: predefined-zone cards */}
          <div className="w-full lg:w-[380px] flex-shrink-0 border-r border-gray-200 flex flex-col bg-gray-50/50">
            <div className="p-4">
              <div className="h-[384px] overflow-y-auto space-y-3">
                {loadingPredefinedZones ? (
                  <div className="flex items-center justify-center py-12">
                    <div className="animate-spin rounded-full h-8 w-8 border-2 border-brand-primary border-t-transparent" />
                  </div>
                ) : filteredPredefinedZones.length === 0 ? (
                  <p className="text-sm text-gray-500 text-center py-8">Aucune zone prédéfinie</p>
                ) : (
                  filteredPredefinedZones.map((zone) => {
                    const selected = isPredefinedZoneSelected(zone);
                    const visitors = getEstimatedVisitorsForPredefinedZone(zone);
                    return (
                      <button
                        key={zone.id}
                        type="button"
                        onClick={() => handleTogglePredefinedZone(zone)}
                        className={`w-full text-left rounded-xl border-2 transition-all overflow-hidden ${
                          selected
                            ? 'border-brand-primary bg-brand-primary/5 shadow-md'
                            : 'border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm'
                        }`}
                      >
                        <div className="relative h-20 bg-gray-200">
                          <img
                            src={
                              zone.image_url || `https://picsum.photos/seed/zone-${zone.id}/400/200`
                            }
                            alt=""
                            className="w-full h-full object-cover"
                          />
                          <div
                            className={`absolute top-3 left-3 w-6 h-6 rounded-md border-2 flex items-center justify-center ${
                              selected
                                ? 'bg-brand-primary border-brand-primary'
                                : 'bg-white border-gray-300'
                            }`}
                          >
                            {selected && <Check className="w-4 h-4 text-white" strokeWidth={3} />}
                          </div>
                          {zone.is_hot && (
                            <span className="absolute top-3 right-3 inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-white border border-red-200 text-red-600 shadow-sm">
                              <Flame className="w-3 h-3" />
                              Hot right now
                            </span>
                          )}
                        </div>
                        <div className="p-2">
                          <p className="text-sm font-semibold text-gray-900 truncate">
                            {zone.name}
                          </p>
                          <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-600">
                            <span className="flex items-center gap-1">
                              <MapPin className="w-3 h-3 flex-shrink-0" />
                              {(zone.radius / 1000).toFixed(0)} km
                            </span>
                            <span className="flex items-center gap-1">
                              <Users className="w-3 h-3 flex-shrink-0" />~{' '}
                              {visitors.toLocaleString('fr-FR')} visiteurs attendus
                            </span>
                          </div>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          {/* Right column: Leaflet map */}
          <div className="flex-1 bg-white p-4">
            {loadingMapLocations ? (
              <div className="h-[384px] flex items-center justify-center rounded-xl border border-gray-200">
                <div className="animate-spin rounded-full h-10 w-10 border-2 border-brand-primary border-t-transparent" />
              </div>
            ) : (
              <div className="h-[384px] rounded-xl overflow-hidden shadow-lg border border-gray-200">
                <MapContainer
                  center={
                    geographicZones.length > 0
                      ? [geographicZones[0].location.lat, geographicZones[0].location.lng]
                      : [36.83435, 10.21905]
                  }
                  zoom={geographicZones.length > 0 ? 12 : 11}
                  style={{ height: '100%', width: '100%' }}
                  className="rounded-lg"
                >
                  <TileLayer
                    url="https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png"
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
                    subdomains="abcd"
                    maxZoom={14}
                  />
                  <TileLayer
                    url="https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png"
                    attribution=""
                    opacity={0.5}
                    maxZoom={12}
                    minZoom={8}
                  />
                  {geographicZones
                    .filter((z) => z.location?.lat != null && z.location?.lng != null)
                    .map((zone) => (
                      <Circle
                        key={zone.id}
                        center={[zone.location!.lat, zone.location!.lng]}
                        radius={zone.radius}
                        pathOptions={{
                          fillColor: '#00B3A6',
                          fillOpacity: 0.2,
                          color: '#00B3A6',
                          weight: 2,
                        }}
                      />
                    ))}
                  {geographicZones
                    .filter((z) => z.location?.lat != null && z.location?.lng != null)
                    .map((zone) => (
                      <Marker
                        key={`marker-${zone.id}`}
                        position={[zone.location!.lat, zone.location!.lng]}
                        icon={L.icon({
                          iconUrl:
                            'https://cdn.jsdelivr.net/gh/pointhi/leaflet-color-markers@master/img/marker-icon-2x-violet.png',
                          iconSize: [20, 32],
                          iconAnchor: [10, 32],
                        })}
                      />
                    ))}
                  {(filteredMapLocations || []).map((loc) => {
                    const c = loc?.coordinates;
                    if (
                      !c ||
                      typeof c.lat !== 'number' ||
                      typeof c.lng !== 'number' ||
                      Number.isNaN(c.lat) ||
                      Number.isNaN(c.lng)
                    )
                      return null;
                    const inZone = geographicZones.some(
                      (z) =>
                        distanceKm(z.location.lat, z.location.lng, c.lat, c.lng) <= z.radius / 1000,
                    );
                    const colorHex = inZone ? '#10b981' : '#6b7280';
                    return (
                      <Marker
                        key={loc.id}
                        position={[c.lat, c.lng]}
                        icon={L.divIcon({
                          className: 'custom-marker',
                          html: `<div style="
                            width: 12px;
                            height: 12px;
                            border-radius: 50%;
                            background-color: ${colorHex};
                            border: 2px solid white;
                            box-shadow: 0 2px 4px rgba(0,0,0,0.3);
                          "></div>`,
                          iconSize: [12, 12],
                          iconAnchor: [6, 6],
                        })}
                      >
                        <Popup>
                          <div className="text-xs">
                            <strong>{loc.name}</strong>
                            <span className="text-gray-500 ml-1">
                              ({loc.screen_count ?? 0} écran
                              {(loc.screen_count ?? 0) > 1 ? 's' : ''})
                            </span>
                            {inZone && <span className="text-green-600 ml-2">✓ dans une zone</span>}
                            {!inZone && <span className="text-gray-500 ml-2">Hors zone</span>}
                          </div>
                        </Popup>
                      </Marker>
                    );
                  })}
                </MapContainer>
              </div>
            )}
          </div>
        </div>

        {/* Selected-zones summary footer */}
        {geographicZones.length > 0 && (
          <div className="px-6 py-4 border-t border-gray-200 bg-green-50/50">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-2 flex-wrap">
                <CheckCircle className="h-5 w-5 text-green-600 flex-shrink-0" />
                <span className="text-sm font-medium text-gray-900">
                  {geographicZones.length} zone{geographicZones.length > 1 ? 's' : ''} sélectionnée
                  {geographicZones.length > 1 ? 's' : ''}
                  {' · '}
                  {totalAreaKm2.toFixed(1)} km²
                </span>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {geographicZones.map((z) => (
                  <span
                    key={z.id}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white border border-gray-200 text-sm text-gray-700"
                  >
                    {z.name}
                    <button
                      type="button"
                      onClick={() => handleDeleteZone(z.id)}
                      className="p-0.5 rounded hover:bg-gray-100 text-gray-500 hover:text-red-600"
                      title="Retirer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-2 px-5 py-3 border border-gray-300 rounded-xl text-gray-700 hover:bg-gray-50 transition-all text-sm font-medium"
        >
          <ArrowRight className="h-4 w-4 rotate-180" />
          Retour
        </button>
        <button
          type="button"
          onClick={handleNext}
          disabled={nextDisabled}
          className={`px-6 py-3 rounded-xl font-semibold transition-all flex items-center space-x-2 shadow-lg ${
            nextDisabled
              ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
              : 'bg-gradient-to-r from-brand-primary to-[#00D4C4] text-white hover:from-[#00A396] hover:to-[#00C4B4]'
          }`}
        >
          <span>Suivant</span>
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
