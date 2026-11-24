import { useSearchParams } from 'react-router-dom';

import { useChecklistMutation, useChecklists } from '@/features/agent/hooks/useAgentChecklists';
import {
  CIRCUIT_BANNER,
  MANAGER_BADGE,
  RESULT_BADGE,
  checklistCounters,
  createdLabel,
  ficheSubline,
  opinionLabel,
} from '@/features/agent/lib/agent-checklists';
import { agentChecklistsService } from '@/features/agent/services/agent-checklists.service';
import { getErrorMessage } from '@/lib/errors';

import { VfChecklistFiche } from './VfChecklistFiche';
import { VfIcon } from './VfIcon';
import { useVfOverlay } from './VfOverlay';

/**
 * AGENT-VF (Agent Screenhost spec VF §11) — the Checklist tab. Its home: « Nouvelle fiche », four
 * counters, « Mes fiches » and the circuit banner. `?fiche=<id>` opens one fiche (the
 * questionnaire for a draft, the result for a sent fiche).
 */
export function VfChecklist() {
  const { toast } = useVfOverlay();
  const [params, setParams] = useSearchParams();
  const ficheId = params.get('fiche');
  const list = useChecklists();
  const create = useChecklistMutation(() => agentChecklistsService.create());
  const open = (id: string | null) => setParams(id ? { fiche: id } : {}, { replace: false });

  if (ficheId) return <VfChecklistFiche key={ficheId} id={ficheId} onHome={() => open(null)} />;

  const rows = list.data ?? [];
  const cnt = checklistCounters(rows);
  const counters: [string, number][] = [
    ['Brouillons', cnt.drafts],
    ['Envoyées au manager', cnt.sent],
    ['Éligibles (proposition)', cnt.eligible],
    ['Non éligibles (proposition)', cnt.notEligible],
  ];
  const newFiche = async () => {
    try {
      open((await create.mutateAsync(undefined)).id);
    } catch (e) {
      toast(getErrorMessage(e) || 'Création impossible');
    }
  };

  return (
    <>
      <div className="hero2">
        <div className="rev vf-chk-hero">
          <small>
            <VfIcon k="chk" size={16} />
            Checklist de qualification
          </small>
          <b className="vf-chk-b">Un établissement à qualifier ?</b>
          <span className="vf-chk-s">
            Remplissez la fiche sur place. Elle est envoyée à votre manager, qui donne
            l&apos;éligibilité finale.
          </span>
          <button
            type="button"
            className="btn pri"
            disabled={create.isPending}
            onClick={() => void newFiche()}
          >
            + Nouvelle fiche
          </button>
        </div>
        <div className="grid2 vf-chk-kpis">
          {counters.map(([label, value]) => (
            <div className="kpi" key={label}>
              <small>{label}</small>
              <b>{value}</b>
            </div>
          ))}
        </div>
      </div>
      <div className="card">
        <div className="ch">
          <div>
            <h3>Mes fiches</h3>
            <p>Brouillons à reprendre et fiches envoyées au manager.</p>
          </div>
        </div>
        {rows.length === 0 ? (
          <div className="empty">
            <div className="ei">
              <VfIcon k="chk" size={24} />
            </div>
            {list.isPending ? 'Chargement…' : 'Aucune fiche pour le moment.'}
            {!list.isPending && (
              <>
                <br />
                <span className="tiny">
                  Cliquez sur « Nouvelle fiche » pour qualifier votre premier établissement.
                </span>
              </>
            )}
          </div>
        ) : (
          <div className="vf-scroll">
            <table>
              <thead>
                <tr>
                  <th>Établissement</th>
                  <th>Créée le</th>
                  <th>Résultat de la fiche</th>
                  <th>Votre avis</th>
                  <th>Décision du manager</th>
                  <th aria-label="Action" />
                </tr>
              </thead>
              <tbody>
                {rows.map((f) => (
                  <tr key={f.id}>
                    <td>
                      <b>{f.name ?? 'Sans nom'}</b>
                      <br />
                      <span className="tiny">{ficheSubline(f)}</span>
                    </td>
                    <td>{createdLabel(f.created_at)}</td>
                    <td>
                      {f.status === 'draft' || !f.result ? (
                        <span className="tiny">En cours</span>
                      ) : (
                        <span className={`badge ${RESULT_BADGE[f.result].cls}`}>
                          {RESULT_BADGE[f.result].label}
                        </span>
                      )}
                    </td>
                    <td>
                      {f.agent_opinion ? (
                        opinionLabel(f.agent_opinion)
                      ) : (
                        <span className="tiny">–</span>
                      )}
                    </td>
                    <td>
                      <span className={`badge ${MANAGER_BADGE[f.status].cls}`}>
                        {MANAGER_BADGE[f.status].label}
                      </span>
                    </td>
                    <td>
                      <button type="button" className="btn sm" onClick={() => open(f.id)}>
                        {f.status === 'draft' ? 'Reprendre' : 'Voir'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div className="banner vf-banner-info vf-mt16">
        <VfIcon k="alert" size={16} />
        <span>{CIRCUIT_BANNER}</span>
      </div>
    </>
  );
}
