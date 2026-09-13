import { format, formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';

import type { Simulation } from '@/features/admin/services/admin-simulator.service';

import { SimulationStatusBadge } from './SimulationStatusBadge';

interface Props {
  simulations: Simulation[];
  max: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function SimulationList({ simulations, max, selectedId, onSelect }: Props) {
  return (
    <section className="rounded-xl border bg-white p-4">
      <h2 className="mb-2 text-sm font-semibold text-gray-700">
        Simulations ({simulations.length}/{max})
      </h2>
      {simulations.length === 0 && (
        <p className="text-sm text-gray-500">Aucune simulation. Crée la première ci-contre.</p>
      )}
      <ul className="divide-y">
        {simulations.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => onSelect(s.id)}
              className={`flex w-full flex-wrap items-center justify-between gap-3 px-2 py-2 text-left text-sm hover:bg-gray-50 ${
                selectedId === s.id ? 'bg-brand-primary/10' : ''
              }`}
            >
              <span className="font-medium">{s.name}</span>
              <span className="text-gray-500">
                {format(new Date(s.virtual_now), 'dd/MM/yyyy HH:mm', { locale: fr })}
              </span>
              <span className="text-gray-400">
                {formatDistanceToNow(new Date(s.created_at), { locale: fr, addSuffix: true })}
              </span>
              <SimulationStatusBadge status={s.status} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
