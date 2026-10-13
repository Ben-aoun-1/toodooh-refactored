import { LayoutGrid, List } from 'lucide-react';

import type { PortfolioView } from '@/features/agent/stores/agent-view.store';

export function ViewToggle({
  view,
  onChange,
}: {
  view: PortfolioView;
  onChange: (v: PortfolioView) => void;
}) {
  const btn = (v: PortfolioView, label: string, Icon: typeof List) => (
    <button
      type="button"
      onClick={() => onChange(v)}
      aria-pressed={view === v}
      title={label}
      className={`rounded-md p-2 ${view === v ? 'bg-white shadow-sm text-brand-deep' : 'text-gray-500'}`}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
  return (
    <div className="flex rounded-lg bg-gray-100 p-1">
      {btn('cards', 'Vue cartes', LayoutGrid)}
      {btn('table', 'Vue tableau', List)}
    </div>
  );
}
