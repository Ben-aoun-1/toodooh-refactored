import { Filter, Layers, Search, User } from 'lucide-react';

import {
  parseRechargeTypeFilter,
  withRechargeType,
  type RechargeFilters,
  type ScreencasterOption,
} from '@/features/admin/lib/recharge-filters';
import {
  RECHARGE_TYPES,
  RECHARGE_TYPE_LABELS,
  adminStatusFilterLabels,
} from '@/features/wallet/lib/recharge-methods';

// RECH-ADM1 — the admin Recharges filter bar: Type (T1), Statut following the type (T2),
// Screencaster (T3), and the reference search (US-FCT-7). Presentational only — the rules live in
// admin/lib/recharge-filters and the labels in wallet/lib/recharge-methods.

interface RechargeFiltersPanelProps {
  filters: RechargeFilters;
  screencasters: readonly ScreencasterOption[];
  onChange: (next: RechargeFilters) => void;
}

const LABEL_CLASS = 'block text-sm font-medium text-gray-700 mb-2';
const CONTROL_CLASS =
  'w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-primary focus:border-transparent';

export default function RechargeFiltersPanel({
  filters,
  screencasters,
  onChange,
}: RechargeFiltersPanelProps) {
  return (
    <div className="bg-white rounded-xl shadow-md p-6 mb-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div>
          <label className={LABEL_CLASS} htmlFor="type-filter">
            <Layers className="inline h-4 w-4 mr-1" />
            Type
          </label>
          <select
            value={filters.type}
            onChange={(e) =>
              onChange(withRechargeType(filters, parseRechargeTypeFilter(e.target.value)))
            }
            className={CONTROL_CLASS}
            id="type-filter"
          >
            <option value="all">Tous les types</option>
            {RECHARGE_TYPES.map((type) => (
              <option key={type} value={type}>
                {RECHARGE_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={LABEL_CLASS} htmlFor="status-filter">
            <Filter className="inline h-4 w-4 mr-1" />
            Statut
          </label>
          <select
            value={filters.status}
            onChange={(e) => onChange({ ...filters, status: e.target.value })}
            className={CONTROL_CLASS}
            id="status-filter"
          >
            <option value="all">Tous les statuts</option>
            {adminStatusFilterLabels(filters.type).map((label) => (
              <option key={label} value={label}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={LABEL_CLASS} htmlFor="screencaster-filter">
            <User className="inline h-4 w-4 mr-1" />
            Screencaster
          </label>
          <select
            value={filters.screencaster}
            onChange={(e) => onChange({ ...filters, screencaster: e.target.value })}
            className={CONTROL_CLASS}
            id="screencaster-filter"
          >
            <option value="all">Tous les screencasters</option>
            {screencasters.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={LABEL_CLASS} htmlFor="search-term">
            <Search className="inline h-4 w-4 mr-1" />
            Rechercher par référence
          </label>
          <input
            type="text"
            value={filters.search}
            onChange={(e) => onChange({ ...filters, search: e.target.value })}
            placeholder="Rechercher une référence..."
            className={CONTROL_CLASS}
            id="search-term"
          />
        </div>
      </div>
    </div>
  );
}
