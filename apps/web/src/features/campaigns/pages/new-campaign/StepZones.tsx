import { ArrowRight, Check, Loader2, MapPin } from 'lucide-react';
import { Suspense, lazy, useState } from 'react';

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
 * where the campaign would land. CF-U2 — it starts COLLAPSED as a corner square floating over
 * the card's bottom-right edge and expands to the full-width view under the chips; the state is
 * component-local so every step entry resets to collapsed. Zone selection stays in the chips.
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
  // CF-U2 — collapsed corner square by default; local state = reset on every step entry.
  const [mapExpanded, setMapExpanded] = useState(false);

  const coverageMap = (
    <Suspense
      fallback={
        <div
          className={`flex items-center justify-center rounded-2xl border border-gray-200 bg-gray-50 ${
            mapExpanded ? 'h-72' : 'h-[180px] w-[180px]'
          }`}
        >
          <Loader2 className="h-6 w-6 animate-spin text-brand-deep" />
        </div>
      }
    >
      <ZonesCoverageMap
        venues={coverage.data?.screenhosts ?? []}
        isLoading={Boolean(draftCampaignId) && coverage.isLoading}
        isError={coverage.isError}
        expanded={mapExpanded}
        onToggle={() => setMapExpanded((v) => !v)}
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
              subtitle="Choisissez les zones de diffusion de votre campagne"
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

                <p className="text-xs text-gray-400">D’autres zones seront bientôt disponibles.</p>

                {/* CF-U3 — anchored bottom-right INSIDE the card, in flow. CF-U4 — ONE mount for
                    BOTH states (no remount on toggle), so the wrapper's height transition
                    actually animates the expand/collapse. */}
                <div className={mapExpanded ? '' : 'flex justify-end'}>{coverageMap}</div>
              </>
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
