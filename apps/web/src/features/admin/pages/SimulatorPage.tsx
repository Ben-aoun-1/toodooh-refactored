import { Gamepad2 } from 'lucide-react';
import { useState } from 'react';

import AdminLayout from '@/features/admin/components/AdminLayout';
import { CreateSimulationForm } from '@/features/admin/components/simulator/CreateSimulationForm';
import { SimulationDetail } from '@/features/admin/components/simulator/SimulationDetail';
import { SimulationList } from '@/features/admin/components/simulator/SimulationList';
import { useSimulations } from '@/features/admin/hooks/useAdminSimulator';
import { isSimulatorDisabled } from '@/features/admin/services/admin-simulator.service';

// SIM-0 — the shell. Later slices mount the living world here; this file stays a mount point.
export default function SimulatorPage() {
  const list = useSimulations();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const disabled = list.isError && isSimulatorDisabled(list.error);
  const simulations = list.data?.simulations ?? [];
  const max = list.data?.max ?? 0;
  const full = list.data ? simulations.filter((s) => s.status !== 'failed').length >= max : true;

  return (
    <AdminLayout title="Simulateur">
      <div className="mx-auto max-w-7xl space-y-4 p-4">
        <header className="flex items-center gap-3">
          <Gamepad2 className="h-6 w-6 text-brand-primary" />
          <div>
            <h1 className="text-xl font-semibold">Simulateur</h1>
            <p className="text-sm text-gray-500">
              Des mondes synthétiques, isolés dans leur propre base de données, sur lesquels
              tournent les vrais moteurs de la plateforme.
            </p>
          </div>
        </header>

        {disabled && (
          <p className="rounded-xl border bg-white p-4 text-sm text-gray-600">
            Le simulateur est désactivé sur ce serveur.
          </p>
        )}
        {list.isError && !disabled && (
          <p className="text-sm text-red-600">Impossible de charger les simulations.</p>
        )}

        {!disabled && (
          <div className="grid gap-4 md:grid-cols-[2fr_1fr]">
            <div className="space-y-4">
              <SimulationList
                simulations={simulations}
                max={max}
                selectedId={selectedId}
                onSelect={setSelectedId}
              />
              {selectedId && (
                <SimulationDetail id={selectedId} onDeleted={() => setSelectedId(null)} />
              )}
            </div>
            <CreateSimulationForm disabled={full} onCreated={setSelectedId} />
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
