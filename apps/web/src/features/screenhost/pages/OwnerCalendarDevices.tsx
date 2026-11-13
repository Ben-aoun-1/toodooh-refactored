import { useMemo, useState } from 'react';
import { toast } from 'react-hot-toast';

import PageHeader from '@/components/PageHeader';
import { useAuthStore } from '@/features/auth/stores/auth.store';
import { AvailabilityCalendarCard } from '@/features/screenhost/components/calendar/AvailabilityCalendarCard';
import DayHoursPanel from '@/features/screenhost/components/calendar/DayHoursPanel';
import { DeviceStatusCard } from '@/features/screenhost/components/calendar/DeviceStatusCard';
import OwnerNavigation from '@/features/screenhost/components/OwnerNavigation';
import OwnerNotificationsBell from '@/features/screenhost/components/OwnerNotificationsBell';
import { useOwnerDevices } from '@/features/screenhost/hooks/useOwnerDevices';
import { useOwnerSensors } from '@/features/screenhost/hooks/useOwnerSensors';
import { useScreenhostCalendar } from '@/features/screenhost/hooks/useScreenhostCalendar';
import { useScreenhostsMine } from '@/features/screenhost/hooks/useScreenhostsMine';
import {
  useScreenhostUnavailability,
  useToggleUnavailability,
} from '@/features/screenhost/hooks/useScreenhostUnavailability';
import {
  campaignsOnDay,
  declareResultCopy,
  fmtLongDate,
  groupCreneauxByDate,
} from '@/features/screenhost/lib/diffusion-calendar';
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
import SupportModal from '@/features/support/components/SupportModal';
import { getErrorMessage } from '@/lib/errors';
import { logger } from '@/lib/logger';

const log = logger.child({ module: 'OwnerCalendarDevices' });

/**
 * « Mon calendrier et mes dispositifs de diffusion » — CAL-2 (Mejri 11/09 point 6 and 15/09:
 * « suivre précisément les maquettes Figma »). One page, two cards, as in the Figma frame: the
 * availability calendar (click a future day to flip it) and the state of the venue's devices.
 *
 * The rule behind the calendar is unchanged (E2 + CAL-1, ruling 2026-09-12): today and the past
 * are locked, and declaring a day that carries an accepted diffusion redistributes that day's
 * share — so that one case asks first, inline, naming the campaigns.
 */
export default function OwnerCalendarDevices() {
  const { user, needsApproval, validationStatus } = useAuthStore();
  const isDisabled = needsApproval && validationStatus === 'pending';

  const venues = useScreenhostsMine(user?.id);
  const { devices } = useOwnerDevices(user?.id);
  const sensors = useOwnerSensors(user?.id);
  const calendar = useScreenhostCalendar(user?.id);
  const [venueId, setVenueId] = useState<string | null>(null);
  const [supportOpen, setSupportOpen] = useState(false);
  // HOUR-UNAV1 — the future day whose hours are open under the grid.
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), monthIndex: now.getMonth() };
  });

  const selectedVenueId = venueId ?? venues.data?.[0]?.id ?? null;
  const cells = useMemo(() => monthGrid(month.year, month.monthIndex), [month]);
  const from = cells[0]?.iso ?? '';
  const to = cells[cells.length - 1]?.iso ?? '';
  const todayIso = isoOf(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());

  const declared = useScreenhostUnavailability(selectedVenueId ?? undefined, from, to);
  const toggle = useToggleUnavailability(selectedVenueId ?? undefined, from, to, user?.id);
  const view = declared.data;

  // Future days carrying an accepted diffusion on this venue → the campaigns' names, and the
  // same per clock cell (`date:hour`) for the hours panel.
  const { diffusionDays, diffusionCells } = useMemo(() => {
    const venueAllocations = calendar.allocations.filter(
      (a) => a.screenhost_id === selectedVenueId,
    );
    const byDate = groupCreneauxByDate(venueAllocations);
    const days = new Map<string, string[]>();
    for (const [iso, airings] of byDate) {
      const names = campaignsOnDay(airings);
      if (iso > todayIso && names.length > 0) days.set(iso, names);
    }
    const cells = new Map<string, string[]>();
    for (const a of venueAllocations) {
      for (const c of a.creneaux) {
        const key = `${c.date}:${c.hour}`;
        const names = cells.get(key) ?? [];
        if (!names.includes(a.campaign_name)) names.push(a.campaign_name);
        cells.set(key, names);
      }
    }
    return { diffusionDays: days, diffusionCells: cells };
  }, [calendar.allocations, selectedVenueId, todayIso]);

  const selectVenue = (id: string) => {
    setSelectedDay(null);
    setVenueId(id);
  };

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

  /** HOUR-UNAV1 — « Enregistrer »: declare the added hours, free the removed ones. */
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
      log.error({ err: error }, 'unavailability toggle failed');
    }
  };

  const handleSelectDay = (iso: string) => {
    if (!isDayToggleable(iso, todayIso) || toggle.isPending) return;
    setSelectedDay((d) => (d === iso ? null : iso));
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
              const names = diffusionCells.get(
                `${cellDateOf(selectedDay, h, view.opening_hour)}:${h}`,
              );
              return names ? [[h, names] as const] : [];
            }),
          )
        }
        busy={toggle.isPending}
        onSave={(change) => void save(selectedDay, change)}
        onClose={() => setSelectedDay(null)}
      />
    ) : undefined;

  const venueScreens = devices.filter((d) => d.venue_id === selectedVenueId);
  const venueSensor = sensors.data?.find((s) => s.venue_id === selectedVenueId);

  return (
    <div className="min-h-screen bg-white">
      <div className="flex h-screen">
        <OwnerNavigation isDisabled={isDisabled} />

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <header className="sticky top-0 z-40 border-b border-gray-200 bg-white shadow-sm">
            <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
              <div className="flex min-h-16 items-center justify-between py-2">
                <PageHeader
                  title="Mon calendrier et mes dispositifs de diffusion"
                  subtitle="Planifiez les périodes d'activation de votre établissement et suivez le statut de vos dispositifs de diffusion"
                />
                <OwnerNotificationsBell />
              </div>
            </div>
          </header>

          <main className="flex-1 overflow-y-auto bg-gray-50/40">
            <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
              {calendar.isError && (
                <p className="text-sm text-red-600">
                  Impossible de charger les diffusions prévues.
                </p>
              )}
              <AvailabilityCalendarCard
                venues={(venues.data ?? []).map((v) => ({ id: v.id, name: v.name }))}
                selectedVenueId={selectedVenueId}
                onSelectVenue={selectVenue}
                month={month}
                onShiftMonth={shiftMonth}
                cells={cells}
                todayIso={todayIso}
                dayState={(iso) => dayStateOf(iso, view)}
                diffusionDays={diffusionDays}
                onSelectDay={handleSelectDay}
                selectedDay={selectedDay}
                busy={toggle.isPending}
                loading={venues.isLoading || declared.isLoading}
                panel={panel}
              />
              <DeviceStatusCard
                sensor={venueSensor}
                screens={venueScreens}
                onContactSupport={() => setSupportOpen(true)}
              />
            </div>
          </main>
        </div>
      </div>
      {supportOpen && <SupportModal onClose={() => setSupportOpen(false)} />}
    </div>
  );
}
