/**
 * A targeting line → a human chip label. NULL on an axis means "toutes" (ALL): category null + class
 * set = "Toutes catégories · <class>"; category set + class null = just the category; null/null =
 * "Tout le réseau". Label wording is a product/i18n choice — adjustable.
 *
 * Extracted verbatim from useMyCampaigns.ts so both the campaign list and the wizard's Validation
 * recap render targeting chips through ONE mapping. The parameter is structural (name + class only)
 * so both CampaignView['targeting'] lines and the targeting-service TargetingLineRow satisfy it.
 */
export interface ChipLabelLine {
  category_name: string | null;
  class: string | null;
}

export function toChipLabel(line: ChipLabelLine): string {
  const { category_name, class: cls } = line;
  if (category_name && cls) return `${category_name} · ${cls}`;
  if (!category_name && cls) return `Toutes catégories · ${cls}`;
  if (category_name && !cls) return category_name;
  return 'Tout le réseau';
}
