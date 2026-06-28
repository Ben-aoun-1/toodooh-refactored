import L from 'leaflet';
import { ArrowRight, MapPin } from 'lucide-react';
import { useEffect, useRef } from 'react';

import toodoohMarker from '@/assets/toodooh-marker.svg';
import { useCampaignCoverage } from '@/features/campaigns/hooks/useCampaignCoverage';

import 'leaflet/dist/leaflet.css';

// Grand-Tunis — the network's footprint. Centred + zoomed to frame the metro area; the map is a
// pure visual (no selection, no clicks), so it stays static at this view.
const GRAND_TUNIS: [number, number] = [36.8065, 10.1815];
const GRAND_TUNIS_ZOOM = 11;

// Each matching venue is a TINY toodooh logo mark (brand glyph), anchored at its bottom tip so the
// point sits on the venue's coordinate. Defined once at module scope (an Icon is reusable).
const venueIcon = L.icon({
  iconUrl: toodoohMarker,
  iconSize: [26, 21],
  iconAnchor: [13, 21],
  tooltipAnchor: [0, -18],
  className: 'toodooh-coverage-marker',
});

interface StepCoverageProps {
  /** The create-early draft id — coverage reads the targeting persisted against it. */
  draftCampaignId: string | null;
  onNext: () => void | Promise<void>;
  onBack: () => void;
}

/**
 * Couverture step (wizard step 3, after Ciblage). Plots ONLY the screenhosts that MATCH the draft's
 * targeting (category × class), fetched from GET /api/campaigns/:id/coverage, as toodooh-logo points
 * on a Grand-Tunis map. Visual coverage ONLY — the advertiser sees their reach, there is no
 * selection. The map is built imperatively on vanilla Leaflet (react-leaflet's typed named exports do
 * not resolve under the app tsconfig); markers re-plot whenever the matching set changes.
 */
export default function StepCoverage({ draftCampaignId, onNext, onBack }: StepCoverageProps) {
  const { screenhosts, isLoading, isError } = useCampaignCoverage(draftCampaignId);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerLayerRef = useRef<L.LayerGroup | null>(null);

  // Create the Leaflet map once (on mount); tear it down on unmount.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      center: GRAND_TUNIS,
      zoom: GRAND_TUNIS_ZOOM,
      scrollWheelZoom: false,
      attributionControl: true,
    });
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      subdomains: 'abcd',
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    }).addTo(map);
    markerLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      markerLayerRef.current = null;
    };
  }, []);

  // Re-plot the matching venues whenever the set changes (e.g. the advertiser edited targeting and
  // came back). Clears the prior markers, then drops one toodooh-logo point per venue.
  useEffect(() => {
    const layer = markerLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    for (const sh of screenhosts) {
      L.marker([sh.latitude, sh.longitude], { icon: venueIcon })
        .bindTooltip(sh.name, { direction: 'top' })
        .addTo(layer);
    }
  }, [screenhosts]);

  const count = screenhosts.length;

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl shadow-lg overflow-hidden border border-gray-100">
        <div className="p-6 border-b border-gray-200">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-lg bg-gradient-to-r from-brand-primary to-brand-deep">
              <MapPin className="h-5 w-5 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-[#00263A]">Couverture</h2>
              <p className="text-gray-600">
                Les écrans du réseau qui correspondent à votre ciblage, sur le Grand-Tunis
              </p>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-gray-700">
              {isLoading ? (
                'Chargement de la couverture…'
              ) : isError ? (
                <span className="text-red-600">Impossible de charger la couverture.</span>
              ) : count === 0 ? (
                'Aucun écran ne correspond encore à votre ciblage. Ajustez le ciblage à l’étape précédente.'
              ) : (
                <>
                  <span className="font-semibold text-[#00263A]">{count}</span>{' '}
                  {count > 1 ? 'écrans correspondent' : 'écran correspond'} à votre ciblage
                </>
              )}
            </p>
          </div>

          <div
            ref={containerRef}
            className="h-[480px] w-full rounded-xl overflow-hidden border border-gray-200"
            aria-label="Carte de couverture des écrans correspondant au ciblage"
          />
        </div>
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
          onClick={() => void onNext()}
          className="px-6 py-3 rounded-xl font-semibold transition-all flex items-center space-x-2 shadow-lg bg-gradient-to-r from-brand-primary to-brand-deep text-white hover:from-brand-primary/90 hover:to-brand-deep"
        >
          <span>Suivant</span>
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
