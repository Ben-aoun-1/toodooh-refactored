import L from 'leaflet';
import { Loader2 } from 'lucide-react';
import { useEffect, useRef } from 'react';

import type { CoverageVenue } from '@/features/campaigns/services/campaigns.api';

import 'leaflet/dist/leaflet.css';

interface ZonesCoverageMapProps {
  venues: CoverageVenue[];
  isLoading: boolean;
  isError: boolean;
}

// Grand Tunis — the V1 network's home view (prod is entirely Grand Tunis, CF-Z1).
const GRAND_TUNIS_CENTER: [number, number] = [36.8065, 10.1815];
const GRAND_TUNIS_ZOOM = 11;

/**
 * CF-U1 (Mejri item 3) — the read-only coverage map returns UNDER the zone chips: the venues of
 * GET /api/campaigns/:id/coverage (active ∩ located ∩ matches-targeting) plotted over Grand
 * Tunis. A NEW component on plain leaflet — imperative map in an effect, circle markers (no
 * image-asset marker pitfalls), lazy-loaded by StepZones so the leaflet chunk stays off the
 * critical path. Read-only: zone SELECTION stays in the chips above.
 */
export default function ZonesCoverageMap({ venues, isLoading, isError }: ZonesCoverageMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      center: GRAND_TUNIS_CENTER,
      zoom: GRAND_TUNIS_ZOOM,
      scrollWheelZoom: false,
    });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap',
      maxZoom: 18,
    }).addTo(map);
    markersRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      markersRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const markers = markersRef.current;
    if (!map || !markers) return;
    markers.clearLayers();
    for (const venue of venues) {
      L.circleMarker([venue.latitude, venue.longitude], {
        radius: 7,
        color: '#1A3C34',
        weight: 2,
        fillColor: '#76E6AB',
        fillOpacity: 0.9,
      })
        .bindTooltip(venue.name)
        .addTo(markers);
    }
    if (venues.length > 0) {
      map.fitBounds(L.latLngBounds(venues.map((v) => [v.latitude, v.longitude])), {
        padding: [32, 32],
        maxZoom: 14,
      });
    }
  }, [venues]);

  return (
    <div className="relative overflow-hidden rounded-2xl border border-gray-200">
      <div ref={containerRef} className="h-72 w-full" aria-label="Carte de couverture" />
      {isLoading && (
        <div className="absolute inset-0 z-[500] flex items-center justify-center bg-white/70">
          <Loader2 className="h-6 w-6 animate-spin text-brand-deep" />
        </div>
      )}
      {!isLoading && isError && (
        <div className="absolute inset-0 z-[500] flex items-center justify-center bg-white/80">
          <p className="text-sm text-gray-500">Impossible de charger la carte de couverture.</p>
        </div>
      )}
      {!isLoading && !isError && venues.length === 0 && (
        <div className="absolute inset-x-0 bottom-0 z-[500] bg-white/90 px-4 py-2.5 text-center">
          <p className="text-sm text-gray-500">
            Aucun écran à afficher pour ce ciblage pour le moment.
          </p>
        </div>
      )}
    </div>
  );
}
