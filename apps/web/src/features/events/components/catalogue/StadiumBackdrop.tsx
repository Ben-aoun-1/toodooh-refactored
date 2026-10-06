import { useId, useMemo } from 'react';

// EVT-CAT2 — the poster's stadium (Youssef's validated design): a night sky, two floodlights and
// their beams, a crowd tinted with each side's colours, the LED boards reading « toodooh », and a
// mowed pitch. Seeded, so a card always draws the same crowd. Decorative (aria-hidden).

/** mulberry32 — a tiny deterministic PRNG (the same seed always yields the same crowd). */
function seeded(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Dot {
  x: number;
  y: number;
  r: number;
  fill: string;
  opacity: number;
}

function crowd(left: string, right: string, seed: number, mixed: boolean): Dot[] {
  const rand = seeded(seed);
  const dots: Dot[] = [];
  for (let y = 68; y < 146; y += 4.6) {
    for (let x = -2; x < 404; x += 5) {
      const xx = x + (rand() - 0.5) * 2.4;
      const yy = y + (rand() - 0.5) * 1.8;
      let side = xx < 200 ? left : right;
      if (mixed) side = rand() < 0.5 ? left : right;
      const p = rand();
      let fill: string;
      let opacity: number;
      let r = 1.2 + rand() * 0.55;
      if (p < 0.5) {
        fill = side;
        opacity = 0.45 + rand() * 0.5;
      } else if (p < 0.56) {
        fill = '#FFFFFF';
        opacity = 0.75 + rand() * 0.25;
        r = 0.8;
      } else {
        fill = '#3A4256';
        opacity = 0.5 + rand() * 0.4;
      }
      const fade = 0.55 + ((y - 68) / 78) * 0.45;
      dots.push({ x: xx, y: yy, r, fill, opacity: opacity * fade });
    }
  }
  return dots;
}

interface StadiumBackdropProps {
  left: string;
  right: string;
  seed: number;
  /** An evening of several matches: both colours everywhere. */
  mixed?: boolean;
}

export default function StadiumBackdrop({
  left,
  right,
  seed,
  mixed = false,
}: StadiumBackdropProps) {
  const id = useId().replace(/:/g, '');
  const dots = useMemo(() => crowd(left, right, seed, mixed), [left, right, seed, mixed]);
  const stripes = [0, 2, 4, 6, 8, 10];
  return (
    <svg
      viewBox="0 0 400 240"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      className="absolute inset-0 h-full w-full"
    >
      <defs>
        <linearGradient id={`${id}k`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#03060F" />
          <stop offset="1" stopColor="#101C36" />
        </linearGradient>
        <radialGradient id={`${id}f`}>
          <stop offset="0" stopColor="#FFFFFF" stopOpacity=".95" />
          <stop offset=".25" stopColor="#E8F0FF" stopOpacity=".35" />
          <stop offset="1" stopColor="#E8F0FF" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}b`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity=".16" />
          <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`${id}p`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2E8B47" />
          <stop offset="1" stopColor="#145C2A" />
        </linearGradient>
        <linearGradient id={`${id}v`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#03060F" stopOpacity=".55" />
          <stop offset=".45" stopColor="#03060F" stopOpacity=".05" />
          <stop offset=".78" stopColor="#03060F" stopOpacity=".25" />
          <stop offset="1" stopColor="#03060F" stopOpacity=".75" />
        </linearGradient>
      </defs>
      <rect width="400" height="240" fill={`url(#${id}k)`} />
      <polygon points="30,14 52,14 210,150 120,150" fill={`url(#${id}b)`} />
      <polygon points="348,14 370,14 280,150 190,150" fill={`url(#${id}b)`} />
      <polygon points="0,62 400,62 400,150 0,150" fill="#0B1222" />
      {dots.map((d, i) => (
        <circle
          key={i}
          cx={d.x.toFixed(1)}
          cy={d.y.toFixed(1)}
          r={d.r.toFixed(2)}
          fill={d.fill}
          fillOpacity={d.opacity.toFixed(2)}
        />
      ))}
      <rect x="0" y="58" width="400" height="5" fill="#060A15" />
      <rect x="0" y="146" width="400" height="7" fill="#0D2B1F" />
      <rect x="0" y="146" width="400" height="7" fill="#76E6AB" fillOpacity=".18" />
      {[8, 66, 124, 182, 240, 298, 356].map((x) => (
        <text
          key={x}
          x={x}
          y="151.8"
          fontFamily="Poppins, sans-serif"
          fontSize="5.2"
          fontWeight="700"
          fill="#76E6AB"
          fillOpacity=".9"
        >
          toodooh
        </text>
      ))}
      <polygon points="-140,240 540,240 330,153 70,153" fill={`url(#${id}p)`} />
      {stripes.map((i) => {
        const t0 = 70 + i * (260 / 12);
        const t1 = 70 + (i + 1) * (260 / 12);
        const b0 = -140 + i * (680 / 12);
        const b1 = -140 + (i + 1) * (680 / 12);
        return (
          <polygon
            key={i}
            points={`${b0},240 ${b1},240 ${t1},153 ${t0},153`}
            fill="#000000"
            fillOpacity=".09"
          />
        );
      })}
      <g fill="none" stroke="#FFFFFF" strokeOpacity=".62" strokeWidth="1.1">
        <polyline points="-60,240 82,158 318,158 460,240" />
        <line x1="200" y1="158" x2="200" y2="240" />
        <ellipse cx="200" cy="194" rx="52" ry="15" />
      </g>
      <circle cx="41" cy="16" r="46" fill={`url(#${id}f)`} />
      <circle cx="359" cy="16" r="46" fill={`url(#${id}f)`} />
      <g fill="#FFFFFF">
        <rect x="31" y="11" width="20" height="8" rx="1.5" />
        <rect x="349" y="11" width="20" height="8" rx="1.5" />
      </g>
      <rect width="400" height="240" fill={`url(#${id}v)`} />
    </svg>
  );
}
