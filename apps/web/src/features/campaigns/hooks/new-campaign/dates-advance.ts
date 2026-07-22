import type { UpdateCampaignInput } from '@/features/campaigns/services/campaigns.api';

/**
 * CF-HF2 (prod bug) — the Période step must persist its dates ON ADVANCE. A user who filled the
 * dates and pressed Suivant (never Enregistrer) used to reach Validation with a server-side
 * DATELESS draft: GET /:id/cmax 409'd (CMAX_REQUIRES) and the budget step was unusable on the
 * straight-through path. Every other step already persists on advance (targeting flush, zones
 * replace-set, creative-on-select) — this closes the one exception, with the zones idiom:
 * dirty-checked persist-then-advance, the advance BLOCKED on failure.
 */

export interface DatesAdvanceDeps {
  draftCampaignId: string | null;
  /** Wire date strings ('YYYY-MM-DD' | null) — the wizard state already holds the wire shape. */
  startDate: string | null;
  endDate: string | null;
  /** The last wire persisted by THIS guard (null = never) — the dirty check. */
  persistedWire: string | null;
  update: (id: string, input: UpdateCampaignInput) => Promise<unknown>;
}

/** The dirty-check identity of a date pair. */
export const datesWire = (startDate: string | null, endDate: string | null): string =>
  JSON.stringify([startDate, endDate]);

export type DatesAdvanceResult = { ok: true; wire: string } | { ok: false; error: unknown };

/**
 * Resolve ok:true when the advance may proceed (dates persisted, or already clean, or no draft
 * yet); ok:false blocks it — the caller toasts and stays on the step.
 */
export const persistDatesForAdvance = async (
  deps: DatesAdvanceDeps,
): Promise<DatesAdvanceResult> => {
  const wire = datesWire(deps.startDate, deps.endDate);
  if (!deps.draftCampaignId || deps.persistedWire === wire) return { ok: true, wire };
  try {
    await deps.update(deps.draftCampaignId, {
      start_date: deps.startDate,
      end_date: deps.endDate,
    });
    return { ok: true, wire };
  } catch (error) {
    return { ok: false, error };
  }
};
