import { agentFaq } from '@/features/agent/lib/agent-faq';
import type { AgentKind } from '@/features/agent/lib/agent-shell';

import { useVfOverlay } from './VfOverlay';
import { VfSupportModal } from './VfSupportModal';

/** AGENT-VF — the FAQ: the questions of the agent's type, the first one open, then the Support. */
export function VfFaq({ kind }: { kind: AgentKind }) {
  const { openModal } = useVfOverlay();
  return (
    <div className="faq vf-faq-wrap">
      <h2>Vous avez des questions ? Nous avons les réponses.</h2>
      {agentFaq(kind).map((q, i) => (
        <details key={q.question} open={i === 0}>
          <summary>{q.question}</summary>
          <p>{q.answer}</p>
        </details>
      ))}
      <p className="muted vf-faq-foot">
        Vous ne trouvez pas votre réponse ?{' '}
        <button
          type="button"
          className="link"
          onClick={() => openModal(<VfSupportModal kind={kind} />)}
        >
          Écrire au Support
        </button>
      </p>
    </div>
  );
}
