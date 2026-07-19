// CF-U2 — the coverage map's stacking contract, in a leaflet-free module so the z-order
// regression test can import it under the node test env (importing the map component would drag
// leaflet in). ZonesCoverageMap consumes these verbatim.

/**
 * The map wrapper's stacking layer. Leaflet's internal panes carry z-indexes of 200–800; without
 * a stacking context of its own the map paints OVER any z-50 modal (the exit intercept sank
 * under the tiles — the CF-U2 bug). `isolate z-0` traps every pane at an effective layer of 0,
 * below WizardExitDialog's EXIT_DIALOG_Z (the regression test asserts the ordering).
 */
export const MAP_STACK_Z = 0;
export const MAP_STACK_CLASSES = 'relative isolate z-0 overflow-hidden';

/** The collapsed corner square (~180px, rounded, floats over the step card's edge). */
export const MAP_COLLAPSED_CLASSES =
  'h-[180px] w-[180px] rounded-2xl border border-gray-200 shadow-lg';
/** The expanded full-width view (the pre-CF-U2 layout). */
export const MAP_EXPANDED_CLASSES = 'h-72 w-full rounded-2xl border border-gray-200';
