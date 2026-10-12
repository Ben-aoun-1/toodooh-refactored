import { Loader2, Save, Timer } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';

import { useSetDemoDelay } from '@/features/admin/hooks/useAdminDemo';
import { parseDelayMinutes } from '@/features/admin/lib/demo';
import { getErrorMessage } from '@/lib/errors';

/** DEMO-1 — « Délai avant diffusion »: minutes from a demo cart confirm to the TV. */
export function DemoDelayCard({ delayMinutes }: { delayMinutes: number }) {
  const [raw, setRaw] = useState(String(delayMinutes));
  const save = useSetDemoDelay();
  useEffect(() => setRaw(String(delayMinutes)), [delayMinutes]);

  const submit = async () => {
    const parsed = parseDelayMinutes(raw);
    if (!parsed.ok) {
      toast.error(parsed.error);
      return;
    }
    try {
      await save.mutateAsync(parsed.value);
      toast.success('Délai enregistré');
    } catch (e) {
      toast.error(getErrorMessage(e) || 'Enregistrement impossible');
    }
  };

  return (
    <section className="rounded-xl border bg-white p-5">
      <div className="flex items-center gap-2">
        <Timer className="h-5 w-5 text-brand-primary" />
        <h2 className="text-base font-semibold">Délai avant diffusion</h2>
      </div>
      <p className="mt-1 text-sm text-gray-500">
        Temps entre la validation du panier d’un compte démo et l’apparition de la campagne sur les
        écrans.
      </p>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="block text-gray-600">Minutes</span>
          <input
            type="number"
            min={0}
            max={1440}
            step={1}
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            className="mt-1 w-32 rounded-lg border px-3 py-2"
          />
        </label>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={save.isPending}
          className="flex items-center gap-2 rounded-lg bg-brand-primary px-4 py-2 text-sm font-medium text-brand-deep disabled:opacity-60"
        >
          {save.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          Enregistrer
        </button>
      </div>
    </section>
  );
}
