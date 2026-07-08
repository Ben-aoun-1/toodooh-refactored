/** The mockups' shared empty-state vocabulary (Lane F) — one source for the copy. */
export const PENDING_LABEL = 'En attente du premier deal';
export const CHART_PENDING_LABEL = 'Évolution en attente du premier deal';

/** A KPI slot whose data has not arrived yet — the mockups' `--pending` italic treatment. */
export function PendingValue() {
  return <span className="text-base font-semibold italic text-perf-mist">{PENDING_LABEL}</span>;
}

/** The mockups' `.chart-placeholder` — dashed card-alt box; aspect comes from the caller. */
export function ChartPlaceholder({ className = '' }: { className?: string }) {
  return (
    <div
      className={`flex w-full items-center justify-center rounded-[10px] border border-dashed border-perf-soft bg-[#F6F8FA] p-5 text-center text-[13px] italic text-perf-mist ${className}`}
    >
      {CHART_PENDING_LABEL}
    </div>
  );
}
