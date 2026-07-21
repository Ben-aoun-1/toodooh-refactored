import L from 'leaflet';
import { Loader2, MapPinOff, Maximize2, Minimize2 } from 'lucide-react';
import { useEffect, useRef } from 'react';

import {
  MAP_BADGE_Z_CLASS,
  MAP_COLLAPSED_CLASSES,
  MAP_CONTROL_Z_CLASS,
  MAP_EXPANDED_CLASSES,
  MAP_OVERLAY_Z_CLASS,
  MAP_STACK_CLASSES,
} from '@/features/campaigns/lib/map-layering';
import type { CoverageVenue } from '@/features/campaigns/services/campaigns.api';

import 'leaflet/dist/leaflet.css';

interface ZonesCoverageMapProps {
  venues: CoverageVenue[];
  isLoading: boolean;
  isError: boolean;
  /** CF-U2 — collapsed corner square vs full-width view; state lives in StepZones. */
  expanded: boolean;
  onToggle: () => void;
  /** CF-U4 — no zone selected (the zones-axis « Tout le réseau ») — words the count badge. */
  wholeNetwork: boolean;
}

// Grand Tunis — the V1 network's home view (prod is entirely Grand Tunis, CF-Z1).
const GRAND_TUNIS_CENTER: [number, number] = [36.8065, 10.1815];
const GRAND_TUNIS_ZOOM = 11;

// CF-U4 — CartoDB Positron: the light, label-quiet basemap the venue dots read cleanly on
// (a tile URL swap — no new dependency). Attribution per Carto's requirements.
const TILE_URL = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

// Brand-styled venue dots (the app ramp: mint fill, deep ring), stepped up from the CF-U1 r=7.
const MARKER_STYLE: L.CircleMarkerOptions = {
  radius: 9,
  color: '#1A3C34',
  weight: 2,
  fillColor: '#76E6AB',
  fillOpacity: 0.95,
};

// The click popup, built via DOM nodes (never innerHTML — venue names are user data) with
// self-contained inline styles so it needs nothing from the app stylesheet.
// NOTE (CF-U4 flag): the chartered CATEGORY chip needs the venue's sector NAME on the coverage
// wire (CoverageVenue carries id/name/lat/lng only) — an api projection field this WEB-ONLY lane
// cannot add. Until then the chip is the truthful « Établissement couvert ».
const buildPopupContent = (venue: CoverageVenue): HTMLElement => {
  const root = document.createElement('div');
  root.style.cssText = 'padding:2px 4px;min-width:140px;';
  const name = document.createElement('p');
  name.textContent = venue.name;
  name.style.cssText = 'margin:0;font-weight:700;font-size:14px;color:#1a1a1a;';
  const chip = document.createElement('span');
  chip.textContent = 'Établissement couvert';
  chip.style.cssText =
    'display:inline-block;margin-top:6px;padding:2px 10px;border-radius:9999px;background:#E3F7EC;border:1px solid #76E6AB;color:#1A3C34;font-size:11px;font-weight:600;';
  root.append(name, chip);
  return root;
};

const fitToVenues = (map: L.Map, venues: CoverageVenue[]): void => {
  if (venues.length === 0) return;
  map.fitBounds(L.latLngBounds(venues.map((v) => [v.latitude, v.longitude])), {
    padding: [40, 40],
    maxZoom: 14,
  });
};

/**
 * CF-U1 (Mejri item 3) — the read-only coverage map: the venues of GET /api/campaigns/:id/coverage
 * plotted over Grand Tunis on plain leaflet (imperative map in an effect, lazy-loaded by StepZones
 * so the leaflet chunk stays off the critical path). Read-only: zone SELECTION stays in the chips.
 * CF-U2 — collapsed by default; CF-U4 — the redesign: Positron tiles, brand markers with name
 * tooltips + app-styled popups, the venue-count badge, a 28rem expanded canvas with a smooth
 * height transition (StepZones renders ONE mount so the wrapper animates). The z-isolation
 * discipline is UNCHANGED — every layer class comes from map-layering.ts.
 */
export default function ZonesCoverageMap({
  venues,
  isLoading,
  isError,
  expanded,
  onToggle,
  wholeNetwork,
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
    L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, maxZoom: 19 }).addTo(map);
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
      L.circleMarker([venue.latitude, venue.longitude], MARKER_STYLE)
        .bindTooltip(venue.name)
        .bindPopup(buildPopupContent(venue), { closeButton: false })
        .addTo(markers);
    }
    fitToVenues(map, venues);
  }, [venues]);

  // The container's box changes with `expanded` — leaflet must re-measure, then re-frame the
  // dots. The wrapper's height transition runs 300ms, so re-measure after it settles too.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.invalidateSize();
    fitToVenues(map, venues);
    const settled = window.setTimeout(() => {
      map.invalidateSize();
      fitToVenues(map, venues);
    }, 320);
    return () => window.clearTimeout(settled);
    // venues intentionally NOT a dep — the marker effect above already refits on data changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);

  const count = venues.length;
  const plural = count > 1 ? 's' : '';
  const badgeLabel = wholeNetwork
    ? `Tout le réseau — ${count} établissement${plural}`
    : `${count} établissement${plural} couvert${plural}`;

  return (
    <div
      className={`${MAP_STACK_CLASSES} ${expanded ? MAP_EXPANDED_CLASSES : MAP_COLLAPSED_CLASSES}`}
    >
      <div ref={containerRef} className="h-full w-full" aria-label="Carte de couverture" />

      {/* CF-U4 — the venue-count badge (both states; mini pill when collapsed). */}
      {!isLoading && !isError && count > 0 && (
        <div
          className={`pointer-events-none absolute bottom-3 left-3 ${MAP_BADGE_Z_CLASS} rounded-full border border-gray-200 bg-white/95 shadow-sm ${
            expanded
              ? 'px-3 py-1.5 text-xs font-semibold text-brand-deep'
              : 'px-2 py-0.5 text-[10px] font-bold text-brand-deep'
          }`}
        >
          {expanded ? badgeLabel : count}
        </div>
      )}

      {expanded ? (
        <button
          type="button"
          onClick={onToggle}
          aria-label="Réduire la carte"
          className={`absolute right-3 top-3 ${MAP_CONTROL_Z_CLASS} flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-700 shadow-sm hover:bg-gray-50`}
        >
          <Minimize2 className="h-4 w-4" />
        </button>
      ) : (
        // Collapsed = a peek: one big affordance, the whole square expands (no tiny-map panning).
        <button
          type="button"
          onClick={onToggle}
          aria-label="Agrandir la carte"
          className={`absolute inset-0 ${MAP_CONTROL_Z_CLASS} flex items-end justify-end bg-transparent p-2`}
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-700 shadow-sm">
            <Maximize2 className="h-4 w-4" />
          </span>
        </button>
      )}

      {isLoading && (
        <div
          className={`absolute inset-0 ${MAP_OVERLAY_Z_CLASS} flex flex-col items-center justify-center gap-2 bg-white/80`}
        >
          <Loader2 className="h-6 w-6 animate-spin text-brand-deep" />
          {expanded && <p className="text-xs text-gray-500">Chargement de la carte…</p>}
        </div>
      )}
      {!isLoading && isError && expanded && (
        <div
          className={`absolute inset-0 ${MAP_OVERLAY_Z_CLASS} flex flex-col items-center justify-center gap-2 bg-white/85`}
        >
          <MapPinOff className="h-6 w-6 text-gray-400" />
          <p className="text-sm text-gray-500">Impossible de charger la carte de couverture.</p>
        </div>
      )}
      {!isLoading && !isError && expanded && count === 0 && (
        <div
          className={`absolute inset-x-0 bottom-0 ${MAP_OVERLAY_Z_CLASS} border-t border-gray-100 bg-white/95 px-4 py-3 text-center`}
        >
          <p className="text-sm text-gray-500">
            Aucun écran à afficher pour ce ciblage pour le moment.
          </p>
        </div>
      )}
    </div>
  );
}
