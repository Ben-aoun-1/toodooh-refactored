import { CAMPAIGN_STATUS_UI, type CampaignStatusId } from './campaign-status';

/**
 * CF-U3 (Mejri items 5/6/7) — the Mes campagnes filter semantics, pure and testable.
 */

/** toChipLabel's null/null label — the whole-network chip (ONE wording, mirrored from the lib). */
export const WHOLE_NETWORK_CHIP = 'Tout le réseau';

/**
 * Item 5 — the category filter matches the campaign's TARGETING categories (the chip labels the
 * card already shows), not the dead pre-targeting `category` field. DOCUMENTED CHOICE: a campaign
 * that targets the whole network — zero targeting lines, or the explicit « Tout le réseau »
 * (null/null) line — matches EVERY category (E5.1 / VF US-2.1: it airs there too).
 */
export function campaignMatchesCategory(
  selectedCategories: readonly string[] | undefined,
  wanted: string,
): boolean {
  if (!wanted) return true;
  const cats = selectedCategories ?? [];
  if (cats.length === 0 || cats.includes(WHOLE_NETWORK_CHIP)) return true;
  return cats.includes(wanted);
}

/**
 * The category dropdown options: the distinct targeting chips across the caller's campaigns,
 * minus the whole-network chip (it is not a category — those campaigns match everything).
 */
export function categoryFilterOptions(
  rows: readonly { selected_categories?: readonly string[] }[],
): string[] {
  const set = new Set<string>();
  for (const row of rows) {
    for (const cat of row.selected_categories ?? []) {
      if (cat && cat !== WHOLE_NETWORK_CHIP) set.add(cat);
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'fr'));
}

/** Item 6 — the status dropdown: the six real statuses, French labels from the CF-S1 single map. */
export const STATUS_FILTER_OPTIONS: readonly { value: CampaignStatusId; label: string }[] = (
  Object.keys(CAMPAIGN_STATUS_UI) as CampaignStatusId[]
).map((id) => ({ value: id, label: CAMPAIGN_STATUS_UI[id].label }));

/**
 * Item 7 — the ?status= deep link (the bell CTA, the submit redirect): any of the six enum ids
 * applies; junk/absent applies nothing. The consumer keys its effect on location.key so a
 * SAME-URL navigate (Consulter while already on the target URL) re-applies the filter instead of
 * being swallowed.
 */
export function statusFilterFromSearch(search: string): CampaignStatusId | null {
  const raw = new URLSearchParams(search).get('status');
  if (raw !== null && raw in CAMPAIGN_STATUS_UI) return raw as CampaignStatusId;
  return null;
}
