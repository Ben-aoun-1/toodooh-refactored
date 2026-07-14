import { AlertCircle, Check, Loader2 } from 'lucide-react';
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';

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
    () => (sectors.data ?? []).map((s) => ({ id: s.id, name: s.name })),
    [sectors.data],
  );

  const dirty = useMemo(
    () =>
      JSON.stringify(toWire(lines)) !==
      JSON.stringify(targeting.rows.map((r) => ({ category_id: r.category_id, class: r.class }))),
    [lines, targeting.rows],
  );

  const onSave = async () => {
    if (!campaignId) return;
    await targeting.save(toWire(lines)).catch(() => undefined);
  };

  // CF-Q1 — silent-loss gap: edits lived only in `lines` until the panel's own save button.
  // Suivant now flushes through this handle: clean or no-draft → advance freely; dirty → the
  // SAME replace-set save, and a failure blocks the advance (saveError renders below).
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

      <div className="flex items-center justify-end gap-3">
        {!campaignId && (
          <span className="text-sm text-gray-400">
            Le ciblage sera enregistré à la création de la campagne.
          </span>
        )}
        {targeting.saveError && (
          <span className="flex items-center gap-1.5 text-sm text-red-500">
            <AlertCircle className="h-4 w-4" />
            Échec de l’enregistrement.
          </span>
        )}
        {targeting.isSaved && !dirty && !targeting.saveError && (
          <span className="flex items-center gap-1.5 text-sm text-brand-deep">
            <Check className="h-4 w-4" />
            Ciblage enregistré
          </span>
        )}
        <button
          type="button"
          disabled={!campaignId || !dirty || targeting.isSaving}
          onClick={onSave}
          className="inline-flex items-center gap-2 rounded-xl bg-brand-deep px-5 py-2.5 font-medium text-white transition-colors hover:bg-brand-deep/90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {targeting.isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
          {targeting.isSaving ? 'Enregistrement…' : 'Enregistrer le ciblage'}
        </button>
      </div>
    </div>
  );
});
