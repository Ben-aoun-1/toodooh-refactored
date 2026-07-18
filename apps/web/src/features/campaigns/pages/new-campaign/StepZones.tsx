import { ArrowRight, Check, Loader2, MapPin } from 'lucide-react';
import { Suspense, lazy } from 'react';

import GradientPillButton from '@/components/GradientPillButton';
import { useCampaignCoverage } from '@/features/campaigns/hooks/useCampaignApi';
import { useZones } from '@/features/campaigns/hooks/useZones';
import { toggleZone } from '@/features/campaigns/lib/zones-selection';

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
 * whole-network semantics (VF US-2.1). CF-U1 (Mejri item 3): the read-only coverage map returns
 * UNDER the chips — the targeting-matched venues over Grand Tunis. Zone selection stays in the
 * chips; the map only shows where the campaign would land.
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

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl shadow-lg overflow-hidden border border-gray-100">
        <div className="p-6 border-b border-gray-200">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-lg bg-gradient-to-r from-brand-primary to-brand-deep">
              <MapPin className="h-5 w-5 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-[#00263A]">Zones géographiques</h2>
              <p className="text-gray-600">Choisissez les zones de diffusion de votre campagne</p>
            </div>
          </div>
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
            <>
              <div className="flex flex-wrap gap-3">
                {(zones.data ?? []).map((zone) => {
                  const selected = zoneIds.includes(zone.id);
                  return (
                    <button
                      key={zone.id}
                      type="button"
                      onClick={() => setZoneIds(toggleZone(zoneIds, zone.id))}
                      aria-pressed={selected}
                      className={`inline-flex items-center gap-2 rounded-xl border-2 px-5 py-3 text-sm font-medium transition-all ${
                        selected
                          ? 'border-brand-primary bg-brand-primary/10 text-brand-deep'
                          : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'
                      }`}
                    >
                      {selected && <Check className="h-4 w-4 text-brand-deep" />}
                      {zone.name}
                    </button>
                  );
                })}
              </div>
              <p className="text-sm text-gray-500">
                {zoneIds.length === 0
                  ? 'Aucune zone sélectionnée : votre campagne sera diffusée sur tout le réseau.'
                  : 'Votre campagne sera diffusée dans les zones sélectionnées.'}
              </p>

              {/* CF-U1 — the read-only coverage preview, under the chips. */}
              <Suspense
                fallback={
                  <div className="flex h-72 items-center justify-center rounded-2xl border border-gray-200 bg-gray-50">
                    <Loader2 className="h-6 w-6 animate-spin text-brand-deep" />
                  </div>
                }
              >
                <ZonesCoverageMap
                  venues={coverage.data?.screenhosts ?? []}
                  isLoading={Boolean(draftCampaignId) && coverage.isLoading}
                  isError={coverage.isError}
                />
              </Suspense>

              <p className="text-xs text-gray-400">D’autres zones seront bientôt disponibles.</p>
            </>
          )}
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
        <GradientPillButton
          onClick={() => void onNext()}
          loading={saving}
          trailingIcon={<ArrowRight className="h-4 w-4" />}
        >
          Suivant
        </GradientPillButton>
      </div>
    </div>
  );
}
