import { Coins, Loader2, Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';

import AdminLayout from '@/features/admin/components/AdminLayout';
import { useDispatchConfig, useUpdateCpmConfig } from '@/features/admin/hooks/useDispatchConfig';
import type { CpmPatch } from '@/features/admin/services/admin-dispatch-config.service';
import { getErrorMessage } from '@/lib/errors';

// A finite, strictly-positive TND/1000 rate (mirrors the server refine — a non-positive CPM makes
// I_cible = ⌊budget·1000/cpm⌋ blow up / go negative at activation).
function parseCpm(raw: string): number | null {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export default function DispatchConfigManagement() {
  const { config, loading, isError } = useDispatchConfig();
  const updateCpm = useUpdateCpmConfig();
  const [standard, setStandard] = useState('');
  const [event, setEvent] = useState('');

  // Seed the editable inputs from the loaded config (guarded on `loading` so the undefined
  // placeholder does not churn the effect before the first read settles).
  useEffect(() => {
    if (loading || !config) return;
    setStandard(String(config.standard_cpm_tnd));
    setEvent(String(config.event_cpm_tnd));
  }, [loading, config]);

  useEffect(() => {
    if (isError) toast.error('Chargement de la configuration impossible');
  }, [isError]);

  const handleSave = async () => {
    if (!config) return;
    const stdNum = parseCpm(standard);
    const evtNum = parseCpm(event);
    if (stdNum === null || evtNum === null) {
      toast.error('Le CPM doit être un nombre strictement positif');
      return;
    }

    // Send only the changed knobs (PATCH is partial). Nothing changed → no-op.
    const patch: CpmPatch = {};
    if (stdNum !== config.standard_cpm_tnd) patch.standard_cpm_tnd = stdNum;
    if (evtNum !== config.event_cpm_tnd) patch.event_cpm_tnd = evtNum;
    if (patch.standard_cpm_tnd === undefined && patch.event_cpm_tnd === undefined) {
      toast('Aucune modification à enregistrer');
      return;
    }

    try {
      await updateCpm.mutateAsync(patch);
      toast.success('Tarification enregistrée');
    } catch (e: unknown) {
      toast.error(getErrorMessage(e) || 'Enregistrement impossible');
    }
  };

  const readonlyRows = config
    ? [
        { label: 'Seuil diffusable', value: config.seuil_diffusable },
        { label: 'G (jours/mois)', value: config.g_mois },
        { label: 'Jours actifs', value: config.jours_actifs },
        { label: 'R min efficace', value: config.r_min_efficace },
        { label: 'F max (secondes)', value: config.f_max_seconds },
      ]
    : [];

  return (
    <AdminLayout
      title="Tarification (CPM)"
      subtitle="CPM standard / événement utilisé par le moteur d'activation (TND / 1000 impressions)"
    >
      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-10 w-10 animate-spin text-brand-primary" />
        </div>
      ) : (
        <div className="space-y-6 max-w-3xl">
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6">
            <div className="flex items-center gap-2 mb-4">
              <Coins className="h-5 w-5 text-brand-primary" />
              <h3 className="text-lg font-semibold text-gray-900">CPM éditable</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label
                  className="block text-sm font-medium text-gray-700 mb-2"
                  htmlFor="standard-cpm"
                >
                  CPM standard (TND / 1000)
                </label>
                <input
                  id="standard-cpm"
                  type="number"
                  step="0.01"
                  min="0"
                  value={standard}
                  onChange={(e) => setStandard(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-primary focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2" htmlFor="event-cpm">
                  CPM événement (TND / 1000)
                </label>
                <input
                  id="event-cpm"
                  type="number"
                  step="0.01"
                  min="0"
                  value={event}
                  onChange={(e) => setEvent(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-primary focus:border-transparent"
                />
              </div>
            </div>
            <div className="mt-6 flex justify-end">
              <button
                type="button"
                onClick={handleSave}
                disabled={updateCpm.isPending}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-brand-primary text-brand-deep text-sm font-medium hover:opacity-90 disabled:opacity-50"
              >
                {updateCpm.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Enregistrer
              </button>
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              Paramètres moteur (lecture seule)
            </h3>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3 text-sm">
              {readonlyRows.map((row) => (
                <div key={row.label} className="flex justify-between border-b border-gray-100 pb-2">
                  <dt className="text-gray-600">{row.label}</dt>
                  <dd className="font-medium text-gray-900">{row.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
