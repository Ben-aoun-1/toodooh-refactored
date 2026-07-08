/**
 * Chart color constants for the "Mes performances" page. Recharts takes literal color strings, so
 * the brand tokens are mirrored here from `tailwind.config.js` (single source for this page) —
 * plus the two chart-only greens the design ruled for the audience series and the heatmap ramp.
 */
export const CHART_ACCENT = '#9195F8'; // = tailwind brand.accent (hero revenue)
export const CHART_DEEP = '#204B43'; // = tailwind brand.deep (S03 impressions)
export const CHART_GREEN = '#1D9E75'; // hero audience + heatmap ramp top (design-ruled)

/** S02 — the mockups' exact 5-step intensity ramp as static Tailwind classes. */
export const HEATMAP_LEVEL_CLASSES = [
  'bg-[#E4F5EC]',
  'bg-[#BFEBD5]',
  'bg-[#88DAB2]',
  'bg-[#4FC28D]',
  'bg-[#1D9E75]',
] as const;

/** The mockups' exact striped ("hachuré") treatment of closed-hour cells. */
export const HEATMAP_CLOSED_CLASS =
  'bg-[repeating-linear-gradient(-45deg,#F1F5F3,#F1F5F3_3px,#E4ECE7_3px,#E4ECE7_6px)]';
