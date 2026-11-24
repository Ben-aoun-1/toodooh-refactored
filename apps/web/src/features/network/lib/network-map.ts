import type { NetworkSpot } from './network-entries';

// RESEAU-1 — the hero map. The prototype hardcodes a position per quartier; here each quartier's
// dot is the average latitude / longitude of its spots, stretched into the prototype's 440 × 470
// viewBox with padding and then nudged apart so that neighbouring quartiers stay readable. The
// result is a diagram, not a survey map — the page keeps « Positions indicatives ».

export const MAP_WIDTH = 440;
export const MAP_HEIGHT = 470;
/** Room kept free around the dots (their halo, and the quartier name printed above a dot). */
export const MAP_PADDING = { top: 64, right: 52, bottom: 52, left: 52 } as const;
/** The prototype's radius (10 + 2.6 per spot), capped so a large quartier cannot fill the map. */
const MAX_RADIUS = 32;
const DOT_GAP = 6;

/** Ported hues: Ariana mint, Tunis white, Ben Arous portage; any other region is neutral. */
const REGION_COLORS: Record<string, string> = {
  ariana: '#76E6AB',
  tunis: '#FFFFFF',
  'ben arous': '#9195F8',
};
const NEUTRAL_REGION_COLOR = '#C5D6CD';

export type RegionTone = 'ariana' | 'tunis' | 'benarous' | 'other';

function regionKey(region: string | null): string {
  return (region ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
}

export function regionColor(region: string | null): string {
  return REGION_COLORS[regionKey(region)] ?? NEUTRAL_REGION_COLOR;
}

export function regionTone(region: string | null): RegionTone {
  const key = regionKey(region);
  if (key === 'ariana' || key === 'tunis') return key;
  return key === 'ben arous' ? 'benarous' : 'other';
}

export function dotRadius(count: number): number {
  return Math.min(MAX_RADIUS, 10 + count * 2.6);
}

export interface QuartierDot {
  quartier: string;
  region: string | null;
  x: number;
  y: number;
  r: number;
  /** Spots of the quartier, and how many of them are still in the Screencaster's network. */
  count: number;
  included: number;
}

interface Group {
  quartier: string;
  region: string | null;
  count: number;
  included: number;
  lat: number;
  lng: number;
}

function groupByQuartier(spots: readonly NetworkSpot[]): Group[] {
  const acc = new Map<
    string,
    { region: string | null; count: number; included: number; lat: number; lng: number; n: number }
  >();
  for (const s of spots) {
    if (s.quartier === null) continue;
    const g = acc.get(s.quartier) ?? {
      region: s.region,
      count: 0,
      included: 0,
      lat: 0,
      lng: 0,
      n: 0,
    };
    g.count += 1;
    if (!s.excluded) g.included += 1;
    if (g.region === null) g.region = s.region;
    if (s.latitude !== null && s.longitude !== null) {
      g.lat += s.latitude;
      g.lng += s.longitude;
      g.n += 1;
    }
    acc.set(s.quartier, g);
  }
  // A quartier none of whose spots has coordinates is listed but cannot be drawn.
  return [...acc.entries()]
    .filter(([, g]) => g.n > 0)
    .map(([quartier, g]) => ({
      quartier,
      region: g.region,
      count: g.count,
      included: g.included,
      lat: g.lat / g.n,
      lng: g.lng / g.n,
    }))
    .sort((a, b) => a.quartier.localeCompare(b.quartier, 'fr'));
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/** Spread `value` of [min, max] over [from, to]; a single value sits in the middle. */
function spread(value: number, min: number, max: number, from: number, to: number): number {
  if (max - min < 1e-9) return (from + to) / 2;
  return from + ((value - min) / (max - min)) * (to - from);
}

function keepInside(d: QuartierDot): void {
  d.x = clamp(d.x, d.r + 14, MAP_WIDTH - d.r - 14);
  d.y = clamp(d.y, d.r + 26, MAP_HEIGHT - d.r - 14);
}

/** Push overlapping dots apart along the line between their centres, deterministically. */
function relax(dots: QuartierDot[]): void {
  for (let pass = 0; pass < 120; pass += 1) {
    let moved = false;
    for (let i = 0; i < dots.length; i += 1) {
      for (let j = i + 1; j < dots.length; j += 1) {
        const a = dots[i];
        const b = dots[j];
        if (!a || !b) continue;
        const need = a.r + b.r + DOT_GAP;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let dist = Math.hypot(dx, dy);
        if (dist >= need) continue;
        if (dist < 1e-6) {
          // Same spot: split them on a direction that depends only on their rank.
          const angle = (i * 7 + j * 3) * 0.7;
          dx = Math.cos(angle);
          dy = Math.sin(angle);
          dist = 1;
        }
        const push = (need - dist) / 2 + 0.01;
        a.x -= (dx / dist) * push;
        a.y -= (dy / dist) * push;
        b.x += (dx / dist) * push;
        b.y += (dy / dist) * push;
        moved = true;
      }
    }
    dots.forEach(keepInside);
    if (!moved) return;
  }
}

/** One dot per quartier that has at least one located spot, sorted by quartier name. */
export function quartierDots(spots: readonly NetworkSpot[]): QuartierDot[] {
  const groups = groupByQuartier(spots);
  if (groups.length === 0) return [];
  const lats = groups.map((g) => g.lat);
  const lngs = groups.map((g) => g.lng);
  const [minLat, maxLat] = [Math.min(...lats), Math.max(...lats)];
  const [minLng, maxLng] = [Math.min(...lngs), Math.max(...lngs)];
  const dots = groups.map(
    (g): QuartierDot => ({
      quartier: g.quartier,
      region: g.region,
      // East is right; north is up, so the latitude axis is flipped.
      x: spread(g.lng, minLng, maxLng, MAP_PADDING.left, MAP_WIDTH - MAP_PADDING.right),
      y: spread(g.lat, minLat, maxLat, MAP_HEIGHT - MAP_PADDING.bottom, MAP_PADDING.top),
      r: dotRadius(g.count),
      count: g.count,
      included: g.included,
    }),
  );
  dots.forEach(keepInside);
  relax(dots);
  return dots.map((d) => ({ ...d, x: Math.round(d.x * 10) / 10, y: Math.round(d.y * 10) / 10 }));
}

export interface MapLink {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** The prototype's dashed mesh: every dot is tied to its 2 nearest ones, each pair drawn once. */
export function mapLinks(dots: readonly QuartierDot[]): MapLink[] {
  const seen = new Set<string>();
  const links: MapLink[] = [];
  dots.forEach((a, i) => {
    dots
      .map((b, j) => ({ j, b, d: Math.hypot(a.x - b.x, a.y - b.y) }))
      .filter((o) => o.j !== i)
      .sort((u, v) => u.d - v.d)
      .slice(0, 2)
      .forEach((o) => {
        const key = `${Math.min(i, o.j)}-${Math.max(i, o.j)}`;
        if (seen.has(key)) return;
        seen.add(key);
        links.push({ x1: a.x, y1: a.y, x2: o.b.x, y2: o.b.y });
      });
  });
  return links;
}

export interface RegionLabel {
  region: string;
  x: number;
  y: number;
}

/** A region is named on the map only when it has dots: under its lowest dot, centred on them. */
export function regionLabels(dots: readonly QuartierDot[]): RegionLabel[] {
  const byRegion = new Map<string, QuartierDot[]>();
  for (const d of dots) {
    if (d.region === null) continue;
    byRegion.set(d.region, [...(byRegion.get(d.region) ?? []), d]);
  }
  return [...byRegion.entries()].map(([region, list]) => ({
    region,
    x: clamp(list.reduce((s, d) => s + d.x, 0) / list.length, 60, MAP_WIDTH - 60),
    y: clamp(Math.max(...list.map((d) => d.y + d.r)) + 34, 30, MAP_HEIGHT - 6),
  }));
}

/** The legend lists the regions that are on the map, in the prototype's order first. */
export function legendRegions(dots: readonly QuartierDot[]): string[] {
  const rank: Record<RegionTone, number> = { ariana: 0, tunis: 1, benarous: 2, other: 3 };
  const regions: string[] = [];
  for (const d of dots)
    if (d.region !== null && !regions.includes(d.region)) regions.push(d.region);
  return regions.sort(
    (a, b) => rank[regionTone(a)] - rank[regionTone(b)] || a.localeCompare(b, 'fr'),
  );
}
