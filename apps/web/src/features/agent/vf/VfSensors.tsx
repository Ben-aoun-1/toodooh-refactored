import { useState } from 'react';

import { useAgentLogos } from '@/features/agent/hooks/useAgentLogos';
import { useSensorsOverview } from '@/features/agent/hooks/useAgentSensors';
import {
  SENSOR_EMPTY,
  SENSOR_FILTERS,
  type SensorFilter,
  filterSensorVenues,
  offlineBanner,
} from '@/features/agent/lib/agent-sensors';
import { vfCategoryKey, vfVenueSubline } from '@/features/agent/lib/agent-vf';
import { getErrorMessage } from '@/lib/errors';

import { VfEmpty } from './VfEmpty';
import { VfFrame } from './VfFrame';
import { VfIcon } from './VfIcon';
import { useVfOverlay } from './VfOverlay';
import { VfSensorWindow } from './VfSensorWindow';

/**
 * AGENT-VF (Agent Screenhost spec VF §12) — « Suivi des capteurs »: the sensor counters, the
 * offline banner, the filters and one card per Screenhost equipped with at least one sensor.
 */
export function VfSensors() {
  const { openBig } = useVfOverlay();
  const overview = useSensorsOverview();
  const logos = useAgentLogos();
  const [filter, setFilter] = useState<SensorFilter>('all');
  const [query, setQuery] = useState('');

  if (overview.isError) {
    return (
      <div className="card">
        <VfEmpty
          icon="aff"
          text={getErrorMessage(overview.error) || 'Les capteurs sont momentanément indisponibles.'}
        />
      </div>
    );
  }
  const totals = overview.data?.totals ?? { sensors: 0, online: 0, offline: 0 };
  const rows = filterSensorVenues(overview.data?.venues ?? [], filter, query);
  const banner = offlineBanner(totals.offline);

  return (
    <>
      <div className="grid4 vf-kpi3">
        <div className="kpi vf-kpi-plain">
          <small>Capteurs</small>
          <b className="vf-ink2">{totals.sensors}</b>
        </div>
        <div className="kpi vf-kpi-plain">
          <small>En ligne</small>
          <b className="vf-green">{totals.online}</b>
        </div>
        <div className="kpi vf-kpi-plain">
          <small>Hors ligne</small>
          <b className="vf-orange">{totals.offline}</b>
        </div>
      </div>
      {banner && (
        <div className="banner vf-banner-info vf-mb16">
          <VfIcon k="alert" size={16} />
          <span>{banner}</span>
        </div>
      )}
      <div className="vf-sensor-tools">
        <div className="vt">
          {SENSOR_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              className={filter === f.key ? 'on vf-vt-pad' : 'vf-vt-pad'}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <input
          className="vf-sensor-q"
          placeholder="Rechercher un Screenhost"
          aria-label="Rechercher un Screenhost"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="vf-sensor-grid">
        {rows.length === 0 ? (
          <div className="tiny vf-sensor-none">
            {overview.isPending
              ? 'Chargement…'
              : (overview.data?.venues.length ?? 0) === 0
                ? "Aucun de vos Screenhosts n'est encore équipé d'un capteur."
                : SENSOR_EMPTY}
          </div>
        ) : (
          rows.map((s) => (
            <button
              type="button"
              className="shc"
              key={s.screenhost_id}
              onClick={() => openBig(<VfSensorWindow screenhostId={s.screenhost_id} />)}
            >
              <VfFrame
                name={s.name}
                kind={vfCategoryKey(s.category)}
                logoUrl={logos.of(s.screenhost_id)?.url}
                attention={s.offline > 0}
              />
              <div className="nm vf-mt10">
                <b>{s.name}</b>
                <small>{vfVenueSubline(s)}</small>
              </div>
              <div className="nums vf-nums-1">
                <div>
                  <small>Personnes présentes maintenant</small>
                  <b className="vf-b20">{s.people_now}</b>
                </div>
              </div>
              <div className="vf-cap-line">
                <span className="vf-cap-on">● {s.online} en ligne</span>
                {s.offline > 0 && <span className="vf-cap-off">● {s.offline} hors ligne</span>}
              </div>
            </button>
          ))
        )}
      </div>
    </>
  );
}
