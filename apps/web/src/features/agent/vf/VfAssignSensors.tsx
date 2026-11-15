import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { useAssignSensor, useSensorAssignment } from '@/features/agent/hooks/useAgentSensors';
import {
  type AssignFilter,
  SENSOR_STATUS,
  assignCounts,
  assignedToast,
  batteryLabel,
  filterAssignable,
  pickerSubline,
  pickerVenues,
} from '@/features/agent/lib/agent-sensors';
import { AGENT_PATHS } from '@/features/agent/lib/agent-shell';
import type {
  AssignVenue,
  AssignableSensor,
} from '@/features/agent/services/agent-sensors.service';
import logo from '@/features/agent/styles/img/vf-logo.png';
import { getErrorMessage } from '@/lib/errors';

import { VfOverlayProvider, useVfOverlay } from './VfOverlay';

import '@/features/agent/styles/agent-vf.css';
import '@/features/agent/styles/agent-vf-extra.css';

/** The picker: the agent's Screenhosts, the one he came from first and preselected. */
function Picker({
  sensor,
  venues,
  fromId,
}: {
  sensor: AssignableSensor;
  venues: AssignVenue[];
  fromId: string | null;
}) {
  const { closeAll, toast } = useVfOverlay();
  const assign = useAssignSensor();
  const [selected, setSelected] = useState<string | null>(sensor.screenhost_id ?? fromId);
  const [query, setQuery] = useState('');
  const list = pickerVenues(venues, query, fromId);

  const submit = async () => {
    if (!selected) return;
    try {
      const r = await assign.mutateAsync({ deviceId: sensor.id, screenhostId: selected });
      closeAll();
      toast(assignedToast(r.sensor, r.screenhost));
    } catch (e) {
      toast(getErrorMessage(e) || 'Assignation impossible');
    }
  };

  return (
    <>
      <div className="mh">
        <div>
          <b>{sensor.screenhost_id ? 'Changer le Screenhost' : 'Assigner le capteur'}</b>
          <small>{sensor.label}</small>
        </div>
        <button type="button" className="x" onClick={closeAll} aria-label="Fermer">
          ✕
        </button>
      </div>
      <div className="mb2">
        <input
          className="vf-pick-q"
          placeholder="Rechercher parmi mes Screenhosts"
          aria-label="Rechercher parmi mes Screenhosts"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="vf-pick-list">
          {list.length === 0 ? (
            <div className="tiny">Aucun Screenhost.</div>
          ) : (
            list.map((v) => (
              <button
                type="button"
                key={v.screenhost_id}
                className={`shopt${selected === v.screenhost_id ? ' on' : ''}`}
                onClick={() => setSelected(v.screenhost_id)}
              >
                <span className="rd" />
                <span>
                  <b>{v.name}</b>
                  <small>{pickerSubline(v)}</small>
                </span>
              </button>
            ))
          )}
        </div>
      </div>
      <div className="mf">
        <button type="button" className="btn" onClick={closeAll}>
          Annuler
        </button>
        <button
          type="button"
          className="btn pri"
          disabled={!selected || selected === sensor.screenhost_id || assign.isPending}
          onClick={() => void submit()}
        >
          Assigner
        </button>
      </div>
    </>
  );
}

function Screen() {
  const { openModal } = useVfOverlay();
  const [params] = useSearchParams();
  const fromId = params.get('screenhost');
  const q = useSensorAssignment();
  const [filter, setFilter] = useState<AssignFilter>(fromId ? 'free' : 'all');
  const [query, setQuery] = useState('');
  const sensors = q.data?.sensors ?? [];
  const venues = q.data?.venues ?? [];
  const from = venues.find((v) => v.screenhost_id === fromId) ?? null;
  const counts = assignCounts(sensors);
  const rows = filterAssignable(sensors, filter, query);
  const chips: [AssignFilter, string][] = [
    ['all', `Tous (${counts.all})`],
    ['free', `Non assignés (${counts.free})`],
    ['done', `Assignés (${counts.done})`],
  ];

  return (
    <div className="hubscr">
      <div className="hub">
        <div className="hbar">
          <Link className="backb" to={AGENT_PATHS.dashboard}>
            ‹ Retour au tableau de bord
          </Link>
          <span className="sp" />
          <img src={logo} alt="toodooh" />
        </div>
        <div className="hh">
          <h1>Assigner mes capteurs</h1>
          <p>
            Les capteurs que vous avez préparés. Assignez chacun au Screenhost chez qui il est
            installé. Un Screenhost peut recevoir plusieurs capteurs.
          </p>
        </div>
        {from && (
          <div className="banner vf-banner-info vf-mb16">
            <span>
              Vous venez de la fiche de <b>{from.name}</b>. Il est proposé en premier quand vous
              cliquez sur Assigner.
            </span>
          </div>
        )}
        <div className="tools">
          <div className="vt">
            {chips.map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={filter === key ? 'on' : undefined}
                onClick={() => setFilter(key)}
              >
                {label}
              </button>
            ))}
          </div>
          <input
            placeholder="Rechercher un capteur ou un Screenhost"
            aria-label="Rechercher un capteur ou un Screenhost"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="card vf-scroll">
          <table>
            <thead>
              <tr>
                <th>Capteur</th>
                <th>Statut</th>
                <th className="hide-s">Batterie</th>
                <th>Screenhost</th>
                <th aria-label="Action" />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="vf-assign-none">
                    {q.isPending
                      ? 'Chargement…'
                      : q.isError
                        ? getErrorMessage(q.error) ||
                          'Les capteurs sont momentanément indisponibles.'
                        : 'Aucun capteur ne correspond à ce filtre.'}
                  </td>
                </tr>
              ) : (
                rows.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <b className="vf-w500">{s.label}</b>
                    </td>
                    <td>
                      <span className={`badge ${SENSOR_STATUS[s.status].badge}`}>
                        {SENSOR_STATUS[s.status].label}
                      </span>
                    </td>
                    <td className="hide-s">{batteryLabel(s.battery_pct)}</td>
                    <td>{s.screenhost_name ?? <span className="vf-ink3">Non assigné</span>}</td>
                    <td className="vf-right">
                      <button
                        type="button"
                        className={`btn sm${s.screenhost_name ? '' : ' pri'}`}
                        onClick={() =>
                          openModal(<Picker sensor={s} venues={venues} fromId={fromId} />)
                        }
                      >
                        {s.screenhost_name ? 'Changer' : 'Assigner'}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/**
 * AGENT-VF (Agent Screenhost spec VF §14; operator 2026-11-14: inside Toodooh, no second sign-in)
 * — « Assigner mes capteurs »: a full white screen without the sidebar, the sensors the agent
 * prepared, and the picker of his Screenhosts. `?screenhost=` is the fiche he came from.
 */
export function VfAssignSensors() {
  return (
    <div className="agt">
      <VfOverlayProvider>
        <Screen />
      </VfOverlayProvider>
    </div>
  );
}
