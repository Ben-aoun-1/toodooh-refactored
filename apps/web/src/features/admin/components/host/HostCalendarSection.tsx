import { useMemo, useState } from 'react';
import { toast } from 'react-hot-toast';

import { useHostUnavailability, useToggleHostDay } from '@/features/admin/hooks/useAdminHost';
import { AvailabilityCalendarCard } from '@/features/screenhost/components/calendar/AvailabilityCalendarCard';
import DayHoursPanel from '@/features/screenhost/components/calendar/DayHoursPanel';
import { declareResultCopy, fmtLongDate } from '@/features/screenhost/lib/diffusion-calendar';
import {
  cellDateOf,
  dayStateOf,
  unavailableHoursOf,
  windowHours,
} from '@/features/screenhost/lib/hour-unavailability';
import {
  isDayToggleable,
  isoOf,
  monthGrid,
} from '@/features/screenhost/lib/unavailability-calendar';
import { getErrorMessage } from '@/lib/errors';
import { logger } from '@/lib/logger';

const log = logger.child({ module: 'HostCalendarSection' });

/**
 * HOST-EDIT1 → HOUR-UNAV1 — « Indisponibilités »: the owner's calendar card on the admin twin
 * route, by the HOUR. Same rules (E2 + CAL-1): today and the past are locked; a future day opens
 * its hours; declaring hours that carry a live campaign share (classic or event) redistributes it
 * — so that case asks first, inline, naming the campaigns.
 */
export default function HostCalendarSection({ venue }: { venue: { id: string; name: string } }) {
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), monthIndex: now.getMonth() };
  });
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const cells = useMemo(() => monthGrid(month.year, month.monthIndex), [month]);
  const from = cells[0]?.iso ?? '';
  const to = cells[cells.length - 1]?.iso ?? '';
  const todayIso = isoOf(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());

  const read = useHostUnavailability(venue.id, from, to);
  const toggle = useToggleHostDay(venue.id, from, to);
  const view = read.data;
  const diffusionDays = useMemo(() => {
    const out = new Map<string, string[]>();
    for (const [iso, names] of Object.entries(view?.diffusion_days ?? {})) {
      if (iso > todayIso && names.length > 0) out.set(iso, names);
    }
    return out;
  }, [view, todayIso]);

  const shiftMonth = (delta: number) => {
    setSelectedDay(null);
    setMonth((m) => {
      const d = new Date(m.year, m.monthIndex + delta, 1);
      return { year: d.getFullYear(), monthIndex: d.getMonth() };
    });
  };

  const window = windowHours(view?.opening_hour ?? null, view?.closing_hour ?? null);
  const hoursOrWhole = (hours: number[]): number[] | undefined =>
    hours.length === window.length ? undefined : hours;

  const save = async (day: string, change: { add: number[]; remove: number[] }) => {
    try {
      if (change.add.length > 0) {
        const result = await toggle.mutateAsync({
          day,
          unavailable: true,
          hours: hoursOrWhole(change.add),
        });
        toast.success(declareResultCopy(result.redispatched));
      }
      if (change.remove.length > 0) {
        await toggle.mutateAsync({ day, unavailable: false, hours: hoursOrWhole(change.remove) });
        if (change.add.length === 0) toast.success('Heures libérées.');
      }
      setSelectedDay(null);
    } catch (error) {
      toast.error(getErrorMessage(error) || "Échec de l'enregistrement de la disponibilité");
      log.error({ err: error }, 'admin unavailability toggle failed');
    }
  };

  const panel =
    selectedDay !== null && view ? (
      <DayHoursPanel
        dayLabel={fmtLongDate(selectedDay)}
        window={window}
        unavailableHours={unavailableHoursOf(selectedDay, view)}
        diffusionByHour={
          new Map(
            window.flatMap((h) => {
              const names =
                view.diffusion_hours[`${cellDateOf(selectedDay, h, view.opening_hour)}:${h}`];
              return names && names.length > 0 ? [[h, names] as const] : [];
            }),
          )
        }
        busy={toggle.isPending}
        onSave={(change) => void save(selectedDay, change)}
        onClose={() => setSelectedDay(null)}
      />
    ) : undefined;

  return (
    <AvailabilityCalendarCard
      title="Indisponibilités"
      subtitle="Les heures où l'établissement ne diffuse pas — touchez un jour futur pour choisir ses heures."
      venues={[venue]}
      selectedVenueId={venue.id}
      onSelectVenue={() => undefined}
      month={month}
      onShiftMonth={shiftMonth}
      cells={cells}
      todayIso={todayIso}
      dayState={(iso) => dayStateOf(iso, view)}
      diffusionDays={diffusionDays}
      onSelectDay={(iso) => {
        if (!isDayToggleable(iso, todayIso) || toggle.isPending) return;
        setSelectedDay((d) => (d === iso ? null : iso));
      }}
      selectedDay={selectedDay}
      busy={toggle.isPending}
      loading={read.isLoading}
      panel={panel}
    />
  );
}
