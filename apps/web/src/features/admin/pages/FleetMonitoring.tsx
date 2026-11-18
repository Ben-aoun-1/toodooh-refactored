import { AlertTriangle, Loader2, Search } from 'lucide-react';
import { useState } from 'react';

import AdminLayout from '@/features/admin/components/AdminLayout';
import FleetScreenPanel from '@/features/admin/components/FleetScreenPanel';
import { useFleet } from '@/features/admin/hooks/useFleet';
import {
  COUNTER_STATUSES,
  type FleetFilters,
  STATUS_META,
  STATUS_ORDER,
  countByStatus,
  filterFleet,
  sinceLabel,
  statusSentence,
  todayRatio,
  zonesOf,
} from '@/features/admin/lib/fleet';
import { ISSUE_LABEL, isBlockingIssue } from '@/features/admin/lib/fleet-health';
import type { FleetStatus } from '@/features/admin/services/admin-fleet.service';

/**
 * FLEET-1 (operator 18/11, phase 1) — « Parc d'écrans »: every TV's state in one word and one
 * sentence, most urgent first; click a row for its day hour by hour and its campaigns.
 */
export default function FleetMonitoring() {
  const fleet = useFleet();
  const [filters, setFilters] = useState<FleetFilters>({ status: 'all', zone: 'all', search: '' });
  const [openId, setOpenId] = useState<string | null>(null);
  const screens = fleet.data?.screens ?? [];
  const now = fleet.data ? new Date(fleet.data.computed_at) : new Date();
  const counts = countByStatus(screens);
  const rows = filterFleet(screens, filters);
  const toggleStatus = (status: FleetStatus) =>
    setFilters((f) => ({ ...f, status: f.status === status ? 'all' : status }));

  return (
    <AdminLayout
      title="Parc d’écrans"
      subtitle="L’état de chaque TV et ce qu’elle diffuse, en direct"
    >
      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {COUNTER_STATUSES.map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => toggleStatus(st)}
              className={`rounded-xl border bg-white p-4 text-left transition-shadow hover:shadow-md ${
                filters.status === st
                  ? 'border-brand-deep ring-2 ring-brand-deep/20'
                  : 'border-gray-200'
              }`}
            >
              <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
                <span className={`h-2.5 w-2.5 rounded-full ${STATUS_META[st].dot}`} />
                {STATUS_META[st].label}
              </div>
              <div className="mt-2 text-3xl font-semibold text-gray-900">{counts[st]}</div>
              <p className="mt-1 text-xs text-gray-500">{STATUS_META[st].hint}</p>
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4 md:flex-row md:items-center">
          <label className="relative flex-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
            <input
              value={filters.search}
              onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
              placeholder="Lieu, écran ou campagne"
              className="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-sm"
            />
          </label>
          <select
            value={filters.status}
            onChange={(e) => {
              const status = STATUS_ORDER.find((s) => s === e.target.value) ?? 'all';
              setFilters((f) => ({ ...f, status }));
            }}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="all">Tous les états ({screens.length})</option>
            {STATUS_ORDER.map((st) => (
              <option key={st} value={st}>
                {STATUS_META[st].label} ({counts[st]})
              </option>
            ))}
          </select>
          <select
            value={filters.zone}
            onChange={(e) => setFilters((f) => ({ ...f, zone: e.target.value }))}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="all">Toutes les zones</option>
            {zonesOf(screens).map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        </div>

        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          {fleet.isLoading ? (
            <div className="flex justify-center p-10 text-gray-400">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : rows.length === 0 ? (
            <p className="p-8 text-center text-sm text-gray-500">
              Aucun écran ne correspond à ces filtres.
            </p>
          ) : (
            <table className="w-full min-w-[48rem] text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3">Écran</th>
                  <th className="px-4 py-3">État</th>
                  <th className="px-4 py-3">Aujourd’hui</th>
                  <th className="px-4 py-3">Dernier signal</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((s) => (
                  <tr
                    key={s.id}
                    onClick={() => setOpenId(s.id)}
                    className="cursor-pointer hover:bg-gray-50"
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">
                        {s.venue.name} · {s.name}
                      </div>
                      <div className="text-xs text-gray-500">{s.venue.zone ?? 'Sans zone'}</div>
                      {s.issues.filter((i) => i !== 'unknown_version').length > 0 && (
                        <div
                          className={`mt-1 inline-flex items-center gap-1 text-xs ${s.issues.some(isBlockingIssue) ? 'text-red-700' : 'text-amber-700'}`}
                          title={s.issues.map((i) => ISSUE_LABEL[i]).join(' · ')}
                        >
                          <AlertTriangle className="h-3.5 w-3.5" />
                          {ISSUE_LABEL[s.issues.find(isBlockingIssue) ?? s.issues[0] ?? 'outdated']}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_META[s.status].chip}`}
                      >
                        {STATUS_META[s.status].label}
                      </span>
                      <div className="mt-1 text-xs text-gray-600">{statusSentence(s, now)}</div>
                    </td>
                    <td className="px-4 py-3">
                      {s.today.planned_total > 0 ? (
                        <>
                          <div className="h-2 w-32 overflow-hidden rounded-full bg-gray-100">
                            <div
                              className="h-full rounded-full bg-brand-primary"
                              style={{ width: `${Math.round(todayRatio(s) * 100)}%` }}
                            />
                          </div>
                          <div className="mt-1 text-xs text-gray-600">
                            {s.today.aired} / {s.today.planned_so_far} prévus à cette heure
                          </div>
                        </>
                      ) : (
                        <span className="text-xs text-gray-400">Rien de prévu aujourd’hui</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">
                      {sinceLabel(s.last_seen_at, now)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <p className="text-xs text-gray-400">Actualisé toutes les 30 secondes.</p>
      </div>
      {openId && <FleetScreenPanel screenId={openId} onClose={() => setOpenId(null)} />}
    </AdminLayout>
  );
}
