import { format } from 'date-fns';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import {
  CAL_HOURS,
  dayCellClass,
  hourChipState,
  hourToggleMakesAvailable,
  monthTitle,
  selectionLabel,
} from '@/features/agent/lib/agent-calendar';
import {
  useAgentAppointments,
  useAgentCalendar,
  useAppointmentMutation,
} from '@/features/appointments/hooks/useAppointments';
import {
  MONTH_FMT,
  monthCells,
  shiftMonth,
  splitAppointments,
} from '@/features/appointments/lib/appointments';
import { appointmentsService } from '@/features/appointments/services/appointments.service';
import { getErrorMessage } from '@/lib/errors';

import { VfEmpty } from './VfEmpty';
import { useVfOverlay } from './VfOverlay';
import { VfRdvList } from './VfRdvList';
import { VfRdvModal } from './VfRdvModal';

const WEEK = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const EMPTY = { unavailable: [], unavailable_hours: [] };

/**
 * AGENT-VF (spec VF « Mon calendrier ») — the month on the left: several days can be selected at
 * once, then made unavailable, available, or blocked hour by hour (0 h to 23 h; the hours apply
 * to every selected day). Each change is saved at once. « Mes rendez-vous » on the right, with
 * its À venir / Passés tabs and, coming from a fiche, a filter on one affiliate.
 */
export function VfCalendar() {
  const { toast, openModal } = useVfOverlay();
  const [month, setMonth] = useState(() => format(new Date(), MONTH_FMT));
  const [selected, setSelected] = useState<string[]>([]);
  const [tab, setTab] = useState<'up' | 'past'>('up');
  const [params, setParams] = useSearchParams();
  const filter = params.get('avec');
  const today = format(new Date(), 'yyyy-MM-dd');
  const cal = useAgentCalendar(month);
  const view = cal.data ?? EMPTY;
  const list = useAgentAppointments();
  const save = useAppointmentMutation(
    (v: { days: string[]; available: boolean; hours?: number[] }) =>
      appointmentsService.setAvailability(v.days, v.available, v.hours),
  );

  const apply = async (
    v: { days: string[]; available: boolean; hours?: number[] },
    done?: string,
  ) => {
    try {
      const res = await save.mutateAsync(v);
      if (!v.available && res.confirmed_kept.length > 0) {
        toast('Enregistré. Vos rendez-vous déjà confirmés sur ces créneaux sont conservés.');
      } else if (done) {
        toast(done);
      }
    } catch (e) {
      toast(getErrorMessage(e) || 'Enregistrement impossible');
    }
  };
  const changeMonth = (delta: number) => {
    setSelected([]);
    setMonth((m) => shiftMonth(m, delta));
  };
  const toggleDay = (day: string) =>
    setSelected((s) => (s.includes(day) ? s.filter((d) => d !== day) : [...s, day]));

  const split = splitAppointments(list.data?.appointments ?? []);
  const rows = (tab === 'up' ? split.upcoming : split.past).filter(
    (a) => !filter || a.venue_name === filter || a.counterpart_name === filter,
  );

  return (
    <div className="calwrap">
      <div className="card">
        <div className="cb cal">
          <div className="mhd">
            <button
              type="button"
              className="nb"
              aria-label="Mois précédent"
              onClick={() => changeMonth(-1)}
            >
              ‹
            </button>
            <b>{monthTitle(month)}</b>
            <button
              type="button"
              className="nb"
              aria-label="Mois suivant"
              onClick={() => changeMonth(1)}
            >
              ›
            </button>
          </div>
          <div className="wd">
            {WEEK.map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>
          <div className="days">
            {monthCells(month).map((day, i) =>
              day === null ? (
                <span className="d blank" key={`b${i}`} />
              ) : (
                <button
                  type="button"
                  key={day}
                  className={dayCellClass(view, day, today, selected)}
                  disabled={day < today}
                  onClick={() => toggleDay(day)}
                >
                  {Number(day.slice(8))}
                </button>
              ),
            )}
          </div>
          <div className="leg">
            <span>
              <i className="vf-leg-free" />
              Disponible
            </span>
            <span>
              <i className="vf-leg-off" />
              Indisponible
            </span>
            <span>
              <i className="vf-leg-part" />
              Quelques heures indisponibles
            </span>
            <span>
              <i className="vf-leg-sel" />
              Sélectionné
            </span>
          </div>
        </div>
      </div>
      <div>
        <div className="card mb">
          <div className="cb">
            {selected.length === 0 ? (
              <>
                <h3 className="vf-cal-h3">Vos disponibilités</h3>
                <p className="muted vf-m0">
                  Sélectionnez un ou plusieurs jours dans le calendrier pour les rendre
                  indisponibles en entier, ou seulement certaines heures.
                </p>
              </>
            ) : (
              <>
                <div className="selbar">
                  <b>{selectionLabel(selected)}</b>
                  <span className="sp vf-flex1" />
                  <button type="button" className="btn sm" onClick={() => setSelected([])}>
                    Désélectionner
                  </button>
                </div>
                <div className="vf-row-wrap">
                  <button
                    type="button"
                    className="btn vf-btn-off"
                    disabled={save.isPending}
                    onClick={() => {
                      void apply(
                        { days: selected, available: false },
                        'Jours enregistrés comme indisponibles',
                      );
                      setSelected([]);
                    }}
                  >
                    Jours indisponibles
                  </button>
                  <button
                    type="button"
                    className="btn vf-btn-on"
                    disabled={save.isPending}
                    onClick={() => {
                      void apply(
                        { days: selected, available: true },
                        'Jours enregistrés comme disponibles',
                      );
                      setSelected([]);
                    }}
                  >
                    Jours disponibles
                  </button>
                </div>
                <h4 className="vf-cal-h4">Ou seulement certaines heures</h4>
                <p className="tiny vf-m0">
                  Touchez les heures où vous ne pouvez pas recevoir de rendez-vous. Elles
                  s&apos;appliquent à tous les jours sélectionnés.
                </p>
                <div className="hours">
                  {CAL_HOURS.map((h) => {
                    const state = hourChipState(view, selected, h);
                    return (
                      <button
                        type="button"
                        key={h}
                        className={`hr${state === 'off' ? ' off' : state === 'mix' ? ' mix' : ''}`}
                        disabled={save.isPending}
                        onClick={() =>
                          void apply({
                            days: selected,
                            available: hourToggleMakesAvailable(view, selected, h),
                            hours: [h],
                          })
                        }
                      >
                        {h} h
                      </button>
                    );
                  })}
                </div>
                <div className="vf-row-wrap vf-gap8">
                  <button
                    type="button"
                    className="btn sm"
                    disabled={save.isPending}
                    onClick={() => void apply({ days: selected, available: false })}
                  >
                    Toute la journée
                  </button>
                  <button
                    type="button"
                    className="btn sm"
                    disabled={save.isPending}
                    onClick={() => void apply({ days: selected, available: true })}
                  >
                    Tout libérer
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
        <div className="card">
          <div className="ch">
            <h3>Mes rendez-vous</h3>
            <div className="tabs">
              <button
                type="button"
                className={tab === 'up' ? 'on' : undefined}
                onClick={() => setTab('up')}
              >
                À venir
              </button>
              <button
                type="button"
                className={tab === 'past' ? 'on' : undefined}
                onClick={() => setTab('past')}
              >
                Passés
              </button>
            </div>
          </div>
          {filter && (
            <div className="vf-rdv-filter">
              <button
                type="button"
                className="badge b-av vf-chip"
                title="Retirer le filtre"
                onClick={() => setParams({})}
              >
                {filter} ✕
              </button>
            </div>
          )}
          {rows.length === 0 ? (
            <VfEmpty
              icon="cal"
              text={
                tab === 'up'
                  ? `Aucun rendez-vous à venir${filter ? ` avec ${filter}` : ''}.`
                  : 'Aucun rendez-vous passé.'
              }
            />
          ) : (
            <VfRdvList rows={rows} past={tab === 'past'} />
          )}
          <div className="vf-rdv-new">
            <button type="button" className="btn pri" onClick={() => openModal(<VfRdvModal />)}>
              Prendre un rendez-vous
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
