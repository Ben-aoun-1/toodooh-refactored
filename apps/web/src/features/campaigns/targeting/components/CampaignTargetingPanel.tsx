import { AlertCircle, Loader2 } from 'lucide-react';
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';

import { sectorDisplayName } from '@/features/advertiser/constants/sector-display-name';
import { useOwnerBusinessSectors } from '@/features/auth/hooks/useOwnerBusinessSectors';

import { useCampaignTargeting } from '../hooks/useCampaignTargeting';
import { fromWire, needsTargetingFlush, toCategoryOnly, toWire } from '../lib/targeting-lines';

import { type BuilderLine, TargetingBuilder, newBuilderLine } from './TargetingBuilder';

interface CampaignTargetingPanelProps {
  /** The NEW campaigns-table draft id. When null the builder runs local-only (not yet persistable). */
  campaignId: string | null;
  /** CF-W1 — category-only wizard mode: hydrated lines normalize (class→all-value, dedup by
   * category) and the builder hides the class control. */
  categoryOnly?: boolean;
}

/** CF-Q1 — the step's Suivant flushes dirty edits through this handle before advancing. */
export interface CampaignTargetingPanelHandle {
  /** Persist dirty edits (replace-set). Resolves true when clean/saved, false on save failure. */
  flush: () => Promise<boolean>;
}

// Composes the targeting builder with the API: loads the persisted lines + the owner categories,
// holds the working set locally, and saves the full set (replace-set) with graceful loading / saving
// / error states. Drop-in for the campaign wizard's targeting step once it carries a new-API draft id.
export const CampaignTargetingPanel = forwardRef<
  CampaignTargetingPanelHandle,
  CampaignTargetingPanelProps
>(function CampaignTargetingPanel({ campaignId, categoryOnly = false }, ref) {
  const sectors = useOwnerBusinessSectors();
  const targeting = useCampaignTargeting(campaignId);

  const [lines, setLines] = useState<BuilderLine[]>([]);
  const hydrated = useRef(false);

  // Seed the working set from the persisted lines once they arrive (don't clobber later edits).
  // CF-W1 category-only: legacy classed lines normalize on hydrate (class→null, dedup by
  // category) — the next save persists the normalized set.
  useEffect(() => {
    if (!hydrated.current && !targeting.isLoading) {
      const wire = fromWire(targeting.rows);
      setLines((categoryOnly ? toCategoryOnly(wire) : wire).map(newBuilderLine));
      hydrated.current = true;
    }
  }, [targeting.isLoading, targeting.rows, categoryOnly]);

  const categories = useMemo(
    // UI-1 — the LABEL is mapped; `id` stays the match key, so targeting is unaffected.
    () => (sectors.data ?? []).map((s) => ({ id: s.id, name: sectorDisplayName(s.name) })),
    [sectors.data],
  );

  const dirty = useMemo(
    () =>
      JSON.stringify(toWire(lines)) !==
      JSON.stringify(targeting.rows.map((r) => ({ category_id: r.category_id, class: r.class }))),
    [lines, targeting.rows],
  );

  // CF-Q1 — silent-loss gap: edits lived only in `lines` until the panel's own save button.
  // Suivant now flushes through this handle: clean or no-draft → advance freely; dirty → the
  // SAME replace-set save, and a failure blocks the advance (saveError renders below).
  // CF-U3 (Mejri item 2) — the « Enregistrer le ciblage » button is GONE: this flush (wired to
  // Suivant, the header Enregistrer and the exit intercept) is the ONLY save path; the dirty
  // state keeps feeding it unchanged.
  useImperativeHandle(ref, () => ({
    flush: async () => {
      if (!needsTargetingFlush(campaignId, dirty)) return true;
      try {
        await targeting.save(toWire(lines));
        return true;
      } catch {
        return false;
      }
    },
  }));

  if (sectors.isLoading || targeting.isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-2xl border border-gray-100 bg-white py-16 text-gray-400">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span className="text-sm">Chargement du ciblage…</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <TargetingBuilder
        value={lines}
        onChange={setLines}
        categories={categories}
        categoryOnly={categoryOnly}
      />

      {targeting.isError && (
        <p className="flex items-center gap-2 text-sm text-red-500">
          <AlertCircle className="h-4 w-4" />
          Impossible de charger le ciblage existant.
        </p>
      )}

      {/* CF-U3 (Mejri item 2) — no dedicated save button: Suivant/Enregistrer flush the panel.
          Only the flush FAILURE needs a voice here (it blocks the advance). */}
      {targeting.saveError && (
        <p className="flex items-center justify-end gap-1.5 text-sm text-red-500">
          <AlertCircle className="h-4 w-4" />
          Échec de l’enregistrement du ciblage — réessayez avec Suivant.
        </p>
      )}
    </div>
  );
});
