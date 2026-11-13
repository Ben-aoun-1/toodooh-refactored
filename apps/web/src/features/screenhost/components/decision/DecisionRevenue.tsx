import { Banknote } from 'lucide-react';

import { revenueLabel } from '@/features/screenhost/services/screenhost-allocations.service';

/**
 * Operator 2026-10-12 — the decision popup leads with what the owner earns by accepting (their
 * share, plain TND like every screen). The amount comes from lib/decision-notifications. Mariem
 * 05/11 — the « Soir de match » popup words it for the match and counts its spots (`badge`).
 */
export default function DecisionRevenue({
  amountTnd,
  label = 'Ce que vous gagnez',
  amountLabel = revenueLabel(amountTnd),
  badge,
}: {
  amountTnd: number;
  label?: string;
  /** The amount as written; the plain TND of every screen by default. */
  amountLabel?: string;
  badge?: string;
}) {
  return (
    <section className="flex flex-wrap items-center gap-3 rounded-xl border border-brand-primary bg-[#E8F8EE] p-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white">
        <Banknote className="h-5 w-5 text-[#1FC16B]" aria-hidden="true" />
      </div>
      <div className="flex min-w-0 flex-col">
        <span className="text-xs font-medium uppercase text-[#5C5C5C]">{label}</span>
        <span className="text-lg font-semibold text-[#171717]">{amountLabel}</span>
      </div>
      {badge ? (
        <span className="ml-auto rounded-full border border-brand-primary bg-white px-2.5 py-0.5 text-xs font-semibold text-brand-deep">
          {badge}
        </span>
      ) : null}
    </section>
  );
}
