import { useId, useMemo } from 'react';

import { RAMADAN_LANTERNS, RAMADAN_SKYLINE, ramadanSceneData } from '../../lib/home-scenes';

/**
 * The Ramadan night (Youssef's design, ramadanScene): a deep sky, a crescent, four lanterns and
 * the old-town skyline with lit windows. Decorative (aria-hidden); the seeded parts come from
 * lib/home-scenes. Gradient ids are made unique per instance (the door and the card both draw it).
 */
export default function RamadanScene() {
  const uid = useId().replace(/:/g, '');
  const id = (suffix: string): string => `rm${uid}${suffix}`;
  const { stars, windows } = useMemo(ramadanSceneData, []);

  return (
    <svg
      viewBox="0 0 800 420"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      className="absolute inset-0 h-full w-full"
    >
      <defs>
        <linearGradient id={id('s')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#060A22" />
          <stop offset=".5" stopColor="#191545" />
          <stop offset=".82" stopColor="#43275A" />
          <stop offset="1" stopColor="#8A4A3E" />
        </linearGradient>
        <radialGradient id={id('m')}>
          <stop offset="0" stopColor="#FFE9B8" stopOpacity=".55" />
          <stop offset=".35" stopColor="#F6D48A" stopOpacity=".18" />
          <stop offset="1" stopColor="#F6D48A" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={id('g')}>
          <stop offset="0" stopColor="#FFC266" stopOpacity=".75" />
          <stop offset=".4" stopColor="#FF9A3C" stopOpacity=".22" />
          <stop offset="1" stopColor="#FF9A3C" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={id('l')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFE3A3" />
          <stop offset=".6" stopColor="#F7A83E" />
          <stop offset="1" stopColor="#C9661F" />
        </linearGradient>
        <radialGradient id={id('h')} cx=".5" cy="1" r=".7">
          <stop offset="0" stopColor="#FF9E4F" stopOpacity=".45" />
          <stop offset="1" stopColor="#FF9E4F" stopOpacity="0" />
        </radialGradient>
        <mask id={id('c')}>
          <rect width="800" height="420" fill="#FFFFFF" />
          <circle cx="662" cy="96" r="50" fill="#000000" />
        </mask>
        <linearGradient id={id('v')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#03050F" stopOpacity=".1" />
          <stop offset=".6" stopColor="#03050F" stopOpacity="0" />
          <stop offset="1" stopColor="#03050F" stopOpacity=".55" />
        </linearGradient>
        <linearGradient id={id('x')} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#03050F" stopOpacity=".55" />
          <stop offset=".55" stopColor="#03050F" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width="800" height="420" fill={`url(#${id('s')})`} />
      {stars.map((s, i) => (
        <circle key={i} cx={s.x} cy={s.y} r={s.r} fill="#FFF6DD" fillOpacity={s.opacity} />
      ))}
      <circle cx="640" cy="110" r="150" fill={`url(#${id('m')})`} />
      <circle cx="640" cy="110" r="56" fill="#F8E2AE" mask={`url(#${id('c')})`} />
      <rect x="0" y="260" width="800" height="160" fill={`url(#${id('h')})`} />
      {RAMADAN_LANTERNS.map(({ x, y, k }) => (
        <g key={`${x}-${y}`}>
          <line
            x1={x}
            y1="0"
            x2={x}
            y2={y - 26 * k}
            stroke="#E9C27A"
            strokeOpacity=".55"
            strokeWidth={Number((1.2 * k).toFixed(2))}
          />
          <circle cx={x} cy={y} r={70 * k} fill={`url(#${id('g')})`} />
          <g transform={`translate(${x},${y}) scale(${k})`}>
            <path d="M-6,-30 h12 l2,4 h-16 z" fill="#B8862F" />
            <path d="M-9,-26 h18 l6,10 h-30 z" fill="#D9A441" />
            <path d="M-15,-16 h30 l-3,30 h-24 z" fill={`url(#${id('l')})`} />
            <path
              d="M-5,-16 v30 M5,-16 v30"
              stroke="#8A5A1C"
              strokeOpacity=".55"
              strokeWidth="1.4"
            />
            <path d="M-12,14 h24 l-5,8 h-14 z" fill="#D9A441" />
            <circle cx="0" cy="25" r="2.5" fill="#D9A441" />
          </g>
        </g>
      ))}
      <path fill="#0B0A22" d={RAMADAN_SKYLINE} />
      {windows.map((w, i) => (
        <rect
          key={i}
          x={w.x}
          y={w.y}
          width="3"
          height="5"
          rx="1"
          fill="#FFC56B"
          fillOpacity={w.opacity}
        />
      ))}
      <rect width="800" height="420" fill={`url(#${id('v')})`} />
      <rect width="800" height="420" fill={`url(#${id('x')})`} />
    </svg>
  );
}
