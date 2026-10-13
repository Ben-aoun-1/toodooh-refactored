import { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';

import { useAttentionThresholds, useSaveThresholds } from '@/features/admin/hooks/useAdminAgents';
import type { AttentionThresholds } from '@/features/admin/services/admin-agents.service';
import { getErrorMessage } from '@/lib/errors';

const FIELDS: [keyof AttentionThresholds, string, string][] = [
  [
    'refus_pct',
    'Refus fréquents',
    '% d’offres refusées sur 30 jours au-dessus duquel le point apparaît',
  ],
  [
    'sans_reponse_count',
    'Offres sans réponse répétées',
    'nombre d’offres sans réponse sous 24 h sur 30 jours',
  ],
  [
    'activite_pct',
    'Écrans peu actifs',
    '% d’activité des écrans sur 30 jours en dessous duquel le point apparaît',
  ],
  [
    'evenement_count',
    'Événement accepté non diffusé',
    'passages ratés de cause événementielle sur 30 jours',
  ],
  ['inactivite_days', 'Aucune campagne récente', 'jours sans diffusion pour un Screenhost activé'],
  ['baisse_score_points', 'Baisse du score de priorité', 'points perdus sur 30 jours'],
];

/**
 * AGT-7 (Agent Screenhost spec v1.0 §6 « Points d'attention ») — the hub's thresholds; the next
 * daily follow-up run applies them.
 */
export function AgentThresholdsPanel() {
  const query = useAttentionThresholds();
  const save = useSaveThresholds();
  const [draft, setDraft] = useState<Record<string, string>>({});
  useEffect(() => {
    if (query.data)
      setDraft(Object.fromEntries(Object.entries(query.data).map(([k, v]) => [k, String(v)])));
  }, [query.data]);

  const submit = async () => {
    const body = Object.fromEntries(
      FIELDS.map(([k]) => [k, Number((draft[k] ?? '').replace(',', '.'))]),
    ) as Partial<AttentionThresholds>;
    if (Object.values(body).some((v) => !Number.isFinite(v))) {
      toast.error('Valeurs invalides.');
      return;
    }
    try {
      await save.mutateAsync(body);
      toast.success('Seuils enregistrés');
    } catch (e) {
      toast.error(getErrorMessage(e) || 'Enregistrement impossible');
    }
  };

  return (
    <div className="max-w-2xl space-y-3 p-4">
      <p className="text-sm text-gray-600">
        Seuils des points d’attention du suivi des Screenhosts. Ils s’appliquent au prochain calcul
        quotidien.
      </p>
      {FIELDS.map(([key, label, help]) => (
        <div key={key} className="flex items-center justify-between gap-4 text-sm">
          <label htmlFor={`threshold-${key}`}>
            <span className="font-medium">{label}</span>
            <span className="block text-xs text-gray-500">{help}</span>
          </label>
          <input
            id={`threshold-${key}`}
            value={draft[key] ?? ''}
            onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
            className="w-24 rounded-lg border px-3 py-2 text-right"
          />
        </div>
      ))}
      <button
        type="button"
        onClick={() => void submit()}
        disabled={save.isPending}
        className="rounded-lg bg-brand-primary px-4 py-2 text-sm font-medium text-brand-deep disabled:opacity-50"
      >
        Enregistrer
      </button>
    </div>
  );
}
