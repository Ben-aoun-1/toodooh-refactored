// CF-HF3 (Mejri item 3) — the ONE impressions display rule for every ADVERTISER surface (Mes
// campagnes cards/rows, the dashboard, Consulter):
//   « Impressions prévues » = the FROZEN plan's PHYSICAL impressions (planned_impressions, a pure
//                             read of the plan) when a plan exists; before that — IMP-EST1
//                             (ruled 2026-09-22) — the server's dry-run of the real dispatch over
//                             the live semaine type (components/CampaignPrevues → GET
//                             /:id/impressions-estimate), never ⌊budget×1000/cpm⌋ and never a
//                             bare 0 on a funded campaign.
// CF-HF4 (Kais) — the advertiser side is PRÉVUES-ONLY: « Impressions validées » left every cast
// surface (the delivered/reconciled numbers remain a HOST-side read — the owner surfaces are
// untouched).
// CPM-1 — the dry-run prices at the campaign's OWN CPM (CPM-3: its screencaster's) server-side;
// no CPM is read here any more.
// IMP-UNIT1 (ruled B, 2026-09-22) — « real audience, not billable »: BOTH sides of dispatch are
// PHYSICAL impressions. The post-dispatch figure was the plan's facturable (Σ ii_potentiel = the
// physical × T), so the same label used to drop by ~T the moment the campaign was dispatched.

export const PREVUES_LABEL = 'Impressions prévues';

/** A campaign row as the display rule reads it. */
export interface PrevuesSource {
  planned_impressions?: number | null;
}

/** The frozen plan's figure, or null: no plan yet — the surface shows the dry-run estimate. */
export const plannedPrevues = (row: PrevuesSource): number | null =>
  row.planned_impressions ?? null;

const intFr = new Intl.NumberFormat('fr-FR');

/** '—' for a not-yet-derivable value; a real 0 renders as 0 (a genuine outcome, not absence). */
export const formatImpressions = (value: number | null): string =>
  value === null ? '—' : intFr.format(value);
