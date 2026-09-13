import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Loader2, Pause, Play, Rewind } from 'lucide-react';
import { useEffect, useState } from 'react';

import { useTick } from '@/features/admin/hooks/useAdminSimulator';
import type { BoardState, TickCounters } from '@/features/admin/services/admin-simulator.service';

interface Props {
  simulationId: string;
  board: BoardState | undefined;
  live: boolean;
  onLiveChange: (live: boolean) => void;
}

const JUMPS: { label: string; hours: number }[] = [
  { label: '+1 h', hours: 1 },
  { label: '+6 h', hours: 6 },
  { label: '+1 jour', hours: 24 },
  { label: '+1 semaine', hours: 168 },
];

/** The speeds of the auto-run: virtual hours per real second. */
const SPEEDS = [
  { label: '×1', hours: 1, everyMs: 1000 },
  { label: '×6', hours: 6, everyMs: 1000 },
  { label: '×24', hours: 24, everyMs: 1000 },
];

const HIGHLIGHTS: { key: keyof TickCounters; label: string }[] = [
  { key: 'accepted', label: 'acceptées' },
  { key: 'refused', label: 'refusées' },
  { key: 'proofs', label: 'diffusions' },
  { key: 'activated', label: 'activées' },
  { key: 'completed', label: 'terminées' },
  { key: 'redispatch_rounds', label: 'rattrapages' },
];

export function ClockBar({ simulationId, board, live, onLiveChange }: Props) {
  const tick = useTick(simulationId);
  const [speed, setSpeed] = useState(0);

  // The auto-run: one tick at a time, never overlapping — the next is scheduled only once the
  // previous has come back, so a slow hour slows the clock instead of queueing up behind it.
  useEffect(() => {
    if (!live || tick.isPending) return undefined;
    const config = SPEEDS[speed] ?? SPEEDS[0]!;
    const timer = setTimeout(() => tick.mutate(config.hours), config.everyMs);
    return () => clearTimeout(timer);
  }, [live, speed, tick]);

  const clock = board?.clock;
  const counters = tick.data?.counters;

  return (
    <section className="space-y-3 rounded-xl border bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-gray-500">Horloge virtuelle</p>
          <p className="text-lg font-semibold">
            {clock ? format(new Date(clock.at), "EEEE dd MMMM yyyy — HH'h'", { locale: fr }) : '—'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onLiveChange(!live)}
            className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium ${
              live ? 'bg-red-600 text-white' : 'bg-brand-primary text-brand-deep'
            }`}
          >
            {live ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            {live ? 'Pause' : 'Lancer'}
          </button>
          <div className="flex overflow-hidden rounded-lg border">
            {SPEEDS.map((s, i) => (
              <button
                key={s.label}
                type="button"
                onClick={() => setSpeed(i)}
                className={`px-2 py-2 text-sm ${
                  speed === i ? 'bg-brand-primary/20 font-medium' : 'hover:bg-gray-50'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
          {JUMPS.map((jump) => (
            <button
              key={jump.label}
              type="button"
              disabled={tick.isPending || live}
              onClick={() => tick.mutate(jump.hours)}
              className="rounded-lg border px-3 py-2 text-sm disabled:opacity-50"
            >
              {jump.label}
            </button>
          ))}
          {tick.isPending && <Loader2 className="h-5 w-5 animate-spin text-gray-400" />}
        </div>
      </div>

      {tick.isError && (
        <p className="flex items-center gap-2 text-sm text-red-600">
          <Rewind className="h-4 w-4" />
          {tick.error instanceof Error ? tick.error.message : 'Le tick a échoué.'}
        </p>
      )}

      {counters && (
        <ul className="flex flex-wrap gap-3 text-sm">
          {HIGHLIGHTS.filter((h) => (counters[h.key] ?? 0) > 0).map((h) => (
            <li key={h.key} className="rounded-full bg-gray-100 px-3 py-1">
              <span className="font-semibold">{counters[h.key]}</span> {h.label}
            </li>
          ))}
          {HIGHLIGHTS.every((h) => (counters[h.key] ?? 0) === 0) && (
            <li className="text-gray-500">Heure calme.</li>
          )}
        </ul>
      )}
    </section>
  );
}
