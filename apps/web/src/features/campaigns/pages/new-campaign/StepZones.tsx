import { ArrowRight, Check, Loader2, MapPin } from 'lucide-react';
import { Suspense, lazy } from 'react';

import PillButton from '@/components/PillButton';
import { useCampaignCoverage } from '@/features/campaigns/hooks/useCampaignApi';
import { useZones } from '@/features/campaigns/hooks/useZones';
import { toggleZone } from '@/features/campaigns/lib/zones-selection';
import StepSectionHeading from '@/features/campaigns/pages/new-campaign/StepSectionHeading';

// CF-U1 (Mejri item 3) — the leaflet map is a lazy chunk: the wizard stays light until this step.
const ZonesCoverageMap = lazy(() => import('./ZonesCoverageMap'));

interface StepZonesProps {
  /** The selected zone ids (wizard state; [] = whole network on the zone criterion). */
  zoneIds: string[];
  setZoneIds: (next: string[]) => void;
  /** CF-U1 — the create-early draft id: the coverage map plots GET /:id/coverage. */
  draftCampaignId: string | null;
  onNext: () => void | Promise<void>;
  onBack: () => void;
  /** True while the zone replace-set PATCH is in flight (Suivant persists dirty selections). */
  saving: boolean;
}

/**
 * « Zones géographiques » step (CF-Z1 slot). Chips from GET /api/zones (V1: exactly « Grand
 * Tunis », preselected for a fresh campaign by the orchestrator); deselecting everything =
 * whole-network semantics (VF US-2.1). CF-U1 (Mejri item 3): the read-only coverage map shows
 * where the campaign would land. MAP-3 (Mejri 08/09 point 2, reopened 15/09; Figma « Lancer une
 * campagne », Zone step): the zone list on the left, the map at FULL size on the right from the
 * first render — no collapsed square, no expand click. Zone selection stays in the list.
 */
export default function StepZones({
  zoneIds,
  setZoneIds,
  draftCampaignId,
  onNext,
  onBack,
  saving,
}: StepZonesProps) {
  const zones = useZones();
  const coverage = useCampaignCoverage(draftCampaignId);

  const coverageMap = (
    <Suspense
      fallback={
        <div className="flex h-full min-h-[28rem] w-full items-center justify-center rounded-2xl border border-gray-200 bg-gray-50">
          <Loader2 className="h-6 w-6 animate-spin text-brand-deep" />
        </div>
      }
    >
      <ZonesCoverageMap
        venues={coverage.data?.screenhosts ?? []}
        coveredCount={coverage.data?.covered_count ?? 0}
        withoutCoordinates={coverage.data?.without_coordinates ?? 0}
        isLoading={Boolean(draftCampaignId) && coverage.isLoading}
        isError={coverage.isError}
        wholeNetwork={zoneIds.length === 0}
      />
    </Suspense>
  );

  return (
    <div className="space-y-6">
      {/* CF-U3 — the .relative overlay wrapper retired with the absolute corner square. */}
      <div>
        <div className="bg-white rounded-2xl shadow-lg overflow-hidden border border-gray-100">
          <div className="p-6 border-b border-gray-200">
            <StepSectionHeading
              icon={MapPin}
              title="Zones géographiques"
              subtitle="Ajoutez une ou plusieurs zones de diffusion"
            />
          </div>

          <div className="p-6 space-y-4">
            {zones.isLoading ? (
              <div className="flex items-center gap-2 py-8 justify-center text-gray-400">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="text-sm">Chargement des zones…</span>
              </div>
            ) : zones.isError ? (
              <p className="py-8 text-center text-sm text-red-600">
                Impossible de charger les zones.
              </p>
            ) : (
              <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
                <div className="space-y-3">
                  <ul className="space-y-3">
                    {(zones.data ?? []).map((zone) => {
                      const selected = zoneIds.includes(zone.id);
                      return (
                        <li key={zone.id}>
                          <button
                            type="button"
                            onClick={() => setZoneIds(toggleZone(zoneIds, zone.id))}
                            aria-pressed={selected}
                            className={`flex w-full items-center gap-3 rounded-xl border-2 px-4 py-3 text-left text-sm font-medium transition-all ${
                              selected
                                ? 'border-brand-primary bg-brand-primary/10 text-brand-deep'
                                : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'
                            }`}
                          >
                            <span
                              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${
                                selected
                                  ? 'border-brand-deep bg-brand-primary'
                                  : 'border-gray-300 bg-white'
                              }`}
                            >
                              {selected && <Check className="h-3.5 w-3.5 text-brand-deep" />}
                            </span>
                            <MapPin className="h-4 w-4 shrink-0 text-brand-deep" />
                            {zone.name}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  <p className="text-sm text-gray-500">
                    {zoneIds.length === 0
                      ? 'Aucune zone sélectionnée : votre campagne sera diffusée sur tout le réseau.'
                      : 'Votre campagne sera diffusée dans les zones sélectionnées.'}
                  </p>
                  <p className="text-xs text-gray-400">
                    D’autres zones seront bientôt disponibles.
                  </p>
                </div>

                {/* MAP-3 — the map fills the column beside the list, full size from the start. */}
                <div className="min-h-[28rem]">{coverageMap}</div>
              </div>
            )}
          </div>
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
        <PillButton
          onClick={() => void onNext()}
          loading={saving}
          trailingIcon={<ArrowRight className="h-4 w-4" />}
        >
          Suivant
        </PillButton>
      </div>
    </div>
  );
}
