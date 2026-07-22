import { CalendarDays, ChevronLeft, ChevronRight, Loader2, MonitorSmartphone } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'react-hot-toast';

import PageHeader from '@/components/PageHeader';
import { useAuthStore } from '@/features/auth/stores/auth.store';
import OwnerNavigation from '@/features/screenhost/components/OwnerNavigation';
import OwnerNotificationsBell from '@/features/screenhost/components/OwnerNotificationsBell';
import { useOwnerDevices } from '@/features/screenhost/hooks/useOwnerDevices';
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
 * E2 (VF jours_dispo_i) — the REBUILT availability calendar, on the live api (the dead Supabase
 * periods tree is deleted). Per-venue: pick the établissement, toggle FUTURE days (declared =
 * red « Indisponible »); past/today are locked (the api's PAST_OR_TODAY). The engine excludes
 * declared days from NEW campaigns only — frozen plans are never rewritten (the consequence copy
 * says exactly that). The CF-D1 device-liveness block rides below (one liveness truth).
 */
export default function OwnerCalendarDevices() {
  const { user, needsApproval, validationStatus } = useAuthStore();
  const isDisabled = needsApproval && validationStatus === 'pending';

  const venues = useScreenhostsMine(user?.id);
  const { devices } = useOwnerDevices(user?.id);
  const [venueId, setVenueId] = useState<string | null>(null);
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
  const toggle = useToggleUnavailability(selectedVenueId ?? undefined, from, to);
  const declaredSet = useMemo(() => new Set(declared.data ?? []), [declared.data]);

  const venueDevices = devices.filter((d) => d.venue_id === selectedVenueId);

  const shiftMonth = (delta: number) => {
    setMonth((m) => {
      const d = new Date(m.year, m.monthIndex + delta, 1);
      return { year: d.getFullYear(), monthIndex: d.getMonth() };
    });
  };

  const handleToggle = (iso: string) => {
    if (!isDayToggleable(iso, todayIso) || toggle.isPending) return;
    toggle.mutate(
      { day: iso, unavailable: !declaredSet.has(iso) },
      {
        onError: (error) => {
          toast.error(getErrorMessage(error) || "Échec de l'enregistrement de la disponibilité");
          log.error({ err: error }, 'unavailability toggle failed');
        },
      },
    );
  };

  return (
    <div className="min-h-screen bg-white">
      <div className="flex h-screen">
        <OwnerNavigation isDisabled={isDisabled} />

        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          <header className="bg-white border-b border-gray-200 sticky top-0 z-40 shadow-sm">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 w-full">
              <div className="flex justify-between items-center h-16">
                <PageHeader
                  title="Calendrier & Appareils"
                  subtitle="Déclarez vos indisponibilités et suivez vos écrans"
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
                    const toggleable = cell.inMonth && isDayToggleable(cell.iso, todayIso);
                    return (
                      <button
                        key={cell.iso}
                        type="button"
                        disabled={!toggleable}
                        onClick={() => handleToggle(cell.iso)}
                        aria-label={`${cell.iso}${unavailable ? ' — Indisponible' : ''}`}
                        aria-pressed={unavailable}
                        className={`flex h-14 flex-col items-center justify-center rounded-lg border text-sm transition-colors ${
                          !cell.inMonth
                            ? 'border-transparent text-gray-300'
                            : unavailable
                              ? 'border-red-200 bg-red-50 font-semibold text-red-700'
                              : toggleable
                                ? 'border-gray-100 text-gray-800 hover:border-brand-primary hover:bg-brand-primary/5'
                                : 'border-gray-100 bg-gray-50 text-gray-400 cursor-not-allowed'
                        }`}
                      >
                        <span>{cell.dayOfMonth}</span>
                        {unavailable && cell.inMonth && (
                          <span className="text-[10px] leading-tight">Indisponible</span>
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* The honest consequence — frozen plans are never rewritten (ruling 2). */}
                <p className="mt-4 rounded-xl bg-gray-50 px-4 py-3 text-sm text-gray-600">
                  {UNAVAILABILITY_CONSEQUENCE_COPY}
                </p>
              </section>

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
