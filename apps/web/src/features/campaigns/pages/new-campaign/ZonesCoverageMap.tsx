import L from 'leaflet';
import { Loader2, MapPinOff } from 'lucide-react';
import { useEffect, useRef } from 'react';

import {
  MAP_BADGE_Z_CLASS,
  MAP_CANVAS_CLASSES,
  MAP_CONTAINER_CLASSES,
  MAP_OVERLAY_Z_CLASS,
  MAP_STACK_CLASSES,
} from '@/features/campaigns/lib/map-layering';
import type { CoverageVenue } from '@/features/campaigns/services/campaigns.api';

import 'leaflet/dist/leaflet.css';

interface ZonesCoverageMapProps {
  venues: CoverageVenue[];
  /** MAP-2 — the SERVER's count of covered établissements (the dispatch-eligible set); the dots
   * are the subset with coordinates, so the badge reads this, never `venues.length`. */
  coveredCount: number;
  /** MAP-2 — covered établissements that cannot be plotted (no coordinates). */
  withoutCoordinates: number;
  isLoading: boolean;
  isError: boolean;
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
// CF-SK1 rider — the coverage projection now carries sector_name, so the chip shows the REAL
// category; the CF-U4 « Établissement couvert » wording stays as the fallback for a NULL sector.
const buildPopupContent = (venue: CoverageVenue): HTMLElement => {
  const root = document.createElement('div');
  root.style.cssText = 'padding:2px 4px;min-width:140px;';
  const name = document.createElement('p');
  name.textContent = venue.name;
  name.style.cssText = 'margin:0;font-weight:700;font-size:14px;color:#1a1a1a;';
  const chip = document.createElement('span');
  chip.textContent = venue.sector_name ?? 'Établissement couvert';
  chip.style.cssText =
    'display:inline-block;margin-top:6px;padding:2px 10px;border-radius:9999px;background:#E3F7EC;border:1px solid #76E6AB;color:#1A3C34;font-size:11px;font-weight:600;';
  root.append(name, chip);
  return root;
};

/**
 * MAP-2 — établissements sharing one coordinate (same building, same typed address) painted as
 * ONE dot, so the map showed fewer dots than the caption counted. Spread coincident venues on a
 * small ring (~15 m) so every covered venue has its own visible dot; tooltips keep the names.
 */
export const spreadCoincident = (venues: CoverageVenue[]): CoverageVenue[] => {
  const seen = new Map<string, number>();
  return venues.map((v) => {
    const key = `${v.latitude.toFixed(5)}:${v.longitude.toFixed(5)}`;
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    if (n === 0) return v;
    const angle = (n * 2 * Math.PI) / 6;
    const delta = 0.00014; // ≈ 15 m
    return {
      ...v,
      latitude: v.latitude + delta * Math.sin(angle),
      longitude: v.longitude + delta * Math.cos(angle),
    };
  });
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
 * CF-U4 — Positron tiles, brand markers with name tooltips + app-styled popups, the venue-count
 * badge. MAP-3 — always a full canvas (no collapsed state). The z-isolation discipline is
 * UNCHANGED — every layer class comes from map-layering.ts.
 * MAP-6 — the leaflet container is absolutely inset in the stack, so its height never hangs on an
 * ancestor's (the #222 wrapper only has a min-height; `h-full` there painted a 0px map).
 */
export default function ZonesCoverageMap({
  venues,
  coveredCount,
  withoutCoordinates,
  isLoading,
  isError,
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
    // MAP-1 (Mejri 08/09 point 2): leaflet measures its container ONCE and only re-measures on
    // WINDOW resize. The box here changes in-flow after mount (the cart dock column appearing,
    // the sidebar collapsing, the wrapper's own size transition), so the map stayed laid out
    // against a stale size until the expand click fired the one invalidateSize path. Observe the
    // container itself and re-measure + re-frame on every change.
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            map.invalidateSize();
            fitToVenues(map, latestVenuesRef.current);
          });
    observer?.observe(containerRef.current);
    return () => {
      observer?.disconnect();
      map.remove();
      mapRef.current = null;
      markersRef.current = null;
    };
  }, []);

  const latestVenuesRef = useRef<CoverageVenue[]>(venues);
  latestVenuesRef.current = venues;

  useEffect(() => {
    const map = mapRef.current;
    const markers = markersRef.current;
    if (!map || !markers) return;
    markers.clearLayers();
    for (const venue of spreadCoincident(venues)) {
      L.circleMarker([venue.latitude, venue.longitude], MARKER_STYLE)
        .bindTooltip(venue.name)
        .bindPopup(buildPopupContent(venue), { closeButton: false })
        .addTo(markers);
    }
    // MAP-1 — data can arrive after a layout change: re-measure before framing the dots.
    map.invalidateSize();
    fitToVenues(map, venues);
  }, [venues]);

  // MAP-2 (Mejri 08/09 point 3): ONE definition for the pins and the caption — the server's
  // covered set; the dots are its plottable subset, and the remainder is said out loud.
  const count = coveredCount;
  const plural = count > 1 ? 's' : '';
  const unplotted = withoutCoordinates > 0 ? `, dont ${withoutCoordinates} sans coordonnées` : '';
  const badgeLabel = wholeNetwork
    ? `Tout le réseau — ${count} établissement${plural}${unplotted}`
    : `${count} établissement${plural} couvert${plural}${unplotted}`;

  return (
    <div className={`${MAP_STACK_CLASSES} ${MAP_CANVAS_CLASSES}`}>
      <div ref={containerRef} className={MAP_CONTAINER_CLASSES} aria-label="Carte de couverture" />

      {/* CF-U4 — the venue-count badge, always the full sentence (MAP-3: no mini pill). */}
      {!isLoading && !isError && count > 0 && (
        <div
          className={`pointer-events-none absolute bottom-3 left-3 ${MAP_BADGE_Z_CLASS} rounded-full border border-gray-200 bg-white/95 px-3 py-1.5 text-xs font-semibold text-brand-deep shadow-sm`}
        >
          {badgeLabel}
        </div>
      )}

      {isLoading && (
        <div
          className={`absolute inset-0 ${MAP_OVERLAY_Z_CLASS} flex flex-col items-center justify-center gap-2 bg-white/80`}
        >
          <Loader2 className="h-6 w-6 animate-spin text-brand-deep" />
          <p className="text-xs text-gray-500">Chargement de la carte…</p>
        </div>
      )}
      {!isLoading && isError && (
        <div
          className={`absolute inset-0 ${MAP_OVERLAY_Z_CLASS} flex flex-col items-center justify-center gap-2 bg-white/85`}
        >
          <MapPinOff className="h-6 w-6 text-gray-400" />
          <p className="text-sm text-gray-500">Impossible de charger la carte de couverture.</p>
        </div>
      )}
      {!isLoading && !isError && count === 0 && (
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
