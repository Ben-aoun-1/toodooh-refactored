import { useSimulationCampaignInspection } from '@/features/admin/hooks/useAdminSimulator';
import { runLine, settlementLine } from '@/features/admin/lib/sim-inspector';

// SIM-6 phase 2 — one simulated campaign, every engine stage: the pricing it was sold at, the plan
// the dispatch froze (or the event blocs), the redispatch rounds, the engine journal and the
// settlement. All figures come from the api's inspector (the product's own functions, read inside
// the sandbox); this component only lays them out.

const nf = (n: number | null | undefined): string =>
  n === null || n === undefined ? '—' : n.toLocaleString('fr-FR');
const hm = (iso: string): string => iso.slice(0, 16).replace('T', ' ');

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</h3>
      {children}
    </section>
  );
}

export function SimulationCampaignInspector({
  simulationId,
  campaignId,
  onClose,
}: {
  simulationId: string;
  campaignId: string;
  onClose: () => void;
}) {
  const query = useSimulationCampaignInspection(simulationId, campaignId);
  const r = query.data;

  return (
    <aside className="space-y-4 rounded-xl border bg-white p-4 text-xs">
      <header className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">{r ? r.campaign.name : 'Inspection'}</h2>
          {r && (
            <p className="text-gray-500">
              {r.campaign.kind === 'event' ? 'Positionnement événement' : 'Campagne'} ·{' '}
              {r.campaign.status} · {r.campaign.start_date ?? '—'} → {r.campaign.end_date ?? '—'} ·
              spot {r.campaign.spot_seconds ?? '—'} s · budget {nf(r.campaign.budget_tnd)} TND
            </p>
          )}
        </div>
        <button type="button" onClick={onClose} className="text-gray-500 underline">
          Fermer
        </button>
      </header>

      {query.isLoading && <p className="text-gray-500">Chargement…</p>}
      {query.isError && <p className="text-red-600">Inspection impossible.</p>}

      {r && (
        <>
          <Section title="Tarification">
            <p>
              Plafond C_max {nf(r.pricing.c_max_tnd)} TND · objectif {nf(r.pricing.objectif)}{' '}
              impressions · estimation {r.pricing.estimate.status}
              {r.pricing.estimate.venuesCount !== undefined &&
                ` (${r.pricing.estimate.venuesCount} établissements)`}
            </p>
            <p className="text-gray-500">
              CPM {r.pricing.campaign_rates.standard_cpm_tnd} (événement{' '}
              {r.pricing.campaign_rates.event_cpm_tnd}) · T {r.pricing.campaign_rates.t10s} /{' '}
              {r.pricing.campaign_rates.t20s} / {r.pricing.campaign_rates.t30s} · F{' '}
              {r.pricing.config.f_max_seconds} s par campagne · R_min{' '}
              {r.pricing.config.r_min_efficace}
            </p>
          </Section>

          {r.plan && (
            <Section title={`Plan de diffusion (${hm(r.plan.dispatched_at)})`}>
              <p className="text-gray-500">
                I_cible {nf(r.plan.i_cible)} · couvert {nf(r.plan.couvert)} · CPM {r.plan.cpm} · T{' '}
                {r.plan.t} · S {r.plan.s} s · part minimale {nf(r.plan.seuil)} · N{' '}
                {r.plan.n_retenus} ({r.plan.n_min}–{r.plan.n_max}) · reliquat{' '}
                {nf(r.plan.reliquat_stocke)}
                {r.plan.is_partial ? ' · PARTIEL' : ''}
              </p>
              <table className="w-full text-left">
                <thead className="border-b text-gray-500">
                  <tr>
                    <th className="py-1 pr-2 font-medium">Établissement</th>
                    <th className="py-1 pr-2 font-medium">Statut</th>
                    <th className="py-1 pr-2 font-medium">r_i</th>
                    <th className="py-1 pr-2 font-medium">Part</th>
                    <th className="py-1 pr-2 font-medium">Créneaux</th>
                    <th className="py-1 font-medium">Prouvés</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {r.plan.allocations.map((a) => (
                    <tr key={a.screenhost_id}>
                      <td className="py-1 pr-2">{a.venue}</td>
                      <td className="py-1 pr-2">{a.statut}</td>
                      <td className="py-1 pr-2">{a.r_i}</td>
                      <td className="py-1 pr-2">{nf(a.share)}</td>
                      <td className="py-1 pr-2">
                        {a.creneaux} ({a.first ?? '—'} → {a.last ?? '—'})
                      </td>
                      <td className="py-1">{a.delivered_slots}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          )}

          {r.event_placement && (
            <Section title="Placement événement (blocs)">
              <ul className="space-y-1">
                {r.event_placement.map((e) => (
                  <li key={e.screenhost_id}>
                    <span className="font-medium">{e.venue}</span> · {e.statut} · {e.blocs.length}{' '}
                    blocs · {nf(e.impressions)} imp. · {nf(e.montant_tnd)} TND
                    <span className="block text-gray-400">
                      {e.blocs.map((b) => `${hm(b.start)}→${b.end.slice(11, 16)}`).join(' · ')}
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <Section title={`Rattrapages (${r.redispatch.length})`}>
            {r.redispatch.length === 0 ? (
              <p className="text-gray-500">Aucun volume replacé.</p>
            ) : (
              <ul className="space-y-1">
                {r.redispatch.map((d) => (
                  <li key={d.at}>
                    {hm(d.at)} · manqué {nf(d.missed_fact)} · replacé {nf(d.placed_fact)} · reste{' '}
                    {nf(d.residual_fact)}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title={`Journal du moteur (${r.journal.length} derniers passages)`}>
            <ul className="max-h-64 space-y-1 overflow-y-auto">
              {r.journal.map((run) => (
                <li key={run.run_id}>
                  <span className="text-gray-400">{hm(run.started_at)}</span> {runLine(run)}
                </li>
              ))}
            </ul>
          </Section>

          <Section title="Règlement">
            {r.settlement ? (
              <>
                <p className="font-medium">{settlementLine(r.settlement)}</p>
                {r.settlement.reversement.length > 0 && (
                  <ul className="space-y-1">
                    {r.settlement.reversement.map((l) => (
                      <li key={l.venue}>
                        {l.venue} · base {nf(l.base_tnd)} · hôte {nf(l.sh_tnd)} · Toodooh{' '}
                        {nf(l.toodooh_tnd)} · agents {nf(l.agent_sh_tnd)} / {nf(l.agent_sc_tnd)} TND
                      </li>
                    ))}
                  </ul>
                )}
                {r.settlement.event_delivery && (
                  <ul className="space-y-1">
                    {r.settlement.event_delivery.map((v) => (
                      <li key={v.venue}>
                        {v.venue} · {v.blocs_delivered} blocs livrés · {nf(v.delivered_tnd)} TND
                        {v.refund_tnd > 0 ? ` · remboursé ${nf(v.refund_tnd)} TND` : ''}
                        {v.attestation_negated ? ' · non respecté' : ''}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <p className="text-gray-500">Pas encore réglée (à la fin de la fenêtre).</p>
            )}
          </Section>
        </>
      )}
    </aside>
  );
}
