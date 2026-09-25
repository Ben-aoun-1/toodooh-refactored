import { useState } from 'react';

import { useOwnerBehaviour } from '@/features/admin/hooks/useAdminSimulator';

// SIM-6 phase 3 — how a simulated owner answers proposals: the acceptance rate and the delay
// before answering. The behaviour lives in MAIN (simulation_actors); the next ticks apply it.

export function OwnerBehaviourEditor({
  simulationId,
  ownerId,
  acceptanceRate,
  responseDelayHours,
}: {
  simulationId: string;
  ownerId: string;
  acceptanceRate: number | null;
  responseDelayHours: number | null;
}) {
  const save = useOwnerBehaviour(simulationId);
  const [pct, setPct] = useState(Math.round((acceptanceRate ?? 0.8) * 100));
  const [delay, setDelay] = useState(responseDelayHours ?? 4);
  return (
    <span className="flex items-center gap-1 text-xs">
      <input
        type="number"
        min={0}
        max={100}
        value={pct}
        onChange={(e) => setPct(Number(e.target.value))}
        className="w-14 rounded border px-1"
        title="Taux d'acceptation (%)"
      />
      %
      <input
        type="number"
        min={1}
        max={72}
        value={delay}
        onChange={(e) => setDelay(Number(e.target.value))}
        className="w-12 rounded border px-1"
        title="Délai de réponse (h)"
      />
      h
      <button
        type="button"
        disabled={save.isPending}
        onClick={() =>
          save.mutate({
            ownerId,
            params: { acceptance_rate: pct / 100, response_delay_hours: delay },
          })
        }
        className="rounded bg-gray-100 px-1.5 py-0.5 disabled:opacity-50"
      >
        {save.isSuccess ? 'Appliqué' : 'Appliquer'}
      </button>
    </span>
  );
}
