import { TAB_LABELS, tabCount } from '@/features/network/lib/network-copy';
import {
  CSP_LABELS,
  CSP_ORDER,
  type NetworkCategory,
  type NetworkCounts,
  type NetworkFilters,
} from '@/features/network/lib/network-entries';
import type { NetworkCsp } from '@/features/network/services/network.api';

import { SearchIcon } from './NetworkIcons';

interface NetworkToolbarProps {
  filters: NetworkFilters;
  onChange: (patch: Partial<NetworkFilters>) => void;
  counts: NetworkCounts;
  searchLabel: string;
  regions: string[];
  categories: NetworkCategory[];
  quartiers: string[];
}

function isCsp(value: string): value is NetworkCsp {
  return CSP_ORDER.some((csp) => csp === value);
}

/** Tabs Tous / Inclus / Exclus, the search and the four selects (options from the data). */
export default function NetworkToolbar({
  filters,
  onChange,
  counts,
  searchLabel,
  regions,
  categories,
  quartiers,
}: NetworkToolbarProps) {
  return (
    <div className="tools">
      <div className="tabs" role="group" aria-label="Filtrer par statut">
        {TAB_LABELS.map(([tab, label]) => (
          <button
            key={tab}
            type="button"
            aria-pressed={filters.tab === tab}
            onClick={() => onChange({ tab })}
          >
            {label}
            <span>{tabCount(tab, counts)}</span>
          </button>
        ))}
      </div>
      <label className="search">
        <SearchIcon />
        <span className="sr">{searchLabel}</span>
        <input
          type="search"
          placeholder="Rechercher..."
          value={filters.search}
          onChange={(e) => onChange({ search: e.target.value })}
        />
      </label>
      <select
        aria-label="Région"
        value={filters.region}
        onChange={(e) => onChange({ region: e.target.value })}
      >
        <option value="">Toutes les régions</option>
        {regions.map((region) => (
          <option key={region}>{region}</option>
        ))}
      </select>
      <select
        aria-label="Catégorie"
        value={filters.categoryId}
        onChange={(e) => onChange({ categoryId: e.target.value })}
      >
        <option value="">Toutes les catégories</option>
        {categories.map((category) => (
          <option key={category.id} value={category.id}>
            {category.plural}
          </option>
        ))}
      </select>
      <select
        aria-label="Quartier"
        value={filters.quartier}
        onChange={(e) => onChange({ quartier: e.target.value })}
      >
        <option value="">Tous les quartiers</option>
        {quartiers.map((quartier) => (
          <option key={quartier}>{quartier}</option>
        ))}
      </select>
      <select
        aria-label="CSP"
        value={filters.csp}
        onChange={(e) => onChange({ csp: isCsp(e.target.value) ? e.target.value : '' })}
      >
        <option value="">Toutes les CSP</option>
        {CSP_ORDER.map((csp) => (
          <option key={csp} value={csp}>
            {CSP_LABELS[csp]}
          </option>
        ))}
      </select>
    </div>
  );
}
