import { Loader2, Mail, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';

import { AgentAffiliationsPanel } from '@/features/admin/components/agents/AgentAffiliationsPanel';
import {
  useAgentSheet,
  usePatchAgent,
  useResendAgentAccess,
  useSetAgentStatus,
} from '@/features/admin/hooks/useAdminAgents';
import { AGENT_STATUS_FR, onboardingLabel } from '@/features/admin/lib/agent-sheet';
import { getErrorMessage } from '@/lib/errors';
import { tndLabel } from '@/lib/money';

const RIB_FR = {
  non_fourni: 'Non fourni',
  en_attente: 'En attente de validation',
  valide: 'Validé',
  refuse: 'Refusé',
};

const Row = ({ label, value }: { label: string; value: string | null }) => (
  <div className="flex justify-between gap-4 py-1.5 text-sm">
    <span className="text-gray-500">{label}</span>
    <span className="text-right font-medium">{value ?? '—'}</span>
  </div>
);

/** AGT-1 — one agent's sheet: data, rate and zone edit, lifecycle, access link, affiliations,
 * CGE history. */
export function AgentSheetDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const sheet = useAgentSheet(id);
  const patch = usePatchAgent();
  const setStatus = useSetAgentStatus();
  const resend = useResendAgentAccess();
  const [pct, setPct] = useState('');
  const [zone, setZone] = useState('');
  const a = sheet.data;
  useEffect(() => {
    if (!a) return;
    setPct(a.commission_pct === null ? '' : String(a.commission_pct));
    setZone(a.covered_zone ?? '');
  }, [a]);

  const run = async (p: Promise<unknown>, ok: string) => {
    try {
      await p;
      await sheet.refetch();
      toast.success(ok);
    } catch (e) {
      toast.error(getErrorMessage(e) || 'Action impossible');
    }
  };

  const saveTerms = () => {
    const value = pct.trim() === '' ? null : Number(pct.replace(',', '.'));
    if (value !== null && (!Number.isFinite(value) || value < 0 || value > 100)) {
      toast.error('Taux invalide (0 à 100).');
      return;
    }
    void run(
      patch.mutateAsync({ id, body: { commission_pct: value, covered_zone: zone.trim() } }),
      'Fiche enregistrée',
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30">
      <button
        type="button"
        aria-label="Fermer la fiche"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />
      <aside className="relative h-full w-full max-w-lg overflow-y-auto bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between">
          <h2 className="text-lg font-semibold">{a?.contact_name ?? 'Agent'}</h2>
          <button type="button" onClick={onClose} aria-label="Fermer">
            <X className="h-5 w-5" />
          </button>
        </div>
        {!a ? (
          <Loader2 className="mx-auto mt-10 h-6 w-6 animate-spin text-brand-primary" />
        ) : (
          <div className="mt-4 space-y-6">
            <section>
              <Row label="Email" value={a.email} />
              <Row label="Code agent" value={a.code} />
              <Row label="Statut" value={AGENT_STATUS_FR[a.account_status]} />
              <Row label="Onboarding" value={onboardingLabel(a.onboarding)} />
              <Row label="RIB" value={RIB_FR[a.rib_status]} />
              <Row label="Téléphone" value={a.phone} />
              <Row label="Matricule fiscal" value={a.tax_number} />
              <Row
                label="Adresse"
                value={[a.street_address, a.postal_code, a.city].filter(Boolean).join(', ') || null}
              />
              <Row label="Certifié le" value={a.certified_at} />
              <Row label="Taux appliqué" value={`${a.effective_commission_pct} %`} />
              <Row label="Revenu actuel" value={tndLabel(a.wallet.balance_tnd)} />
              <Row label="Revenus cumulés" value={tndLabel(a.wallet.cumulative_tnd)} />
              <Row label="Revenu prévisionnel" value={tndLabel(a.wallet.forecast_tnd)} />
            </section>

            <section className="space-y-3 rounded-lg border p-4">
              <p className="text-sm font-semibold">Taux et zone</p>
              <label className="block text-sm">
                <span className="text-gray-600">
                  Taux de commission (%) — vide = défaut du moteur
                </span>
                <input
                  value={pct}
                  onChange={(e) => setPct(e.target.value)}
                  className="mt-1 w-full rounded-lg border px-3 py-2"
                />
              </label>
              <label className="block text-sm">
                <span className="text-gray-600">Zone couverte</span>
                <input
                  value={zone}
                  onChange={(e) => setZone(e.target.value)}
                  className="mt-1 w-full rounded-lg border px-3 py-2"
                />
              </label>
              <button
                type="button"
                onClick={saveTerms}
                className="rounded-lg bg-brand-primary px-4 py-2 text-sm font-medium text-brand-deep"
              >
                Enregistrer
              </button>
            </section>

            <section className="flex flex-wrap gap-2">
              {a.account_status === 'suspendu' && (
                <button
                  type="button"
                  onClick={() =>
                    void run(setStatus.mutateAsync({ id, status: 'actif' }), 'Compte réactivé')
                  }
                  className="rounded-lg border px-3 py-2 text-sm"
                >
                  Réactiver
                </button>
              )}
              {(a.account_status === 'actif' || a.account_status === 'en_attente') && (
                <button
                  type="button"
                  onClick={() =>
                    void run(setStatus.mutateAsync({ id, status: 'suspendu' }), 'Compte suspendu')
                  }
                  className="rounded-lg border border-orange-300 px-3 py-2 text-sm text-orange-700"
                >
                  Suspendre
                </button>
              )}
              {a.account_status !== 'cloture' && (
                <button
                  type="button"
                  onClick={() =>
                    void run(setStatus.mutateAsync({ id, status: 'cloture' }), 'Compte clôturé')
                  }
                  className="rounded-lg border border-red-300 px-3 py-2 text-sm text-red-700"
                >
                  Clôturer
                </button>
              )}
              <button
                type="button"
                onClick={() => void run(resend.mutateAsync(id), 'Lien d’accès renvoyé')}
                className="flex items-center gap-1 rounded-lg border px-3 py-2 text-sm"
              >
                <Mail className="h-4 w-4" />
                Renvoyer le lien d’accès
              </button>
            </section>

            <AgentAffiliationsPanel agentId={id} role={a.role} />

            <section>
              <p className="text-sm font-semibold">CGE acceptées</p>
              {a.cge_acceptances.length === 0 ? (
                <p className="mt-1 text-sm text-gray-500">Aucune acceptation enregistrée.</p>
              ) : (
                <ul className="mt-1 space-y-1 text-sm">
                  {a.cge_acceptances.map((c) => (
                    <li key={c.version + c.accepted_at}>
                      Version {c.version} — {new Date(c.accepted_at).toLocaleString('fr-FR')}
                      {c.ip ? ` — IP ${c.ip}` : ''}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </aside>
    </div>
  );
}
