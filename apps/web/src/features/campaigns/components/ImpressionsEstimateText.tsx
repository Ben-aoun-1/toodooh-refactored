import type { EstimateView } from '@/features/campaigns/lib/impressions-estimate';

/**
 * IMP-EST1 — an estimate as INLINE content for the caller's own figure element: the text
 * (« … », the number or « — ») and, when there is no estimate, its reason on a line of its own.
 */
export default function ImpressionsEstimateText({ view }: { view: EstimateView }) {
  return (
    <>
      {view.text}
      {view.reason !== null && (
        <span className="mt-0.5 block text-xs font-normal text-gray-500">{view.reason}</span>
      )}
    </>
  );
}
