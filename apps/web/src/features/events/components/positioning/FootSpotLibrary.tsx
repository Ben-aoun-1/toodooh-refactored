import { CheckCircle, Film, Image as ImageIcon, Loader2, X } from 'lucide-react';

import { creativeStatusLabel } from '@/features/campaigns/lib/creative-status';
import type { CreativeView } from '@/features/campaigns/services/creatives.api';

import { spotLengthLine } from '../../lib/positioning-display';

const STATUS_CHIP: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-700',
  approved: 'bg-green-50 text-green-700',
  rejected: 'bg-red-50 text-red-700',
};

interface FootSpotLibraryProps {
  /** The spots that can air in a pod (lib/event-positioning filterEventSpots). */
  creatives: CreativeView[];
  isLoading: boolean;
  selectedCreativeId: string | null;
  busy: boolean;
  onSelect: (creativeId: string) => void | Promise<void>;
  onDeselect: () => void | Promise<void>;
}

/**
 * « Vos créations » in the Foot parcours: one row per spot — its name, the pod slot it airs in
 * (« 11s → créneau de 12 s ») and its validation status; the chosen row can be unselected.
 */
export default function FootSpotLibrary({
  creatives,
  isLoading,
  selectedCreativeId,
  busy,
  onSelect,
  onDeselect,
}: FootSpotLibraryProps) {
  return (
    <div>
      <p className="mb-2 text-sm font-semibold text-pitch-ink">Vos créations</p>
      {isLoading ? (
        <p className="flex items-center gap-2 py-4 text-sm text-pitch-mist">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Chargement de vos créations…
        </p>
      ) : creatives.length === 0 ? (
        <p className="py-3 text-sm text-pitch-grey">
          Aucune création pour le moment. Téléversez votre premier spot ci-dessus.
        </p>
      ) : (
        <ul className="max-w-3xl space-y-2">
          {creatives.map((creative) => {
            const selected = creative.id === selectedCreativeId;
            return (
              <li key={creative.id} className="relative">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void onSelect(creative.id)}
                  aria-pressed={selected}
                  className={`w-full rounded-lg border px-4 py-3 pr-12 text-left transition-colors disabled:opacity-60 ${
                    selected
                      ? 'border-brand-primary bg-stadium-wash'
                      : 'border-pitch-line bg-white hover:border-pitch-mist'
                  }`}
                >
                  <span className="flex items-center gap-2 text-sm font-medium text-pitch-ink">
                    {creative.creative_type === 'video' ? (
                      <Film className="h-4 w-4 shrink-0 text-pitch-grey" aria-hidden="true" />
                    ) : (
                      <ImageIcon className="h-4 w-4 shrink-0 text-pitch-grey" aria-hidden="true" />
                    )}
                    <span className="truncate text-pitch-ink">
                      {creative.title || creative.original_filename || 'Création'}
                    </span>
                    {selected && (
                      <CheckCircle
                        className="h-4 w-4 shrink-0 text-pitch-leaf"
                        aria-hidden="true"
                      />
                    )}
                  </span>
                  <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-pitch-mist">
                    {spotLengthLine(creative.creative_type, creative.duration_seconds)}
                    <span
                      className={`rounded px-1.5 py-0.5 font-medium ${
                        STATUS_CHIP[creative.validation_status] ?? 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {creativeStatusLabel(creative.validation_status)}
                    </span>
                  </span>
                </button>
                {selected && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void onDeselect()}
                    aria-label="Désélectionner cette création"
                    title="Désélectionner"
                    className="absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full bg-white text-pitch-mist shadow-sm ring-1 ring-pitch-line transition-colors hover:bg-red-50 hover:text-red-500 disabled:opacity-50"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
