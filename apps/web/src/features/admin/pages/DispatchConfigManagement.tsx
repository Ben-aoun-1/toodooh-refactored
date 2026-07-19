import { CalendarClock, Coins, Eye, Loader2, Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';

import AdminLayout from '@/features/admin/components/AdminLayout';
import { useDispatchConfig, useUpdateCpmConfig } from '@/features/admin/hooks/useDispatchConfig';
import {
  type CpmPatch,
  attentionOrderingValid,
  parseAttention,
  parseCampaignLead,
} from '@/features/admin/services/admin-dispatch-config.service';
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
  // E1 — the attention T buckets (indice d'attention par durée de spot).
  const [t10, setT10] = useState('');
  const [t20, setT20] = useState('');
  const [t30, setT30] = useState('');
  // CF-D1 — the campaign start-date lead (jours ouvrés).
  const [lead, setLead] = useState('');

  // Seed the editable inputs from the loaded config (guarded on `loading` so the undefined
  // placeholder does not churn the effect before the first read settles).
  useEffect(() => {
    if (loading || !config) return;
    setStandard(String(config.standard_cpm_tnd));
    setEvent(String(config.event_cpm_tnd));
    setT10(String(config.t_10s));
    setT20(String(config.t_20s));
    setT30(String(config.t_30s));
    setLead(String(config.campaign_lead_working_days));
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
    // E1 — the T buckets: each in (0, 1], ordered t₁₀ ≤ t₂₀ ≤ t₃₀ (mirrors the server rules).
    const t10Num = parseAttention(t10);
    const t20Num = parseAttention(t20);
    const t30Num = parseAttention(t30);
    if (t10Num === null || t20Num === null || t30Num === null) {
      toast.error("L'indice d'attention doit être compris entre 0 (exclu) et 1");
      return;
    }
    if (!attentionOrderingValid(t10Num, t20Num, t30Num)) {
      toast.error("L'ordre requis est T ≤ 10 s ≤ T ≤ 20 s ≤ T ≤ 30 s");
      return;
    }
    // CF-D1 — the lead: an integer count of jours ouvrés in [0, 30] (mirrors the server bounds).
    const leadNum = parseCampaignLead(lead);
    if (leadNum === null) {
      toast.error('Le délai de lancement doit être un entier entre 0 et 30');
      return;
    }

    // Send only the changed knobs (PATCH is partial). Nothing changed → no-op.
    const patch: CpmPatch = {};
    if (stdNum !== config.standard_cpm_tnd) patch.standard_cpm_tnd = stdNum;
    if (evtNum !== config.event_cpm_tnd) patch.event_cpm_tnd = evtNum;
    if (t10Num !== config.t_10s) patch.t_10s = t10Num;
    if (t20Num !== config.t_20s) patch.t_20s = t20Num;
    if (t30Num !== config.t_30s) patch.t_30s = t30Num;
    if (leadNum !== config.campaign_lead_working_days) patch.campaign_lead_working_days = leadNum;
    if (Object.keys(patch).length === 0) {
      toast('Aucune modification à enregistrer');
      return;
    }

    try {
      await updateCpm.mutateAsync(patch);
      toast.success('Configuration enregistrée');
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
      title="Tarification (CPM) et attention (T)"
      subtitle="CPM standard / événement (TND / 1000 impressions) et indice d'attention par durée de spot — le bouton Enregistrer sauvegarde les deux blocs"
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

          {/* CF-D1 — the campaign start-date lead, saved by the same Enregistrer. */}
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6">
            <div className="flex items-center gap-2 mb-1">
              <CalendarClock className="h-5 w-5 text-brand-primary" />
              <h3 className="text-lg font-semibold text-gray-900">Délai de lancement</h3>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              Nombre de jours ouvrés minimum entre aujourd'hui et le début d'une campagne. Attention
              : 0 autorise un démarrage le jour même — réservé aux tests terrain.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label
                  className="block text-sm font-medium text-gray-700 mb-2"
                  htmlFor="campaign-lead"
                >
                  Délai de lancement (jours ouvrés)
                </label>
                <input
                  id="campaign-lead"
                  type="number"
                  step="1"
                  min="0"
                  max="30"
                  value={lead}
                  onChange={(e) => setLead(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-primary focus:border-transparent"
                />
              </div>
            </div>
          </div>

          {/* E1 — the attention index T by spot duration, saved by the same Enregistrer. */}
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6">
            <div className="flex items-center gap-2 mb-1">
              <Eye className="h-5 w-5 text-brand-primary" />
              <h3 className="text-lg font-semibold text-gray-900">Indice d'attention (T)</h3>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              Capacité facturable = capacité physique × T, selon la durée du spot. Valeurs entre 0
              (exclu) et 1, avec T ≤ 10 s ≤ T ≤ 20 s ≤ T ≤ 30 s.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {(
                [
                  ['t-10s', 'Spot ≤ 10 s', t10, setT10],
                  ['t-20s', 'Spot ≤ 20 s', t20, setT20],
                  ['t-30s', 'Spot ≤ 30 s', t30, setT30],
                ] as const
              ).map(([id, label, value, setter]) => (
                <div key={id}>
                  <label className="block text-sm font-medium text-gray-700 mb-2" htmlFor={id}>
                    {label}
                  </label>
                  <input
                    id={id}
                    type="number"
                    step="0.05"
                    min="0"
                    max="1"
                    value={value}
                    onChange={(e) => setter(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-primary focus:border-transparent"
                  />
                </div>
              ))}
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
