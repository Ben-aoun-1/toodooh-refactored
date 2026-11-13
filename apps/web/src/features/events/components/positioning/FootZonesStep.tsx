import { Check, Info, Loader2, MapPin } from 'lucide-react';
import { Suspense, lazy } from 'react';

import { useCampaignCoverage } from '@/features/campaigns/hooks/useCampaignApi';
import { useZones } from '@/features/campaigns/hooks/useZones';
import { COVERAGE_MAP_NOTE, toggleZone, zonesHint } from '@/features/campaigns/lib/zones-selection';

import PositioningCard from './PositioningCard';
import PositioningFooter from './PositioningFooter';

// The leaflet map is a lazy chunk: the parcours stays light until this step (CF-U1).
const FootCoverageMap = lazy(() => import('./FootCoverageMap'));

interface FootZonesStepProps {
  /** The selected zone ids ([] = the whole network on the zone criterion). */
  zoneIds: string[];
  setZoneIds: (next: string[]) => void;
  /** The positioning draft: the map plots its GET /:id/coverage. */
  draftCampaignId: string | null;
  /** True while the zone replace-set PATCH is in flight. */
  saving: boolean;
  onNext: () => void | Promise<void>;
  onBack: () => void;
}

/**
 * EV3 — the parcours' Zones step, as Mariem drew it (04/11): the zones to tick on the left, the
 * map of the eligible venues on the right (MAP-5 note under it). No zone = the whole network.
 */
export default function FootZonesStep({
  zoneIds,
  setZoneIds,
  draftCampaignId,
  saving,
  onNext,
  onBack,
}: FootZonesStepProps) {
  const zones = useZones();
  const coverage = useCampaignCoverage(draftCampaignId);

  return (
    <>
      <PositioningCard
        icon={MapPin}
        title="Zones géographiques"
        subtitle="Ajoutez une ou plusieurs zones de diffusion"
      >
        {zones.isLoading ? (
          <p className="flex items-center justify-center gap-2 py-8 text-sm text-pitch-mist">
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
            Chargement des zones…
          </p>
        ) : zones.isError ? (
          <p className="py-8 text-center text-sm text-red-600">Impossible de charger les zones.</p>
        ) : (
          <div className="grid gap-5 lg:grid-cols-[minmax(15rem,1fr)_minmax(0,2fr)]">
            <div className="space-y-3">
              <ul className="space-y-2">
                {(zones.data ?? []).map((zone) => {
                  const selected = zoneIds.includes(zone.id);
                  return (
                    <li key={zone.id}>
                      <button
                        type="button"
                        onClick={() => setZoneIds(toggleZone(zoneIds, zone.id))}
                        aria-pressed={selected}
                        className={`flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left text-sm text-pitch-ink transition-colors ${
                          selected
                            ? 'border-brand-primary bg-stadium-wash ring-[3px] ring-brand-primary/20'
                            : 'border-pitch-line bg-white hover:border-pitch-mist'
                        }`}
                      >
                        <span
                          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${
                            selected
                              ? 'border-brand-primary bg-brand-primary text-pitch-ink'
                              : 'border-pitch-mist bg-white text-pitch-ink'
                          }`}
                        >
                          {selected && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                        </span>
                        <MapPin className="h-4 w-4 shrink-0 text-pitch-leaf" aria-hidden="true" />
                        {zone.name}
                      </button>
                    </li>
                  );
                })}
              </ul>
              <p className="text-sm text-pitch-deep">{zonesHint(zoneIds.length)}</p>
              <p className="text-xs text-pitch-mist">D’autres zones seront bientôt disponibles.</p>
            </div>

            <div className="space-y-2">
              <Suspense
                fallback={
                  <div className="flex h-[28rem] w-full items-center justify-center rounded-2xl border border-pitch-line bg-pitch-wash">
                    <Loader2 className="h-6 w-6 animate-spin text-pitch-leaf" />
                  </div>
                }
              >
                <FootCoverageMap
                  venues={coverage.data?.screenhosts ?? []}
                  coveredCount={coverage.data?.covered_count ?? 0}
                  withoutCoordinates={coverage.data?.without_coordinates ?? 0}
                  isLoading={Boolean(draftCampaignId) && coverage.isLoading}
                  isError={coverage.isError}
                  wholeNetwork={zoneIds.length === 0}
                />
              </Suspense>
              <p className="flex items-start gap-2 text-xs text-pitch-grey">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-pitch-leaf" aria-hidden="true" />
                {COVERAGE_MAP_NOTE}
              </p>
            </div>
          </div>
        )}
      </PositioningCard>
      <PositioningFooter
        onBack={onBack}
        onNext={() => void onNext()}
        nextLabel="Suivant"
        loading={saving}
      />
    </>
  );
}
