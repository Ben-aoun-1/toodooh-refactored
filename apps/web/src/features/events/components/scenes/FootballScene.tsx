import { useId, useMemo } from 'react';

import { FOOTBALL_LIGHTS, footballSceneData, pentagonPoints } from '../../lib/home-scenes';

/** The ball's edge patches: their centres; each is rotated 90° + i × 72° and squashed. */
const BALL_PATCHES = [
  [-6, -96],
  [84, -32],
  [50, 74],
  [-62, 74],
  [-96, -32],
] as const;

/** The seams from the centre patch's corners outward. */
const SEAMS = Array.from({ length: 5 }, (_, i) => {
  const a = ((-90 + i * 72) * Math.PI) / 180;
  const x1 = -6 + 30 * Math.cos(a);
  const y1 = -4 + 30 * Math.sin(a);
  return {
    x1: Number(x1.toFixed(1)),
    y1: Number(y1.toFixed(1)),
    x2: Number((x1 + 38 * Math.cos(a)).toFixed(1)),
    y2: Number((y1 + 38 * Math.sin(a)).toFixed(1)),
  };
});

/**
 * The football night (Youssef's design, footballScene): a floodlit stadium bowl full of fans, the
 * Toodooh advertising ring around the pitch, grass in the foreground and a ball. Decorative
 * (aria-hidden); the seeded parts come from lib/home-scenes.
 */
export default function FootballScene() {
  const uid = useId().replace(/:/g, '');
  const id = (suffix: string): string => `fb${uid}${suffix}`;
  const { crowd, flashes, grass } = useMemo(footballSceneData, []);

  return (
    <svg
      viewBox="0 0 700 600"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      className="absolute inset-0 h-full w-full"
    >
      <defs>
        <linearGradient id={id('Sky')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#02040B" />
          <stop offset=".55" stopColor="#0A1430" />
          <stop offset="1" stopColor="#0E1B3A" />
        </linearGradient>
        <radialGradient id={id('Glow')}>
          <stop offset="0" stopColor="#FFFFFF" stopOpacity="1" />
          <stop offset=".18" stopColor="#EAF2FF" stopOpacity=".55" />
          <stop offset="1" stopColor="#EAF2FF" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={id('Beam')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity=".22" />
          <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={id('Pitch')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3FA457" />
          <stop offset="1" stopColor="#1E6E33" />
        </linearGradient>
        <linearGradient id={id('Ground')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1F6B31" />
          <stop offset="1" stopColor="#0A2E15" />
        </linearGradient>
        <radialGradient id={id('Haze')} cx=".5" cy=".55" r=".5">
          <stop offset="0" stopColor="#DDEBFF" stopOpacity=".22" />
          <stop offset="1" stopColor="#DDEBFF" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={id('Ball')} cx=".36" cy=".3" r=".8">
          <stop offset="0" stopColor="#FFFFFF" />
          <stop offset=".55" stopColor="#E7ECF2" />
          <stop offset="1" stopColor="#8A95A6" />
        </radialGradient>
        <radialGradient id={id('Spot')} cx=".5" cy=".5" r=".5">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity=".35" />
          <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
        </radialGradient>
        <clipPath id={id('PitchClip')}>
          <ellipse cx="350" cy="330" rx="300" ry="92" />
        </clipPath>
        <clipPath id={id('BallClip')}>
          <circle cx="0" cy="0" r="100" />
        </clipPath>
      </defs>
      <rect width="700" height="600" fill={`url(#${id('Sky')})`} />
      <ellipse cx="350" cy="300" rx="640" ry="300" fill="#070B18" />
      <ellipse cx="350" cy="300" rx="610" ry="272" fill="#0D1426" />
      {crowd.map((d, i) => (
        <circle key={i} cx={d.x} cy={d.y} r={d.r} fill={d.fill} fillOpacity={d.opacity} />
      ))}
      {flashes.map((f, i) => (
        <circle key={i} cx={f.x} cy={f.y} r={f.r} fill={`url(#${id('Glow')})`} fillOpacity=".8" />
      ))}
      <ellipse cx="350" cy="330" rx="312" ry="99" fill="none" stroke="#0D2B1F" strokeWidth="9" />
      <ellipse
        cx="350"
        cy="330"
        rx="312"
        ry="99"
        fill="none"
        stroke="#76E6AB"
        strokeOpacity=".55"
        strokeWidth="2"
        strokeDasharray="26 10"
      />
      <g clipPath={`url(#${id('PitchClip')})`}>
        <rect x="40" y="230" width="620" height="200" fill={`url(#${id('Pitch')})`} />
        {Array.from({ length: 14 }, (_, i) => 50 + i * 44).map((sx) => (
          <rect key={sx} x={sx} y="230" width="22" height="200" fill="#000000" fillOpacity=".08" />
        ))}
        <g fill="none" stroke="#FFFFFF" strokeOpacity=".75" strokeWidth="1.4">
          <polygon points="120,268 580,268 640,392 60,392" />
          <line x1="350" y1="268" x2="350" y2="392" />
          <ellipse cx="350" cy="328" rx="62" ry="20" />
          <polygon points="110,290 172,290 168,370 96,370" />
          <polygon points="528,290 590,290 604,370 532,370" />
        </g>
        <circle cx="350" cy="328" r="2" fill="#FFFFFF" />
      </g>
      <ellipse cx="350" cy="330" rx="300" ry="92" fill={`url(#${id('Haze')})`} />
      {FOOTBALL_LIGHTS.map(([lx, ly]) => (
        <polygon
          key={`beam-${lx}`}
          points={`${lx - 14},${ly} ${lx + 14},${ly} ${350 + (lx - 350) * 0.45 + 60},330 ${350 + (lx - 350) * 0.45 - 60},330`}
          fill={`url(#${id('Beam')})`}
        />
      ))}
      {FOOTBALL_LIGHTS.map(([lx, ly]) => (
        <g key={`light-${lx}`}>
          <circle cx={lx} cy={ly} r="70" fill={`url(#${id('Glow')})`} fillOpacity=".55" />
          <g fill="#FFFFFF">
            {[-2, -1, 0, 1, 2].flatMap((i) =>
              [0, 1].map((row) => (
                <rect
                  key={`${i}-${row}`}
                  x={lx + i * 7 - 2.5}
                  y={ly - 5 + row * 6}
                  width="5"
                  height="4"
                  rx="1"
                />
              )),
            )}
          </g>
        </g>
      ))}
      <rect x="0" y="34" width="700" height="2" fill="#FFFFFF" fillOpacity=".08" />
      <path d="M0,600 V430 Q350,392 700,430 V600 Z" fill={`url(#${id('Ground')})`} />
      {grass.map((b, i) => (
        <line
          key={i}
          x1={b.x1}
          y1={b.y1}
          x2={b.x2}
          y2={b.y2}
          stroke={b.stroke}
          strokeOpacity=".7"
          strokeWidth="1.2"
          strokeLinecap="round"
        />
      ))}
      <ellipse cx="560" cy="602" rx="120" ry="20" fill="#000000" fillOpacity=".55" />
      <circle cx="560" cy="500" r="170" fill={`url(#${id('Spot')})`} />
      <g transform="translate(560,500) rotate(-12)">
        <circle r="100" fill={`url(#${id('Ball')})`} />
        <g clipPath={`url(#${id('BallClip')})`}>
          <polygon points={pentagonPoints(-6, -4, 30, -90)} fill="#111827" />
          {BALL_PATCHES.map(([px, py], i) => (
            <polygon
              key={i}
              points={pentagonPoints(px, py, 30, 90 + i * 72, 0.78)}
              fill="#111827"
            />
          ))}
          <g stroke="#5B6474" strokeOpacity=".6" strokeWidth="1.6">
            {SEAMS.map((s, i) => (
              <line key={i} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} />
            ))}
          </g>
        </g>
        <circle r="100" fill="none" stroke="#000000" strokeOpacity=".25" strokeWidth="2" />
        <ellipse
          cx="-34"
          cy="-46"
          rx="30"
          ry="18"
          fill="#FFFFFF"
          fillOpacity=".55"
          transform="rotate(-30 -34 -46)"
        />
      </g>
    </svg>
  );
}
