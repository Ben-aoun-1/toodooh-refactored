/** The mockups' shared empty-state vocabulary (Lane F) — one source for the copy. */
export const PENDING_LABEL = 'En attente du premier deal';
export const CHART_PENDING_LABEL = 'Évolution en attente du premier deal';

/** A KPI slot whose data has not arrived yet — the muted italic treatment of the EMPTY mockup. */
export function PendingValue() {
  return <span className="text-sm font-medium italic text-gray-400">{PENDING_LABEL}</span>;
}

/** The dashed chart placeholder of the EMPTY mockup. */
export function ChartPlaceholder() {
  return (
    <div className="flex h-44 items-center justify-center rounded-xl border-2 border-dashed border-gray-200 text-sm italic text-gray-400">
      {CHART_PENDING_LABEL}
    </div>
  );
}
