import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import type { ReactNode } from 'react';

import { variationLabel } from '@/features/agent/lib/agent-portfolio';

/** Blocks 3–6: a figure and its year-on-year variation (hidden while null — spec §4 « Variation »). */
export function KpiCard({
  label,
  value,
  variationPct,
  icon,
}: {
  label: string;
  value: string;
  variationPct: number | null;
  icon: ReactNode;
}) {
  const v = variationLabel(variationPct);
  return (
    <div className="flex min-h-[120px] flex-col rounded-xl border border-[#E1E4EA] bg-white p-5">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm text-gray-600">{label}</p>
        <span className="text-gray-400">{icon}</span>
      </div>
      <p className="mt-2 text-2xl font-bold tabular-nums text-gray-900">{value}</p>
      {v && (
        <p
          className={`mt-auto flex items-center gap-1 pt-2 text-xs font-medium ${v.up ? 'text-emerald-600' : 'text-red-600'}`}
        >
          {v.up ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />}
          {v.text} vs l’an dernier
        </p>
      )}
    </div>
  );
}
