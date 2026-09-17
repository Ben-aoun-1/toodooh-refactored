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
export const MAP_STACK_CLASSES = 'relative isolate z-0 overflow-hidden';

/**
 * MAP-3 (Mejri 08/09 point 2, still open on 15/09; Figma « Lancer une campagne », Zone step) —
 * ONE state: the map is a full canvas from the first render, filling the column beside the zone
 * list. The CF-U2/U3/U4 collapsed corner square and its expand/collapse toggle are retired.
 */
export const MAP_CANVAS_CLASSES = 'h-full min-h-[28rem] w-full rounded-2xl border border-gray-200';

/**
 * MAP-6 — the leaflet container fills the canvas by INSET, never by a percentage height. #222
 * (MAP-5) wrapped the canvas in a box that only has a min-height, so the container's `h-full`
 * resolved to auto and the map painted as a 0px-tall, empty bordered box. The stack is
 * `relative`, so it is the containing block: the container no longer depends on any ancestor
 * having a definite height (leaflet keeps an absolutely positioned container as is).
 */
export const MAP_CONTAINER_CLASSES = 'absolute inset-0';

// The INTERNAL ladder (inside the isolate — these never escape the stack): leaflet panes run
// 200–800, so overlays sit at 500, the count badge at 600, controls at 900.
export const MAP_OVERLAY_Z_CLASS = 'z-[500]';
export const MAP_BADGE_Z_CLASS = 'z-[600]';
export const MAP_CONTROL_Z_CLASS = 'z-[900]';
