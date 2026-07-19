import L from 'leaflet';
import { Loader2, Maximize2, Minimize2 } from 'lucide-react';
import { useEffect, useRef } from 'react';

import {
  MAP_COLLAPSED_CLASSES,
  MAP_EXPANDED_CLASSES,
  MAP_STACK_CLASSES,
} from '@/features/campaigns/lib/map-layering';
import type { CoverageVenue } from '@/features/campaigns/services/campaigns.api';

import 'leaflet/dist/leaflet.css';

interface ZonesCoverageMapProps {
  venues: CoverageVenue[];
  isLoading: boolean;
  isError: boolean;
  /** CF-U2 — collapsed corner square vs full-width view; state lives in StepZones (per-entry reset). */
  expanded: boolean;
  onToggle: () => void;
}

// Grand Tunis — the V1 network's home view (prod is entirely Grand Tunis, CF-Z1).
const GRAND_TUNIS_CENTER: [number, number] = [36.8065, 10.1815];
const GRAND_TUNIS_ZOOM = 11;

/**
 * CF-U1 (Mejri item 3) — the read-only coverage map: the venues of GET /api/campaigns/:id/coverage
 * plotted over Grand Tunis on plain leaflet (imperative map in an effect, circle markers, lazy-
 * loaded by StepZones so the leaflet chunk stays off the critical path). Read-only: zone SELECTION
 * stays in the chips above.
 * CF-U2 — collapsed by default as a corner square (a click anywhere expands); the expanded view
 * is the full-width block with a Réduire control. StepZones owns the placement (corner overlay vs
 * in-flow), so a toggle re-mounts the map; the [expanded] effect re-measures either way.
 */
export default function ZonesCoverageMap({
  venues,
  isLoading,
  isError,
  expanded,
  onToggle,
}: ZonesCoverageMapProps) {
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

  // The container's box changes with `expanded` — leaflet must re-measure, then re-frame the dots.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.invalidateSize();
    if (venues.length > 0) {
      map.fitBounds(L.latLngBounds(venues.map((v) => [v.latitude, v.longitude])), {
        padding: [32, 32],
        maxZoom: 14,
      });
    }
    // venues intentionally NOT a dep — the marker effect above already refits on data changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);

  return (
    <div
      className={`${MAP_STACK_CLASSES} ${expanded ? MAP_EXPANDED_CLASSES : MAP_COLLAPSED_CLASSES}`}
    >
      <div ref={containerRef} className="h-full w-full" aria-label="Carte de couverture" />
      {expanded ? (
        <button
          type="button"
          onClick={onToggle}
          aria-label="Réduire la carte"
          className="absolute right-3 top-3 z-[900] flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-700 shadow-sm hover:bg-gray-50"
        >
          <Minimize2 className="h-4 w-4" />
        </button>
      ) : (
        // Collapsed = a peek: one big affordance, the whole square expands (no tiny-map panning).
        <button
          type="button"
          onClick={onToggle}
          aria-label="Agrandir la carte"
          className="absolute inset-0 z-[900] flex items-end justify-end bg-transparent p-2"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-700 shadow-sm">
            <Maximize2 className="h-4 w-4" />
          </span>
        </button>
      )}
      {isLoading && (
        <div className="absolute inset-0 z-[500] flex items-center justify-center bg-white/70">
          <Loader2 className="h-6 w-6 animate-spin text-brand-deep" />
        </div>
      )}
      {!isLoading && isError && expanded && (
        <div className="absolute inset-0 z-[500] flex items-center justify-center bg-white/80">
          <p className="text-sm text-gray-500">Impossible de charger la carte de couverture.</p>
        </div>
      )}
      {!isLoading && !isError && expanded && venues.length === 0 && (
        <div className="absolute inset-x-0 bottom-0 z-[500] bg-white/90 px-4 py-2.5 text-center">
          <p className="text-sm text-gray-500">
            Aucun écran à afficher pour ce ciblage pour le moment.
          </p>
        </div>
      )}
    </div>
  );
}
