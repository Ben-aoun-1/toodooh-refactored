import { Calendar, ChevronLeft, ChevronRight, Clock, MapPin, MonitorPlay } from 'lucide-react';
import { useMemo, useState } from 'react';

import { useAuthStore } from '@/features/auth/stores/auth.store';
import OwnerNavigation from '@/features/screenhost/components/OwnerNavigation';
import OwnerNotificationsBell from '@/features/screenhost/components/OwnerNotificationsBell';
import { useScreenhostCalendar } from '@/features/screenhost/hooks/useScreenhostCalendar';

/**
 * Owner diffusion calendar — the read-only view of the campaigns the owner has ACCEPTED (from
 * `GET /api/screenhosts/calendar`), shown as a month grid + an agenda. Each accepted allocation
 * carries its frozen créneaux (date/hour); we regroup them by calendar date so the owner can see, at
 * a glance, which campaigns air on which days across their screenhosts. Acceptance itself lives on
 * the separate accept/reject surface — this page never mutates.
 */
const dayHeaders = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

const toIso = (value: Date) =>
  `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;

const fmtHour = (hour: number) => `${String(hour).padStart(2, '0')}h`;

const fmtDate = (iso: string | null): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('fr-FR');
};

const fmtLongDate = (iso: string): string => {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
};

interface DayAiring {
  allocationId: string;
  campaignId: string;
  campaignName: string;
  screenhostName: string;
  startDate: string | null;
  endDate: string | null;
  hours: number[];
  impressions: number;
}

export default function OwnerCampaignCalendar() {
  const { user, needsApproval, validationStatus } = useAuthStore();
  const isDisabled = needsApproval && validationStatus === 'pending';

  const { allocations, loading, isError } = useScreenhostCalendar(user?.id);
  const [currentMonth, setCurrentMonth] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  // Regroup every accepted allocation's créneaux by calendar date → the per-day airing entries the
  // grid + agenda render. One entry per (allocation, date), with that date's hours + summed impressions.
  const byDate = useMemo(() => {
    const map = new Map<string, DayAiring[]>();
    allocations.forEach((a) => {
      const perDate = new Map<string, { hours: number[]; impressions: number }>();
      a.creneaux.forEach((c) => {
        const entry = perDate.get(c.date) ?? { hours: [], impressions: 0 };
        entry.hours.push(c.hour);
        entry.impressions += c.impressions;
        perDate.set(c.date, entry);
      });
      Array.from(perDate.entries()).forEach(([date, entry]) => {
        const list = map.get(date) ?? [];
        list.push({
          allocationId: a.id,
          campaignId: a.campaign_id,
          campaignName: a.campaign_name,
          screenhostName: a.screenhost_name,
          startDate: a.start_date,
          endDate: a.end_date,
          hours: [...entry.hours].sort((x, y) => x - y),
          impressions: entry.impressions,
        });
        map.set(date, list);
      });
    });
    return map;
  }, [allocations]);

  const days = useMemo(() => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const first = new Date(year, month, 1);
    const last = new Date(year, month + 1, 0);
    const mondayStartOffset = (first.getDay() + 6) % 7;
    const daysInMonth = last.getDate();
    const cells: Date[] = [];

    for (let i = 0; i < mondayStartOffset; i++)
      cells.push(new Date(year, month, 1 - (mondayStartOffset - i)));
    for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
    while (cells.length % 7 !== 0)
      cells.push(new Date(year, month + 1, cells.length - (mondayStartOffset + daysInMonth) + 1));

    return cells;
  }, [currentMonth]);

  const monthLabel = useMemo(
    () => currentMonth.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }),
    [currentMonth],
  );

  // The agenda below the grid: dates that have airings IN the current month, chronologically. When a
  // day is selected we narrow to it; otherwise we show the whole month.
  const monthAiringDates = useMemo(() => {
    const prefix = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, '0')}-`;
    return Array.from(byDate.keys())
      .filter((iso) => iso.startsWith(prefix))
      .sort();
  }, [byDate, currentMonth]);

  const agendaDates = useMemo(() => {
    if (selectedDate) return monthAiringDates.includes(selectedDate) ? [selectedDate] : [];
    return monthAiringDates;
  }, [monthAiringDates, selectedDate]);

  const goToMonth = (delta: number) => {
    setSelectedDate(null);
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + delta, 1));
  };

  return (
    <div className="min-h-screen bg-white">
      <div className="flex h-screen">
        <OwnerNavigation isDisabled={isDisabled} />

        <div className="flex-1 flex flex-col overflow-hidden">
          <header className="bg-white border-b border-[#EBEBEB] sticky top-0 z-40">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="h-10 w-10 rounded-full border border-gray-200 bg-white flex items-center justify-center flex-shrink-0">
                    <Calendar className="h-5 w-5 text-gray-700" />
                  </div>
                  <div className="min-w-0">
                    <h1 className="text-xl font-semibold text-[#171717]">
                      Calendrier de diffusion
                    </h1>
                    <p className="text-sm text-[#5C5C5C]">
                      Les campagnes acceptées et leurs créneaux sur vos écrans
                    </p>
                  </div>
                </div>
                <OwnerNotificationsBell userId={user?.id} />
              </div>
            </div>
          </header>

          <div className="flex-1 overflow-y-auto">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
              {loading ? (
                <div className="py-16 text-center text-sm text-gray-500">Chargement...</div>
              ) : isError ? (
                <div className="py-16 text-center text-sm text-[#FB3748]">
                  Impossible de charger le calendrier de diffusion.
                </div>
              ) : (
                <>
                  {/* Month grid */}
                  <section className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
                    <div className="h-12 bg-gray-50 border-b border-gray-200 flex items-center justify-between px-3">
                      <button
                        type="button"
                        onClick={() => goToMonth(-1)}
                        className="p-2 rounded-md hover:bg-white"
                        aria-label="Mois précédent"
                      >
                        <ChevronLeft className="h-4 w-4 text-gray-600" />
                      </button>
                      <p className="font-semibold text-gray-700 capitalize">{monthLabel}</p>
                      <button
                        type="button"
                        onClick={() => goToMonth(1)}
                        className="p-2 rounded-md hover:bg-white"
                        aria-label="Mois suivant"
                      >
                        <ChevronRight className="h-4 w-4 text-gray-600" />
                      </button>
                    </div>
                    <div className="grid grid-cols-7 border-b border-gray-100">
                      {dayHeaders.map((d) => (
                        <div key={d} className="px-3 py-2 text-sm text-gray-500">
                          {d}
                        </div>
                      ))}
                    </div>
                    <div className="grid grid-cols-7 gap-px bg-gray-100">
                      {days.map((day, idx) => {
                        const iso = toIso(day);
                        const inCurrentMonth = day.getMonth() === currentMonth.getMonth();
                        const airings = (inCurrentMonth && byDate.get(iso)) || [];
                        const hasAirings = airings.length > 0;
                        const selected = selectedDate === iso;
                        return (
                          <div
                            key={`${iso}-${idx}`}
                            className={`min-h-[84px] bg-white p-1.5 ${inCurrentMonth ? '' : 'opacity-40'}`}
                          >
                            {inCurrentMonth ? (
                              <button
                                type="button"
                                disabled={!hasAirings}
                                onClick={() => setSelectedDate(selected ? null : iso)}
                                className={`w-full h-full flex flex-col items-start text-left rounded-lg p-1.5 transition-colors ${
                                  hasAirings
                                    ? 'bg-[#EAF8EE] hover:bg-[#DDF3E5] cursor-pointer'
                                    : 'cursor-default'
                                } ${selected ? 'ring-2 ring-[#2B8A57]' : ''}`}
                              >
                                <span
                                  className={`text-sm font-medium ${hasAirings ? 'text-[#2B8A57]' : 'text-gray-700'}`}
                                >
                                  {day.getDate()}
                                </span>
                                {hasAirings ? (
                                  <span className="mt-1 w-full space-y-0.5">
                                    {airings.slice(0, 2).map((a) => (
                                      <span
                                        key={a.allocationId}
                                        className="block truncate rounded bg-white px-1 py-0.5 text-[11px] font-medium text-[#171717]"
                                        title={`${a.campaignName} · ${a.screenhostName}`}
                                      >
                                        {a.campaignName}
                                      </span>
                                    ))}
                                    {airings.length > 2 ? (
                                      <span className="block text-[11px] text-[#2B8A57]">
                                        +{airings.length - 2}
                                      </span>
                                    ) : null}
                                  </span>
                                ) : null}
                              </button>
                            ) : (
                              <span className="text-sm text-gray-300">{day.getDate()}</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </section>

                  {/* Agenda */}
                  <section className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
                    <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="h-10 w-10 rounded-full border border-gray-200 bg-white flex items-center justify-center flex-shrink-0">
                          <MonitorPlay className="h-5 w-5 text-gray-700" />
                        </div>
                        <div className="min-w-0">
                          <h2 className="text-base font-semibold text-[#171717]">
                            {selectedDate
                              ? `Diffusions du ${fmtDate(selectedDate)}`
                              : 'Diffusions du mois'}
                          </h2>
                          <p className="text-sm text-gray-500 capitalize">{monthLabel}</p>
                        </div>
                      </div>
                      {selectedDate ? (
                        <button
                          type="button"
                          onClick={() => setSelectedDate(null)}
                          className="text-sm font-medium text-[#2B8A57] hover:underline flex-shrink-0"
                        >
                          Voir tout le mois
                        </button>
                      ) : null}
                    </div>

                    <div className="p-4">
                      {agendaDates.length === 0 ? (
                        <div className="py-12 text-center text-sm text-gray-500">
                          Aucune campagne acceptée pour cette période.
                        </div>
                      ) : (
                        <ul className="space-y-5">
                          {agendaDates.map((iso) => (
                            <li key={iso}>
                              <p className="text-sm font-semibold text-[#171717] capitalize mb-2">
                                {fmtLongDate(iso)}
                              </p>
                              <ul className="space-y-2">
                                {(byDate.get(iso) ?? []).map((a) => (
                                  <li
                                    key={`${iso}-${a.allocationId}`}
                                    className="rounded-xl border border-[#EBEBEB] bg-white px-4 py-3"
                                  >
                                    <div className="flex items-start justify-between gap-3">
                                      <div className="min-w-0">
                                        <p className="text-base font-medium text-[#171717] truncate">
                                          {a.campaignName}
                                        </p>
                                        <p className="text-sm text-[#5C5C5C] flex items-center gap-1.5 mt-0.5">
                                          <MapPin className="h-3.5 w-3.5 flex-shrink-0" />
                                          <span className="truncate">{a.screenhostName}</span>
                                        </p>
                                        <p className="text-xs text-[#7A7A7A] mt-0.5">
                                          Campagne du {fmtDate(a.startDate)} au {fmtDate(a.endDate)}
                                        </p>
                                      </div>
                                      <span className="text-xs text-[#7A7A7A] flex-shrink-0">
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
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </section>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
