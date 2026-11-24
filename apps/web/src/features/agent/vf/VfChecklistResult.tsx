import { MANAGER_BADGE, RESULT_BADGE, RESULT_LINE } from '@/features/agent/lib/agent-checklists';
import { type Answers, checklistResult } from '@/features/agent/lib/checklist-model';
import type { ChecklistStatus } from '@/features/agent/services/agent-checklists.service';

import { VfIcon } from './VfIcon';

function Block({ title, items, bad = false }: { title: string; items: string[]; bad?: boolean }) {
  if (items.length === 0) return null;
  return (
    <div className={`cblk${bad ? ' bad' : ''}`}>
      <h4>{title}</h4>
      <ul>
        {items.map((x) => (
          <li key={x}>{x}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * AGENT-VF (spec VF §11 « Résultat de la fiche ») — the proposed result (the manager decides):
 * the reasons, conditions, checks and signals, the agent's opinion, then « Envoyer au manager ».
 * A sent fiche shows the same page, read-only, with the manager's decision badge.
 */
export function VfChecklistResult({
  answers: a,
  status,
  sending,
  onEdit,
  onHome,
  onSend,
}: {
  answers: Answers;
  status: ChecklistStatus;
  sending: boolean;
  onEdit: () => void;
  onHome: () => void;
  onSend: () => void;
}) {
  const r = checklistResult(a);
  const sent = status !== 'draft';
  const name = typeof a['nom'] === 'string' && a['nom'] ? a['nom'] : 'Établissement';
  const comment = typeof a['avis_com'] === 'string' ? a['avis_com'] : '';
  return (
    <div className="card cform">
      <div className="cfb">
        <div className="vf-chk-badges">
          <span className={`badge ${RESULT_BADGE[r.res].cls}`}>{RESULT_BADGE[r.res].label}</span>
          <span className={`badge ${MANAGER_BADGE[status].cls}`}>
            {MANAGER_BADGE[status].label}
          </span>
        </div>
        <h2 className="ctitle vf-mt12">{name}</h2>
        <p className="muted vf-chk-line">{RESULT_LINE[r.res]}</p>
        <Block title="Motifs éliminatoires" items={r.motifs} bad />
        <Block title="Conditions à remplir" items={r.cond} />
        <Block title="À vérifier" items={r.verif} />
        <Block title="Signaux à suivre" items={r.sig} />
        <div className="cblk">
          <h4>Votre avis</h4>
          <p className="vf-m0">
            {a['avis'] === 'oui' ? 'Oui, je le propose' : 'Non, je ne le propose pas'}
            {comment ? ` · ${comment}` : ''}
          </p>
        </div>
        <div className="banner vf-banner-info vf-mt14b">
          <VfIcon k="alert" size={16} />
          <span>
            {sent
              ? "Fiche envoyée au manager avec toutes les réponses. Il donnera l'éligibilité finale, puis le récapitulatif sera envoyé à l'admin."
              : 'En envoyant la fiche, toutes les réponses partent au manager. Seule sa décision fait foi et est enregistrée.'}
          </span>
        </div>
      </div>
      <div className="cff">
        <button type="button" className="btn" disabled={sent} onClick={onEdit}>
          Modifier
        </button>
        <button type="button" className="btn" onClick={onHome}>
          Retour à mes fiches
        </button>
        <span className="vf-flex1" />
        {!sent && (
          <button type="button" className="btn pri" disabled={sending} onClick={onSend}>
            Envoyer au manager
          </button>
        )}
      </div>
    </div>
  );
}
