import L from 'leaflet';
import { Loader2, MapPinOff, Minus, Plus } from 'lucide-react';
import { useEffect, useRef } from 'react';

import {
  MAP_BADGE_Z_CLASS,
  MAP_CONTAINER_CLASSES,
  MAP_CONTROL_Z_CLASS,
  MAP_OVERLAY_Z_CLASS,
  MAP_STACK_CLASSES,
} from '@/features/campaigns/lib/map-layering';
import { spreadCoincident } from '@/features/campaigns/lib/map-venues';
import type { CoverageVenue } from '@/features/campaigns/services/campaigns.api';
import { MAP_TILE_ATTRIBUTION, MAP_TILE_MAX_ZOOM, MAP_TILE_URL } from '@/lib/map-tiles';

import { coverageCaption } from '../../lib/positioning-display';

import 'leaflet/dist/leaflet.css';

interface FootCoverageMapProps {
  venues: CoverageVenue[];
  /** MAP-2 — the server's covered count; the pins are its plottable subset. */
  coveredCount: number;
  withoutCoordinates: number;
  isLoading: boolean;
  isError: boolean;
  /** No zone picked: the whole network (dashed halos); a zone picked: solid, brighter halos. */
  wholeNetwork: boolean;
}

// Grand Tunis — the network's home view while the venues load.
const GRAND_TUNIS_CENTER: [number, number] = [36.8065, 10.1815];
const GRAND_TUNIS_ZOOM = 11;

// The mockup's halo around each eligible venue (its reach is a picture, not a promise: MAP-5 note).
const HALO_RADIUS_M = 1300;
const haloStyle = (wholeNetwork: boolean): L.PathOptions => ({
  color: '#1D9E75',
  weight: 1.5,
  opacity: wholeNetwork ? 0.6 : 0.95,
  fillColor: '#3FCB86',
  fillOpacity: wholeNetwork ? 0.16 : 0.32,
  interactive: false,
  ...(wholeNetwork ? { dashArray: '5 5' } : {}),
});

// A numbered pin with a pulse; green-filled once a zone is picked. MAP-DOTS (Mejri 21/10): no
// tooltip and no popup on a pin — the number only counts the dots.
const pinIcon = (n: number, wholeNetwork: boolean): L.DivIcon =>
  L.divIcon({
    className: '',
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    html: `<div class="relative h-[28px] w-[28px]"><div class="absolute inset-0 animate-pin-pulse rounded-full bg-pitch-grass/35"></div><div class="${
      wholeNetwork
        ? 'border-pitch-leaf bg-white text-pitch-ink'
        : 'border-white bg-pitch-grass text-pitch-ink'
    } absolute inset-[3px] flex items-center justify-center rounded-full border-2 text-[11px] font-semibold shadow-md">${n}</div></div>`,
  });

// Re-framing never animates: a zoom animation ends on a leaflet timer that outlives map.remove()
// when the step changes mid-flight (« Cannot read properties of undefined (_leaflet_pos) »).
const fitToVenues = (map: L.Map, venues: CoverageVenue[]): void => {
  if (venues.length === 0) return;
  map.fitBounds(L.latLngBounds(venues.map((v) => [v.latitude, v.longitude])), {
    padding: [48, 48],
    maxZoom: 14,
    animate: false,
  });
};

/**
 * The Foot parcours' coverage map (Mariem's mockup): the eligible venues of GET /:id/coverage as
 * pulsing numbered pins with a halo, frosted zoom buttons, the caption at the bottom left. Same
 * contract as the wizard's map: OSM tiles (lib/map-tiles), the stacking classes of
 * lib/map-layering, a container absolutely inset (MAP-6), re-measured on every resize (MAP-1).
 */
export default function FootCoverageMap({
  venues,
  coveredCount,
  withoutCoordinates,
  isLoading,
  isError,
  wholeNetwork,
}: FootCoverageMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const latestVenuesRef = useRef<CoverageVenue[]>(venues);
  latestVenuesRef.current = venues;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      center: GRAND_TUNIS_CENTER,
      zoom: GRAND_TUNIS_ZOOM,
      scrollWheelZoom: false,
      zoomControl: false,
      zoomSnap: 0.25,
    });
    L.tileLayer(MAP_TILE_URL, {
      attribution: MAP_TILE_ATTRIBUTION,
      maxZoom: MAP_TILE_MAX_ZOOM,
      className: 'saturate-[.85] brightness-[1.04]',
    }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(([entry]) => {
            // A step change detaches the box before this effect's cleanup runs: skip the 0 × 0.
            if (!entry || entry.contentRect.width === 0 || entry.contentRect.height === 0) return;
            map.invalidateSize();
            fitToVenues(map, latestVenuesRef.current);
          });
    observer?.observe(containerRef.current);
    return () => {
      observer?.disconnect();
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    const spread = spreadCoincident(venues);
    for (const venue of spread) {
      L.circle([venue.latitude, venue.longitude], {
        radius: HALO_RADIUS_M,
        ...haloStyle(wholeNetwork),
      }).addTo(layer);
    }
    spread.forEach((venue, i) => {
      L.marker([venue.latitude, venue.longitude], {
        icon: pinIcon(i + 1, wholeNetwork),
        keyboard: false,
        interactive: false,
      }).addTo(layer);
    });
    map.invalidateSize();
    fitToVenues(map, venues);
  }, [venues, wholeNetwork]);

  const caption = coverageCaption({ wholeNetwork, count: coveredCount, withoutCoordinates });

  return (
    <div
      className={`${MAP_STACK_CLASSES} h-[28rem] w-full rounded-2xl border border-pitch-line shadow-xl shadow-pitch-ink/10`}
    >
      <div ref={containerRef} className={MAP_CONTAINER_CLASSES} aria-label="Carte de couverture" />

      <div
        className={`absolute right-3 top-3 ${MAP_CONTROL_Z_CLASS} flex flex-col overflow-hidden rounded-lg border border-white/90 bg-white/85 shadow-lg shadow-pitch-ink/10 backdrop-blur`}
      >
        <button
          type="button"
          onClick={() => mapRef.current?.zoomIn()}
          aria-label="Zoomer"
          className="flex h-9 w-9 items-center justify-center text-pitch-ink transition-colors hover:bg-pitch-wash"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => mapRef.current?.zoomOut()}
          aria-label="Dézoomer"
          className="flex h-9 w-9 items-center justify-center border-t border-pitch-line text-pitch-ink transition-colors hover:bg-pitch-wash"
        >
          <Minus className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      {!isLoading && !isError && coveredCount > 0 && (
        <div
          className={`pointer-events-none absolute bottom-3 left-3 ${MAP_BADGE_Z_CLASS} flex items-center gap-2 rounded-lg border border-white/90 bg-white/85 px-3 py-1.5 shadow-lg shadow-pitch-ink/10 backdrop-blur`}
        >
          <div className="h-2 w-2 rounded-full bg-pitch-grass ring-[3px] ring-pitch-grass/25" />
          <p className="text-xs font-medium text-pitch-ink">{caption}</p>
        </div>
      )}

      {isLoading && (
        <div
          className={`absolute inset-0 ${MAP_OVERLAY_Z_CLASS} flex flex-col items-center justify-center gap-2 bg-white/80`}
        >
          <Loader2 className="h-6 w-6 animate-spin text-pitch-leaf" />
          <p className="text-xs text-pitch-grey">Chargement de la carte…</p>
        </div>
      )}
      {!isLoading && isError && (
        <div
          className={`absolute inset-0 ${MAP_OVERLAY_Z_CLASS} flex flex-col items-center justify-center gap-2 bg-white/85`}
        >
          <MapPinOff className="h-6 w-6 text-pitch-mist" />
          <p className="text-sm text-pitch-grey">Impossible de charger la carte de couverture.</p>
        </div>
      )}
      {!isLoading && !isError && coveredCount === 0 && (
        <div
          className={`absolute inset-x-0 bottom-0 ${MAP_OVERLAY_Z_CLASS} border-t border-pitch-line bg-white/95 px-4 py-3 text-center`}
        >
          <p className="text-sm text-pitch-grey">
            Aucun écran à afficher pour ce ciblage pour le moment.
          </p>
        </div>
      )}
    </div>
  );
}
