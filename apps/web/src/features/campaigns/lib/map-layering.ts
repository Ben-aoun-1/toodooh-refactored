// CF-U2 — the coverage map's stacking contract, in a leaflet-free module so the z-order
// regression test can import it under the node test env (importing the map component would drag
// leaflet in). ZonesCoverageMap consumes these verbatim. CF-U4 extends the ladder (badge slot,
// explicit control/overlay z classes, the height transition) — same contract, one home, never
// forked.

/**
 * The map wrapper's stacking layer. Leaflet's internal panes carry z-indexes of 200–800; without
 * a stacking context of its own the map paints OVER any z-50 modal (the exit intercept sank
 * under the tiles — the CF-U2 bug). `isolate z-0` traps every pane at an effective layer of 0,
 * below WizardExitDialog's EXIT_DIALOG_Z (the regression test asserts the ordering).
 */
export const MAP_STACK_Z = 0;
export const MAP_STACK_CLASSES =
  'relative isolate z-0 overflow-hidden transition-[height,width] duration-300 ease-in-out';

/** The collapsed corner square (~180px, rounded — the CF-U3 in-flow anchoring). */
export const MAP_COLLAPSED_CLASSES =
  'h-[180px] w-[180px] rounded-2xl border border-gray-200 shadow-lg';
/** CF-U4 — the expanded view grows to a real canvas (was h-72). */
export const MAP_EXPANDED_CLASSES = 'h-[28rem] w-full rounded-2xl border border-gray-200';

// The INTERNAL ladder (inside the isolate — these never escape the stack): leaflet panes run
// 200–800, so overlays sit at 500, the count badge at 600, the toggle/controls at 900.
export const MAP_OVERLAY_Z_CLASS = 'z-[500]';
export const MAP_BADGE_Z_CLASS = 'z-[600]';
export const MAP_CONTROL_Z_CLASS = 'z-[900]';
