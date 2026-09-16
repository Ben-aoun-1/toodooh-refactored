import { FlaskConical, Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';

import AdminLayout from '@/features/admin/components/AdminLayout';
import { TestingReportView } from '@/features/admin/components/TestingReportView';
import { useTestingReport, useTestingScreenhosts } from '@/features/admin/hooks/useAdminTesting';

// ADM-OBS1 slice A — « Tests »: every variable the engines compute for ONE screenhost over ANY
// période, side by side, plus the raw cells and the raw JSON. Read-only. The numbers are the api's
// own (periodAudience / computeSps / computeAmax / dispatch config) — if this page and « Mes
// performances » disagree, the product page is the bug. No product copy here; it is a bench.

const isoDaysAgo = (days: number): string => {
  const d = new Date(Date.now() + 60 * 60 * 1000 - days * 86_400_000); // Tunis day (UTC+1)
  return d.toISOString().slice(0, 10);
};

export default function TestingPage() {
  const list = useTestingScreenhosts();
  const [venueId, setVenueId] = useState<string | null>(null);
  const [from, setFrom] = useState(isoDaysAgo(27));
  const [to, setTo] = useState(isoDaysAgo(0));
  const report = useTestingReport(venueId, from, to);
  const venues = useMemo(() => list.data?.screenhosts ?? [], [list.data]);

  return (
    <AdminLayout title="Tests">
      <div className="mx-auto max-w-7xl space-y-4 p-4">
        <header className="flex items-center gap-3">
          <FlaskConical className="h-6 w-6 text-brand-primary" />
          <div>
            <h1 className="text-xl font-semibold">Tests — variables par screenhost</h1>
            <p className="text-sm text-gray-500">
              Lecture seule. Les chiffres viennent des moteurs de la plateforme (audience, SPS,
              pricing) pour la période choisie, sans recalcul côté page.
            </p>
          </div>
        </header>

        <div className="flex flex-wrap items-end gap-3 rounded-xl border bg-white p-4">
          <label className="text-sm">
            <span className="block text-gray-600">Screenhost</span>
            <select
              className="mt-1 rounded-lg border px-3 py-2"
              value={venueId ?? ''}
              onChange={(e) => setVenueId(e.target.value || null)}
            >
              <option value="">— choisir —</option>
              {venues.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="block text-gray-600">Du</span>
            <input
              type="date"
              className="mt-1 rounded-lg border px-3 py-2"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label className="text-sm">
            <span className="block text-gray-600">Au</span>
            <input
              type="date"
              className="mt-1 rounded-lg border px-3 py-2"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
          {from > to && <span className="text-sm text-red-600">« Du » doit précéder « Au »</span>}
          {report.isFetching && <Loader2 className="h-5 w-5 animate-spin text-gray-400" />}
        </div>

        {list.isError && (
          <p className="text-sm text-red-600">Impossible de charger la liste des screenhosts.</p>
        )}
        {report.isError && (
          <p className="text-sm text-red-600">Impossible de charger le rapport.</p>
        )}
        {!venueId && (
          <p className="text-sm text-gray-500">
            Choisis un screenhost pour afficher ses variables.
          </p>
        )}
        {report.data && <TestingReportView r={report.data} />}
      </div>
    </AdminLayout>
  );
}
