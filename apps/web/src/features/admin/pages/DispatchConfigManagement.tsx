import { CalendarClock, Coins, Eye, Loader2, Percent, Save } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'react-hot-toast';

import AdminLayout from '@/features/admin/components/AdminLayout';
import { useDispatchConfig, useUpdateCpmConfig } from '@/features/admin/hooks/useDispatchConfig';
import {
  type BlockPatchResult,
  type DispatchConfigView,
  composeAttentionPatch,
  composeCpmPatch,
  composeLeadPatch,
  composeReversementPatch,
} from '@/features/admin/services/admin-dispatch-config.service';
import { getErrorMessage } from '@/lib/errors';

// CPM-ADMIN (Mejri 05/08) — one save per block, and NO silent path: a refused compose toasts the
// French reason, an empty diff toasts « Aucune modification », a failed PATCH toasts the server
// error. The old single-button page could swallow a click whole (config never loaded → bare
// `return`; a background refetch re-seeding the inputs → edits wiped, then an empty diff).
async function runBlockSave(
  mutation: ReturnType<typeof useUpdateCpmConfig>,
  result: BlockPatchResult,
): Promise<void> {
  if (!result.ok) {
    toast.error(result.error);
    return;
  }
  if (Object.keys(result.patch).length === 0) {
    toast('Aucune modification à enregistrer');
    return;
  }
  try {
    await mutation.mutateAsync(result.patch);
    toast.success('Configuration enregistrée');
  } catch (e: unknown) {
    toast.error(getErrorMessage(e) || 'Enregistrement impossible');
  }
}

function SaveButton({ pending, onClick }: { pending: boolean; onClick: () => void }) {
  return (
    <div className="mt-6 flex justify-end">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-brand-primary text-brand-deep text-sm font-medium hover:opacity-90 disabled:opacity-50"
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        Enregistrer
      </button>
    </div>
  );
}

const inputClass =
  'w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-primary focus:border-transparent';

// Mounted only once the config EXISTS, so the inputs seed through useState initializers: a later
// refetch (new object identity) can never re-seed them and silently wipe an in-progress edit.
function ConfigForm({ config }: { config: DispatchConfigView }) {
  const cpmMutation = useUpdateCpmConfig();
  const leadMutation = useUpdateCpmConfig();
  const attentionMutation = useUpdateCpmConfig();
  const reversementMutation = useUpdateCpmConfig();
  const [standard, setStandard] = useState(String(config.standard_cpm_tnd));
  const [event, setEvent] = useState(String(config.event_cpm_tnd));
  // E1 — the attention T buckets (indice d'attention par durée de spot).
  const [t10, setT10] = useState(String(config.t_10s));
  const [t20, setT20] = useState(String(config.t_20s));
  const [t30, setT30] = useState(String(config.t_30s));
  // CF-D1 — the campaign start-date lead (jours ouvrés).
  const [lead, setLead] = useState(String(config.campaign_lead_working_days));
  // E7 — the reversement split (Σ = 100).
  const [pctSh, setPctSh] = useState(String(config.pct_sh));
  const [pctToodooh, setPctToodooh] = useState(String(config.pct_toodooh));
  const [pctAgentSh, setPctAgentSh] = useState(String(config.pct_agent_sh));
  const [pctAgentSc, setPctAgentSc] = useState(String(config.pct_agent_sc));

  const handleSaveCpm = () =>
    runBlockSave(cpmMutation, composeCpmPatch({ standard, event }, config));
  const handleSaveLead = () => runBlockSave(leadMutation, composeLeadPatch({ lead }, config));
  const handleSaveAttention = () =>
    runBlockSave(attentionMutation, composeAttentionPatch({ t10, t20, t30 }, config));
  const handleSaveReversement = () =>
    runBlockSave(
      reversementMutation,
      composeReversementPatch(
        { sh: pctSh, toodooh: pctToodooh, agentSh: pctAgentSh, agentSc: pctAgentSc },
        config,
      ),
    );

  // Live total for the reversement block — the operator sees the Σ drift before pressing save.
  const totalPct = [pctSh, pctToodooh, pctAgentSh, pctAgentSc].reduce((sum, raw) => {
    const n = Number(raw);
    return sum + (Number.isFinite(n) ? n : 0);
  }, 0);

  const readonlyRows = [
    { label: 'Seuil diffusable', value: config.seuil_diffusable },
    { label: 'G (jours/mois)', value: config.g_mois },
    { label: 'Jours actifs', value: config.jours_actifs },
    { label: 'R min efficace', value: config.r_min_efficace },
    { label: 'F max (secondes)', value: config.f_max_seconds },
  ];

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6">
        <div className="flex items-center gap-2 mb-4">
          <Coins className="h-5 w-5 text-brand-primary" />
          <h3 className="text-lg font-semibold text-gray-900">CPM éditable</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2" htmlFor="standard-cpm">
              CPM standard (TND / 1000)
            </label>
            <input
              id="standard-cpm"
              type="number"
              step="0.01"
              min="0"
              value={standard}
              onChange={(e) => setStandard(e.target.value)}
              className={inputClass}
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
              className={inputClass}
            />
          </div>
        </div>
        <SaveButton pending={cpmMutation.isPending} onClick={handleSaveCpm} />
      </div>

      {/* CF-D1 — the campaign start-date lead; its own Enregistrer. */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6">
        <div className="flex items-center gap-2 mb-1">
          <CalendarClock className="h-5 w-5 text-brand-primary" />
          <h3 className="text-lg font-semibold text-gray-900">Délai de lancement</h3>
        </div>
        <p className="text-sm text-gray-600 mb-4">
          Nombre de jours ouvrés minimum entre aujourd'hui et le début d'une campagne. Attention : 0
          autorise un démarrage le jour même — réservé aux tests terrain.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2" htmlFor="campaign-lead">
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
              className={inputClass}
            />
          </div>
        </div>
        <SaveButton pending={leadMutation.isPending} onClick={handleSaveLead} />
      </div>

      {/* E1 — the attention index T by spot duration; its own Enregistrer. */}
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
                className={inputClass}
              />
            </div>
          ))}
        </div>
        <SaveButton pending={attentionMutation.isPending} onClick={handleSaveAttention} />
      </div>

      {/* E7 — the reversement split (Σ = 100); its own Enregistrer. */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6">
        <div className="flex items-center gap-2 mb-1">
          <Percent className="h-5 w-5 text-brand-primary" />
          <h3 className="text-lg font-semibold text-gray-900">Répartition des reversements</h3>
        </div>
        <p className="text-sm text-gray-600 mb-4">
          Part de chaque bénéficiaire sur la valeur diffusée. Le total doit être exactement 100 —
          une répartition différente est refusée à l'enregistrement.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          {(
            [
              ['pct-sh', 'Établissement (%)', pctSh, setPctSh],
              ['pct-toodooh', 'TOODOOH (%)', pctToodooh, setPctToodooh],
              ['pct-agent-sh', 'Agent établissement (%)', pctAgentSh, setPctAgentSh],
              ['pct-agent-sc', 'Agent annonceur (%)', pctAgentSc, setPctAgentSc],
            ] as const
          ).map(([id, label, value, setter]) => (
            <div key={id}>
              <label className="block text-sm font-medium text-gray-700 mb-2" htmlFor={id}>
                {label}
              </label>
              <input
                id={id}
                type="number"
                step="0.01"
                min="0"
                max="100"
                value={value}
                onChange={(e) => setter(e.target.value)}
                className={inputClass}
              />
            </div>
          ))}
        </div>
        <p className="mt-4 text-sm font-medium text-gray-700">
          Total : {totalPct}
          {totalPct === 100 ? '' : ' — doit être 100'}
        </p>
        <SaveButton pending={reversementMutation.isPending} onClick={handleSaveReversement} />
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
  );
}

export default function DispatchConfigManagement() {
  const { config, loading, isError, refetch } = useDispatchConfig();

  return (
    <AdminLayout
      title="Tarification (CPM) et attention (T)"
      subtitle="CPM, délai de lancement, indice d'attention et répartition des reversements — chaque bloc a son propre bouton Enregistrer"
    >
      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-10 w-10 animate-spin text-brand-primary" />
        </div>
      ) : config ? (
        <ConfigForm config={config} />
      ) : isError ? (
        // CPM-ADMIN (the INV-1 rule) — a failed config read renders as an ERROR, never as an
        // empty-but-editable form whose Enregistrer would have nothing to diff against.
        <div className="max-w-3xl rounded-xl border border-rose-200 bg-rose-50/60 px-6 py-10 text-center">
          <p className="text-sm font-medium text-rose-600">
            Impossible de charger la configuration de tarification pour le moment.
          </p>
          <button
            type="button"
            onClick={refetch}
            className="mt-4 rounded-full border border-rose-300 bg-white px-5 py-2 text-sm font-semibold text-rose-600 transition-colors hover:bg-rose-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"
          >
            Réessayer
          </button>
        </div>
      ) : null}
    </AdminLayout>
  );
}
