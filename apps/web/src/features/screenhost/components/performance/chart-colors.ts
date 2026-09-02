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
 * AFF1 — the estimation treatment layered over a ramp level: an estimated cell KEEPS ITS INTENSITY
 * but never passes for a sensor reading. Paired with the « Estimation » legend swatch; the dense
 * hachure stays reserved for closed / no-data cells.
 *
 * S02-SRC1 (Mejri, ruled 2026-09-02) — THE SIGNAL IS THE HATCH, not the outline and not a wash.
 * Two earlier attempts each failed at one end of the ramp, and both failures are the same mistake:
 * relying on something a 13 px cell cannot show.
 *   • `opacity-60` (AFF1) washed the colour out. Fine at 26 px; after slice C halved the cells a
 *     LOW-level estimated cell rendered almost white and read as « aucune donnée ».
 *   • Dropping the opacity (02/09 14:41, mine) fixed that end and broke the other: her slot 27 is
 *     the day's MAXIMUM, so it is the DARKEST ramp step, and a 1 px dashed outline is invisible on
 *     it. She photographed exactly that cell.
 * A low-density diagonal hatch works at BOTH ends because it is drawn ON the colour rather than
 * taken out of it: the cell keeps its ramp step, and the stripes read on dark and light alike.
 * The dashed outline stays as the secondary cue.
 */
export const HEATMAP_ESTIMATION_CLASS =
  'bg-[repeating-linear-gradient(-45deg,transparent,transparent_2px,rgba(255,255,255,0.62)_2px,rgba(255,255,255,0.62)_3.5px)] outline outline-1 outline-dashed -outline-offset-1 outline-perf-mist';
