import { Coins } from 'lucide-react';
import { useState } from 'react';

import {
  useSimulationPricing,
  useUpdateSimulationPricing,
} from '@/features/admin/hooks/useAdminSimulator';
import { pricingError, pricingPatch } from '@/features/admin/lib/sim-controls';
import type { SandboxPricing } from '@/features/admin/services/admin-simulator.service';

// SIM-6 phase 3 — the SANDBOX pricing (ruled P2 A): CPM, T tiers and F of this simulation only,
// never prod's configuration. The world's advertisers take the new CPM too (CPM-3: a campaign
// prices at its screencaster's CPM when created — campaigns already launched keep theirs).

const FIELDS: { key: keyof SandboxPricing; label: string; step: number }[] = [
  { key: 'standard_cpm_tnd', label: 'CPM standard (TND)', step: 0.1 },
  { key: 'event_cpm_tnd', label: 'CPM événement (TND)', step: 0.1 },
  { key: 't_10s', label: 'T 10 s', step: 0.01 },
  { key: 't_20s', label: 'T 20 s', step: 0.01 },
  { key: 't_30s', label: 'T 30 s', step: 0.01 },
  { key: 'f_max_seconds', label: 'F (s / heure / campagne)', step: 1 },
];

function PricingForm({ simulationId, saved }: { simulationId: string; saved: SandboxPricing }) {
  const update = useUpdateSimulationPricing(simulationId);
  const [draft, setDraft] = useState<SandboxPricing>(saved);
  const error = pricingError(draft);
  const patch = pricingPatch(saved, draft);
  const dirty = Object.keys(patch).length > 0;

  return (
    <div className="flex flex-wrap items-end gap-3">
      {FIELDS.map((f) => (
        <label key={f.key} className="text-sm">
          <span className="block text-xs text-gray-600">{f.label}</span>
          <input
            type="number"
            step={f.step}
            className="mt-1 w-24 rounded-lg border px-2 py-1"
            value={draft[f.key]}
            onChange={(e) => setDraft({ ...draft, [f.key]: Number(e.target.value) })}
          />
        </label>
      ))}
      <button
        type="button"
        disabled={!dirty || error !== null || update.isPending}
        onClick={() => update.mutate(patch)}
        className="rounded-lg bg-brand-primary px-3 py-2 text-sm font-medium text-brand-deep disabled:opacity-50"
      >
        {update.isPending ? 'Enregistrement…' : 'Enregistrer'}
      </button>
      {error && <p className="w-full text-sm text-red-600">{error}</p>}
      {update.isError && (
        <p className="w-full text-sm text-red-600">
          {update.error instanceof Error ? update.error.message : 'Enregistrement impossible.'}
        </p>
      )}
    </div>
  );
}

export function SimulationPricingEditor({ simulationId }: { simulationId: string }) {
  const pricing = useSimulationPricing(simulationId);
  return (
    <section className="space-y-3 rounded-xl border bg-white p-4">
      <header className="flex items-center gap-2">
        <Coins className="h-5 w-5 text-brand-primary" />
        <h2 className="text-sm font-semibold text-gray-700">Tarification du bac à sable</h2>
      </header>
      <p className="text-xs text-gray-500">
        Ne touche que cette simulation. Les campagnes déjà lancées gardent leur CPM ; les suivantes
        prennent le nouveau.
      </p>
      {pricing.isLoading && <p className="text-sm text-gray-500">Chargement…</p>}
      {pricing.isError && <p className="text-sm text-red-600">Tarification indisponible.</p>}
      {pricing.data && (
        // Re-seeded from the saved values after every save (mount-when-loaded, CPM-ADMIN).
        <PricingForm
          key={JSON.stringify(pricing.data)}
          simulationId={simulationId}
          saved={pricing.data}
        />
      )}
    </section>
  );
}
