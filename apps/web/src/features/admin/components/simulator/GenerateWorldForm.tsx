import { Loader2, Sparkles } from 'lucide-react';
import { useState } from 'react';

import { useGenerateWorld } from '@/features/admin/hooks/useAdminSimulator';

interface Props {
  simulationId: string;
}

interface Knob {
  key: 'venues' | 'owners' | 'advertisers' | 'agents' | 'history_days';
  label: string;
  min: number;
  max: number;
  fallback: number;
}

const KNOBS: Knob[] = [
  { key: 'venues', label: 'Établissements', min: 1, max: 60, fallback: 12 },
  { key: 'owners', label: 'Propriétaires', min: 1, max: 60, fallback: 8 },
  { key: 'advertisers', label: 'Annonceurs', min: 0, max: 40, fallback: 6 },
  { key: 'agents', label: 'Agents', min: 0, max: 10, fallback: 2 },
  { key: 'history_days', label: 'Historique (jours)', min: 0, max: 90, fallback: 28 },
];

export function GenerateWorldForm({ simulationId }: Props) {
  const [values, setValues] = useState<Record<string, number>>(
    Object.fromEntries(KNOBS.map((k) => [k.key, k.fallback])),
  );
  const [seed, setSeed] = useState('');
  const [walletMin, setWalletMin] = useState(500);
  const [walletMax, setWalletMax] = useState(5000);
  const generate = useGenerateWorld(simulationId);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    generate.mutate({
      ...(seed.trim() ? { seed: seed.trim() } : {}),
      venues: values['venues'],
      owners: Math.min(values['owners'] ?? 1, values['venues'] ?? 1),
      advertisers: values['advertisers'],
      agents: values['agents'],
      history_days: values['history_days'],
      wallet_min_tnd: walletMin,
      wallet_max_tnd: walletMax,
    });
  };

  return (
    <form onSubmit={submit} className="space-y-4 rounded-xl border bg-white p-4">
      <header className="flex items-center gap-2">
        <Sparkles className="h-5 w-5 text-brand-primary" />
        <h2 className="text-sm font-semibold text-gray-700">Générer un monde</h2>
      </header>
      <p className="text-sm text-gray-500">
        Des établissements, leurs écrans, leurs propriétaires, des annonceurs financés et un
        historique d&apos;affluence mesurée. Les vrais moteurs les voient comme de vraies données.
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {KNOBS.map((knob) => (
          <label key={knob.key} className="block text-sm">
            <span className="text-gray-600">{knob.label}</span>
            <input
              type="number"
              min={knob.min}
              max={knob.max}
              className="mt-1 w-full rounded-lg border px-3 py-2"
              value={values[knob.key] ?? knob.fallback}
              onChange={(e) => setValues((v) => ({ ...v, [knob.key]: Number(e.target.value) }))}
            />
          </label>
        ))}
        <label className="block text-sm">
          <span className="text-gray-600">Solde min (TND)</span>
          <input
            type="number"
            min={0}
            className="mt-1 w-full rounded-lg border px-3 py-2"
            value={walletMin}
            onChange={(e) => setWalletMin(Number(e.target.value))}
          />
        </label>
        <label className="block text-sm">
          <span className="text-gray-600">Solde max (TND)</span>
          <input
            type="number"
            min={0}
            className="mt-1 w-full rounded-lg border px-3 py-2"
            value={walletMax}
            onChange={(e) => setWalletMax(Number(e.target.value))}
          />
        </label>
        <label className="block text-sm sm:col-span-2">
          <span className="text-gray-600">
            Graine (optionnel — rejoue un monde à l&apos;identique)
          </span>
          <input
            className="mt-1 w-full rounded-lg border px-3 py-2 font-mono"
            value={seed}
            maxLength={32}
            placeholder="aléatoire"
            onChange={(e) => setSeed(e.target.value)}
          />
        </label>
      </div>
      {generate.isError && (
        <p className="text-sm text-red-600">
          {generate.error instanceof Error ? generate.error.message : 'Génération impossible.'}
        </p>
      )}
      <button
        type="submit"
        disabled={generate.isPending}
        className="flex items-center gap-2 rounded-lg bg-brand-primary px-4 py-2 text-sm font-medium text-brand-deep disabled:opacity-50"
      >
        {generate.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
        {generate.isPending ? 'Génération…' : 'Générer le monde'}
      </button>
    </form>
  );
}
