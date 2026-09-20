import { addDays, format, parseISO } from 'date-fns';
import { Loader2, X } from 'lucide-react';
import { useState } from 'react';

import { AllHistoryButton } from '@/features/admin/components/testing/AllHistoryButton';
import { TestingReportView } from '@/features/admin/components/TestingReportView';
import { useSimulationVenueReport } from '@/features/admin/hooks/useAdminSimulator';

// SIM-5 — the « Tests » report of a sandbox venue: every variable the engines compute (audience,
// SPS and its evidence, A_max, dispatch config, status per hour, campaigns on the venue), read at
// the simulation's VIRTUAL instant. Same view as Admin → Tests, other database, other clock.

interface Props {
  simulationId: string;
  venueId: string;
  venueName: string;
  /** The virtual day (YYYY-MM-DD) the simulation clock stands on. */
  virtualToday: string;
  onClose: () => void;
}

const shift = (iso: string, days: number): string =>
  format(addDays(parseISO(iso), days), 'yyyy-MM-dd');

export function SimulationVenueInspector({
  simulationId,
  venueId,
  venueName,
  virtualToday,
  onClose,
}: Props) {
  const [from, setFrom] = useState(shift(virtualToday, -27));
  const [to, setTo] = useState(virtualToday);
  const report = useSimulationVenueReport(simulationId, venueId, from, to);

  return (
    <section className="space-y-3 rounded-xl border-2 border-brand-primary/40 bg-white p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">Inspecteur — {venueName}</h2>
          <p className="text-xs text-gray-500">
            Les variables calculées par les moteurs, comme sur la page Tests, à l&apos;heure
            virtuelle de la simulation.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border p-1.5 text-gray-500 hover:bg-gray-50"
          aria-label="Fermer l'inspecteur"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="block text-xs text-gray-600">Du</span>
          <input
            type="date"
            className="mt-1 rounded-lg border px-3 py-1.5"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label className="text-sm">
          <span className="block text-xs text-gray-600">Au</span>
          <input
            type="date"
            className="mt-1 rounded-lg border px-3 py-1.5"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <AllHistoryButton
          createdDate={report.data?.periode.created_date ?? null}
          today={virtualToday}
          from={from}
          to={to}
          onPick={(f, t) => {
            setFrom(f);
            setTo(t);
          }}
        />
        {from > to && <span className="text-sm text-red-600">« Du » doit précéder « Au »</span>}
        {report.isFetching && <Loader2 className="h-5 w-5 animate-spin text-gray-400" />}
      </div>

      {report.isError && <p className="text-sm text-red-600">Impossible de charger le rapport.</p>}
      {report.data && <TestingReportView r={report.data} />}
    </section>
  );
}
