import { fmt } from '@/features/admin/lib/testing-labels';
import type { Stats } from '@/features/admin/services/admin-testing.service';

// ADM-OBS1 — the two table shapes the « Tests » report is made of, moved out of
// TestingReportView (ADM-OBS2) when the view was split into sections.

export function KeyValues({ title, rows }: { title: string; rows: [string, string][] }) {
  return (
    <section className="rounded-xl border bg-white p-4">
      <h2 className="mb-2 text-sm font-semibold text-gray-700">{title}</h2>
      <table className="text-sm">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k} className="border-t">
              <td className="py-1 pr-6 text-gray-600">{k}</td>
              <td className="py-1 font-mono tabular-nums">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** min / médiane / moyenne / max of several series, one row each. */
export function StatsTable({ title, rows }: { title: string; rows: [string, Stats][] }) {
  return (
    <section className="rounded-xl border bg-white p-4">
      <h2 className="mb-2 text-sm font-semibold text-gray-700">{title}</h2>
      <table className="text-sm">
        <thead>
          <tr className="text-left text-gray-500">
            <th className="pr-4">série</th>
            <th className="pr-4">n</th>
            <th className="pr-4">min</th>
            <th className="pr-4">médiane</th>
            <th className="pr-4">moyenne</th>
            <th className="pr-4">max</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, s]) => (
            <tr key={label} className="border-t">
              <td className="py-1 pr-4 font-medium">{label}</td>
              <td className="py-1 pr-4 tabular-nums">{s.n}</td>
              <td className="py-1 pr-4 tabular-nums">{fmt(s.min)}</td>
              <td className="py-1 pr-4 tabular-nums">{fmt(s.median)}</td>
              <td className="py-1 pr-4 tabular-nums">{fmt(s.mean)}</td>
              <td className="py-1 pr-4 tabular-nums">{fmt(s.max)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
