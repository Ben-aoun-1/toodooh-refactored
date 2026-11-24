import { useState } from 'react';

import { useAgentLogos } from '@/features/agent/hooks/useAgentLogos';
import { useSensorVenue } from '@/features/agent/hooks/useAgentSensors';
import {
  HEAT_CAPTION,
  batteryLabel,
  curveLabels,
  curvePoints,
  heatMax,
  heatStep,
  lastActivity,
} from '@/features/agent/lib/agent-sensors';
import { vfCategoryKey, vfVenueSubline } from '@/features/agent/lib/agent-vf';
import {
  type HeatGrid,
  agentSensorsService,
} from '@/features/agent/services/agent-sensors.service';
import { getErrorMessage } from '@/lib/errors';

import { VfLogo } from './VfFrame';
import { useVfOverlay } from './VfOverlay';

const DAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const W = 760;
const H = 170;

/** The 24 h area curve of the prototype, in plain SVG. */
function Curve({ series }: { series: { at: string; people: number | null }[] }) {
  if (series.length < 2) {
    return <div className="tiny vf-sensor-none">Aucune mesure sur les dernières 24 heures.</div>;
  }
  const pts = curvePoints(
    series.map((s) => s.people),
    W,
    H,
  );
  const p = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const last = series.length - 1;
  return (
    <svg viewBox={`-10 0 ${W + 20} ${H + 22}`} width="100%" height="200" role="img">
      <title>Fréquentation sur les dernières 24 heures</title>
      <defs>
        <linearGradient id="vf-ag" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#76E6AB" stopOpacity=".4" />
          <stop offset="1" stopColor="#76E6AB" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,${H} ${p} ${W},${H}`} fill="url(#vf-ag)" />
      <polyline points={p} fill="none" stroke="#1D9E75" strokeWidth="2.5" strokeLinejoin="round" />
      {curveLabels(series.map((s) => s.at)).map((l) => (
        <text
          key={l.index}
          x={((l.index / last) * W).toFixed(0)}
          y={H + 16}
          fontSize="10"
          fill="#5B6E66"
          textAnchor="middle"
        >
          {l.label}
        </text>
      ))}
    </svg>
  );
}

function Heat({ grid }: { grid: HeatGrid }) {
  const max = heatMax(grid);
  return (
    <div className="vf-scroll">
      <table className="vf-heat">
        <thead>
          <tr>
            <th aria-label="Heure" />
            {DAYS.map((d) => (
              <th key={d}>{d}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.map((row) => (
            <tr key={row.hour}>
              <td className="vf-heat-h">{String(row.hour).padStart(2, '0')}:00</td>
              {row.days.map((v, i) => (
                <td key={DAYS[i]} className={`vf-heat-c vf-heat-${heatStep(v, max)}`}>
                  {v ?? ''}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * AGENT-VF (Agent Screenhost spec VF §12) — the window of one equipped Screenhost: four figures,
 * the venue's Wi-Fi (the password is fetched only on « Afficher » or « Copier »), the last
 * 24 hours, the two heat-maps and the sensors.
 */
export function VfSensorWindow({ screenhostId }: { screenhostId: string }) {
  const { closeAll, toast } = useVfOverlay();
  const logos = useAgentLogos();
  const q = useSensorVenue(screenhostId);
  const [mode, setMode] = useState<'type' | 'week'>('type');
  const [password, setPassword] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  const d = q.data;

  const fetchPassword = async (): Promise<string | null> => {
    if (password !== null) return password;
    try {
      const r = await agentSensorsService.wifiPassword(screenhostId);
      setPassword(r.password ?? '');
      return r.password;
    } catch (e) {
      toast(getErrorMessage(e) || 'Mot de passe indisponible');
      return null;
    }
  };

  if (!d) {
    return (
      <>
        <div className="bh">
          <VfLogo kind="shop" size={60} />
          <div>
            <h2>Suivi des capteurs</h2>
            <p>
              {q.isError
                ? getErrorMessage(q.error) || 'Capteurs momentanément indisponibles.'
                : 'Chargement…'}
            </p>
          </div>
          <button type="button" className="x" onClick={closeAll} aria-label="Fermer">
            ✕
          </button>
        </div>
        <div className="bb vf-bb-1" />
      </>
    );
  }
  const c = d.card;
  const tiles: [string, string | number][] = [
    ['Personnes présentes', c.people_now],
    ['Capteurs en ligne', `${c.online} / ${c.online + c.offline}`],
    ['Moyenne par capteur', d.average_per_sensor],
    ['Wi-Fi', d.wifi_ssid ?? '–'],
  ];
  return (
    <>
      <div className="bh">
        <VfLogo
          kind={vfCategoryKey(c.category)}
          size={60}
          title={c.name}
          logoUrl={logos.of(c.screenhost_id)?.url}
          attention={c.offline > 0}
        />
        <div>
          <h2>{c.name}</h2>
          <p>{vfVenueSubline(c)}</p>
        </div>
        <button type="button" className="x" onClick={closeAll} aria-label="Fermer">
          ✕
        </button>
      </div>
      <div className="bb vf-bb-1">
        <div className="vf-kpi4">
          {tiles.map(([label, value]) => (
            <div className="kpi vf-kpi-sm" key={label}>
              <small>{label}</small>
              <b>{value}</b>
            </div>
          ))}
        </div>
        <div className="sec vf-m0">
          <h4>Wi-Fi de l&apos;établissement</h4>
          <div className="vf-wifi-line">
            <span>
              <span className="muted">Réseau :</span> <b>{d.wifi_ssid ?? '–'}</b>
            </span>
            <span>
              <span className="muted">Mot de passe :</span>{' '}
              <b>{!d.wifi_password_set ? '–' : shown && password ? password : '••••••••'}</b>
            </span>
            {d.wifi_password_set && (
              <>
                <button
                  type="button"
                  className="btn sm"
                  onClick={() => {
                    if (shown) return setShown(false);
                    void fetchPassword().then((p) => p && setShown(true));
                  }}
                >
                  {shown ? 'Masquer' : 'Afficher'}
                </button>
                <button
                  type="button"
                  className="btn sm"
                  onClick={() =>
                    void fetchPassword().then((p) => {
                      if (!p) return;
                      void navigator.clipboard?.writeText(p).catch(() => undefined);
                      toast('Mot de passe copié');
                    })
                  }
                >
                  Copier
                </button>
              </>
            )}
          </div>
        </div>
        <div className="sec vf-m0">
          <h4>Fréquentation sur les dernières 24 heures</h4>
          <Curve series={d.last24h} />
        </div>
        <div className="sec vf-m0">
          <div className="vf-heat-head">
            <h4 className="vf-m0">Affluence par jour et par heure</h4>
            <div className="vt">
              <button
                type="button"
                className={mode === 'type' ? 'on vf-vt-auto' : 'vf-vt-auto'}
                onClick={() => setMode('type')}
              >
                Semaine type
              </button>
              <button
                type="button"
                className={mode === 'week' ? 'on vf-vt-auto' : 'vf-vt-auto'}
                onClick={() => setMode('week')}
              >
                Cette semaine
              </button>
            </div>
          </div>
          <div className="vf-mt10">
            <Heat grid={mode === 'type' ? d.heat_typical : d.heat_week} />
            <div className="tiny vf-mt8">{HEAT_CAPTION[mode]}</div>
          </div>
        </div>
        <div className="sec vf-m0">
          <h4>Capteurs</h4>
          <div className="card vf-scroll">
            <table>
              <thead>
                <tr>
                  <th>Capteur</th>
                  <th>Statut</th>
                  <th>Personnes</th>
                  <th>Batterie</th>
                  <th>Dernière activité</th>
                </tr>
              </thead>
              <tbody>
                {d.sensors.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <b className="vf-w500">{s.label}</b>
                    </td>
                    <td>
                      <span className={`badge ${s.online ? 'b-act' : 'b-att'}`}>
                        {s.online ? 'En ligne' : 'Hors ligne'}
                      </span>
                    </td>
                    <td>{s.online ? (s.people ?? '–') : '–'}</td>
                    <td>{batteryLabel(s.battery_pct)}</td>
                    <td>{lastActivity(s.last_seen_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
