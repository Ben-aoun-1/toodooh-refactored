/**
 * Chart color constants for the "Mes performances" page. Recharts takes literal color strings, so
 * the brand tokens are mirrored here from `tailwind.config.js` (single source for this page) —
 * plus the two chart-only greens the design ruled for the audience series and the heatmap ramp.
 */
export const CHART_ACCENT = '#9195F8'; // = tailwind brand.accent (hero revenue)
export const CHART_DEEP = '#204B43'; // = tailwind brand.deep (S03 impressions)
export const CHART_GREEN = '#1D9E75'; // hero audience + heatmap ramp top (design-ruled)

/**
 * Shared axis treatment for the page's curves (Mejri prod-test #2 — the mockups' charts carry no
 * axes, so the ruling renders them in the mockup's own design language): Geist Mono ticks in
 * perf-mist over perf-line hairlines, tick marks off.
 */
export const AXIS_TICK = {
  fontSize: 10,
  fill: '#8A9E92', // = tailwind perf.mist
  fontFamily: "'Geist Mono', 'SF Mono', Monaco, monospace", // = .perf-mono
} as const;
export const AXIS_LINE = { stroke: '#E9EBEF' } as const; // = tailwind perf.line

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

/**
 * AFF1 — the estimation treatment layered over a ramp level: a dashed outline, so an estimated
 * cell KEEPS ITS INTENSITY but never passes for a sensor reading. Paired with the « Estimation »
 * legend swatch; the hachure stays reserved for closed / no-data cells.
 *
 * S02-FUT1 (2026-09-02) — `opacity-60` is GONE, and dropping it restores AFF1's own stated intent
 * rather than changing it: « keeps its intensity » and a 40 % wash were always in tension. On the
 * 26 px cells this class was written for, the dashed outline carried the signal and the wash was
 * a hint. Slice C halved the cells to ~13 px: the 1 px outline became faint, the wash dominated,
 * and a low-level estimated cell rendered ALMOST WHITE — reading as « no data » rather than as an
 * estimation, which is the one thing the hachure is reserved for. Verified side by side at 13 px.
 */
export const HEATMAP_ESTIMATION_CLASS =
  'outline outline-1 outline-dashed -outline-offset-1 outline-perf-mist';
