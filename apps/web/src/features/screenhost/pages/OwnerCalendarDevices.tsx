import { Calendar, ChevronLeft, ChevronRight, Megaphone, Users, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'react-hot-toast';

import { useAuthStore } from '@/features/auth/stores/auth.store';
import OwnerNavigation from '@/features/screenhost/components/OwnerNavigation';
import OwnerNotificationsBell from '@/features/screenhost/components/OwnerNotificationsBell';
import {
  useCalendarAvailability,
  type CalendarAvailabilityBatch,
} from '@/features/screens/hooks/useCalendarAvailability';
import { useCalendarDevicesData } from '@/features/screens/hooks/useCalendarDevicesData';
import type { Screen, UnavailabilityPeriod } from '@/features/screens/services/screens.service';

type EstablishmentStatus = 'active' | 'inactive' | 'maintenance' | 'unavailable';

const dayHeaders = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

const normalizeDateOnly = (value: Date | string) => {
  const d = value instanceof Date ? value : new Date(value);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
};

const toIso = (value: Date) =>
  `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;

const isDayUnavailable = (day: Date, periods: UnavailabilityPeriod[]) => {
  const dayStart = normalizeDateOnly(day).getTime();
  return periods.some((p) => {
    if (p.status === 'completed' || p.status === 'cancelled') return false;
    const start = normalizeDateOnly(p.start_date).getTime();
    const end = normalizeDateOnly(p.end_date).getTime();
    return dayStart >= start && dayStart <= end;
  });
};

export default function OwnerCalendarDevices() {
  const { user, needsApproval, validationStatus } = useAuthStore();
  const isDisabled = needsApproval && validationStatus === 'pending';

  const { screens, periods, loading } = useCalendarDevicesData(user?.id);
  const applyCalendarAvailability = useCalendarAvailability();
  const [currentMonth, setCurrentMonth] = useState(() => new Date());
  const [selectedEstablishment, setSelectedEstablishment] = useState<string>('all');
  const [selectedDates, setSelectedDates] = useState<string[]>([]);
  const [processingAvailability, setProcessingAvailability] = useState<
    null | 'available' | 'unavailable'
  >(null);

  const establishments = useMemo(() => {
    const byLocation = new Map<
      string,
      { name: string; screens: Screen[]; status: EstablishmentStatus }
    >();
    (screens || []).forEach((s) => {
      const loc = s.location || s.name || 'Établissement';
      if (!byLocation.has(loc)) {
        byLocation.set(loc, {
          name: loc,
          screens: [s],
          status: (s.status as EstablishmentStatus) || 'inactive',
        });
      } else {
        const entry = byLocation.get(loc)!;
        entry.screens.push(s);
        if (s.status === 'active') entry.status = 'active';
        else if (s.status === 'maintenance' && entry.status !== 'active')
          entry.status = 'maintenance';
        else if (
          s.status === 'unavailable' &&
          entry.status !== 'active' &&
          entry.status !== 'maintenance'
        )
          entry.status = 'unavailable';
        else if (
          entry.status !== 'active' &&
          entry.status !== 'maintenance' &&
          entry.status !== 'unavailable'
        )
          entry.status = 'inactive';
      }
    });
    return Array.from(byLocation.values());
  }, [screens]);

  const filteredEstablishments = useMemo(() => {
    if (selectedEstablishment === 'all') return establishments;
    return establishments.filter((e) => e.name === selectedEstablishment);
  }, [establishments, selectedEstablishment]);

  const filteredScreens = useMemo(
    () => filteredEstablishments.flatMap((e) => e.screens),
    [filteredEstablishments],
  );
  const filteredScreenIds = useMemo(
    () => new Set(filteredScreens.map((s) => s.id)),
    [filteredScreens],
  );

  const filteredPeriods = useMemo(
    () => periods.filter((p) => filteredScreenIds.has(p.screen_id)),
    [periods, filteredScreenIds],
  );
  const selectedDateSet = useMemo(() => new Set(selectedDates), [selectedDates]);

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

  const statusConfig = {
    active: { label: 'Active', bg: 'bg-[#E8F8ED]', text: 'text-[#16A34A]', dot: 'bg-[#16A34A]' },
    inactive: { label: 'Inactif', bg: 'bg-[#FFF1F2]', text: 'text-[#DC2626]', dot: 'bg-[#DC2626]' },
    maintenance: {
      label: 'Inactif',
      bg: 'bg-[#FFF1F2]',
      text: 'text-[#DC2626]',
      dot: 'bg-[#DC2626]',
    },
    unavailable: {
      label: 'Inactif',
      bg: 'bg-[#FFF1F2]',
      text: 'text-[#DC2626]',
      dot: 'bg-[#DC2626]',
    },
  } as const;

  const toggleDateSelection = (day: Date) => {
    const isCurrentMonth = day.getMonth() === currentMonth.getMonth();
    if (!isCurrentMonth) return;
    const isoDate = toIso(day);
    setSelectedDates((prev) =>
      prev.includes(isoDate) ? prev.filter((d) => d !== isoDate) : [...prev, isoDate],
    );
  };

  const clearSelectedDates = () => setSelectedDates([]);

  const hasUnavailabilityOnDate = (screenId: string, dateIso: string) => {
    const currentDate = normalizeDateOnly(dateIso).getTime();
    return periods.some((p) => {
      if (p.screen_id !== screenId) return false;
      if (p.status === 'completed' || p.status === 'cancelled') return false;
      const start = normalizeDateOnly(p.start_date).getTime();
      const end = normalizeDateOnly(p.end_date).getTime();
      return currentDate >= start && currentDate <= end;
    });
  };

  const applyAvailability = async (target: 'available' | 'unavailable') => {
    if (selectedDates.length === 0) {
      toast.error('Sélectionnez au moins une date');
      return;
    }
    if (filteredScreens.length === 0) {
      toast.error('Aucun écran trouvé pour cet établissement');
      return;
    }

    try {
      setProcessingAvailability(target);

      // Le calcul du batch reste ici (dérivé de l'état client : dates/écrans
      // sélectionnés) ; la mutation useCalendarAvailability exécute les écritures
      // puis invalide screensKeys → la query refetch.
      let batch: CalendarAvailabilityBatch;
      if (target === 'unavailable') {
        const toCreate = filteredScreens.flatMap((screen) =>
          selectedDates
            .filter((dateIso) => !hasUnavailabilityOnDate(screen.id, dateIso))
            .map((dateIso) => ({
              screen_id: screen.id,
              start_date: dateIso,
              end_date: dateIso,
              start_time: '00:00',
              end_time: '23:59',
              reason: 'Indisponibilité planifiée depuis calendrier',
            })),
        );
        batch = {
          toCreate,
          screensToSetUnavailable: filteredScreens.map((s) => s.id),
          periodsToDelete: [],
          screenIdsToActivate: [],
        };
      } else {
        const selectedDateMillis = new Set(
          selectedDates.map((d) => normalizeDateOnly(d).getTime()),
        );
        const periodsToDelete = periods.filter((p) => {
          if (!filteredScreenIds.has(p.screen_id)) return false;
          if (p.status === 'completed' || p.status === 'cancelled') return false;
          const start = normalizeDateOnly(p.start_date).getTime();
          const end = normalizeDateOnly(p.end_date).getTime();
          for (const dayMs of selectedDateMillis) {
            if (dayMs >= start && dayMs <= end) return true;
          }
          return false;
        });

        const deletedByScreen = new Set(periodsToDelete.map((p) => p.screen_id));
        const remainingPeriods = periods.filter((p) => !periodsToDelete.some((x) => x.id === p.id));
        const screenIdsToActivate = filteredScreens
          .filter((screen) => {
            if (!deletedByScreen.has(screen.id)) return false;
            return !remainingPeriods.some((p) => {
              if (p.screen_id !== screen.id) return false;
              if (p.status === 'completed' || p.status === 'cancelled') return false;
              return true;
            });
          })
          .map((s) => s.id);

        batch = {
          toCreate: [],
          screensToSetUnavailable: [],
          periodsToDelete: periodsToDelete.map((p) => p.id),
          screenIdsToActivate,
        };
      }

      await applyCalendarAvailability.mutateAsync(batch);
      toast.success(
        target === 'unavailable'
          ? 'Établissement mis en indisponible pour les dates sélectionnées'
          : 'Établissement remis disponible pour les dates sélectionnées',
      );
      setSelectedDates([]);
    } catch (_error) {
      toast.error('Erreur lors de la mise à jour des disponibilités');
    } finally {
      setProcessingAvailability(null);
    }
  };

  return (
    <div className="min-h-screen bg-white">
      <div className="flex h-screen">
        <OwnerNavigation isDisabled={isDisabled} />

        <div className="flex-1 flex flex-col overflow-hidden">
          <header className="bg-white border-b border-gray-200 sticky top-0 z-40 shadow-sm">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="h-10 w-10 rounded-full border border-gray-200 bg-white flex items-center justify-center">
                    <Calendar className="h-5 w-5 text-gray-700" />
                  </div>
                  <div className="min-w-0">
                    <h1 className="text-xl font-semibold text-[#171717] truncate">
                      Mon calendrier et mes dispositifs de diffusion
                    </h1>
                    <p className="text-sm text-gray-500 truncate">
                      Planifiez les périodes d&apos;activation de votre établissement et suivez le
                      statut de vos dispositifs de diffusion
                    </p>
                  </div>
                </div>
                <OwnerNotificationsBell userId={user?.id} />
              </div>
            </div>
          </header>

          <div className="flex-1 overflow-y-auto">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
              <section className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-200 flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div className="h-10 w-10 rounded-full border border-gray-200 bg-white flex items-center justify-center">
                      <Users className="h-5 w-5 text-gray-700" />
                    </div>
                    <div>
                      <h2 className="text-xl font-semibold text-[#171717]">
                        DISPONIBILITÉS DE MES ÉTABLISSEMENTS
                      </h2>
                      <p className="text-sm text-gray-500">
                        Définissez les périodes de disponibilité de vos établissements
                      </p>
                    </div>
                  </div>
                </div>

                <div className="p-4">
                  <div className="mb-4">
                    <label
                      className="block text-sm font-medium text-gray-700 mb-1"
                      htmlFor="selected-establishment"
                    >
                      Choix l&apos;établissement
                    </label>
                    <select
                      value={selectedEstablishment}
                      onChange={(e) => setSelectedEstablishment(e.target.value)}
                      className="h-11 min-w-[220px] rounded-lg border border-gray-200 px-3 text-sm"
                      id="selected-establishment"
                    >
                      <option value="all">Toutes</option>
                      {establishments.map((e) => (
                        <option key={e.name} value={e.name}>
                          {e.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <p className="text-base font-semibold text-[#171717] mb-3">
                    Définissez les périodes de disponibilité et d’indisponibilité{' '}
                    <span className="text-red-500">*</span>
                  </p>

                  <div className="rounded-xl border border-gray-200 overflow-hidden">
                    <div className="h-12 bg-gray-50 border-b border-gray-200 flex items-center justify-between px-3">
                      <button
                        type="button"
                        onClick={() =>
                          setCurrentMonth(
                            new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1),
                          )
                        }
                        className="p-2 rounded-md hover:bg-white"
                      >
                        <ChevronLeft className="h-4 w-4 text-gray-600" />
                      </button>
                      <p className="font-semibold text-gray-700 capitalize">{monthLabel}</p>
                      <button
                        type="button"
                        onClick={() =>
                          setCurrentMonth(
                            new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1),
                          )
                        }
                        className="p-2 rounded-md hover:bg-white"
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
                    <div className="grid grid-cols-7 gap-y-2 px-3 py-3">
                      {days.map((day, idx) => {
                        const inCurrentMonth = day.getMonth() === currentMonth.getMonth();
                        const unavailable = isDayUnavailable(day, filteredPeriods);
                        const selected = selectedDateSet.has(toIso(day));
                        const bg = unavailable
                          ? 'bg-[#FDECEC] text-[#D94848]'
                          : 'bg-[#EAF8EE] text-[#2B8A57]';
                        return (
                          <div key={`${toIso(day)}-${idx}`} className="h-10 flex items-center">
                            {inCurrentMonth ? (
                              <button
                                type="button"
                                onClick={() => toggleDateSelection(day)}
                                className={`h-9 w-9 rounded-lg ${bg} text-sm font-medium flex items-center justify-center ${
                                  selected ? 'ring-2 ring-[#171717] ring-offset-1' : ''
                                }`}
                              >
                                {day.getDate()}
                              </button>
                            ) : (
                              <div className="h-9 w-9 rounded-lg text-sm text-gray-300 flex items-center justify-center">
                                {day.getDate()}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      disabled={processingAvailability !== null || selectedDates.length === 0}
                      onClick={() => applyAvailability('unavailable')}
                      className="inline-flex items-center px-4 py-2 rounded-xl bg-[#FDECEC] text-[#D94848] font-medium text-sm disabled:opacity-60"
                    >
                      {processingAvailability === 'unavailable'
                        ? 'Traitement...'
                        : 'Mettre indisponible'}
                    </button>
                    <button
                      type="button"
                      disabled={processingAvailability !== null || selectedDates.length === 0}
                      onClick={() => applyAvailability('available')}
                      className="inline-flex items-center px-4 py-2 rounded-xl bg-[#EAF8EE] text-[#2B8A57] font-medium text-sm disabled:opacity-60"
                    >
                      {processingAvailability === 'available'
                        ? 'Traitement...'
                        : 'Mettre disponible'}
                    </button>
                    <button
                      type="button"
                      disabled={processingAvailability !== null || selectedDates.length === 0}
                      onClick={clearSelectedDates}
                      className="inline-flex items-center px-4 py-2 rounded-xl border border-gray-200 text-gray-700 font-medium text-sm disabled:opacity-60"
                    >
                      Effacer la sélection
                    </button>
                    {selectedDates.length > 0 ? (
                      <span className="text-sm text-gray-500">
                        {selectedDates.length} date(s) sélectionnée(s)
                      </span>
                    ) : null}
                  </div>
                </div>
              </section>

              <section className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-200 flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div className="h-10 w-10 rounded-full border border-gray-200 bg-white flex items-center justify-center">
                      <Users className="h-5 w-5 text-gray-700" />
                    </div>
                    <div>
                      <h2 className="text-xl font-semibold text-[#171717]">ÉTAT DU DISPOSITIF</h2>
                      <p className="text-sm text-gray-500">
                        Consultez en temps réel l&apos;état du dispositif de diffusion de cet
                        établissement
                      </p>
                    </div>
                  </div>
                  <button type="button" className="text-gray-400 hover:text-gray-600">
                    <X className="h-5 w-5" />
                  </button>
                </div>

                <div className="p-4 space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {filteredEstablishments.map((est) => {
                      const sc = statusConfig[est.status];
                      return (
                        <div
                          key={est.name}
                          className="rounded-xl border border-gray-200 bg-white px-4 py-3 flex items-center justify-between"
                        >
                          <p className="font-medium text-gray-900 truncate">{est.name}</p>
                          <span
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium ${sc.bg} ${sc.text}`}
                          >
                            <span className={`w-1.5 h-1.5 rounded-full ${sc.dot}`} />
                            {sc.label}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {filteredScreens.map((screen) => {
                      const sc =
                        statusConfig[(screen.status as EstablishmentStatus) || 'inactive'] ||
                        statusConfig.inactive;
                      return (
                        <div
                          key={screen.id}
                          className="rounded-xl border border-gray-200 bg-white px-4 py-3 flex items-center justify-between"
                        >
                          <p className="font-medium text-gray-900 truncate">{screen.name}</p>
                          <span
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium ${sc.bg} ${sc.text}`}
                          >
                            <span className={`w-1.5 h-1.5 rounded-full ${sc.dot}`} />
                            {sc.label}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  <div className="pt-2 flex justify-end">
                    <button
                      type="button"
                      onClick={() => window.dispatchEvent(new Event('owner-open-support-modal'))}
                      className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-brand-primary hover:bg-brand-primary/90 text-gray-900 text-sm font-medium transition-colors"
                    >
                      <Megaphone className="h-4 w-4" />
                      Contacter le support
                    </button>
                  </div>
                </div>
              </section>

              {loading ? <p className="text-sm text-gray-500">Chargement...</p> : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
