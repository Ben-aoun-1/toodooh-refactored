import { format } from 'date-fns';
import { CalendarDays } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'react-hot-toast';

import AgentLayout from '@/features/agent/components/AgentLayout';
import { AgentAppointmentCard } from '@/features/appointments/components/AgentAppointmentCard';
import { MonthCalendar } from '@/features/appointments/components/MonthCalendar';
import {
  useAgentAppointments,
  useAgentCalendar,
  useAppointmentMutation,
} from '@/features/appointments/hooks/useAppointments';
import {
  blockedHoursOf,
  dayLabel,
  partialDays,
  splitAppointments,
} from '@/features/appointments/lib/appointments';
import { appointmentsService } from '@/features/appointments/services/appointments.service';
import DayHoursPanel from '@/features/screenhost/components/calendar/DayHoursPanel';
import { getErrorMessage } from '@/lib/errors';

/**
 * AGT-5 (agent specs v1.0 §7) — « Mon calendrier »: every future day is available by default;
 * the agent selects days and marks them Indisponibles / Disponibles (saved immediately, past
 * days frozen). Days with an appointment carry a dot; a click on one lists its appointments.
 * Below, « Mes rendez-vous » with À venir / Passés.
 */
export default function AgentCalendar() {
  const today = format(new Date(), 'yyyy-MM-dd');
  const [month, setMonth] = useState(today.slice(0, 7));
  const [selected, setSelected] = useState<string[]>([]);
  const [focusDay, setFocusDay] = useState<string | null>(null);
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming');
  const cal = useAgentCalendar(month);
  const list = useAgentAppointments();
  const save = useAppointmentMutation(
    (v: { days: string[]; available: boolean; hours?: number[] }) =>
      appointmentsService.setAvailability(v.days, v.available, v.hours),
  );
  const rows = list.data?.appointments ?? [];
  const { upcoming, past } = splitAppointments(rows);
  const dots = [...new Set(upcoming.map((a) => a.day))];

  const toggle = (day: string) => {
    setFocusDay(dots.includes(day) ? day : null);
    setSelected((s) => (s.includes(day) ? s.filter((d) => d !== day) : [...s, day]));
  };

  const apply = async (available: boolean) => {
    try {
      const r = await save.mutateAsync({ days: selected, available });
      setSelected([]);
      if (r.confirmed_kept.length > 0) {
        toast(
          `Rendez-vous confirmés conservés le ${r.confirmed_kept.map(dayLabel).join(', ')} : seules les nouvelles demandes sont bloquées.`,
          { icon: 'ℹ️', duration: 6000 },
        );
      } else {
        toast.success(available ? 'Jours disponibles' : 'Jours indisponibles');
      }
    } catch (e) {
      toast.error(getErrorMessage(e) || 'Enregistrement impossible');
    }
  };

  const dayAppointments = focusDay ? upcoming.filter((a) => a.day === focusDay) : [];
  // AGT-HOUR1 (Mariem 26/10) — one future day selected: its appointment hours open below.
  const hoursDay = selected.length === 1 && selected[0] && selected[0] > today ? selected[0] : null;
  const slotHours = cal.data?.slot_hours ?? [];
  const saveHours = async (day: string, change: { add: number[]; remove: number[] }) => {
    const narrowed = (hours: number[]) => (hours.length === slotHours.length ? undefined : hours);
    try {
      let kept: string[] = [];
      if (change.add.length > 0) {
        const r = await save.mutateAsync({
          days: [day],
          available: false,
          hours: narrowed(change.add),
        });
        kept = r.confirmed_kept;
      }
      if (change.remove.length > 0) {
        await save.mutateAsync({ days: [day], available: true, hours: narrowed(change.remove) });
      }
      setSelected([]);
      toast.success(
        kept.length > 0
          ? 'Heures enregistrées — les rendez-vous confirmés sur ces heures sont conservés.'
          : 'Heures enregistrées',
      );
    } catch (e) {
      toast.error(getErrorMessage(e) || 'Enregistrement impossible');
    }
  };
  const shown = tab === 'upcoming' ? upcoming : past;

  return (
    <AgentLayout page="calendar">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[420px_1fr]">
        <div className="space-y-3">
          <MonthCalendar
            month={month}
            onMonth={setMonth}
            today={today}
            unavailable={cal.data?.unavailable ?? []}
            partial={partialDays(cal.data?.unavailable_hours ?? [], cal.data?.unavailable ?? [])}
            dots={dots}
            selected={selected}
            onDay={(d) => toggle(d)}
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={selected.length === 0 || save.isPending}
              onClick={() => void apply(false)}
              className="flex-1 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 disabled:opacity-50"
            >
              Indisponibles
            </button>
            <button
              type="button"
              disabled={selected.length === 0 || save.isPending}
              onClick={() => void apply(true)}
              className="flex-1 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800 disabled:opacity-50"
            >
              Disponibles
            </button>
          </div>
          {hoursDay && cal.data && (
            <DayHoursPanel
              key={hoursDay}
              dayLabel={dayLabel(hoursDay)}
              hint="Touchez les heures où vous ne pouvez pas recevoir de rendez-vous, puis enregistrez."
              window={slotHours}
              unavailableHours={blockedHoursOf(hoursDay, cal.data)}
              diffusionByHour={new Map()}
              busy={save.isPending}
              onSave={(change) => void saveHours(hoursDay, change)}
              onClose={() => setSelected([])}
            />
          )}
          {dayAppointments.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-semibold">Rendez-vous du {dayLabel(focusDay ?? '')}</p>
              {dayAppointments.map((a) => (
                <AgentAppointmentCard key={a.id} appointment={a} />
              ))}
            </div>
          )}
        </div>

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">Mes rendez-vous</h2>
            <div className="flex gap-1 rounded-lg bg-gray-100 p-1">
              {(
                [
                  ['upcoming', 'À venir'],
                  ['past', 'Passés'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTab(key)}
                  className={`rounded-md px-3 py-1.5 text-sm ${tab === key ? 'bg-white font-semibold shadow-sm' : 'text-gray-600'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {shown.length === 0 ? (
            <div className="rounded-2xl border border-[#E1E4EA] bg-white px-6 py-10 text-center">
              <CalendarDays className="mx-auto mb-3 h-10 w-10 text-gray-300" />
              <p className="text-sm text-gray-600">
                {tab === 'upcoming' ? 'Aucun rendez-vous à venir.' : 'Aucun rendez-vous passé.'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
              {shown.map((a) => (
                <AgentAppointmentCard key={a.id} appointment={a} />
              ))}
            </div>
          )}
        </section>
      </div>
    </AgentLayout>
  );
}
