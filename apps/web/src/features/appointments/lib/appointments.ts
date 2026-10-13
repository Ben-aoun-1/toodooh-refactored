import { addDays, endOfMonth, format, getISODay, parseISO, startOfMonth } from 'date-fns';

import type { AppointmentStatus, AppointmentView } from '../services/appointments.service';

// AGT-5 (agent specs v1.0 §7) — the appointment calendar rules shared by the agent's « Mon
// calendrier » and the affiliates' « Prendre rendez-vous », pure.

export const APPOINTMENT_STATUS_FR: Record<AppointmentStatus, string> = {
  en_attente: 'En attente',
  nouvel_horaire: 'Nouvel horaire proposé',
  confirme: 'Confirmé',
  annule: 'Annulé',
  expire: 'Expiré',
  passe: 'Passé',
};

/** Blue for En attente, green for Confirmé (spec §7 table). */
export const APPOINTMENT_STATUS_CLASS: Record<AppointmentStatus, string> = {
  en_attente: 'bg-blue-50 text-blue-700',
  nouvel_horaire: 'bg-amber-50 text-amber-700',
  confirme: 'bg-emerald-50 text-emerald-700',
  annule: 'bg-gray-100 text-gray-500',
  expire: 'bg-gray-100 text-gray-500',
  passe: 'bg-gray-100 text-gray-600',
};

export const MONTH_FMT = 'yyyy-MM';

/** Monday-first weeks of a month: nulls pad the first and last week. */
export const monthCells = (month: string): (string | null)[] => {
  const first = startOfMonth(parseISO(`${month}-01`));
  const last = endOfMonth(first);
  const cells: (string | null)[] = Array.from({ length: getISODay(first) - 1 }, () => null);
  for (let d = first; d <= last; d = addDays(d, 1)) cells.push(format(d, 'yyyy-MM-dd'));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
};

export const monthLabel = (month: string) =>
  parseISO(`${month}-01`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

export const shiftMonth = (month: string, delta: number) => {
  const d = parseISO(`${month}-01`);
  return format(new Date(d.getFullYear(), d.getMonth() + delta, 1), MONTH_FMT);
};

export type DayState = 'past' | 'unavailable' | 'available';

export const dayState = (day: string, today: string, unavailable: string[]): DayState =>
  day < today ? 'past' : unavailable.includes(day) ? 'unavailable' : 'available';

/** Pale green available, pale red unavailable (the Screenhost calendar's colours). */
export const DAY_CLASS: Record<DayState, string> = {
  past: 'bg-gray-50 text-gray-300',
  unavailable: 'bg-red-50 text-red-700',
  available: 'bg-emerald-50 text-emerald-800',
};

/** The free hours of a day: offered slots, not taken, not already started. */
export const freeHours = (
  day: string,
  slotHours: readonly number[],
  taken: { day: string; hour: number }[],
  now: Date,
): number[] =>
  slotHours.filter(
    (h) =>
      !taken.some((t) => t.day === day && t.hour === h) &&
      new Date(`${day}T${String(h).padStart(2, '0')}:00:00+01:00`) > now,
  );

export const hourLabel = (h: number) => `${String(h).padStart(2, '0')}h00`;
export const dayLabel = (day: string) => day.split('-').reverse().join('/');

/** « À venir » = still live (or confirmed ahead); « Passés » = over, cancelled or expired. */
export const splitAppointments = (rows: AppointmentView[]) => {
  const upcoming = rows
    .filter(
      (r) => r.status === 'en_attente' || r.status === 'nouvel_horaire' || r.status === 'confirme',
    )
    .sort((a, b) => `${a.day}${a.hour}`.localeCompare(`${b.day}${b.hour}`));
  const past = rows.filter((r) => !upcoming.includes(r));
  return { upcoming, past };
};

/** The agent can act on a request only while it waits for him. */
export const agentCanAnswer = (r: { status: AppointmentStatus }) => r.status === 'en_attente';
/** The affiliate answers only a counter-proposal. */
export const affiliateCanAnswer = (r: { status: AppointmentStatus }) =>
  r.status === 'nouvel_horaire';
export const canCancel = (r: { status: AppointmentStatus }) =>
  r.status === 'en_attente' || r.status === 'nouvel_horaire' || r.status === 'confirme';
