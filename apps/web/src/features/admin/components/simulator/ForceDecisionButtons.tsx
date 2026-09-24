import { useForceDecision } from '@/features/admin/hooks/useAdminSimulator';

// SIM-6 phase 3 — force an owner's answer on one pending allocation. It runs the REAL decision
// (a refusal cascades exactly like an owner's), so a redispatch scenario is one click away.

export function ForceDecisionButtons({
  simulationId,
  allocationId,
  statut,
}: {
  simulationId: string;
  allocationId: string;
  statut: string;
}) {
  const decide = useForceDecision(simulationId);
  if (statut !== 'EN_ATTENTE') return <>{statut}</>;
  return (
    <span className="flex items-center gap-1">
      {statut}
      <button
        type="button"
        disabled={decide.isPending}
        onClick={() => decide.mutate({ allocationId, statut: 'ACCEPTE' })}
        className="rounded bg-emerald-50 px-1 text-emerald-700 disabled:opacity-50"
      >
        Accepter
      </button>
      <button
        type="button"
        disabled={decide.isPending}
        onClick={() => decide.mutate({ allocationId, statut: 'REFUSE' })}
        className="rounded bg-red-50 px-1 text-red-700 disabled:opacity-50"
      >
        Refuser
      </button>
    </span>
  );
}
