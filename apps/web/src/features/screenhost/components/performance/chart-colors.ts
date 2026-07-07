/**
 * Chart color constants for the "Mes performances" page. Recharts takes literal color strings, so
 * the brand tokens are mirrored here from `tailwind.config.js` (single source for this page) —
 * plus the two chart-only greens the design ruled for the audience series and the heatmap ramp.
 */
export const CHART_ACCENT = '#9195F8'; // = tailwind brand.accent (hero revenue)
export const CHART_DEEP = '#204B43'; // = tailwind brand.deep (S03 impressions)
export const CHART_GREEN = '#1D9E75'; // hero audience + heatmap ramp top (design-ruled)

/** S02 — the 5-step intensity ramp #E4F5EC → #1D9E75 as static Tailwind classes. */
export const HEATMAP_LEVEL_CLASSES = [
  'bg-[#E4F5EC]',
  'bg-[#C2EBD7]',
  'bg-[#8FD9B7]',
  'bg-[#4FBE93]',
  'bg-[#1D9E75]',
] as const;

/** The striped "fermé" treatment of the mockups' closed-hour cells. */
export const HEATMAP_CLOSED_CLASS =
  'bg-[repeating-linear-gradient(45deg,#F3F4F6_0px,#F3F4F6_4px,#E5E7EB_4px,#E5E7EB_8px)]';
