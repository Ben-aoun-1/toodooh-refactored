import { AnimatePresence, motion } from 'framer-motion';
import { AlertCircle, CalendarDays, Clock, Loader2, TrendingUp, Users } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { useAuthStore } from '@/features/auth/stores/auth.store';

import { useScreenhostAffluence } from '../hooks/useScreenhostAffluence';
import { useScreenhostsMine } from '../hooks/useScreenhostsMine';
import { DAY_LABELS, DAY_LABELS_SHORT, formatHour, summarize } from '../lib/affluence-grid';

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-4">
      <div className="flex items-center gap-2 text-gray-500">
        {icon}
        <span className="text-xs font-medium">{label}</span>
      </div>
      <p className="mt-2 text-2xl font-bold tracking-tight text-brand-deep tabular-nums">{value}</p>
    </div>
  );
}

// Owner-dashboard "Votre audience" section: the venue's typical-week affluence (weekday × hour
// heatmap + summary). fleet_owner gets a venue selector; individual_owner has one venue. Self-
// contained — reads the session + fetches its own data. Hidden entirely when the owner has no venue.
export function OwnerAffluenceSection() {
  const { user, profileType } = useAuthStore();
  const screenhosts = useScreenhostsMine(user?.id);
  const venues = useMemo(() => screenhosts.data ?? [], [screenhosts.data]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => {
    if (selectedId === null && venues.length > 0) setSelectedId(venues[0]?.id ?? null);
  }, [venues, selectedId]);

  const affluence = useScreenhostAffluence(selectedId);
  const grid = useMemo(() => affluence.data?.grid ?? [], [affluence.data]);
  const hasData = affluence.data?.has_data ?? false;
  const summary = useMemo(() => summarize(grid), [grid]);

  // Hide the whole section while we don't yet know the venues, or when there are none.
  if (screenhosts.isLoading) {
    return (
      <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-center gap-2 py-10 text-gray-400">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm">Chargement…</span>
        </div>
      </section>
    );
  }
  if (venues.length === 0) return null;

  const isFleet = profileType === 'fleet_owner';
  const peakDay = summary.peakDayIndex !== null ? (DAY_LABELS[summary.peakDayIndex] ?? '—') : '—';
  const peakHour = summary.peakHourIndex !== null ? formatHour(summary.peakHourIndex) : '—';

  return (
    <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
      <header className="mb-1">
        <h2 className="text-xl font-semibold text-brand-deep">Votre audience</h2>
        <p className="text-sm text-gray-500">
          Le profil d’affluence type de votre établissement, par jour et par heure.
        </p>
      </header>

      {isFleet && venues.length > 1 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {venues.map((v) => {
            const active = v.id === selectedId;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => setSelectedId(v.id)}
                aria-pressed={active}
                className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary ${
                  active
                    ? 'bg-brand-deep text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {v.name}
              </button>
            );
          })}
        </div>
      )}

      <div className="mt-6">
        <AnimatePresence mode="wait">
          <motion.div
            key={selectedId ?? 'none'}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            {affluence.isLoading ? (
              <div className="flex items-center justify-center gap-2 py-12 text-gray-400">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="text-sm">Chargement de l’affluence…</span>
              </div>
            ) : affluence.isError ? (
              <div className="flex items-center justify-center gap-2 py-12 text-red-500">
                <AlertCircle className="h-5 w-5" />
                <span className="text-sm">Impossible de charger l’affluence.</span>
              </div>
            ) : !hasData ? (
              <div className="rounded-2xl border-2 border-dashed border-gray-200 px-6 py-12 text-center">
                <Users className="mx-auto h-8 w-8 text-gray-300" />
                <p className="mt-3 font-medium text-brand-deep">
                  Pas encore de données d’affluence
                </p>
                <p className="mt-1 text-sm text-gray-500">
                  Les données d’affluence apparaîtront ici dès que votre écran commence à collecter.
                </p>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <StatCard
                    icon={<CalendarDays className="h-4 w-4" />}
                    label="Jour le plus fréquenté"
                    value={peakDay}
                  />
                  <StatCard
                    icon={<Clock className="h-4 w-4" />}
                    label="Heure de pointe"
                    value={peakHour}
                  />
                  <StatCard
                    icon={<Users className="h-4 w-4" />}
                    label="Audience moyenne / jour"
                    value={summary.dailyAverage.toLocaleString('fr-FR')}
                  />
                  <StatCard
                    icon={<TrendingUp className="h-4 w-4" />}
                    label="Audience hebdomadaire"
                    value={summary.weeklyTotal.toLocaleString('fr-FR')}
                  />
                </div>
                <div>
                  <h3 className="mb-3 text-sm font-semibold text-gray-500">Affluence par jour</h3>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
                    {DAY_LABELS_SHORT.map((label, day) => {
                      const total = summary.dayTotals[day] ?? 0;
                      const isPeak = day === summary.peakDayIndex && total > 0;
                      return (
                        <div
                          key={label}
                          className={`rounded-xl border p-3 text-center ${
                            isPeak
                              ? 'border-brand-primary bg-brand-primary/10'
                              : 'border-gray-100 bg-gray-50/60'
                          }`}
                        >
                          <p className="text-xs font-medium text-gray-500">{label}</p>
                          <p className="mt-1 text-lg font-bold tabular-nums text-brand-deep">
                            {total.toLocaleString('fr-FR')}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </section>
  );
}
