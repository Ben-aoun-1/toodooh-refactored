import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import {
  AGENT_BUILT_PAGES,
  AGENT_PATHS,
  type AgentKind,
  agentSupportObjectives,
} from '@/features/agent/lib/agent-shell';
import { SUPPORT_SENT_TOAST, supportPayloadError } from '@/features/support/lib/support-form';
import { supportService } from '@/features/support/services/support.service';
import { getErrorMessage } from '@/lib/errors';

import { VfIcon } from './VfIcon';
import { useVfOverlay } from './VfOverlay';

/**
 * AGENT-VF (spec VF « Support, FAQ et déconnexion ») — « Écrivez à l'équipe Toodooh »: the link
 * to the FAQ, the reason, a free comment. « Envoyer » stays off until a reason is chosen.
 */
export function VfSupportModal({ kind }: { kind: AgentKind }) {
  const { closeAll, toast } = useVfOverlay();
  const navigate = useNavigate();
  const location = useLocation();
  const [objective, setObjective] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  const send = async () => {
    const payload = {
      kind: 'support' as const,
      objective,
      // « Autre » carries its detail: here the comment itself.
      other_detail: objective === 'Autre' ? message.trim() || undefined : undefined,
      message: message.trim() || undefined,
      origin_page: location.pathname,
    };
    const error = supportPayloadError(payload);
    if (error) {
      toast(error);
      return;
    }
    setSending(true);
    try {
      await supportService.send(payload);
      closeAll();
      toast(SUPPORT_SENT_TOAST);
    } catch (err) {
      toast(getErrorMessage(err) || 'Envoi impossible. Réessayez.');
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <div className="mh">
        <span className="mi">
          <VfIcon k="help" size={18} />
        </span>
        <div>
          <b>Support</b>
          <small>Écrivez à l&apos;équipe Toodooh</small>
        </div>
        <button type="button" className="x" onClick={closeAll} aria-label="Fermer">
          ✕
        </button>
      </div>
      <div className="mb2">
        {AGENT_BUILT_PAGES.has('faq') && (
          <button
            type="button"
            className="banner vf-faq"
            onClick={() => {
              closeAll();
              navigate(AGENT_PATHS.faq);
            }}
          >
            <VfIcon k="help" size={16} />
            <span>
              Une question fréquente ? <b>Consulter la FAQ</b>
            </span>
            <span className="vf-arrow">→</span>
          </button>
        )}
        <div className="f">
          <label htmlFor="vf-sup-motif">
            Motif de la demande <i>*</i>
          </label>
          <select
            id="vf-sup-motif"
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
          >
            <option value="">Choisissez un motif</option>
            {agentSupportObjectives(kind).map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
        </div>
        <div className="f">
          <label htmlFor="vf-sup-msg">Commentaires additionnels</label>
          <textarea
            id="vf-sup-msg"
            rows={4}
            placeholder="Votre message ici…"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
        </div>
      </div>
      <div className="mf">
        <button type="button" className="btn" onClick={closeAll}>
          Annuler
        </button>
        <button
          type="button"
          className="btn pri"
          disabled={!objective || sending}
          onClick={() => void send()}
        >
          Envoyer
        </button>
      </div>
    </>
  );
}
