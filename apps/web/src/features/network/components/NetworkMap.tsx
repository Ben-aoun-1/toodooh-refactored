import { useMemo } from 'react';

import { dotLabel } from '@/features/network/lib/network-copy';
import type { NetworkKind, NetworkSpot } from '@/features/network/lib/network-entries';
import {
  MAP_HEIGHT,
  MAP_WIDTH,
  legendRegions,
  mapLinks,
  quartierDots,
  regionColor,
  regionLabels,
  regionTone,
} from '@/features/network/lib/network-map';

interface NetworkMapProps {
  kind: NetworkKind;
  spots: NetworkSpot[];
  label: string;
  caption: string;
  /** The quartier the list is filtered on ('' = none). */
  quartier: string;
  onPick: (quartier: string) => void;
}

const DEEP = '#0D2B1F';

/** The hero map: one dot per quartier, coloured by region; a click filters the list. */
export default function NetworkMap({
  kind,
  spots,
  label,
  caption,
  quartier,
  onPick,
}: NetworkMapProps) {
  const dots = useMemo(() => quartierDots(spots), [spots]);
  const links = useMemo(() => mapLinks(dots), [dots]);
  const labels = useMemo(() => regionLabels(dots), [dots]);
  const legend = useMemo(() => legendRegions(dots), [dots]);

  return (
    <div className="mapbox">
      <svg viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`} role="group" aria-label={label}>
        {labels.map((l) => (
          <text key={l.region} className="reg" x={l.x} y={l.y} textAnchor="middle">
            {l.region}
          </text>
        ))}
        {links.map((l) => (
          <line
            key={`${l.x1}-${l.y1}-${l.x2}-${l.y2}`}
            x1={l.x1}
            y1={l.y1}
            x2={l.x2}
            y2={l.y2}
            stroke="rgba(118,230,171,.28)"
            strokeWidth="1"
            strokeDasharray="2 5"
          />
        ))}
        {dots.map((p, i) => {
          const col = regionColor(p.region);
          const off = p.included === 0;
          return (
            <g
              key={p.quartier}
              className={quartier === p.quartier ? 'q sel' : 'q'}
              tabIndex={0}
              role="button"
              aria-pressed={quartier === p.quartier}
              aria-label={dotLabel(kind, p.quartier, p.included, p.count)}
              data-d={i * 45}
              onClick={() => onPick(p.quartier)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' && e.key !== ' ') return;
                e.preventDefault();
                onPick(p.quartier);
              }}
            >
              <circle
                className="h"
                cx={p.x}
                cy={p.y}
                r={p.r + 7}
                fill="none"
                stroke={col}
                strokeOpacity=".55"
                strokeWidth="1.5"
              />
              <circle cx={p.x} cy={p.y} r={p.r + 12} fill={col} fillOpacity={off ? 0 : 0.08} />
              <circle
                className="d"
                cx={p.x}
                cy={p.y}
                r={p.r}
                fill={col}
                fillOpacity={off ? 0 : 1}
                stroke={col}
                strokeWidth="1.5"
                strokeDasharray={off ? '3 3' : undefined}
              />
              <text className="n" x={p.x} y={p.y} fill={off ? col : DEEP}>
                {p.included}
              </text>
              <text className="l" x={p.x} y={p.y - p.r - 12}>
                {p.quartier}
              </text>
            </g>
          );
        })}
      </svg>
      {legend.length > 0 && (
        <div className="legend">
          {legend.map((region) => (
            <span key={region}>
              <i className={`rg-${regionTone(region)}`} />
              {region}
            </span>
          ))}
        </div>
      )}
      <div className="cap">{caption}</div>
    </div>
  );
}
