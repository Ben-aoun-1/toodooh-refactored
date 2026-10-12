import { Banknote } from 'lucide-react';

import { revenueLabel } from '@/features/screenhost/services/screenhost-allocations.service';

/**
 * Operator 2026-10-12 — the decision popup leads with what the owner earns by accepting (their
 * share, plain TND like every screen). The amount comes from lib/decision-notifications.
 */
export default function DecisionRevenue({ amountTnd }: { amountTnd: number }) {
  return (
    <section className="flex items-center gap-3 rounded-xl border border-brand-primary bg-[#E8F8EE] p-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white">
        <Banknote className="h-5 w-5 text-[#1FC16B]" aria-hidden="true" />
      </div>
      <div className="flex min-w-0 flex-col">
        <span className="text-xs font-medium uppercase text-[#5C5C5C]">Ce que vous gagnez</span>
        <span className="text-lg font-semibold text-[#171717]">{revenueLabel(amountTnd)}</span>
      </div>
    </section>
  );
}
