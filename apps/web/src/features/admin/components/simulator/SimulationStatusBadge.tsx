import type { SimulationStatus } from '@/features/admin/services/admin-simulator.service';

const LABEL: Record<SimulationStatus, string> = {
  creating: 'Création…',
  ready: 'Prête',
  failed: 'Échec',
  deleting: 'Suppression…',
};
const CLASS: Record<SimulationStatus, string> = {
  creating: 'bg-amber-100 text-amber-800',
  ready: 'bg-emerald-100 text-emerald-800',
  failed: 'bg-red-100 text-red-800',
  deleting: 'bg-gray-100 text-gray-700',
};

export function SimulationStatusBadge({ status }: { status: SimulationStatus }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${CLASS[status]}`}>
      {LABEL[status]}
    </span>
  );
}
