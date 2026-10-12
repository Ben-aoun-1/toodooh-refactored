import { seededRandom } from './seeded-random';

/**
 * The two illustrated scenes of the Événements home (Youssef's « Toodooh Page événements.html »,
 * ramadanScene / footballScene), as DATA: every seeded element is computed here with the design's
 * own seeds, so the drawing is identical on every render and pinned by tests. The components in
 * components/scenes/ only render these.
 */

export interface Star {
  x: number;
  y: number;
  r: number;
  opacity: number;
}

export interface LitWindow {
  x: number;
  y: number;
  opacity: number;
}

/** A hanging lantern: its anchor and its scale. */
export const RAMADAN_LANTERNS = [
  { x: 470, y: 64, k: 1 },
  { x: 528, y: 112, k: 0.8 },
  { x: 742, y: 60, k: 0.72 },
  { x: 586, y: 52, k: 0.62 },
] as const;

/** The old-town skyline (domes, a minaret), verbatim from the design. */
export const RAMADAN_SKYLINE =
  'M0,420 V352 h40 v-14 h26 v22 h30 v-30 a26,26 0 0 1 52,0 v30 h24 v-18 h22 v-8 h18 v26 h30 V286 h6 v-10 h-4 v-6 h4 v-8 h4 v-12 a4,4 0 0 1 8,0 v12 h4 v8 h4 v6 h-4 v10 h6 v104 h20 v-24 h34 v-22 a34,34 0 0 1 68,0 v22 h30 v-34 h26 v28 h36 v-16 h24 v-10 a14,14 0 0 1 28,0 v10 h22 v-30 h18 v30 h40 v-20 h30 v34 h34 V312 h4 v-8 h18 v8 h4 v62 h30 v-12 h28 v20 h40 V420 Z';

const round = (n: number, digits: number): number => Number(n.toFixed(digits));

/** The Ramadan night: 130 stars over the sky, then 26 lit windows in the skyline (seed 2027). */
export function ramadanSceneData(): { stars: Star[]; windows: LitWindow[] } {
  const r = seededRandom(2027);
  const stars: Star[] = [];
  for (let i = 0; i < 130; i += 1) {
    const x = r() * 800;
    const y = r() * 260;
    const radius = r() < 0.08 ? 1.6 : 0.4 + r() * 0.8;
    stars.push({
      x: round(x, 1),
      y: round(y, 1),
      r: round(radius, 2),
      opacity: round(0.35 + r() * 0.6, 2),
    });
  }
  const windows: LitWindow[] = [];
  for (let w = 0; w < 26; w += 1) {
    const x = 20 + r() * 760;
    const y = 360 + r() * 44;
    windows.push({ x: Math.round(x), y: Math.round(y), opacity: round(0.5 + r() * 0.5, 2) });
  }
  return { stars, windows };
}

export interface CrowdDot {
  x: number;
  y: number;
  r: number;
  fill: string;
  opacity: number;
}

export interface GrassBlade {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stroke: string;
}

const CROWD_PALETTE = ['#E70013', '#FFFFFF', '#76E6AB', '#F7D117', '#2F6BD8', '#E70013', '#FFFFFF'];

/** The roof floodlights (x, y). */
export const FOOTBALL_LIGHTS = [
  [120, 72],
  [235, 38],
  [350, 30],
  [465, 38],
  [580, 72],
] as const;

/** The football night (seed 9090): the bowl's crowd, the camera flashes, the foreground grass. */
export function footballSceneData(): { crowd: CrowdDot[]; flashes: Star[]; grass: GrassBlade[] } {
  const r = seededRandom(9090);
  const cx = 350;
  const cy = 300;
  const onEllipse = (rx: number, ry: number, a: number): [number, number] => [
    cx + rx * Math.cos(a),
    cy + ry * Math.sin(a),
  ];
  const crowd: CrowdDot[] = [];
  for (let k = 0; k < 34; k += 1) {
    const t = k / 33;
    const rx = 318 + 290 * t;
    const ry = 104 + 164 * t;
    const rr = 2.4 - 1.3 * t;
    const n = Math.round(((rx + ry) * 0.95) / (rr * 2.3));
    for (let j = 0; j < n; j += 1) {
      const a = Math.PI + (j / n) * Math.PI * 1.18 - 0.09 * Math.PI;
      const [px, py] = onEllipse(rx, ry, a);
      if (py > cy + 60) continue;
      const x = px + (r() - 0.5) * 2.2;
      const y = py + (r() - 0.5) * 1.6;
      const q = r();
      let fill: string;
      let opacity: number;
      if (q < 0.42) {
        fill = CROWD_PALETTE[Math.floor(r() * CROWD_PALETTE.length)] ?? '#FFFFFF';
        opacity = 0.38 + r() * 0.45;
      } else {
        fill = '#2B3550';
        opacity = 0.55 + r() * 0.35;
      }
      crowd.push({
        x: round(x, 1),
        y: round(y, 1),
        r: round(rr, 2),
        fill,
        opacity: round(opacity, 2),
      });
    }
  }
  const flashes: Star[] = [];
  for (let f = 0; f < 38; f += 1) {
    const a = Math.PI * (1.02 + r() * 0.96);
    const t = r();
    const [x, y] = onEllipse(330 + 270 * t, 110 + 150 * t, a);
    if (y > cy + 40) continue;
    flashes.push({ x: round(x, 1), y: round(y, 1), r: round(5 + r() * 6, 1), opacity: 0.8 });
  }
  const grass: GrassBlade[] = [];
  for (let g = 0; g < 420; g += 1) {
    const x = r() * 700;
    const y = 440 + r() * 160;
    const h = 6 + (r() * 16 * (y - 430)) / 170;
    grass.push({
      x1: round(x, 1),
      y1: round(y, 1),
      x2: round(x + (r() - 0.5) * 4, 1),
      y2: round(y - h, 1),
      stroke: r() < 0.5 ? '#2F8F45' : '#174F25',
    });
  }
  return { crowd, flashes, grass };
}

/** A regular pentagon's points (the ball's patches); sq squashes x for the edge patches. */
export function pentagonPoints(
  x: number,
  y: number,
  radius: number,
  rotDeg: number,
  sq = 1,
): string {
  const pts: string[] = [];
  for (let i = 0; i < 5; i += 1) {
    const a = ((rotDeg + i * 72) * Math.PI) / 180;
    pts.push(
      `${(x + radius * Math.cos(a) * sq).toFixed(1)},${(y + radius * Math.sin(a)).toFixed(1)}`,
    );
  }
  return pts.join(' ');
}
