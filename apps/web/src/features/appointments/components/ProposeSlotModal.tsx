import { format } from 'date-fns';
import { X } from 'lucide-react';
import { useState } from 'react';

import { useAgentCalendar } from '../hooks/useAppointments';
import { hourLabel } from '../lib/appointments';

import { MonthCalendar } from './MonthCalendar';

/** The agent's « Proposer un nouvel horaire »: a future available day and an offered hour. */
export function ProposeSlotModal({
  onClose,
  onSubmit,
  busy,
}: {
  onClose: () => void;
  onSubmit: (day: string, hour: number) => void;
  busy: boolean;
}) {
  const today = format(new Date(), 'yyyy-MM-dd');
  const [month, setMonth] = useState(today.slice(0, 7));
  const [day, setDay] = useState<string | null>(null);
  const [hour, setHour] = useState<number | null>(null);
  const cal = useAgentCalendar(month);
  const unavailable = cal.data?.unavailable ?? [];
  const slotHours = cal.data?.slot_hours ?? [];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-semibold">Proposer un nouvel horaire</h3>
          <button type="button" onClick={onClose} aria-label="Fermer">
            <X className="h-5 w-5" />
          </button>
        </div>
        <MonthCalendar
          month={month}
          onMonth={setMonth}
          today={today}
          unavailable={unavailable}
          selected={day ? [day] : []}
          unavailableSelectable={false}
          onDay={(d) => setDay(d)}
        />
        {day && (
          <div className="mt-3 flex flex-wrap gap-2">
            {slotHours.map((h) => (
              <button
                key={h}
                type="button"
                onClick={() => setHour(h)}
                className={`rounded-lg border px-3 py-1.5 text-sm ${hour === h ? 'border-brand-primary bg-brand-primary/10 font-semibold' : ''}`}
              >
                {hourLabel(h)}
              </button>
            ))}
          </div>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border px-4 py-2 text-sm">
            Annuler
          </button>
          <button
            type="button"
            disabled={!day || hour === null || busy}
            onClick={() => day && hour !== null && onSubmit(day, hour)}
            className="rounded-lg bg-brand-primary px-4 py-2 text-sm font-medium text-brand-deep disabled:opacity-50"
          >
            Proposer
          </button>
        </div>
      </div>
    </div>
  );
}
