import { useState } from 'react';

import { useCreateSimulation } from '@/features/admin/hooks/useAdminSimulator';

interface Props {
  disabled: boolean;
  onCreated: (id: string) => void;
}

export function CreateSimulationForm({ disabled, onCreated }: Props) {
  const [name, setName] = useState('');
  const [start, setStart] = useState('');
  const create = useCreateSimulation();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    create.mutate(
      { name: trimmed, ...(start ? { virtual_start: new Date(start).toISOString() } : {}) },
      {
        onSuccess: (s) => {
          setName('');
          setStart('');
          onCreated(s.id);
        },
      },
    );
  };

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border bg-white p-4">
      <h2 className="text-sm font-semibold text-gray-700">Nouvelle simulation</h2>
      <label className="block text-sm">
        <span className="text-gray-600">Nom</span>
        <input
          className="mt-1 w-full rounded-lg border px-3 py-2"
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
          placeholder="Monde 1"
        />
      </label>
      <label className="block text-sm">
        <span className="text-gray-600">Début de l'horloge virtuelle (optionnel)</span>
        <input
          type="datetime-local"
          className="mt-1 w-full rounded-lg border px-3 py-2"
          value={start}
          onChange={(e) => setStart(e.target.value)}
        />
      </label>
      {create.isError && (
        <p className="text-sm text-red-600">
          {create.error instanceof Error ? create.error.message : 'Création impossible.'}
        </p>
      )}
      <button
        type="submit"
        disabled={disabled || create.isPending || !name.trim()}
        className="rounded-lg bg-brand-primary px-4 py-2 text-sm font-medium text-brand-deep disabled:opacity-50"
      >
        {create.isPending ? 'Création…' : 'Créer'}
      </button>
      {disabled && <p className="text-xs text-gray-500">Nombre maximal de simulations atteint.</p>}
    </form>
  );
}
