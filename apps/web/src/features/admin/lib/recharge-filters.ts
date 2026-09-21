import type { AdminRecharge } from '@/features/admin/services/admin-recharges.service';
import {
  RECHARGE_TYPES,
  RECHARGE_TYPE_LABELS,
  adminStatusFilterLabels,
  methodLabel,
  rechargeTypeOf,
  statusLabel,
  type RechargeMethod,
  type RechargeType,
} from '@/features/wallet/lib/recharge-methods';

// RECH-ADM1 — the admin Recharges filters, pure (the page only holds the state). Rulings T1–T4 A:
// a TYPE filter (VIR / BC / FCT, derived from the method); a STATUS filter whose options follow the
// type (the labels come from the one label home, wallet/lib/recharge-methods); a SCREENCASTER
// filter over the screencasters present in the list, named by the api's advertiser_label; the
// stat cards are computed over the filtered rows. The search stays on the reference (US-FCT-7).
// Everything stays client-side over the one GET /api/admin/recharges list.

export type RechargeTypeFilter = RechargeType | 'all';

export interface RechargeFilters {
  type: RechargeTypeFilter;
  /** A status DISPLAY label (the per-type chip words — FCT1), or 'all'. */
  status: string;
  /** A screencaster (advertiser) id, or 'all'. */
  screencaster: string;
  /** Free text matched against the reference only. */
  search: string;
}

export const DEFAULT_RECHARGE_FILTERS: RechargeFilters = {
  type: 'all',
  status: 'all',
  screencaster: 'all',
  search: '',
};

type FilterableRecharge = Pick<AdminRecharge, 'method' | 'status' | 'reference' | 'advertiser_id'>;

const matches = (row: FilterableRecharge, filters: RechargeFilters, needle: string): boolean =>
  (filters.type === 'all' || rechargeTypeOf(row.method) === filters.type) &&
  (filters.status === 'all' || statusLabel(row.method, row.status) === filters.status) &&
  (filters.screencaster === 'all' || row.advertiser_id === filters.screencaster) &&
  (needle === '' || row.reference.toLowerCase().includes(needle));

export const filterRecharges = <T extends FilterableRecharge>(
  rows: readonly T[],
  filters: RechargeFilters,
): T[] => {
  const needle = filters.search.trim().toLowerCase();
  return rows.filter((row) => matches(row, filters, needle));
};

/**
 * T2 — choosing a type keeps the chosen status only while the new type still offers it
 * (« Annulée » survives every switch); otherwise it falls back to « Tous les statuts ». The
 * filter can never hold a type × status pair that matches nothing by construction.
 */
export const withRechargeType = (
  filters: RechargeFilters,
  type: RechargeTypeFilter,
): RechargeFilters => ({
  ...filters,
  type,
  status:
    filters.status === 'all' || adminStatusFilterLabels(type).includes(filters.status)
      ? filters.status
      : 'all',
});

/**
 * The admin Type column (the table and the details modal). A legacy row (method NULL) is named with
 * the type filter's own word, « Ancien format (FCT) », so the column and the filter agree; a method
 * row keeps its method label. Admin-side on purpose: the screencaster's MyRecharges shares
 * methodLabel and keeps its « — ».
 */
export const adminRechargeTypeLabel = (method: RechargeMethod | null): string =>
  method === null ? RECHARGE_TYPE_LABELS.FCT : methodLabel(method);

/** The type <select> value, narrowed without a cast; an unknown value reads as « Tous les types ». */
export const parseRechargeTypeFilter = (value: string): RechargeTypeFilter =>
  RECHARGE_TYPES.find((type) => type === value) ?? 'all';

export interface ScreencasterOption {
  id: string;
  label: string;
}

/**
 * T3 — one option per screencaster PRESENT in the list, labelled with the api's advertiser_label
 * (ADM-FIX1's one label), alphabetical. Two screencasters sharing a label are told apart by their
 * email (unique), so the dropdown never offers two identical entries.
 */
export const screencasterOptions = (
  rows: readonly Pick<AdminRecharge, 'advertiser_id' | 'advertiser_label' | 'advertiser_email'>[],
): ScreencasterOption[] => {
  const byId = new Map<string, { label: string; email: string }>();
  for (const row of rows) {
    if (!byId.has(row.advertiser_id)) {
      byId.set(row.advertiser_id, { label: row.advertiser_label, email: row.advertiser_email });
    }
  }
  const labelCount = new Map<string, number>();
  for (const { label } of byId.values()) labelCount.set(label, (labelCount.get(label) ?? 0) + 1);
  return [...byId.entries()]
    .map(([id, { label, email }]) => ({
      id,
      label: (labelCount.get(label) ?? 0) > 1 && email !== '' ? `${label} (${email})` : label,
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'fr'));
};
