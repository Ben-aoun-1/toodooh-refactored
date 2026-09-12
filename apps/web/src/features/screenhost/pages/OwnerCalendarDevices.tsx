import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  Loader2,
  MonitorPlay,
  MonitorSmartphone,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'react-hot-toast';

import PageHeader from '@/components/PageHeader';
import { useAuthStore } from '@/features/auth/stores/auth.store';
import OwnerNavigation from '@/features/screenhost/components/OwnerNavigation';
import OwnerNotificationsBell from '@/features/screenhost/components/OwnerNotificationsBell';
import { useOwnerDevices } from '@/features/screenhost/hooks/useOwnerDevices';
import { useScreenhostCalendar } from '@/features/screenhost/hooks/useScreenhostCalendar';
import { useScreenhostsMine } from '@/features/screenhost/hooks/useScreenhostsMine';
import {
  useScreenhostUnavailability,
  useToggleUnavailability,
} from '@/features/screenhost/hooks/useScreenhostUnavailability';
import {
  DEVICE_STATUS_LABELS,
  deviceStatusOf,
  lastSeenLabel,
} from '@/features/screenhost/lib/device-liveness';
import {
  campaignsOnDay,
  declareConfirmCopy,
  declareResultCopy,
  fmtHour,
  fmtLongDate,
  groupCreneauxByDate,
} from '@/features/screenhost/lib/diffusion-calendar';
import {
  MONTH_LABELS_FR,
  UNAVAILABILITY_CONSEQUENCE_COPY,
  WEEKDAY_LABELS_FR,
  isDayToggleable,
  isoOf,
  monthGrid,
} from '@/features/screenhost/lib/unavailability-calendar';
import { getErrorMessage } from '@/lib/errors';
import { logger } from '@/lib/logger';

const log = logger.child({ module: 'OwnerCalendarDevices' });

/**
 * E2 (VF jours_dispo_i) — the availability calendar on the live api. Per-venue: pick the
 * établissement, toggle FUTURE days (declared = red « Indisponible »); past/today are locked (the
 * api's PAST_OR_TODAY).
 *
 * CAL-1 (Mejri 11/09 point 6, ruling 2026-09-12) — the MERGED owner calendar: the former
 * « Calendrier de diffusion » (accepted créneaux from GET /api/screenhosts/calendar) is the second
 * layer of the same grid, filtered on the selected venue. Clicking a day opens its panel (the
 * day's diffusions + the availability toggle). Declaring a day that carries accepted diffusion
 * MOVES that day's share — the api re-places it and reports what moved; the page confirms first
 * and words the toast from the api's answer. The CF-D1 device-liveness block rides below.
 */
export default function OwnerCalendarDevices() {
  const { user, needsApproval, validationStatus } = useAuthStore();
  const isDisabled = needsApproval && validationStatus === 'pending';

  const venues = useScreenhostsMine(user?.id);
  const { devices } = useOwnerDevices(user?.id);
  const calendar = useScreenhostCalendar(user?.id);
  const [venueId, setVenueId] = useState<string | null>(null);
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
  const declaredSet = useMemo(() => new Set(declared.data ?? []), [declared.data]);
  // CAL-1 — the diffusion layer: this venue's accepted créneaux, by date.
  const byDate = useMemo(
    () =>
      groupCreneauxByDate(calendar.allocations.filter((a) => a.screenhost_id === selectedVenueId)),
    [calendar.allocations, selectedVenueId],
  );

  const venueDevices = devices.filter((d) => d.venue_id === selectedVenueId);

  const shiftMonth = (delta: number) => {
    setSelectedDay(null);
    setMonth((m) => {
      const d = new Date(m.year, m.monthIndex + delta, 1);
      return { year: d.getFullYear(), monthIndex: d.getMonth() };
    });
  };

  const handleToggle = (iso: string) => {
    if (!isDayToggleable(iso, todayIso) || toggle.isPending) return;
    const declaring = !declaredSet.has(iso);
    // CAL-1 — a declaration on a day that carries accepted diffusion moves that day's share:
    // say so and ask before writing.
    const airing = campaignsOnDay(byDate.get(iso));
    if (declaring && airing.length > 0 && !window.confirm(declareConfirmCopy(airing))) return;
    toggle.mutate(
      { day: iso, unavailable: declaring },
      {
        onSuccess: (result) => {
          if (declaring) toast.success(declareResultCopy(result.redispatched));
        },
        onError: (error) => {
          toast.error(getErrorMessage(error) || "Échec de l'enregistrement de la disponibilité");
          log.error({ err: error }, 'unavailability toggle failed');
        },
      },
    );
  };

  const selectedAirings = selectedDay ? (byDate.get(selectedDay) ?? []) : [];
  const selectedToggleable = selectedDay !== null && isDayToggleable(selectedDay, todayIso);
  const selectedUnavailable = selectedDay !== null && declaredSet.has(selectedDay);

  return (
    <div className="min-h-screen bg-white">
      <div className="flex h-screen">
        <OwnerNavigation isDisabled={isDisabled} />

        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          <header className="bg-white border-b border-gray-200 sticky top-0 z-40 shadow-sm">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 w-full">
              <div className="flex justify-between items-center h-16">
                <PageHeader
                  title="Mon calendrier de diffusion"
                  subtitle="Vos diffusions, vos indisponibilités et vos écrans, sur un seul calendrier"
                />
                <OwnerNotificationsBell />
              </div>
            </div>
          </header>

          <main className="flex-1 overflow-y-auto">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
              {/* ── the venue selector (the fleet) ── */}
              <div className="flex flex-wrap gap-2">
                {(venues.data ?? []).map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    aria-pressed={v.id === selectedVenueId}
                    onClick={() => setVenueId(v.id)}
                    className={`rounded-full border px-4 py-2 text-sm transition-colors ${
                      v.id === selectedVenueId
                        ? 'border-brand-primary bg-brand-primary/10 font-semibold text-brand-deep'
                        : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {v.name}
                  </button>
                ))}
                {venues.isLoading && (
                  <span className="flex items-center gap-2 text-sm text-gray-400">
                    <Loader2 className="h-4 w-4 animate-spin" /> Chargement…
                  </span>
                )}
              </div>

              {/* ── the calendar ── */}
              <section className="rounded-2xl border border-gray-200 bg-white p-5">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="flex items-center gap-2 text-lg font-bold text-gray-900">
                    <CalendarDays className="h-5 w-5 text-brand-deep" />
                    {MONTH_LABELS_FR[month.monthIndex]} {month.year}
                  </h2>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => shiftMonth(-1)}
                      aria-label="Mois précédent"
                      className="rounded-lg border border-gray-200 p-2 text-gray-600 hover:bg-gray-50"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => shiftMonth(1)}
                      aria-label="Mois suivant"
                      className="rounded-lg border border-gray-200 p-2 text-gray-600 hover:bg-gray-50"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-7 gap-1 text-center">
                  {WEEKDAY_LABELS_FR.map((w) => (
                    <div key={w} className="py-1 text-xs font-semibold text-gray-400">
                      {w}
                    </div>
                  ))}
                  {cells.map((cell) => {
                    const unavailable = declaredSet.has(cell.iso);
                    const airings = byDate.get(cell.iso) ?? [];
                    const selected = cell.iso === selectedDay;
                    return (
                      <button
                        key={cell.iso}
                        type="button"
                        disabled={!cell.inMonth}
                        onClick={() => setSelectedDay(selected ? null : cell.iso)}
                        aria-label={`${cell.iso}${unavailable ? ' — Indisponible' : ''}${
                          airings.length > 0 ? ` — ${airings.length} diffusion(s)` : ''
                        }`}
                        aria-pressed={selected}
                        className={`flex h-16 flex-col items-center justify-center gap-0.5 rounded-lg border text-sm transition-colors ${
                          !cell.inMonth
                            ? 'border-transparent text-gray-300'
                            : selected
                              ? 'border-brand-primary bg-brand-primary/10 font-semibold text-brand-deep'
                              : unavailable
                                ? 'border-red-200 bg-red-50 font-semibold text-red-700'
                                : 'border-gray-100 text-gray-800 hover:border-brand-primary hover:bg-brand-primary/5'
                        }`}
                      >
                        <span>{cell.dayOfMonth}</span>
                        {cell.inMonth && unavailable && (
                          <span className="text-[10px] leading-tight">Indisponible</span>
                        )}
                        {cell.inMonth && airings.length > 0 && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-[#EAF8EE] px-1.5 text-[10px] font-medium leading-4 text-[#2B8A57]">
                            <MonitorPlay className="h-3 w-3" />
                            {airings.length}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* The honest consequence — CAL-1: a declared day with accepted diffusion moves its share. */}
                <p className="mt-4 rounded-xl bg-gray-50 px-4 py-3 text-sm text-gray-600">
                  {UNAVAILABILITY_CONSEQUENCE_COPY}
                </p>
              </section>

              {/* ── the day panel (CAL-1): this day's diffusions + the availability toggle ── */}
              {selectedDay && (
                <section className="rounded-2xl border border-gray-200 bg-white p-5">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <h2 className="flex items-center gap-2 text-lg font-bold capitalize text-gray-900">
                      <MonitorPlay className="h-5 w-5 text-brand-deep" />
                      {fmtLongDate(selectedDay)}
                    </h2>
                    <button
                      type="button"
                      disabled={!selectedToggleable || toggle.isPending}
                      onClick={() => handleToggle(selectedDay)}
                      className={`rounded-xl border px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                        selectedUnavailable
                          ? 'border-gray-200 text-gray-700 hover:bg-gray-50'
                          : 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100'
                      }`}
                    >
                      {selectedUnavailable
                        ? 'Rendre ce jour disponible'
                        : 'Déclarer ce jour indisponible'}
                    </button>
                  </div>
                  {!selectedToggleable && (
                    <p className="mb-3 text-xs text-gray-400">
                      Seuls les jours à venir peuvent être déclarés indisponibles.
                    </p>
                  )}
                  {calendar.isError ? (
                    <p className="text-sm text-red-600">Impossible de charger les diffusions.</p>
                  ) : selectedAirings.length === 0 ? (
                    <p className="text-sm text-gray-400">Aucune diffusion acceptée ce jour-là.</p>
                  ) : (
                    <ul className="space-y-2">
                      {selectedAirings.map((a) => (
                        <li
                          key={`${selectedDay}-${a.allocationId}`}
                          className="rounded-xl border border-[#EBEBEB] bg-white px-4 py-3"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate text-base font-medium text-[#171717]">
                                {a.campaignName}
                              </p>
                              <p className="mt-0.5 text-xs text-[#7A7A7A]">
                                Campagne du {a.startDate ?? '—'} au {a.endDate ?? '—'}
                              </p>
                            </div>
                            <span className="flex-shrink-0 text-xs text-[#7A7A7A]">
                              {a.impressions.toLocaleString('fr-FR')} impressions
                            </span>
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            {a.hours.map((h) => (
                              <span
                                key={`${a.allocationId}-${h}`}
                                className="inline-flex items-center gap-1 rounded-lg bg-[#EAF8EE] px-2 py-0.5 text-xs font-medium text-[#2B8A57]"
                              >
                                <Clock className="h-3 w-3" />
                                {fmtHour(h)}
                              </span>
                            ))}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              )}

              {/* ── the CF-D1 device liveness block ── */}
              <section className="rounded-2xl border border-gray-200 bg-white p-5">
                <h2 className="mb-4 flex items-center gap-2 text-lg font-bold text-gray-900">
                  <MonitorSmartphone className="h-5 w-5 text-brand-deep" />
                  Appareils de l’établissement
                </h2>
                {venueDevices.length === 0 ? (
                  <p className="text-sm text-gray-400">Aucun appareil appairé sur ce lieu.</p>
                ) : (
                  <ul className="space-y-2">
                    {venueDevices.map((d) => {
                      const status = deviceStatusOf(d);
                      return (
                        <li
                          key={d.id}
                          className="flex items-center justify-between rounded-xl border border-gray-100 px-4 py-3"
                        >
                          <span className="font-medium text-gray-900">{d.name}</span>
                          <span
                            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
                              status === 'connected'
                                ? 'bg-emerald-50 text-emerald-700'
                                : status === 'offline'
                                  ? 'bg-red-50 text-red-700'
                                  : 'bg-gray-100 text-gray-500'
                            }`}
                          >
                            {DEVICE_STATUS_LABELS[status]}
                            {status === 'offline' && d.last_seen_at
                              ? ` — ${lastSeenLabel(d.last_seen_at, new Date())}`
                              : ''}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
