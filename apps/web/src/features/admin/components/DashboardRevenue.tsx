import { Banknote, BarChart3, TrendingUp } from 'lucide-react';

import { revenueFigures } from '@/features/admin/lib/admin-dashboard';
import type { PlatformStats } from '@/features/admin/types/platform-stats';

// DASH-1 — the dashboard's « Revenus » block (operator rulings R1–R3, 2026-09-21), all HT:
//   « Revenu Toodooh » (was « Revenu Total », a sum of confirmed RECHARGES) = Toodooh's 44 % lines
//   + the settled spend no line split (the sub-S_min undelivered value — R2 amended), so Toodooh
//   + screenhosts + agents = « Revenu total »; « Revenu mensuel » = both figures over the current
//   Tunis month; « Revenu total » (was « Budget Campagnes », the requested budgets of every
//   status) = settled spend.
// The formulas live in the api (routes/admin-platform-stats.ts); this only renders them, through
// revenueFigures — the deploy-window guard: a part an older api does not send renders « — ».
export default function DashboardRevenue({
  revenue,
}: {
  revenue: PlatformStats['revenue'] | undefined;
}) {
  const figures = revenueFigures(revenue);
  return (
    <div className="mb-6">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">💰 Revenus Globaux</h3>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-gradient-to-br from-green-500 to-green-600 rounded-xl shadow-sm p-6 text-white">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-green-100">Revenu Toodooh</p>
              <p className="text-3xl font-bold mt-2">{figures.toodooh}</p>
            </div>
            <Banknote className="h-12 w-12 text-green-200" />
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between gap-4">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-600">
                Revenu mensuel · {figures.monthLabel}
              </p>
              <dl className="mt-2 space-y-1">
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="text-sm text-gray-600">Total</dt>
                  <dd className="text-lg font-bold text-gray-900">{figures.monthlyTotal}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="text-sm text-gray-600">Toodooh</dt>
                  <dd className="text-lg font-bold text-gray-900">{figures.monthlyToodooh}</dd>
                </div>
              </dl>
            </div>
            <TrendingUp className="h-10 w-10 text-green-500 shrink-0" />
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Revenu total</p>
              <p className="text-2xl font-bold text-gray-900 mt-2">{figures.total}</p>
            </div>
            <BarChart3 className="h-10 w-10 text-purple-500" />
          </div>
        </div>
      </div>
    </div>
  );
}
